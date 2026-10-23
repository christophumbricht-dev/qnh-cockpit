// Deno tests: YouTube publishing with a mocked Google API and a fake file in Storage (npm run test:functions)
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { type Account, type Deps, publishDue, type Post, type Store } from "./publish.ts";
import { followUpYoutube, nextOffset, parseSession, videoResource } from "./youtube.ts";

const NOW = new Date("2026-10-20T16:00:00Z");
const YT: Account = { id: "yt1", app_id: "leesidelab", platform: "youtube", remote_id: "UCown", handle: "leesidelab", active: true, token_expires_at: null };
const GOOGLE = { clientId: "cid", clientSecret: "secret" };
const CHUNK = 256 * 1024;
const FILE = new Uint8Array(600 * 1024).map((_, i) => i % 251); // 3 pieces: 256 + 256 + 88 KiB
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=SESSION1";

function post(over: Partial<Post> = {}): Post {
  return {
    id: "p1", account_id: "yt1", kind: "reel", title: "Föhn: why is it warm in Altdorf? <Part 1>", caption: "Rain in Ticino, 23 °C in Altdorf.\n\n#foehn #aviation",
    first_comment: "Where have you felt Föhn? 👇", media: [{ path: "p1/v.mp4", type: "video/mp4" }], cover_path: null, status: "approved",
    scheduled_at: "2026-10-20T15:55:00Z", attempts: 0, remote_container_id: null, remote_media_id: null, remote_comment_id: null, permalink: null, ...over,
  };
}

function fakeStore(posts: Post[]) {
  const store: Store & { youtubeWithoutComment(since: Date): Promise<Post[]> } = {
    async claim(postId) {
      const due = posts.filter((p) => (!postId || p.id === postId) && ((p.status === "approved" && new Date(p.scheduled_at!) <= NOW) || p.status === "publishing"));
      for (const p of due) { if (p.status === "approved") p.attempts++; p.status = "publishing"; }
      return due.map((p) => ({ ...p, media: [...p.media] }));
    },
    async account() { return YT; },
    async accounts() { return [YT]; },
    async token() { return "REFRESH"; },
    async storeToken() {},
    async update(id, patch) { Object.assign(posts.find((p) => p.id === id)!, patch); },
    publicUrl: (path) => `https://qnh.supabase.co/storage/v1/object/public/social-media/${path}`,
    async publishedWithFiles() { return []; },
    async removeFiles() {},
    async youtubeWithoutComment(since) {
      return posts.filter((p) => p.status === "published" && !p.remote_comment_id && p.first_comment && p.remote_media_id && new Date(p.published_at!) >= since);
    },
  };
  return store;
}

type Opts = { tokenError?: unknown; startError?: unknown; commentError?: boolean; lose?: number; privacy?: string; fail5xx?: number; chunk400?: boolean; oldDone?: boolean };
const OLD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=OLD";
const oldSession = (fp = "different") => JSON.stringify({ s: OLD, fp, total: FILE.length });
// Google + Storage: token, resumable session, pieces (308 + Range), final video; counts every call
function mockGoogle(o: Opts = {}) {
  let received = 0; // bytes YouTube has
  let sessions = 0;
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }> = [];
  const fetchFn = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, headers, body: init?.body });
    const json = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...h } });
    if (url === "https://oauth2.googleapis.com/token") return o.tokenError ? json(o.tokenError, 400) : json({ access_token: "ACCESS" });
    if (url.includes("/storage/v1/object/public/")) {
      const [, a, b] = headers.Range.match(/bytes=(\d+)-(\d+)/)!.map(Number);
      return new Response(FILE.slice(a, b + 1), { status: 206, headers: { "Content-Range": `bytes ${a}-${b}/${FILE.length}` } });
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=")) {
      if (o.startError) return json(o.startError, 403);
      sessions++;
      received = 0;
      return new Response(null, { status: 200, headers: { Location: SESSION.replace("SESSION1", `SESSION${sessions}`) } });
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=")) {
      assertEquals(init?.redirect, "manual"); // the bearer token never follows a redirect
      const range = headers["Content-Range"];
      const video = { id: "VID1", status: { privacyStatus: o.privacy ?? "public", uploadStatus: "uploaded" } };
      if (url === OLD) return o.oldDone ? json({ ...video, id: "VIDOLD" }, 200) : range.startsWith("bytes */") ? new Response(null, { status: 308, headers: { Range: "bytes=0-1000" } }) : new Response("gone", { status: 404 });
      if (o.chunk400 && !range.startsWith("bytes */")) return json({ error: { message: "Invalid Content-Range", errors: [{ reason: "badRequest" }] } }, 400);
      if (o.fail5xx && !range.startsWith("bytes */") && o.fail5xx-- > 0) return new Response("busy", { status: 503 });
      if (range.startsWith("bytes */")) return received >= FILE.length ? json(video, 200) : new Response(null, { status: 308, headers: received ? { Range: `bytes=0-${received - 1}` } : {} });
      const [, start, end] = range.match(/bytes (\d+)-(\d+)\//)!.map(Number);
      assertEquals(start, received, "pieces in order, no gaps");
      assertEquals((init!.body as Uint8Array).length, end - start + 1);
      received = end + 1;
      if (received < FILE.length) return new Response(null, { status: 308, headers: { Range: `bytes=0-${received - 1}` } });
      if (o.lose && o.lose-- > 0) throw new Error("connection reset"); // the final answer gets lost
      return json(video, 201);
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/commentThreads")) return o.commentError ? json({ error: { message: "The video is processing", errors: [{ reason: "processingFailure" }] } }, 400) : json({ id: "CT1" });
    return json({ error: { message: `no mock for ${method} ${url}` } }, 500);
  };
  return { fetchFn, calls, sessions: () => sessions, sent: () => calls.filter((c) => c.method === "PUT" && !String(c.headers["Content-Range"]).startsWith("bytes */")).length };
}

const deps = (store: Store, fetchFn: Deps["fetch"], over: Partial<Deps> = {}): Deps =>
  ({ store, fetch: fetchFn, sleep: async () => {}, now: () => NOW, google: GOOGLE, chunkSize: CHUNK, ...over });

Deno.test("youtube: resumable upload in pieces → Short link → first comment; title and settings", async () => {
  const posts = [post()];
  const g = mockGoogle();
  const r = await publishDue(deps(fakeStore(posts), g.fetchFn));
  assertEquals(r, [{ id: "p1", status: "published" }]);
  assertEquals([posts[0].remote_media_id, posts[0].permalink, posts[0].remote_comment_id, posts[0].last_error], ["VID1", "https://www.youtube.com/shorts/VID1", "CT1", null]);
  assertEquals(g.sent(), 3);
  const start = g.calls.find((c) => c.url.includes("part=snippet,status"))!;
  const meta = JSON.parse(String(start.body));
  assertEquals(meta.snippet.title, "Föhn: why is it warm in Altdorf? Part 1"); // < > are not allowed on YouTube
  assertEquals([meta.snippet.categoryId, meta.status.privacyStatus, meta.status.selfDeclaredMadeForKids], ["27", "public", false]);
  assertEquals(start.headers["X-Upload-Content-Length"], String(FILE.length));
  assertEquals(start.headers.Authorization, "Bearer ACCESS");
  assertEquals(parseSession(posts[0].remote_container_id)?.s, SESSION); // session kept for a resume
  assertEquals(parseSession(posts[0].remote_container_id)?.total, FILE.length);
});

Deno.test("youtube: out of time mid-upload → next run continues the same session, no second video", async () => {
  const posts = [post()];
  const store = fakeStore(posts);
  const g = mockGoogle();
  let t = NOW.getTime();
  const clock = () => new Date(t);
  // deadline passes after the first piece
  const origFetch = g.fetchFn;
  const timed = async (u: string | URL, i?: RequestInit) => { const res = await origFetch(u, i); if (i?.method === "PUT") t += 60_000; return res; };
  const r1 = await publishDue(deps(store, timed, { now: clock, deadline: NOW.getTime() + 30_000 }));
  assertEquals(r1[0].status, "processing");
  assertEquals(posts[0].status, "publishing");
  assertMatch(posts[0].last_error as string, /Upload läuft \(43 %\)/);
  const r2 = await publishDue(deps(store, g.fetchFn));
  assertEquals(r2[0].status, "published");
  assertEquals(g.sessions(), 1);
  assertEquals(g.sent(), 3);
  assertEquals(posts[0].attempts, 1); // continuing is not a new attempt
});

Deno.test("youtube: the final answer got lost → the session says done → no re-upload, no lost attempt", async () => {
  const posts = [post()];
  const store = fakeStore(posts);
  const g = mockGoogle({ lose: 1 });
  assertEquals((await publishDue(deps(store, g.fetchFn)))[0].status, "published");
  assertEquals([posts[0].remote_media_id, posts[0].attempts], ["VID1", 1]);
  assertEquals([g.sessions(), g.sent()], [1, 3]);
});

Deno.test("youtube: a Google hiccup (503) mid-upload → ask the session, go on from there", async () => {
  const posts = [post()];
  const g = mockGoogle({ fail5xx: 2 });
  assertEquals((await publishDue(deps(fakeStore(posts), g.fetchFn)))[0].status, "published");
  assertEquals(g.sessions(), 1);
});

Deno.test("youtube: post edited after the upload had started → a fresh session with the new title", async () => {
  const posts = [post({ status: "approved", attempts: 1, remote_container_id: oldSession() })];
  const g = mockGoogle();
  await publishDue(deps(fakeStore(posts), g.fetchFn));
  assertEquals([posts[0].status, posts[0].remote_media_id, g.sessions()], ["published", "VID1", 1]);
  assert(!g.calls.some((c) => c.url === OLD && !String(c.headers["Content-Range"]).startsWith("bytes */")), "no bytes into the old session");
});

Deno.test("youtube: an old session that had finished is taken (no second video), with a note", async () => {
  const posts = [post({ status: "approved", attempts: 1, remote_container_id: oldSession() })];
  const g = mockGoogle({ oldDone: true });
  await publishDue(deps(fakeStore(posts), g.fetchFn));
  assertEquals([posts[0].remote_media_id, g.sessions()], ["VIDOLD", 0]);
  assertMatch(posts[0].last_error as string, /vor deiner letzten Änderung/);
});

Deno.test("youtube: a session that refuses the pieces is dropped → the retry starts clean", async () => {
  const posts = [post()];
  const g = mockGoogle({ chunk400: true });
  await publishDue(deps(fakeStore(posts), g.fetchFn));
  assertEquals([posts[0].status, posts[0].remote_container_id], ["failed", null]);
});

Deno.test("publish: out of time → the remaining claimed posts wait for the next run", async () => {
  const posts = [post({ id: "a" }), post({ id: "b" })];
  let t = NOW.getTime();
  const g = mockGoogle();
  const timed = async (u: string | URL, i?: RequestInit) => { t += 30_000; return await g.fetchFn(u, i); };
  const r = await publishDue(deps(fakeStore(posts), timed, { now: () => new Date(t), deadline: NOW.getTime() + 60_000, chunkSize: 1024 * 1024 }));
  assertEquals(r.length, 1);
  assertEquals(posts[1].status, "publishing"); // claimed, untouched, resumed by the next run
});

Deno.test("youtube: daily quota → waits without counting an attempt; revoked access fails with a German message", async () => {
  const posts = [post()];
  const g = mockGoogle({ startError: { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } } });
  assertEquals((await publishDue(deps(fakeStore(posts), g.fetchFn)))[0].status, "waiting");
  assertEquals([posts[0].status, posts[0].attempts], ["approved", 0]);
  assertMatch(posts[0].last_error as string, /Tageskontingent/);

  const p2 = [post({ id: "p2" })];
  const g2 = mockGoogle({ tokenError: { error: "invalid_grant", error_description: "Token has been expired or revoked." } });
  await publishDue(deps(fakeStore(p2), g2.fetchFn));
  assertEquals(p2[0].status, "failed");
  assertMatch(p2[0].last_error as string, /YouTube verbinden/);
});

Deno.test("youtube: no title or no Google keys → stopped before anything is uploaded", async () => {
  const posts = [post({ title: "  " }), post({ id: "p2" })];
  const g = mockGoogle();
  await publishDue(deps(fakeStore(posts), g.fetchFn, { google: null }));
  assertEquals(posts.map((p) => p.status), ["failed", "failed"]);
  assertMatch(posts[0].last_error as string, /Titel/);
  assertMatch(posts[1].last_error as string, /GOOGLE_CLIENT_ID/);
  assertEquals(g.calls.length, 0);
});

Deno.test("youtube: first comment refused while processing → follow-up writes it later; private video is flagged", async () => {
  const posts = [post()];
  const store = fakeStore(posts);
  await publishDue(deps(store, mockGoogle({ commentError: true, privacy: "private" }).fetchFn));
  assertEquals([posts[0].status, posts[0].remote_comment_id], ["published", null]);
  assertMatch(posts[0].last_error as string, /privat.*erste Kommentar folgt/s);
  posts[0].published_at = NOW.toISOString();
  const r = await followUpYoutube({ store, fetch: mockGoogle().fetchFn, now: () => new Date(NOW.getTime() + 20 * 60_000), google: GOOGLE });
  assertEquals(r, [{ id: "p1", status: "commented" }]);
  assertEquals(posts[0].remote_comment_id, "CT1");
  assertMatch(posts[0].last_error as string, /privat/);
  assert(!/Kommentar folgt/.test(posts[0].last_error as string));
});

Deno.test("youtube follow-up: at the end of the window it says «von Hand» once, and a later success removes it", async () => {
  const posts = [post({ status: "published", remote_media_id: "VID1", published_at: NOW.toISOString(), last_error: "YouTube hat das Video als «private» gespeichert – in YouTube Studio prüfen. Der erste Kommentar folgt, sobald YouTube das Video fertig verarbeitet hat." })];
  const store = fakeStore(posts);
  const late = () => new Date(NOW.getTime() + 100 * 60_000);
  let writes = 0;
  const counting = { ...store, update: async (id: string, patch: Record<string, unknown>) => { writes++; await store.update(id, patch); } };
  await followUpYoutube({ store: counting, fetch: mockGoogle({ commentError: true }).fetchFn, now: late, google: GOOGLE });
  await followUpYoutube({ store: counting, fetch: mockGoogle({ commentError: true }).fetchFn, now: late, google: GOOGLE });
  assertEquals(writes, 1);
  assertMatch(posts[0].last_error as string, /privat.*von Hand schreiben/s);
  assert(!/folgt/.test(posts[0].last_error as string));
  await followUpYoutube({ store, fetch: mockGoogle().fetchFn, now: late, google: GOOGLE });
  assertEquals(posts[0].last_error, "YouTube hat das Video als «private» gespeichert – in YouTube Studio prüfen.");
});

Deno.test("youtube: helpers", () => {
  assertEquals([nextOffset("bytes=0-262143"), nextOffset(null)], [262144, 0]);
  const long = videoResource(post({ caption: "ä".repeat(3000) }));
  assertEquals(new TextEncoder().encode(long.snippet.description).length <= 5000, true);
});

Deno.test("youtube: «für Kinder» wird als selfDeclaredMadeForKids hochgeladen", () => {
  assertEquals(videoResource(post()).status.selfDeclaredMadeForKids, false);
  assertEquals(videoResource(post({ made_for_kids: true })).status.selfDeclaredMadeForKids, true);
});
