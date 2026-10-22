// Deno tests with a fake store and a mocked Graph API: npm run test:functions
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { cleanup, MAX_ATTEMPTS, publishDue, refreshTokens, type Account, type Deps, type Post, type Store } from "./publish.ts";

const NOW = new Date("2026-10-20T10:00:00Z");
const ACCOUNT: Account = { id: "acc1", platform: "instagram", remote_id: "IG1", handle: "flydownwind", active: true, token_expires_at: "2026-10-30T00:00:00Z" };

function post(over: Partial<Post> = {}): Post {
  return {
    id: "p1", account_id: "acc1", kind: "image", caption: "Hello #pilot", first_comment: "", media: [{ path: "acc1/p1/1.jpg", type: "image/jpeg", alt: "Plane" }],
    cover_path: null, status: "approved", scheduled_at: "2026-10-20T09:50:00Z", attempts: 0,
    remote_container_id: null, remote_media_id: null, remote_comment_id: null, permalink: null, ...over,
  };
}

// in-memory store that behaves like social_claim(): approved + due → publishing, attempts + 1
function fakeStore(posts: Post[], accounts: Account[] = [ACCOUNT]) {
  const tokens = new Map<string, string>([["acc1", "TOKEN"]]);
  const removed: string[] = [];
  const store: Store = {
    async claim(postId) {
      const due = posts.filter((p) => (!postId || p.id === postId) && ((p.status === "approved" && new Date(p.scheduled_at!) <= NOW) || p.status === "publishing"));
      for (const p of due) { if (p.status === "approved") p.attempts++; p.status = "publishing"; }
      return due.map((p) => ({ ...p, media: [...p.media] }));
    },
    async account(id) { return accounts.find((a) => a.id === id)!; },
    async accounts() { return accounts; },
    async token(id) { return tokens.get(id)!; },
    async storeToken(id, token, expiresAt) { tokens.set(id, token); accounts.find((a) => a.id === id)!.token_expires_at = expiresAt?.toISOString() ?? null; },
    async update(id, patch) { Object.assign(posts.find((p) => p.id === id)!, patch); },
    publicUrl: (path) => `https://qnh.supabase.co/storage/v1/object/public/social-media/${path}`,
    async publishedWithFiles(before) { return posts.filter((p) => p.status === "published" && !p.media_deleted_at && new Date(p.published_at!) < before); },
    async removeFiles(paths) { removed.push(...paths); },
  };
  return { store, tokens, removed };
}

type Call = { method: string; path: string; params: Record<string, string> };
// routes: "METHOD path" → response body (object) or function(params, call#) → body; Error → HTTP error body
function mockGraph(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetchFn = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (params[k] = v));
    if (init?.body) new URLSearchParams(String(init.body)).forEach((v, k) => (params[k] = v));
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "").replace(/^\//, "");
    const key = `${method} ${path}`;
    calls.push({ method, path, params });
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    let body = routes[key];
    if (typeof body === "function") body = body(params, n);
    if (body === undefined) return new Response(JSON.stringify({ error: { message: `no mock for ${key}`, code: 1 } }), { status: 500 });
    const status = (body as { error?: unknown }).error ? 400 : 200;
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchFn, calls, count: (key: string) => counts.get(key) ?? 0 };
}

const deps = (store: Store, fetchFn: Deps["fetch"], over: Partial<Deps> = {}): Deps =>
  ({ store, fetch: fetchFn, sleep: async () => {}, now: () => NOW, pollMs: 1, maxPolls: 5, ...over });

const LIMIT_OK = { data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }] };

Deno.test("image: container → publish → permalink → first comment", async () => {
  const posts = [post({ first_comment: "#downwind #ppl" })];
  const { store } = fakeStore(posts);
  const g = mockGraph({
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": { id: "C1" },
    "GET C1": { status_code: "FINISHED" },
    "POST IG1/media_publish": { id: "M1" },
    "GET M1": { permalink: "https://www.instagram.com/p/abc/" },
    "POST M1/comments": { id: "K1" },
  });
  const r = await publishDue(deps(store, g.fetchFn));
  assertEquals(r, [{ id: "p1", status: "published" }]);
  assertEquals(posts[0].status, "published");
  assertEquals(posts[0].remote_media_id, "M1");
  assertEquals(posts[0].remote_comment_id, "K1");
  assertEquals(posts[0].permalink, "https://www.instagram.com/p/abc/");
  const create = g.calls.find((c) => c.method === "POST" && c.path === "IG1/media")!;
  assertEquals(create.params.alt_text, "Plane");
  assertMatch(create.params.image_url, /social-media\/acc1\/p1\/1\.jpg$/);
  assert(!g.calls.some((c) => c.method === "GET" && "access_token" in c.params && c.path.includes("media_publish")));
  assertEquals(create.params.access_token, "TOKEN"); // token sent in the POST body
});

Deno.test("reel: polls the video until FINISHED", async () => {
  const posts = [post({ kind: "reel", media: [{ path: "acc1/p1/v.mp4", type: "video/mp4" }], cover_path: "acc1/p1/cover.jpg" })];
  const { store } = fakeStore(posts);
  const g = mockGraph({
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": { id: "C2" },
    "GET C2": (_p: unknown, n: number) => ({ status_code: n < 3 ? "IN_PROGRESS" : "FINISHED" }),
    "POST IG1/media_publish": { id: "M2" },
    "GET M2": { permalink: "https://www.instagram.com/reel/x/" },
  });
  await publishDue(deps(store, g.fetchFn));
  assertEquals(posts[0].status, "published");
  assertEquals(g.count("GET C2"), 3);
  const create = g.calls.find((c) => c.path === "IG1/media")!;
  assertEquals(create.params.media_type, "REELS");
  assertMatch(create.params.cover_url, /cover\.jpg$/);
});

Deno.test("video still processing after this run: stays publishing, next run continues without a new container", async () => {
  const posts = [post({ kind: "story", media: [{ path: "acc1/p1/s.mp4", type: "video/mp4" }] })];
  const { store } = fakeStore(posts);
  let ready = false;
  const g = mockGraph({
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": { id: "C3" },
    "GET C3": () => ({ status_code: ready ? "FINISHED" : "IN_PROGRESS" }),
    "POST IG1/media_publish": { id: "M3" },
    "GET M3": {},
  });
  assertEquals((await publishDue(deps(store, g.fetchFn, { maxPolls: 2 })))[0].status, "processing");
  assertEquals(posts[0].status, "publishing");
  assertEquals(posts[0].remote_container_id, "C3");
  ready = true;
  await publishDue(deps(store, g.fetchFn));
  assertEquals(posts[0].status, "published");
  assertEquals(g.count("POST IG1/media"), 1);
  assertEquals(posts[0].attempts, 1); // resuming is not a new attempt
});

Deno.test("failure → retry next run → success; after 3 attempts → failed", async () => {
  const posts = [post()];
  const { store } = fakeStore(posts);
  let broken = true;
  const g = mockGraph({
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": () => (broken ? { error: { message: "Service temporarily unavailable", code: 2 } } : { id: "C4" }),
    "GET C4": { status_code: "FINISHED" },
    "POST IG1/media_publish": { id: "M4" },
    "GET M4": {},
  });
  const r1 = await publishDue(deps(store, g.fetchFn));
  assertEquals(r1[0].status, "retry");
  assertEquals(posts[0].status, "approved");
  assertMatch(posts[0].last_error as string, /Versuch 1 von 3/);
  broken = false;
  await publishDue(deps(store, g.fetchFn));
  assertEquals(posts[0].status, "published");

  const failing = [post({ id: "p9" })];
  const s2 = fakeStore(failing).store;
  const g2 = mockGraph({ "GET IG1/content_publishing_limit": LIMIT_OK, "POST IG1/media": { error: { message: "Boom", code: 2 } } });
  for (let i = 0; i < MAX_ATTEMPTS; i++) await publishDue(deps(s2, g2.fetchFn));
  assertEquals(failing[0].status, "failed");
  assertEquals(failing[0].attempts, MAX_ATTEMPTS);
  assertMatch(failing[0].last_error as string, /Instagram meldet: Boom/);
});

Deno.test("no double posting: a post with remote_media_id is only finished, never published again", async () => {
  const posts = [post({ status: "publishing", remote_container_id: "C5", remote_media_id: "M5", attempts: 1 })];
  const { store } = fakeStore(posts);
  const g = mockGraph({ "GET M5": { permalink: "https://www.instagram.com/p/m5/" } });
  await publishDue(deps(store, g.fetchFn));
  assertEquals(posts[0].status, "published");
  assertEquals(g.count("POST IG1/media_publish"), 0);
  assertEquals(g.count("POST IG1/media"), 0);
});

Deno.test("no double posting: container already PUBLISHED (lost response) is matched, not re-published", async () => {
  const posts = [post({ status: "publishing", remote_container_id: "C6", attempts: 1 })];
  const { store } = fakeStore(posts);
  const g = mockGraph({
    "GET C6": { status_code: "PUBLISHED" },
    "GET IG1/media": { data: [{ id: "M6", timestamp: "2026-10-20T09:55:00+0000" }, { id: "OLD", timestamp: "2026-10-01T09:00:00+0000" }] },
    "GET M6": { permalink: "https://www.instagram.com/p/m6/" },
  });
  await publishDue(deps(store, g.fetchFn));
  assertEquals(posts[0].status, "published");
  assertEquals(posts[0].remote_media_id, "M6");
  assertEquals(g.count("POST IG1/media_publish"), 0);
});

Deno.test("daily limit reached: nothing is created, post waits, attempt not counted", async () => {
  const posts = [post()];
  const { store } = fakeStore(posts);
  const g = mockGraph({ "GET IG1/content_publishing_limit": { data: [{ quota_usage: 100, config: { quota_total: 100 } }] } });
  const r = await publishDue(deps(store, g.fetchFn));
  assertEquals(r[0].status, "waiting");
  assertEquals(posts[0].status, "approved");
  assertEquals(posts[0].attempts, 0);
  assertEquals(g.count("POST IG1/media"), 0);
  assertMatch(posts[0].last_error as string, /Tageslimit/);
});

Deno.test("expired token fails at once with a German explanation", async () => {
  const posts = [post()];
  const { store } = fakeStore(posts);
  const g = mockGraph({ "GET IG1/content_publishing_limit": { error: { message: "Error validating access token", code: 190 } } });
  await publishDue(deps(store, g.fetchFn));
  assertEquals(posts[0].status, "failed");
  assertMatch(posts[0].last_error as string, /Token/);
});

Deno.test("carousel: child containers, then the carousel container", async () => {
  const posts = [post({ kind: "carousel", media: [{ path: "a/1.jpg", type: "image/jpeg" }, { path: "a/2.mp4", type: "video/mp4" }] })];
  const { store } = fakeStore(posts);
  let n = 0;
  const g = mockGraph({
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": () => ({ id: `K${++n}` }),
    "GET K1": { status_code: "FINISHED" }, "GET K2": { status_code: "FINISHED" }, "GET K3": { status_code: "FINISHED" },
    "POST IG1/media_publish": { id: "M7" },
    "GET M7": {},
  });
  await publishDue(deps(store, g.fetchFn));
  const creates = g.calls.filter((c) => c.path === "IG1/media" && c.method === "POST");
  assertEquals(creates.length, 3);
  assertEquals(creates[1].params.media_type, "VIDEO");
  assertEquals(creates[2].params.media_type, "CAROUSEL");
  assertEquals(creates[2].params.children, "K1,K2");
  assertEquals(posts[0].status, "published");
});

Deno.test("facebook is prepared but off by default", async () => {
  const fb: Account = { ...ACCOUNT, id: "fb1", platform: "facebook", remote_id: "PAGE1" };
  const posts = [post({ account_id: "fb1" })];
  const { store } = fakeStore(posts, [ACCOUNT, fb]);
  await publishDue(deps(store, mockGraph({}).fetchFn));
  assertEquals(posts[0].status, "failed");
  assertMatch(posts[0].last_error as string, /Facebook ist noch nicht eingeschaltet/);
});

Deno.test("token refresh: only tokens that expire soon, written back with the new expiry", async () => {
  const later: Account = { ...ACCOUNT, id: "acc2", token_expires_at: "2026-12-30T00:00:00Z" };
  const { store, tokens } = fakeStore([], [ACCOUNT, later]);
  tokens.set("acc2", "OTHER");
  const g = mockGraph({ "GET refresh_access_token": { access_token: "NEW", token_type: "bearer", expires_in: 5184000 } });
  const r = await refreshTokens(deps(store, g.fetchFn));
  assertEquals(r, [{ id: "acc1", status: "refreshed" }]);
  assertEquals(tokens.get("acc1"), "NEW");
  assertEquals(tokens.get("acc2"), "OTHER");
  assertEquals(ACCOUNT.token_expires_at, new Date(NOW.getTime() + 5184000 * 1000).toISOString());
});

Deno.test("cleanup deletes files of posts published more than 14 days ago", async () => {
  const old = { ...post({ id: "old", status: "published", cover_path: "a/c.jpg" }), published_at: "2026-10-01T10:00:00Z" } as Post;
  const fresh = { ...post({ id: "new", status: "published" }), published_at: "2026-10-19T10:00:00Z" } as Post;
  const { store, removed } = fakeStore([old, fresh]);
  await cleanup(deps(store, mockGraph({}).fetchFn));
  assertEquals(removed, ["acc1/p1/1.jpg", "a/c.jpg"]);
  assert(old.media_deleted_at);
  assert(!fresh.media_deleted_at);
});

Deno.test("user_tags go to the image containers (single image and carousel images), never to videos", async () => {
  const tag = [{ username: "exploring_the_skies", x: 0.5, y: 0.9 }];
  const posts = [
    post({ id: "p1", media: [{ path: "a/1.jpg", type: "image/jpeg", user_tags: tag }] }),
    post({ id: "p2", kind: "carousel", media: [{ path: "a/2.jpg", type: "image/jpeg", user_tags: [...tag, { username: "bad name!", x: 0.1, y: 0.1 }] }, { path: "a/3.mp4", type: "video/mp4", user_tags: tag }] }),
  ];
  const { store } = fakeStore(posts);
  let n = 0;
  const g = mockGraph({
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": () => ({ id: `K${++n}` }),
    "GET K1": { status_code: "FINISHED" }, "GET K2": { status_code: "FINISHED" }, "GET K3": { status_code: "FINISHED" }, "GET K4": { status_code: "FINISHED" },
    "POST IG1/media_publish": () => ({ id: `M${n}` }),
    "GET M1": {}, "GET M4": {},
    "POST M1/comments": { id: "C1" }, "POST M4/comments": { id: "C4" },
  });
  await publishDue(deps(store, g.fetchFn));
  const creates = g.calls.filter((c) => c.path === "IG1/media" && c.method === "POST");
  assertEquals(creates[0].params.user_tags, JSON.stringify(tag));
  assertEquals(creates[1].params.user_tags, JSON.stringify(tag)); // invalid name dropped
  assertEquals(creates[2].params.user_tags, undefined); // video
  assertEquals(creates[3].params.user_tags, undefined); // carousel container
});

Deno.test("carousel with different image formats is stopped before anything is posted", async () => {
  const posts = [post({ kind: "carousel", media: [
    { path: "a/1.jpg", type: "image/jpeg", width: 1080, height: 1080 },
    { path: "a/2.jpg", type: "image/jpeg", width: 1080, height: 1350 },
  ] })];
  const { store } = fakeStore(posts);
  const g = mockGraph({ "GET IG1/content_publishing_limit": LIMIT_OK });
  await publishDue(deps(store, g.fetchFn));
  assertEquals(g.calls.filter((c) => c.method === "POST").length, 0);
  assertEquals(posts[0].status, "failed");
  assertMatch(posts[0].last_error!, /unterschiedliche Formate/);
});

Deno.test("location: sent for images (not stories); refused location → posted without, with a note", async () => {
  const loc = { id: "112233445566", name: "Flugplatz Birrfeld" };
  const posts = [post({ id: "p1", location: loc }), post({ id: "p2", kind: "story", location: loc })];
  const { store } = fakeStore(posts);
  let n = 0;
  const g = mockGraph({
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": () => ({ id: `K${++n}` }),
    "GET K1": { status_code: "FINISHED" }, "GET K2": { status_code: "FINISHED" },
    "POST IG1/media_publish": () => ({ id: `M${n}` }),
    "GET M1": {}, "GET M2": {}, "POST M1/comments": { id: "C1" },
  });
  await publishDue(deps(store, g.fetchFn));
  const creates = g.calls.filter((c) => c.path === "IG1/media" && c.method === "POST");
  assertEquals(creates[0].params.location_id, "112233445566");
  assertEquals(creates[1].params.location_id, undefined); // story

  const refused = [post({ id: "p3", location: loc })];
  const s2 = fakeStore(refused);
  let tries = 0;
  const g2 = mockGraph({
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": (params: Record<string, string>) => (++tries, params.location_id ? { error: { message: "Invalid location_id" } } : { id: "K9" }),
    "GET K9": { status_code: "FINISHED" },
    "POST IG1/media_publish": { id: "M9" }, "GET M9": {}, "POST M9/comments": { id: "C9" },
  });
  await publishDue(deps(s2.store, g2.fetchFn));
  assertEquals(tries, 2);
  assertEquals(refused[0].status, "published");
  assertMatch(refused[0].last_error!, /Standort «Flugplatz Birrfeld»/);
});

Deno.test("AI label: is_ai_generated on image, reel and carousel parent – not on children, not without the flag", async () => {
  const media2 = [{ path: "a/1.jpg", type: "image/jpeg", width: 1080, height: 1350 }, { path: "a/2.jpg", type: "image/jpeg", width: 1080, height: 1350 }];
  const posts = [
    post({ id: "p1", ai_generated: true }),
    post({ id: "p2", kind: "reel", ai_generated: true, media: [{ path: "a/v.mp4", type: "video/mp4", width: 1080, height: 1920 }] }),
    post({ id: "p3", kind: "carousel", ai_generated: true, media: media2 }),
    post({ id: "p4" }),
  ];
  const { store } = fakeStore(posts);
  let n = 0;
  const routes: Record<string, unknown> = {
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": () => ({ id: `K${++n}` }),
    "POST IG1/media_publish": () => ({ id: `M${n}` }),
  };
  for (let i = 1; i <= 8; i++) { routes[`GET K${i}`] = { status_code: "FINISHED" }; routes[`GET M${i}`] = {}; routes[`POST M${i}/comments`] = { id: `C${i}` }; }
  const g = mockGraph(routes);
  await publishDue(deps(store, g.fetchFn));
  const creates = g.calls.filter((c) => c.path === "IG1/media" && c.method === "POST").map((c) => c.params);
  assertEquals(posts.map((p) => p.status), ["published", "published", "published", "published"]);
  assertEquals(String(creates[0].is_ai_generated), "true"); // image
  assertEquals(String(creates[1].is_ai_generated), "true"); // reel
  assertEquals(creates[2].is_ai_generated, undefined); // carousel child
  assertEquals(creates[3].is_ai_generated, undefined); // carousel child
  assertEquals(String(creates[4].is_ai_generated), "true"); // carousel container
  assertEquals(creates[5].is_ai_generated, undefined); // no flag
});

Deno.test("AI label on a story: tried; refused → story posted without, with a note", async () => {
  const story = [post({ id: "s1", kind: "story", ai_generated: true })];
  const { store } = fakeStore(story);
  let tries = 0;
  const g = mockGraph({
    "GET IG1/content_publishing_limit": LIMIT_OK,
    "POST IG1/media": (params: Record<string, string>) => (++tries, params.is_ai_generated ? { error: { message: "(#100) Invalid parameter", code: 100 } } : { id: "K7" }),
    "GET K7": { status_code: "FINISHED" },
    "POST IG1/media_publish": { id: "M7" }, "GET M7": {},
  });
  await publishDue(deps(store, g.fetchFn));
  assertEquals(tries, 2);
  assertEquals(story[0].status, "published");
  assertMatch(story[0].last_error!, /KI-Info bei Storys/);
});

Deno.test("files are checked before Instagram: missing file or no media → failed at once, nothing sent", async () => {
  const posts = [post({ id: "p1" }), post({ id: "p2", media: [] })];
  const { store } = fakeStore(posts);
  store.missingFiles = async (paths) => paths.filter((p) => p.includes("acc1/p1"));
  const g = mockGraph({ "GET IG1/content_publishing_limit": LIMIT_OK });
  await publishDue(deps(store, g.fetchFn));
  assertEquals(g.calls.filter((c) => c.method === "POST").length, 0);
  assertEquals(posts[0].status, "failed");
  assertMatch(posts[0].last_error!, /Datei fehlt im Speicher \(1\.jpg\).*Erneut versuchen/);
  assertEquals(posts[1].status, "failed");
  assertMatch(posts[1].last_error!, /Kein Bild\/Video/);
});

Deno.test("Graph error text names the code and what to do", async () => {
  const { germanError } = await import("./publish.ts");
  const { GraphError } = await import("./graph.ts");
  assertMatch(germanError(new GraphError("Media download has failed", 400, 9004, 2207052)), /neu hochladen.*\(Code 9004\/2207052\)/);
  assertMatch(germanError(new GraphError("Something else", 400, 100)), /Instagram meldet: Something else \(Code 100\)/);
});
