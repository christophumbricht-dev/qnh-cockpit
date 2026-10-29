// Deno tests: a long YouTube video of the Digital Studio – file in Cloudflare R2, uploaded privately a day ahead with
// title picture and captions, public at the planned time (npm run test:functions)
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { type Account, type Deps, publishDue, type Post, type Store } from "./publish.ts";
import { EXTRA_TRIES, isLong, PRE_NOTE, preuploadYoutube, type PreStore, videoResource } from "./youtube.ts";

const PLAN = new Date("2026-11-01T16:00:00Z"); // Sunday 17:00 Swiss time
const DAY_BEFORE = new Date(PLAN.getTime() - 20 * 3600_000);
const YT: Account = { id: "yt1", app_id: "leesidelab", platform: "youtube", remote_id: "UCown", handle: "leesidelab", active: true, token_expires_at: null };
const GOOGLE = { clientId: "cid", clientSecret: "secret" };
const R2 = { accountId: "acc123", jurisdiction: "eu", bucket: "qnh-studio", accessKeyId: "AKID", secretAccessKey: "SECRETKEY" };
const CHUNK = 256 * 1024;
const FILE = new Uint8Array(700 * 1024).map((_, i) => (i * 7) % 251); // 3 pieces
const SRT = "1\n00:00:00,000 --> 00:00:02,000\nYou feel perfectly level.\n";
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const KEY = "studio/artificial-horizon/v1/video.mp4";

function post(over: Partial<Post> = {}): Post {
  return {
    id: "p1", account_id: "yt1", kind: "reel", title: "Your Body Lies in a Cloud. This Instrument Doesn't.", caption: "Fly into a cloud and your inner ear starts to lie.\n\n0:00 Into the white",
    first_comment: "At 10:33 two instruments look almost identical …", status: "approved", scheduled_at: PLAN.toISOString(), attempts: 0,
    media: [{ path: KEY, type: "video/mp4", source: "r2", width: 1920, height: 1080, duration: 889, captions: "studio/artificial-horizon/v1/captions_en.srt", lang: "en" }],
    cover_path: "p1/thumb-0.jpg", remote_container_id: null, remote_media_id: null, remote_comment_id: null, permalink: null, ...over,
  };
}

function fakeStore(posts: Post[], clock: () => Date) {
  const store: Store & PreStore = {
    async claim(postId) {
      const due = posts.filter((p) => (!postId || p.id === postId) && ((p.status === "approved" && new Date(p.scheduled_at!) <= clock()) || p.status === "publishing"));
      for (const p of due) { if (p.status === "approved") p.attempts++; p.status = "publishing"; }
      return due.map((p) => structuredClone(p));
    },
    async youtubeUpcoming(from, until) {
      return posts.filter((p) => p.status === "approved" && new Date(p.scheduled_at!) > from && new Date(p.scheduled_at!) <= until).map((p) => structuredClone(p));
    },
    async account() { return YT; },
    async accounts() { return [YT]; },
    async token() { return "REFRESH"; },
    async storeToken() {},
    async update(id, patch) { Object.assign(posts.find((p) => p.id === id)!, patch); },
    publicUrl: (path) => `https://qnh.supabase.co/storage/v1/object/public/social-media/${path}`,
    async publishedWithFiles() { return []; },
    async removeFiles() {},
  };
  return store;
}

type Opts = { oldDone?: boolean; thumb403?: boolean; thumbQuota?: number; captionFails?: number; publicAs?: string; gone?: boolean };
function mockApi(o: Opts = {}) {
  let received = 0, sessions = 0;
  const privacy: string[] = [];
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }> = [];
  const fetchFn = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, headers, body: init?.body });
    const json = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...h } });
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "ACCESS" });
    if (url.startsWith("https://acc123.eu.r2.cloudflarestorage.com/qnh-studio/")) {
      assert(!headers.Authorization, "no bearer token ever goes to R2");
      assertMatch(url, /X-Amz-Signature=[0-9a-f]{64}/);
      if (url.includes("captions_en.srt")) return new Response(SRT, { status: 200 });
      const [, a, b] = headers.Range.match(/bytes=(\d+)-(\d+)/)!.map(Number);
      return new Response(FILE.slice(a, b + 1), { status: 206, headers: { "Content-Range": `bytes ${a}-${b}/${FILE.length}` } });
    }
    if (url === "https://qnh.supabase.co/storage/v1/object/public/social-media/p1/thumb-0.jpg" || url.endsWith("/p1/thumb-1.jpg")) return new Response(JPG, { status: 200 });
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=")) {
      sessions++;
      received = 0;
      privacy.push(JSON.parse(String(init?.body)).status.privacyStatus);
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=S${sessions}` } });
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=")) {
      const range = headers["Content-Range"];
      if (url.endsWith("upload_id=OLD")) return o.oldDone ? json({ id: "VIDOLD", status: { privacyStatus: "private" } }, 200) : new Response("gone", { status: 404 });
      const video = { id: `VID${sessions}`, status: { privacyStatus: privacy.at(-1), uploadStatus: "uploaded" } };
      if (range.startsWith("bytes */")) return received >= FILE.length ? json(video, 200) : new Response(null, { status: 308, headers: received ? { Range: `bytes=0-${received - 1}` } : {} });
      const [, start, end] = range.match(/bytes (\d+)-(\d+)\//)!.map(Number);
      assertEquals(start, received, "pieces in order");
      received = end + 1;
      return received < FILE.length ? new Response(null, { status: 308, headers: { Range: `bytes=0-${received - 1}` } }) : json(video, 201);
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?")) {
      assertEquals(headers["Content-Type"], "image/jpeg");
      if (o.thumbQuota && o.thumbQuota-- > 0) return json({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403);
      return o.thumb403 ? json({ error: { message: "The authenticated user doesn't have permissions to upload and set custom video thumbnails.", errors: [{ reason: "forbidden" }] } }, 403) : json({ items: [{}] });
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart")) {
      if (o.captionFails && o.captionFails-- > 0) return json({ error: { message: "Backend error", errors: [{ reason: "backendError" }] } }, 500);
      assertMatch(headers["Content-Type"], /^multipart\/related; boundary=qnh[0-9a-f]+$/);
      assertMatch(String(init?.body), /"language":"en"[\s\S]*You feel perfectly level\./);
      return json({ id: "CAP1" });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/videos?") && method === "GET") {
      const id = new URL(url).searchParams.get("id");
      if (o.gone) return json({ items: [] });
      return json({ items: [{ id, snippet: { title: "old", tags: ["kept tag"], defaultLanguage: "en" }, status: { privacyStatus: "private", uploadStatus: "processed", embeddable: true, license: "youtube", publicStatsViewable: false, madeForKids: false } }] });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/videos?part=") && method === "PUT") {
      const b = JSON.parse(String(init?.body));
      return json({ id: b.id, status: { privacyStatus: o.publicAs ?? b.status.privacyStatus } });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/commentThreads")) return json({ id: "CT1" });
    return json({ error: { message: `no mock for ${method} ${url}` } }, 500);
  };
  const count = (re: RegExp) => calls.filter((c) => re.test(c.url)).length;
  return { fetchFn, calls, privacy, sessions: () => sessions, count };
}

const deps = (store: Store, fetchFn: Deps["fetch"], now: () => Date, over: Partial<Deps> = {}): Deps =>
  ({ store, fetch: fetchFn, sleep: async () => {}, now, google: GOOGLE, r2: R2, chunkSize: CHUNK, ...over });

Deno.test("long video: a day ahead private from R2 with title picture and captions → on time public (status only), watch link, comment", async () => {
  const posts = [post()];
  let now = DAY_BEFORE;
  const store = fakeStore(posts, () => now);
  const api = mockApi();
  assertEquals(await preuploadYoutube(deps(store, api.fetchFn, () => now)), [{ id: "p1", status: "preuploaded" }]);
  assertEquals([posts[0].status, posts[0].remote_media_id, api.privacy], ["approved", "VID1", ["private"]]);
  assertEquals([api.count(/thumbnails\/set/), api.count(/\/captions\?/)], [1, 1]);
  assertMatch(posts[0].last_error as string, new RegExp(`^${PRE_NOTE}; geht am So\\.?, 1\\.11\\., 17:00 öffentlich\\.$`));
  const start = api.calls.find((c) => c.url.includes("part=snippet,status"))!;
  const meta = JSON.parse(String(start.body));
  assertEquals([meta.snippet.defaultAudioLanguage, meta.snippet.title], ["en", "Your Body Lies in a Cloud. This Instrument Doesn't."]);

  // the next runs of the day: everything is done – not a single call
  const before = api.calls.length;
  now = new Date(DAY_BEFORE.getTime() + 600_000);
  assertEquals(await preuploadYoutube(deps(store, api.fetchFn, () => now)), []);
  assertEquals(api.calls.length, before);

  // the planned time: no second upload, only the status goes public
  now = new Date(PLAN.getTime() + 60_000);
  assertEquals(await publishDue(deps(store, api.fetchFn, () => now)), [{ id: "p1", status: "published" }]);
  assertEquals(api.sessions(), 1);
  const flip = api.calls.find((c) => c.method === "PUT" && c.url.startsWith("https://www.googleapis.com/youtube/v3/videos?"))!;
  assertMatch(flip.url, /part=status$/);
  // what Christoph set in YouTube Studio stays (statistics hidden), read-only fields are not sent back
  assertEquals(JSON.parse(String(flip.body)), { id: "VID1", status: { embeddable: true, license: "youtube", publicStatsViewable: false, privacyStatus: "public", selfDeclaredMadeForKids: false } });
  assertEquals([posts[0].status, posts[0].permalink, posts[0].remote_comment_id, posts[0].last_error], ["published", "https://www.youtube.com/watch?v=VID1", "CT1", null]);
  assertEquals([api.count(/thumbnails\/set/), api.count(/\/captions\?/)], [1, 1]); // nothing set twice
});

Deno.test("long video: withdrawn after the pre-upload is never published; edited and approved again → title and description follow", async () => {
  const posts = [post()];
  let now = DAY_BEFORE;
  const store = fakeStore(posts, () => now);
  const api = mockApi();
  await preuploadYoutube(deps(store, api.fetchFn, () => now));
  posts[0].status = "draft"; // withdrawn in the cockpit (the server fields stay)
  now = new Date(PLAN.getTime() + 60_000);
  assertEquals(await publishDue(deps(store, api.fetchFn, () => now)), []);
  assert(!api.calls.some((c) => c.method === "PUT" && c.url.startsWith("https://www.googleapis.com/youtube/v3/videos?")), "a withdrawn post never goes public");
  Object.assign(posts[0], { status: "approved", title: "Left or Right? The Instrument Mistake Pilots Still Fear", scheduled_at: new Date(PLAN.getTime() + 3600_000).toISOString() });
  now = new Date(PLAN.getTime() + 2 * 3600_000);
  await publishDue(deps(store, api.fetchFn, () => now));
  const flip = api.calls.find((c) => c.method === "PUT" && c.url.startsWith("https://www.googleapis.com/youtube/v3/videos?"))!;
  assertMatch(decodeURIComponent(flip.url), /part=snippet,status$/);
  assertEquals(JSON.parse(String(flip.body)).snippet.title, "Left or Right? The Instrument Mistake Pilots Still Fear");
  assertEquals(JSON.parse(String(flip.body)).snippet.tags, ["kept tag"]); // tags added in YouTube Studio stay
  assertEquals([posts[0].status, api.sessions()], ["published", 1]);
});

Deno.test("long video: a new cut after the pre-upload → uploaded again, the old private video is named for deleting", async () => {
  const posts = [post()];
  let now = DAY_BEFORE;
  const store = fakeStore(posts, () => now);
  const api = mockApi();
  await preuploadYoutube(deps(store, api.fetchFn, () => now));
  posts[0].media = [{ ...posts[0].media[0], path: "studio/artificial-horizon/v2/video.mp4" }];
  now = new Date(DAY_BEFORE.getTime() + 600_000);
  await preuploadYoutube(deps(store, api.fetchFn, () => now));
  assertEquals([api.sessions(), posts[0].remote_media_id], [2, "VID2"]);
  assertMatch(posts[0].last_error as string, /ältere private Fassung.*youtu\.be\/VID1.*löschen/);
  now = new Date(PLAN.getTime() + 60_000);
  await publishDue(deps(store, api.fetchFn, () => now));
  assertEquals([posts[0].status, posts[0].permalink], ["published", "https://www.youtube.com/watch?v=VID2"]);
  assertMatch(posts[0].last_error as string, /youtu\.be\/VID1/);
});

Deno.test("long video: title picture refused (channel not verified) → tried once, a clear note; captions retried, then fine", async () => {
  const posts = [post()];
  let now = DAY_BEFORE;
  const store = fakeStore(posts, () => now);
  const api = mockApi({ thumb403: true, captionFails: 1 });
  await preuploadYoutube(deps(store, api.fetchFn, () => now));
  assertMatch(posts[0].last_error as string, /Titelbild nicht gesetzt: Eigene Titelbilder erlaubt YouTube erst.*Untertitel: neuer Versuch/s);
  for (let i = 1; i <= EXTRA_TRIES; i++) {
    now = new Date(DAY_BEFORE.getTime() + i * 600_000);
    await preuploadYoutube(deps(store, api.fetchFn, () => now));
  }
  assertEquals([api.count(/thumbnails\/set/), api.count(/\/captions\?/)], [1, 2]);
  now = new Date(PLAN.getTime() + 60_000);
  await publishDue(deps(store, api.fetchFn, () => now));
  assertEquals(posts[0].status, "published");
  assertMatch(posts[0].last_error as string, /^Titelbild nicht gesetzt: Eigene Titelbilder.*– bitte in YouTube Studio setzen\.$/);
  assertEquals(api.count(/thumbnails\/set/), 1);
});

Deno.test("long video: upload not finished by the planned time → the publish run continues the private session, then public", async () => {
  const posts = [post()];
  let now = DAY_BEFORE;
  const store = fakeStore(posts, () => now);
  const api = mockApi();
  const timed = async (u: string | URL, i?: RequestInit) => { const r = await api.fetchFn(u, i); if (i?.method === "PUT") now = new Date(now.getTime() + 60_000); return r; };
  assertEquals(await preuploadYoutube(deps(store, timed, () => now, { deadline: DAY_BEFORE.getTime() + 30_000 })), [{ id: "p1", status: "preuploading" }]);
  assertMatch(posts[0].last_error as string, /^Vorab-Upload auf YouTube läuft \(37 %\) – privat, geht am So\.?, 1\.11\., 17:00 öffentlich\.$/);
  now = new Date(PLAN.getTime() + 60_000);
  assertEquals((await publishDue(deps(store, api.fetchFn, () => now)))[0].status, "published");
  assertEquals([api.sessions(), api.privacy, posts[0].attempts], [1, ["private"], 1]);
  assertEquals([api.count(/thumbnails\/set/), api.count(/\/captions\?/)], [1, 1]);
});

Deno.test("long video: without the R2 secrets the pre-upload waits with a German note, nothing goes to YouTube", async () => {
  const posts = [post()];
  const store = fakeStore(posts, () => DAY_BEFORE);
  const api = mockApi();
  const r = await preuploadYoutube(deps(store, api.fetchFn, () => DAY_BEFORE, { r2: null }));
  assertEquals(r[0].status, "preupload-waiting");
  assertMatch(posts[0].last_error as string, /^Vorab-Upload geht nicht: .*R2-Secrets/);
  assertEquals([posts[0].status, api.sessions()], ["approved", 0]);
});

Deno.test("long video helpers: Shorts stay Shorts; landscape and studio videos are long; language only when valid", () => {
  assert(!isLong(post({ media: [{ path: "a/1.mp4", type: "video/mp4", width: 1080, height: 1920, duration: 50 }] })));
  assert(isLong(post({ media: [{ path: "a/1.mp4", type: "video/mp4", width: 1920, height: 1080, duration: 50 }] })));
  assert(isLong(post({ media: [{ path: "a/1.mp4", type: "video/mp4", duration: 181 }] })));
  assert(isLong(post()));
  assertEquals(videoResource(post({ media: [{ path: "a", type: "video/mp4", lang: "en; drop table" }] })).snippet, {
    title: "Your Body Lies in a Cloud. This Instrument Doesn't.", description: post().caption, categoryId: "27" });
});

Deno.test("long video: a refused daily quota is no try for the title picture; a new picture is tried again", async () => {
  const posts = [post()];
  let now = DAY_BEFORE;
  const store = fakeStore(posts, () => now);
  const api = mockApi({ thumbQuota: 2 });
  await preuploadYoutube(deps(store, api.fetchFn, () => now));
  assertMatch(posts[0].last_error as string, /Titelbild: wartet auf das YouTube-Kontingent/);
  now = new Date(now.getTime() + 600_000);
  await preuploadYoutube(deps(store, api.fetchFn, () => now));
  now = new Date(now.getTime() + 600_000);
  await preuploadYoutube(deps(store, api.fetchFn, () => now));
  assertEquals(api.count(/thumbnails\/set/), 3); // two refusals, then set
  assertMatch(posts[0].last_error as string, new RegExp(`^${PRE_NOTE}; geht am`));
  // not verified (403 forbidden): given up at once; a different picture later is tried again
  const p2 = [post({ id: "p2" })];
  const s2 = fakeStore(p2, () => DAY_BEFORE);
  const a2 = mockApi({ thumb403: true });
  await preuploadYoutube(deps(s2, a2.fetchFn, () => DAY_BEFORE));
  p2[0].cover_path = "p1/thumb-1.jpg";
  await preuploadYoutube(deps(s2, a2.fetchFn, () => new Date(DAY_BEFORE.getTime() + 600_000)));
  assertEquals(a2.count(/thumbnails\/set/), 2);
});

Deno.test("long video: while a pre-upload run works on the post, «Jetzt veröffentlichen» waits instead of writing to the same session", async () => {
  const posts = [post()];
  const store = fakeStore(posts, () => PLAN);
  posts[0].remote_container_id = JSON.stringify({ s: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=S9", fp: "x", total: 1, busy: PLAN.getTime() + 120_000 });
  posts[0].scheduled_at = new Date(PLAN.getTime() - 60_000).toISOString();
  const api = mockApi();
  assertEquals(await publishDue(deps(store, api.fetchFn, () => PLAN)), [{ id: "p1", status: "processing" }]);
  assertMatch(posts[0].last_error as string, /Vorab-Upload läuft gerade/);
  assertEquals(api.calls.length, 0);
});

Deno.test("long video: deleted in YouTube Studio before the planned time → the retry uploads it again", async () => {
  const posts = [post()];
  let now = DAY_BEFORE;
  const store = fakeStore(posts, () => now);
  await preuploadYoutube(deps(store, mockApi().fetchFn, () => now));
  now = new Date(PLAN.getTime() + 60_000);
  const r = await publishDue(deps(store, mockApi({ gone: true }).fetchFn, () => now));
  assertEquals(r[0].status, "retry");
  assertEquals([posts[0].status, posts[0].remote_media_id], ["approved", null]);
  assertMatch(posts[0].last_error as string, /nicht mehr da/);
});

Deno.test("long video: missing secrets are shown as a problem (red), not as progress, and written once", async () => {
  const posts = [post()];
  const store = fakeStore(posts, () => DAY_BEFORE);
  let writes = 0;
  const counting = { ...store, update: async (id: string, patch: Record<string, unknown>) => { if ("last_error" in patch) writes++; await store.update(id, patch); } };
  await preuploadYoutube(deps(counting, mockApi().fetchFn, () => DAY_BEFORE, { r2: null }));
  await preuploadYoutube(deps(counting, mockApi().fetchFn, () => new Date(DAY_BEFORE.getTime() + 600_000), { r2: null }));
  assertMatch(posts[0].last_error as string, /^Vorab-Upload geht nicht: .*R2-Secrets/);
  assertEquals(writes, 1);
  assertEquals(JSON.parse(posts[0].remote_container_id ?? "null"), null); // the busy mark is gone again
});

Deno.test("long video: an older session finished after all (lost answer) → it counts as the old cut, the current cut goes up next", async () => {
  const posts = [post({ media: [{ ...post().media[0], path: "studio/artificial-horizon/v2/video.mp4" }] })];
  posts[0].remote_container_id = JSON.stringify({ s: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=OLD", fp: "old", total: FILE.length, file: KEY, meta: "old" });
  let now = DAY_BEFORE;
  const store = fakeStore(posts, () => now);
  const api = mockApi({ oldDone: true });
  assertEquals(await preuploadYoutube(deps(store, api.fetchFn, () => now)), [{ id: "p1", status: "preuploading" }]);
  assertEquals(posts[0].remote_media_id, null);
  assertMatch(posts[0].last_error as string, /ältere Fassung/);
  now = new Date(now.getTime() + 600_000);
  await preuploadYoutube(deps(store, api.fetchFn, () => now));
  assertEquals([posts[0].remote_media_id, api.sessions()], ["VID1", 1]);
  now = new Date(PLAN.getTime() + 60_000);
  await publishDue(deps(store, api.fetchFn, () => now));
  assertEquals(posts[0].permalink, "https://www.youtube.com/watch?v=VID1");
  assertMatch(posts[0].last_error as string, /youtu\.be\/VIDOLD.*löschen/);
});
