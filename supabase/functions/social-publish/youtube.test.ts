// Deno tests: YouTube publishing with a mocked Google API and a fake file in Storage (npm run test:functions)
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { type Account, type Deps, publishDue, type Post, type Store } from "./publish.ts";
import { followUpYoutube, nextOffset, videoResource } from "./youtube.ts";

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

type Opts = { tokenError?: unknown; startError?: unknown; commentError?: boolean; lose?: number; expire?: boolean; privacy?: string };
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
      if (o.expire) return new Response("gone", { status: 404 });
      const range = headers["Content-Range"];
      const video = { id: "VID1", status: { privacyStatus: o.privacy ?? "public", uploadStatus: "uploaded" } };
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
  assertEquals(posts[0].remote_container_id, SESSION); // session kept for a resume
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

Deno.test("youtube: the final answer got lost → the session says done → no re-upload", async () => {
  const posts = [post()];
  const store = fakeStore(posts);
  const g = mockGoogle({ lose: 1 });
  assertEquals((await publishDue(deps(store, g.fetchFn)))[0].status, "retry");
  assertEquals(posts[0].status, "approved");
  await publishDue(deps(store, g.fetchFn));
  assertEquals([posts[0].status, posts[0].remote_media_id], ["published", "VID1"]);
  assertEquals([g.sessions(), g.sent()], [1, 3]);
});

Deno.test("youtube: expired session starts a new upload", async () => {
  const posts = [post({ status: "publishing", attempts: 1, remote_container_id: SESSION })];
  const g = mockGoogle({ expire: true });
  await publishDue(deps(fakeStore(posts), g.fetchFn));
  assertEquals(g.sessions(), 1);
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

Deno.test("youtube: helpers", () => {
  assertEquals([nextOffset("bytes=0-262143"), nextOffset(null)], [262144, 0]);
  const long = videoResource(post({ caption: "ä".repeat(3000) }));
  assertEquals(new TextEncoder().encode(long.snippet.description).length <= 5000, true);
});
