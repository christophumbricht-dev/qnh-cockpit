// Deno tests: comment inbox with a fake store and mocked Instagram / Google APIs (npm run test:functions)
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  type CommentDeps, type CommentRow, type CommentsStore, fetchComments, mergeComments, moderate, replyTo, type StoredComment,
  youtubeAuth, youtubeConnect,
} from "./comments.ts";
import type { Account } from "./publish.ts";

const NOW = new Date("2026-10-20T12:00:00Z");
const IG: Account = { id: "ig1", app_id: "leesidelab", platform: "instagram", remote_id: "IGU", handle: "leesidelab", active: true, token_expires_at: null };
const YT: Account = { id: "yt1", app_id: "leesidelab", platform: "youtube", remote_id: "UCown", handle: "leesidelab", active: true, token_expires_at: null };
const GOOGLE = { clientId: "cid.apps.googleusercontent.com", clientSecret: "test-secret" };
const ALLOWED = ["https://cockpit.setqnh.ch/youtube-callback.html"];

function fakeStore(accounts: Account[] = [IG, YT], rows: StoredComment[] = []) {
  const tokens = new Map<string, string>([["ig1", "IGTOKEN"], ["yt1", "REFRESH1"]]);
  let n = rows.length;
  const store: CommentsStore & { rows: StoredComment[]; tokens: Map<string, string>; accountsList: Account[] } = {
    rows, tokens, accountsList: accounts,
    async accounts() { return accounts; },
    async account(id) { return accounts.find((a) => a.id === id)!; },
    async token(id) { return tokens.get(id)!; },
    async storeToken(id, t) { tokens.set(id, t); },
    async comments(id) { return rows.filter((r) => r.account_id === id).map((r) => ({ ...r })); },
    async comment(id) { const r = rows.find((x) => x.id === id); return r ? { ...r } : null; },
    async insertComments(list) {
      for (const r of list) if (!rows.some((x) => x.account_id === r.account_id && x.remote_id === r.remote_id)) rows.push({ id: `c${++n}`, draft: "", replied_at: null, ...r } as unknown as StoredComment);
    },
    async updateComments(list) {
      for (const r of list) Object.assign(rows.find((x) => x.account_id === r.account_id && x.remote_id === r.remote_id)!, r);
    },
    async updateComment(id, patch) { Object.assign(rows.find((x) => x.id === id)!, patch); },
    async claimReply(id, at) {
      const r = rows.find((x) => x.id === id)!;
      if (r.replied_at && Date.parse(at) - Date.parse(r.replied_at) < 60_000) return false;
      r.replied_at = at;
      return true;
    },
    async markDeleted(ids, at) { for (const id of ids) rows.find((x) => x.id === id)!.deleted_at = at; },
    async upsertAccount(row) {
      let a = accounts.find((x) => x.app_id === row.app_id && x.platform === row.platform);
      if (!a) { a = { id: `acc${accounts.length + 1}`, active: true, token_expires_at: null, ...row } as Account; accounts.push(a); }
      else Object.assign(a, row);
      return a;
    },
  };
  return store;
}

type Call = { method: string; key: string; params: Record<string, string>; json?: Record<string, unknown>; auth?: string };
// routes: "GET ig:IGU/media", "POST google:token", "GET yt:commentThreads" … → body | (params, n, call) => body; { error } → HTTP 400
function mockApi(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetchFn = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (params[k] = v));
    let json: Record<string, unknown> | undefined;
    if (init?.body instanceof URLSearchParams) init.body.forEach((v, k) => (params[k] = v));
    else if (typeof init?.body === "string") json = JSON.parse(init.body);
    const host = url.host === "graph.instagram.com" ? "ig" : url.host === "oauth2.googleapis.com" ? "google" : "yt";
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "").replace(/^\/youtube\/v3\//, "").replace(/^\//, "");
    const key = `${method} ${host}:${path}`;
    const call = { method, key, params, json, auth: (init?.headers as Record<string, string> | undefined)?.Authorization };
    calls.push(call);
    const c = (counts.get(key) ?? 0) + 1;
    counts.set(key, c);
    let body = routes[key];
    if (typeof body === "function") body = body(params, c, call);
    if (body === undefined) return new Response(JSON.stringify({ error: { message: `no mock for ${key}`, code: 1 } }), { status: 500 });
    if (body === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(body), { status: (body as { error?: unknown }).error ? 400 : 200 });
  };
  return { fetchFn, calls, count: (key: string) => counts.get(key) ?? 0 };
}

const deps = (store: CommentsStore, fetchFn: CommentDeps["fetch"], google: CommentDeps["google"] = GOOGLE): CommentDeps => ({ store, fetch: fetchFn, now: () => NOW, google });

const row = (over: Partial<CommentRow> = {}): CommentRow => ({
  account_id: "ig1", remote_id: "k1", parent_remote_id: null, media_id: "M1", media_title: "Föhn, part 1", media_permalink: "https://www.instagram.com/reel/a/",
  author: "pilot_anna", author_url: null, body: "Great!", posted_at: "2026-10-20T10:00:00+0000", like_count: 0, own: false, held: false, ...over,
});
const stored = (over: Partial<StoredComment> = {}): StoredComment => {
  const { hidden: _h, ...base } = row(over as Partial<CommentRow>);
  return { ...base, id: "s1", status: "new", draft: "", replied_at: null, deleted_at: null, fetched_at: "2026-10-19T00:00:00Z", ...over };
};
const youtubeToken = { "POST google:token": { access_token: "ACCESS", expires_in: 3599 } };

Deno.test("merge: new comments are open, own and already-answered ones are done", () => {
  const plan = mergeComments([], [
    row({ remote_id: "k1", posted_at: "2026-10-20T10:00:00+0000" }),
    row({ remote_id: "k2", posted_at: "2026-10-20T10:30:00+0000" }),
    row({ remote_id: "r1", parent_remote_id: "k1", author: "leesidelab", own: true, posted_at: "2026-10-20T11:00:00+0000" }),
  ], () => true, NOW.toISOString());
  const status = Object.fromEntries(plan.inserts.map((r) => [r.remote_id, r.status]));
  assertEquals(status, { k1: "done", k2: "new", r1: "done" }); // k1 was answered in the Instagram app
});

Deno.test("merge: same comment with another timestamp format is no update; changes and revivals are", () => {
  const e = stored({ id: "s1", remote_id: "k1", posted_at: "2026-10-20T10:00:00+00:00" });
  assertEquals(mergeComments([e], [row({ remote_id: "k1" })], () => true, NOW.toISOString()).updates.length, 0);
  assertEquals(mergeComments([e], [row({ remote_id: "k1", like_count: 3 })], () => true, NOW.toISOString()).updates.length, 1);
  const gone = stored({ id: "s1", remote_id: "k1", deleted_at: "2026-10-20T11:00:00Z" });
  const plan = mergeComments([gone], [row({ remote_id: "k1" })], () => true, NOW.toISOString());
  assertEquals(plan.updates[0].deleted_at, null);
  assert(!("status" in plan.updates[0]), "updates never touch the status Christoph set");
});

Deno.test("merge: missing comments are deleted only when the post was read completely (and not just sent)", () => {
  const old = stored({ id: "s1", remote_id: "k1" });
  const fresh = stored({ id: "s2", remote_id: "k2", fetched_at: "2026-10-20T11:50:00Z" });
  const hidden = stored({ id: "s3", remote_id: "k3", status: "hidden" });
  assertEquals(mergeComments([old, fresh, hidden], [], () => true, NOW.toISOString()).deletions, ["s1"]);
  assertEquals(mergeComments([old], [], () => false, NOW.toISOString()).deletions, []);
});

Deno.test("merge: Instagram's hidden flag becomes the status", () => {
  const e = stored({ id: "s1", remote_id: "k1" });
  assertEquals(mergeComments([e], [row({ remote_id: "k1", hidden: true })], () => true, NOW.toISOString()).statusChanges, [{ id: "s1", status: "hidden" }]);
  const h = stored({ id: "s1", remote_id: "k1", status: "hidden" });
  assertEquals(mergeComments([h], [row({ remote_id: "k1", hidden: false })], () => true, NOW.toISOString()).statusChanges, [{ id: "s1", status: "done" }]);
});

Deno.test("instagram: only posts whose comment count changed are read; replies keep their thread", async () => {
  const store = fakeStore([IG], [stored({ id: "s1", remote_id: "old", media_id: "M2" })]);
  const api = mockApi({
    "GET ig:IGU/media": { data: [
      { id: "M1", caption: "Föhn, part 1\n\nWhy is it warm?", permalink: "https://www.instagram.com/reel/a/", comments_count: 3 },
      { id: "M2", caption: "Fog", permalink: "https://www.instagram.com/reel/b/", comments_count: 1 },
    ] },
    "GET ig:M1/comments": { data: [
      { id: "k1", text: "Where is this?", timestamp: "2026-10-20T10:00:00+0000", username: "pilot_anna", like_count: 2,
        replies: { data: [{ id: "r1", text: "Altdorf!", timestamp: "2026-10-20T10:05:00+0000", username: "LeesideLab" }] } },
      { id: "k2", text: "🔥", timestamp: "2026-10-20T10:10:00+0000", username: "bob" },
    ] },
  });
  const res = await fetchComments(deps(store, api.fetchFn));
  assertEquals(res, [{ account: "leesidelab", platform: "instagram", status: "ok", new: 1 }]); // k1 answered, k2 new
  assertEquals(api.count("GET ig:M2/comments"), 0); // unchanged count
  const k1 = store.rows.find((r) => r.remote_id === "k1")!;
  assertEquals([k1.status, k1.media_title, k1.like_count, k1.author_url], ["done", "Föhn, part 1", 2, "https://www.instagram.com/pilot_anna/"]);
  const r1 = store.rows.find((r) => r.remote_id === "r1")!;
  assertEquals([r1.parent_remote_id, r1.own], ["k1", true]);
  assertEquals(store.rows.find((r) => r.remote_id === "k2")!.status, "new");
  assertEquals(api.calls[1].params.access_token, "IGTOKEN");
});

Deno.test("instagram: falls back to the basic field set when Instagram refuses a field", async () => {
  const store = fakeStore([IG]);
  const api = mockApi({
    "GET ig:IGU/media": { data: [{ id: "M1", caption: "x", comments_count: 1 }] },
    "GET ig:M1/comments": (p: Record<string, string>) => (p.fields.includes("hidden")
      ? { error: { message: "(#100) Tried accessing nonexisting field (hidden)", code: 100 } }
      : { data: [{ id: "k1", text: "hi", username: "anna", timestamp: "2026-10-20T10:00:00+0000" }] }),
  });
  await fetchComments(deps(store, api.fetchFn));
  assertEquals(store.rows.length, 1);
  assertEquals(api.count("GET ig:M1/comments"), 2);
});

Deno.test("youtube: refresh token → threads, replies, held comments, video titles; own channel recognised", async () => {
  const store = fakeStore([YT]);
  const thread = (id: string, video: string, author: string, channel: string, replies: unknown[] = [], total = replies.length) => ({
    id, snippet: { videoId: video, totalReplyCount: total, topLevelComment: { id, snippet: { authorDisplayName: author, authorChannelId: { value: channel }, textDisplay: `text ${id}`, likeCount: 1, publishedAt: "2026-10-20T09:00:00Z", videoId: video } } },
    replies: { comments: replies },
  });
  const reply = (id: string, parent: string, channel: string) => ({ id, snippet: { parentId: parent, authorDisplayName: "@leesidelab", authorChannelId: { value: channel }, textDisplay: "thanks", publishedAt: "2026-10-20T09:30:00Z" } });
  const api = mockApi({
    ...youtubeToken,
    "GET yt:commentThreads": (p: Record<string, string>) => p.moderationStatus === "heldForReview"
      ? { items: [thread("h1", "V1", "@spam", "UCspam")] }
      : { items: [thread("t1", "V1", "@anna", "UCanna", [reply("t1.r1", "t1", "UCown")]), thread("t2", "V2", "@bob", "UCbob", [], 7)] },
    "GET yt:comments": { items: [reply("t2.r1", "t2", "UCx"), reply("t2.r2", "t2", "UCown")] },
    "GET yt:videos": { items: [{ id: "V1", snippet: { title: "Föhn – part 1" } }, { id: "V2", snippet: { title: "Fog sea" } }] },
  });
  const res = await fetchComments(deps(store, api.fetchFn));
  assertEquals(res[0].status, "ok");
  const tok = api.calls.find((c) => c.key === "POST google:token")!;
  assertEquals([tok.params.grant_type, tok.params.refresh_token], ["refresh_token", "REFRESH1"]);
  assertEquals(api.calls.find((c) => c.key === "GET yt:commentThreads")!.auth, "Bearer ACCESS");
  const by = (id: string) => store.rows.find((r) => r.remote_id === id)!;
  assertEquals([by("t1").status, by("t1").media_title, by("t1").media_permalink], ["done", "Föhn – part 1", "https://www.youtube.com/watch?v=V1"]);
  assertEquals([by("t1.r1").own, by("t1.r1").parent_remote_id], [true, "t1"]);
  assertEquals(by("h1").held, true);
  assertEquals(by("t2").status, "done"); // our reply t2.r2 came from the full replies list
  assertEquals(api.calls.find((c) => c.key === "GET yt:comments")!.params.parentId, "t2");
});

Deno.test("fetch: one broken account does not stop the others; YouTube without Google keys says so", async () => {
  const store = fakeStore([IG, YT]);
  const api = mockApi({ "GET ig:IGU/media": { error: { message: "Invalid OAuth access token", code: 190 } } });
  const res = await fetchComments(deps(store, api.fetchFn, null));
  assertEquals(res.map((r) => r.status), ["failed", "failed"]);
  assertMatch(res[0].error!, /Token/);
  assertMatch(res[1].error!, /GOOGLE_CLIENT_ID/);
});

Deno.test("reply on Instagram: into the thread of the top comment, saved as our own, marked done", async () => {
  const store = fakeStore([IG], [stored({ id: "s1", remote_id: "k1" }), stored({ id: "s2", remote_id: "r9", parent_remote_id: "k1", author: "bob" })]);
  const api = mockApi({ "POST ig:k1/replies": { id: "r10" } });
  const res = await replyTo(deps(store, api.fetchFn), "s2", "  @bob thanks!  ");
  assertEquals(res, { id: "s2", status: "replied", reply_id: "r10" });
  assertEquals(api.calls[0].params.message, "@bob thanks!");
  const mine = store.rows.find((r) => r.remote_id === "r10")!;
  assertEquals([mine.own, mine.parent_remote_id, mine.status, mine.author], [true, "k1", "done", "leesidelab"]);
  const s2 = store.rows.find((r) => r.id === "s2")!;
  assertEquals([s2.status, s2.replied_at], ["done", NOW.toISOString()]);
  // a second click right away is refused – no double answer
  let refused = "";
  await replyTo(deps(store, api.fetchFn), "s2", "again").catch((e) => (refused = e.message));
  assertMatch(refused, /doppelt/);
  assertEquals(api.count("POST ig:k1/replies"), 1);
});

Deno.test("reply on YouTube: comments.insert with parentId; empty or too long text is refused", async () => {
  const store = fakeStore([YT], [stored({ id: "s1", account_id: "yt1", remote_id: "t1" })]);
  const api = mockApi({ ...youtubeToken, "POST yt:comments": { id: "t1.mine", snippet: {} } });
  await replyTo(deps(store, api.fetchFn), "s1", "Danke!");
  const call = api.calls.find((c) => c.key === "POST yt:comments")!;
  assertEquals([call.params.part, call.json], ["snippet", { snippet: { parentId: "t1", textOriginal: "Danke!" } }]);
  for (const text of ["   ", "x".repeat(2201)]) {
    let msg = "";
    await replyTo(deps(store, api.fetchFn), "s1", text).catch((e) => (msg = e.message));
    assert(msg, "refused");
  }
});

Deno.test("moderate: hide/show on Instagram, reversible hide on YouTube, delete only own", async () => {
  const store = fakeStore([IG, YT], [
    stored({ id: "s1", remote_id: "k1" }),
    stored({ id: "s2", account_id: "yt1", remote_id: "t1", held: true }),
    stored({ id: "s3", remote_id: "mine", own: true, status: "done" }),
  ]);
  const api = mockApi({ ...youtubeToken, "POST ig:k1": { success: true }, "POST yt:comments/setModerationStatus": 204, "DELETE ig:mine": { success: true } });
  await moderate(deps(store, api.fetchFn), "s1", "hide");
  assertEquals(api.calls[0].params.hide, "true");
  assertEquals(store.rows[0].status, "hidden");
  await moderate(deps(store, api.fetchFn), "s1", "show");
  assertEquals(store.rows[0].status, "done");
  await moderate(deps(store, api.fetchFn), "s2", "hide");
  assertEquals(api.calls.find((c) => c.key === "POST yt:comments/setModerationStatus")!.params, { id: "t1", moderationStatus: "heldForReview" });
  await moderate(deps(store, api.fetchFn), "s2", "approve");
  assertEquals([store.rows[1].held, store.rows[1].status], [false, "new"]);
  let msg = "";
  await moderate(deps(store, api.fetchFn), "s1", "delete").catch((e) => (msg = e.message));
  assertMatch(msg, /eigenen/);
  await moderate(deps(store, api.fetchFn), "s3", "delete");
  assertEquals(store.rows[2].deleted_at, NOW.toISOString());
  assertEquals(api.calls.find((c) => c.key === "DELETE ig:mine")!.params.access_token, "IGTOKEN");
});

Deno.test("youtube connect: sign-in URL, code → refresh token in the store, channel becomes the account", async () => {
  const { url } = youtubeAuth(GOOGLE, ALLOWED, "leesidelab", ALLOWED[0], "state-1234567890abcdef");
  const u = new URL(url);
  assertEquals([u.searchParams.get("access_type"), u.searchParams.get("redirect_uri"), u.searchParams.get("client_id")], ["offline", ALLOWED[0], GOOGLE.clientId]);
  assertMatch(u.searchParams.get("scope")!, /youtube\.upload.*youtube\.force-ssl/);
  let msg = "";
  try { youtubeAuth(GOOGLE, ALLOWED, "leesidelab", "https://evil.example/cb", "state-1234567890abcdef"); } catch (e) { msg = (e as Error).message; }
  assertMatch(msg, /nicht erlaubt/);

  const store = fakeStore([IG]);
  const scope = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl";
  const api = mockApi({
    "POST google:token": { access_token: "ACCESS", refresh_token: "1//REFRESH-NEW", scope },
    "GET yt:channels": { items: [{ id: "UCleeside", snippet: { title: "Leeside Lab", customUrl: "@leesidelab" } }] },
  });
  const res = await youtubeConnect(deps(store, api.fetchFn), ALLOWED, "leesidelab", "CODE", ALLOWED[0]);
  assertEquals([res.handle, res.title], ["leesidelab", "Leeside Lab"]);
  const acc = store.accountsList.find((a) => a.platform === "youtube")!;
  assertEquals([acc.remote_id, (acc as unknown as { token_name: string }).token_name], ["UCleeside", "google_token_leesidelab_youtube"]);
  assertEquals(store.tokens.get(acc.id), "1//REFRESH-NEW");
  const ex = api.calls[0];
  assertEquals([ex.params.grant_type, ex.params.code, ex.params.redirect_uri], ["authorization_code", "CODE", ALLOWED[0]]);
});

Deno.test("youtube connect: a missing permission tick is refused before anything is stored", async () => {
  const store = fakeStore([IG]);
  const api = mockApi({ "POST google:token": { access_token: "A", refresh_token: "R", scope: "https://www.googleapis.com/auth/youtube.upload" } });
  let msg = "";
  await youtubeConnect(deps(store, api.fetchFn), ALLOWED, "leesidelab", "CODE", ALLOWED[0]).catch((e) => (msg = e.message));
  assertMatch(msg, /Häkchen/);
  assertEquals(store.accountsList.length, 1);
});

Deno.test("merge: a stored open comment answered in the app since the last run becomes done", () => {
  const e = stored({ id: "s1", remote_id: "k1", posted_at: "2026-10-20T10:00:00+00:00" });
  const plan = mergeComments([e], [row({ remote_id: "k1" }), row({ remote_id: "r1", parent_remote_id: "k1", own: true, author: "leesidelab", posted_at: "2026-10-20T10:20:00+0000" })], () => true, NOW.toISOString());
  assertEquals(plan.statusChanges, [{ id: "s1", status: "done" }]);
});

Deno.test("instagram: an error on one post skips that post only; an invalid token stops the account", async () => {
  const store = fakeStore([IG]);
  const api = mockApi({
    "GET ig:IGU/media": { data: [{ id: "M1", caption: "live", comments_count: 2 }, { id: "M2", caption: "ok", comments_count: 1 }] },
    "GET ig:M1/comments": { error: { message: "Unsupported get request", code: 100, error_subcode: 33 } },
    "GET ig:M2/comments": { data: [{ id: "k9", text: "hi", username: "anna", timestamp: "2026-10-20T10:00:00+0000" }] },
  });
  assertEquals((await fetchComments(deps(store, api.fetchFn)))[0].status, "ok");
  assertEquals(store.rows.map((r) => r.remote_id), ["k9"]);
  const bad = mockApi({ "GET ig:IGU/media": { data: [{ id: "M1", comments_count: 1 }] }, "GET ig:M1/comments": { error: { message: "Error validating access token", code: 190 } } });
  assertEquals((await fetchComments(deps(fakeStore([IG]), bad.fetchFn)))[0].status, "failed");
});

Deno.test("youtube: held is YouTube's status of each comment; links only to youtube.com", async () => {
  const store = fakeStore([YT]);
  const c = (id: string, status: string, parent?: string) => ({ id, snippet: { parentId: parent, authorDisplayName: "@x", authorChannelUrl: id === "t1" ? "javascript:alert(1)" : "http://www.youtube.com/@x", authorChannelId: { value: "UCx" }, textDisplay: id, publishedAt: "2026-10-20T09:00:00Z", videoId: "V1", moderationStatus: status } });
  const api = mockApi({
    ...youtubeToken,
    "GET yt:commentThreads": (p: Record<string, string>) => p.moderationStatus === "heldForReview"
      ? { items: [{ id: "t1", snippet: { videoId: "V1", totalReplyCount: 1, topLevelComment: c("t1", "published") }, replies: { comments: [c("t1.r1", "heldForReview", "t1")] } }] }
      : { items: [] },
    "GET yt:videos": (p: Record<string, string>) => { assert(!("maxResults" in p)); return { items: [{ id: "V1", snippet: { title: "Föhn" } }] }; },
  });
  await fetchComments(deps(store, api.fetchFn));
  const by = (id: string) => store.rows.find((r) => r.remote_id === id)!;
  assertEquals([by("t1").held, by("t1.r1").held], [false, true]);
  assertEquals([by("t1").author_url, by("t1.r1").author_url], [null, "https://www.youtube.com/@x"]);
});

Deno.test("youtube connect: another channel for the same app, or one channel for two apps, is refused", async () => {
  const scope = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl";
  const api = (channel: string) => mockApi({
    "POST google:token": { access_token: "A", refresh_token: "1//R", scope },
    "GET yt:channels": { items: [{ id: channel, snippet: { title: channel, customUrl: `@${channel}` } }] },
  });
  let msg = "";
  await youtubeConnect(deps(fakeStore([IG, YT]), api("UCother").fetchFn), ALLOWED, "leesidelab", "C", ALLOWED[0]).catch((e) => (msg = e.message));
  assertMatch(msg, /schon der Kanal @leesidelab/);
  await youtubeConnect(deps(fakeStore([IG, YT]), api("UCown").fetchFn), ALLOWED, "downwind", "C", ALLOWED[0]).catch((e) => (msg = e.message));
  assertMatch(msg, /schon mit «leesidelab»/);
  const ok = await youtubeConnect(deps(fakeStore([IG, YT]), api("UCown").fetchFn), ALLOWED, "leesidelab", "C", ALLOWED[0]); // reconnect, same channel
  assertEquals(ok.handle, "UCown");
});

Deno.test("reply: a failed send releases the claim; a network error never shows the token", async () => {
  const store = fakeStore([IG], [stored({ id: "s1", remote_id: "k1" })]);
  const failing = async () => { throw new TypeError("error sending request for url (https://graph.instagram.com/v25.0/k1/replies?access_token=IGAAsecret123): connection reset"); };
  let msg = "";
  await replyTo(deps(store, failing), "s1", "Danke!").catch((e) => (msg = e.message));
  assert(!msg.includes("IGAAsecret123"), msg);
  assertMatch(msg, /Keine Verbindung/);
  assertEquals(store.rows[0].replied_at, null);
});
