// Deno tests: the prepared answer below our own first comment (sendDueReplies in comments.ts)
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { type CommentDeps, type CommentsStore, type ReplyStore, sendDueReplies, type StoredComment } from "./comments.ts";
import type { Account, Post } from "./publish.ts";

const NOW = new Date("2026-11-04T22:00:00Z");
const IG: Account = { id: "ig1", app_id: "leesidelab", platform: "instagram", remote_id: "IGU", handle: "leesidelab", active: true, token_expires_at: null };
const YT: Account = { id: "yt1", app_id: "leesidelab", platform: "youtube", remote_id: "UCown", handle: "leesidelab", active: true, token_expires_at: null };
const GOOGLE = { clientId: "cid.apps.googleusercontent.com", clientSecret: "test-secret" };
const ANSWER = "Because pressure does not fall evenly with height.";

const post = (over: Partial<Post> = {}): Post => ({
  id: "p1", account_id: "ig1", kind: "reel", caption: "QNH, part 2\nWhy 190 hPa?", first_comment: "Why 190 and not 1013 minus 830 = 183?",
  media: [], cover_path: null, status: "published", scheduled_at: "2026-11-04T17:00:00Z", attempts: 0,
  remote_container_id: null, remote_media_id: "M1", remote_comment_id: "FC1", permalink: "https://www.instagram.com/reel/abc/",
  published_at: "2026-11-04T17:30:00Z", first_comment_reply: ANSWER, first_comment_reply_after_hours: 4,
  first_comment_reply_status: null, ...over,
});
const field = (p: Post, k: string) => (p as Record<string, unknown>)[k];

function fakeStore(posts: Post[], rows: StoredComment[] = [], accounts: Account[] = [IG, YT]) {
  let n = rows.length;
  const claims: string[] = [];
  const store: CommentsStore & ReplyStore & { posts: Post[]; rows: StoredComment[]; claims: string[] } = {
    posts, rows, claims,
    async accounts() { return accounts; },
    async account(id) { return accounts.find((a) => a.id === id)!; },
    async token(id) { return id === "ig1" ? "IGTOKEN" : "REFRESH"; },
    async storeToken() {},
    async comments(id) { return rows.filter((r) => r.account_id === id); },
    async comment(id) { const r = rows.find((x) => x.id === id); return r ? { ...r } : null; },
    async insertComments(list) {
      for (const r of list) if (!rows.some((x) => x.account_id === r.account_id && x.remote_id === r.remote_id)) rows.push({ id: `c${++n}`, draft: "", replied_at: null, ...r } as unknown as StoredComment);
    },
    async updateComments() {},
    async updateComment(id, patch) { Object.assign(rows.find((x) => x.id === id)!, patch); },
    async claimReply(id, at) { rows.find((x) => x.id === id)!.replied_at = at; return true; },
    async markDeleted() {},
    async upsertAccount() { throw new Error("not used"); },
    async dueReplies(since) {
      return posts.filter((p) => p.status === "published" && p.first_comment_reply && !p.first_comment_reply_status && Date.parse(p.published_at!) >= since.getTime()).map((p) => ({ ...p }));
    },
    async claimFirstCommentReply(id) {
      const p = posts.find((x) => x.id === id)!;
      if (p.first_comment_reply_status || p.status !== "published") return false;
      p.first_comment_reply_status = "sending";
      claims.push(id);
      return true;
    },
    async commentByRemote(accountId, remoteId) { const r = rows.find((x) => x.account_id === accountId && x.remote_id === remoteId); return r ? { ...r } : null; },
    async update(id, patch) { Object.assign(posts.find((x) => x.id === id)!, patch); },
  };
  return store;
}

function mockApi(routes: Record<string, unknown>) {
  const calls: Array<{ key: string; params: Record<string, string>; json?: Record<string, unknown> }> = [];
  const fetchFn = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (params[k] = v));
    let json: Record<string, unknown> | undefined;
    if (init?.body instanceof URLSearchParams) init.body.forEach((v, k) => (params[k] = v));
    else if (typeof init?.body === "string") json = JSON.parse(init.body);
    const host = url.host === "graph.instagram.com" ? "ig" : url.host === "oauth2.googleapis.com" ? "google" : "yt";
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "").replace(/^\/youtube\/v3\//, "").replace(/^\//, "");
    const key = `${init?.method ?? "GET"} ${host}:${path}`;
    calls.push({ key, params, json });
    const body = routes[key];
    if (body === undefined) return new Response(JSON.stringify({ error: { message: `no mock for ${key}`, code: 1 } }), { status: 500 });
    return new Response(JSON.stringify(body), { status: (body as { error?: unknown }).error ? 400 : 200 });
  };
  return { fetchFn, calls };
}

const run = (store: ReturnType<typeof fakeStore>, fetchFn: CommentDeps["fetch"], now = NOW) =>
  sendDueReplies({ store, fetch: fetchFn, now: () => now, google: GOOGLE });

Deno.test("answer: sent below our own first comment once it is due, exactly once", async () => {
  const store = fakeStore([post()]);
  const api = mockApi({ "POST ig:FC1/replies": { id: "R1" } });
  // 3 h 59 min after publishing: not yet
  assertEquals(await run(store, api.fetchFn, new Date("2026-11-04T21:29:00Z")), []);
  assertEquals(api.calls.length, 0);
  assertEquals(await run(store, api.fetchFn), [{ id: "p1", status: "replied" }]);
  assertEquals(api.calls.map((c) => c.key), ["POST ig:FC1/replies"]);
  assertEquals(api.calls[0].params.message, ANSWER);
  const p = store.posts[0];
  assertEquals([field(p, "first_comment_reply_status"), field(p, "first_comment_reply_id"), field(p, "first_comment_reply_sent_at")], ["sent", "R1", NOW.toISOString()]);
  // the inbox knows both: our first comment (done) and the answer below it
  const first = store.rows.find((r) => r.remote_id === "FC1")!;
  const answer = store.rows.find((r) => r.remote_id === "R1")!;
  assertEquals([first.own, first.status, first.media_id, first.media_title], [true, "done", "M1", "QNH, part 2"]);
  assertEquals([answer.own, answer.parent_remote_id], [true, "FC1"]);
  // later runs never send it again
  assertEquals(await run(store, api.fetchFn, new Date("2026-11-05T08:00:00Z")), []);
  assertEquals(api.calls.length, 1);
});

Deno.test("answer: two runs at the same time send it once (claimed before sending)", async () => {
  const store = fakeStore([post()]);
  const api = mockApi({ "POST ig:FC1/replies": { id: "R1" } });
  await Promise.all([run(store, api.fetchFn), run(store, api.fetchFn)]);
  assertEquals(api.calls.filter((c) => c.key === "POST ig:FC1/replies").length, 1);
});

Deno.test("answer on YouTube: comments.insert with the first comment as parent", async () => {
  const store = fakeStore([post({ account_id: "yt1", remote_media_id: "VID1", remote_comment_id: "UgFC", first_comment_reply_after_hours: "2.5" })]);
  const api = mockApi({ "POST google:token": { access_token: "ACCESS", expires_in: 3599 }, "POST yt:comments": { id: "UgFC.R" } });
  assertEquals(await run(store, api.fetchFn), [{ id: "p1", status: "replied" }]);
  assertEquals(api.calls.find((c) => c.key === "POST yt:comments")!.json, { snippet: { parentId: "UgFC", textOriginal: ANSWER } });
  assertEquals(store.rows.find((r) => r.remote_id === "UgFC")!.media_permalink, "https://www.youtube.com/watch?v=VID1");
});

Deno.test("answer: never below a comment that is not ours, a deleted or a hidden one", async () => {
  const base = {
    account_id: "ig1", remote_id: "FC1", parent_remote_id: null, media_id: "M1", media_title: "", media_permalink: null, author: "leesidelab", author_url: null,
    body: "Why?", posted_at: "2026-11-04T17:30:05Z", like_count: 0, own: true, held: false, status: "done", draft: "", replied_at: null, deleted_at: null,
  };
  const cases: Array<[Partial<StoredComment>, RegExp]> = [
    [{ own: false, author: "someone" }, /nicht unser eigener/],
    [{ deleted_at: "2026-11-04T18:00:00Z" }, /gelöscht/],
    [{ status: "hidden" }, /ausgeblendet/],
  ];
  for (const [over, why] of cases) {
    const store = fakeStore([post()], [{ ...base, id: "s1", ...over } as StoredComment]);
    const api = mockApi({ "POST ig:FC1/replies": { id: "R1" } });
    assertEquals(await run(store, api.fetchFn), [{ id: "p1", status: "reply-failed" }]);
    assertEquals(api.calls.length, 0, "nothing sent");
    assertEquals(store.posts[0].first_comment_reply_status, "failed");
    assertMatch(String(field(store.posts[0], "first_comment_reply_error")), why);
  }
});

Deno.test("answer: a refused send is not retried, the text waits as a draft for Christoph's click", async () => {
  const store = fakeStore([post()]);
  const api = mockApi({ "POST ig:FC1/replies": { error: { message: "Unsupported post request", code: 100 } } });
  assertEquals(await run(store, api.fetchFn), [{ id: "p1", status: "reply-failed" }]);
  assertEquals(store.posts[0].first_comment_reply_status, "failed");
  assertMatch(String(field(store.posts[0], "first_comment_reply_error")), /Entwurf/);
  assertEquals(store.rows.find((r) => r.remote_id === "FC1")!.draft, ANSWER);
  assertEquals(await run(store, api.fetchFn, new Date("2026-11-05T10:00:00Z")), []);
  assertEquals(api.calls.length, 1);
});

Deno.test("answer: without a first comment online nothing is sent; after the grace time it says so", async () => {
  const store = fakeStore([post({ remote_comment_id: null })]);
  const api = mockApi({});
  assertEquals(await run(store, api.fetchFn), []); // YouTube may still write the first comment
  assertEquals(store.posts[0].first_comment_reply_status, null);
  assertEquals(await run(store, api.fetchFn, new Date("2026-11-05T04:00:00Z")), [{ id: "p1", status: "reply-failed" }]);
  assertMatch(String(field(store.posts[0], "first_comment_reply_error")), /erste Kommentar fehlt/);
  assertEquals(api.calls.length, 0);
});

Deno.test("answer: only published posts with a prepared text; old posts are not picked up", async () => {
  const store = fakeStore([
    post({ id: "a", status: "approved" }),
    post({ id: "b", first_comment_reply: "   " }),
    post({ id: "c", kind: "story" }),
    post({ id: "d", published_at: "2026-10-20T10:00:00Z" }),
  ]);
  const api = mockApi({ "POST ig:FC1/replies": { id: "R1" } });
  assertEquals(await run(store, api.fetchFn), []);
  assertEquals(api.calls.length, 0);
  assert(store.claims.length === 0);
});
