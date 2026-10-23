// Deno tests: automatic answer to a correct quiz solution (answerQuizzes in comments.ts)
import { assert, assertEquals } from "jsr:@std/assert@1";
import { answerQuizzes, type CommentDeps, type CommentsStore, type QuizStore, quizMatch, type StoredComment } from "./comments.ts";
import type { Account, Post } from "./publish.ts";

const NOW = new Date("2026-11-05T10:00:00Z");
const IG: Account = { id: "ig1", app_id: "leesidelab", platform: "instagram", remote_id: "IGU", handle: "leesidelab", active: true, token_expires_at: null };
const KEYS = ["standard air", "ISA", "standard atmosphere"];
const TEXTS = ["Spot on 👏", "Exactly, standard air 👌"];

const post = (over: Partial<Post> = {}): Post => ({
  id: "p1", account_id: "ig1", kind: "reel", caption: "QNH, part 2", first_comment: "Why 190 hPa and not 183?", media: [], cover_path: null,
  status: "published", scheduled_at: null, attempts: 0, remote_container_id: null, remote_media_id: "M1", remote_comment_id: "FC1", permalink: null,
  published_at: "2026-11-04T17:00:00Z", quiz_answer: KEYS, quiz_correct_replies: TEXTS, ...over,
});
let n = 0;
const comment = (over: Partial<StoredComment> = {}): StoredComment => ({
  id: `s${++n}`, account_id: "ig1", remote_id: `k${n}`, parent_remote_id: null, media_id: "M1", media_title: "QNH", media_permalink: null,
  author: "pilot_anna", author_url: null, body: "Because of the standard air column", posted_at: "2026-11-04T18:00:00Z", like_count: 0,
  own: false, held: false, status: "new", draft: "", replied_at: null, deleted_at: null, ...over,
});

function fakeStore(posts: Post[], rows: StoredComment[]) {
  const claims: Array<{ id: string; post_id: string; author: string; comment_id: string; status?: string; reply_text?: string; error?: string }> = [];
  const store: CommentsStore & QuizStore & { rows: StoredComment[]; claims: typeof claims } = {
    rows, claims,
    async accounts() { return [IG]; },
    async account() { return IG; },
    async token() { return "IGTOKEN"; },
    async storeToken() {},
    async comments(id) { return rows.filter((r) => r.account_id === id).map((r) => ({ ...r })); },
    async comment(id) { const r = rows.find((x) => x.id === id); return r ? { ...r } : null; },
    async insertComments(list) { for (const r of list) rows.push({ id: `c${++n}`, draft: "", replied_at: null, ...r } as unknown as StoredComment); },
    async updateComments() {},
    async updateComment(id, patch) { Object.assign(rows.find((x) => x.id === id)!, patch); },
    async claimReply(id, at) { rows.find((x) => x.id === id)!.replied_at = at; return true; },
    async markDeleted() {},
    async upsertAccount() { throw new Error("not used"); },
    async quizPosts(since) { return posts.filter((p) => p.status === "published" && p.quiz_answer?.length && Date.parse(p.published_at!) >= since.getTime()); },
    async claimQuizReply(postId, author, commentId) {
      if (claims.some((c) => c.post_id === postId && c.author === author)) return null;
      const id = `q${claims.length + 1}`;
      claims.push({ id, post_id: postId, author, comment_id: commentId });
      return id;
    },
    async updateQuizReply(id, patch) { Object.assign(claims.find((c) => c.id === id)!, patch); },
  };
  return store;
}

function mockIg(fail = false) {
  const sent: Array<{ parent: string; message: string }> = [];
  const fetchFn: CommentDeps["fetch"] = async (input, init) => {
    const url = new URL(String(input));
    const params = new URLSearchParams(init?.body instanceof URLSearchParams ? init.body : undefined);
    const parent = url.pathname.split("/").at(-2)!;
    if (fail) return new Response(JSON.stringify({ error: { message: "Unsupported post request", code: 100 } }), { status: 400 });
    sent.push({ parent, message: params.get("message") ?? "" });
    return new Response(JSON.stringify({ id: `R${sent.length}` }), { status: 200 });
  };
  return { fetchFn, sent };
}
const run = (store: ReturnType<typeof fakeStore>, fetchFn: CommentDeps["fetch"], now = NOW, random = () => 0) =>
  answerQuizzes({ store, fetch: fetchFn, now: () => now, random });

Deno.test("quiz match: whole words, any case and accents, numbers with units", () => {
  assert(quizMatch("It's the Standard Air!", KEYS));
  assert(quizMatch("isa", KEYS));
  assert(!quizMatch("Isabella says hi", KEYS), "only whole words");
  assert(!quizMatch("1013 minus 830", KEYS));
  assert(quizMatch("about 190hPa", ["190 hPa"]));
  assert(quizMatch("Föhn", ["fohn"]));
  assert(quizMatch("1'707 m", ["1707"]));
});

Deno.test("quiz: a correct answer gets one prepared text, once per person and post", async () => {
  const rows = [
    comment({ author: "pilot_anna", body: "Standard air, not today's air!" }),
    comment({ author: "Pilot_Anna", body: "ISA again", posted_at: "2026-11-04T19:00:00Z" }), // same person, second try
    comment({ author: "bob", body: "1013 minus 830 = 183, so 183?" }), // wrong: stays for Christoph
    comment({ author: "carla", body: "ISA I guess", status: "hidden" }),
    comment({ author: "dave", body: "standard atmosphere", held: true }),
    comment({ author: "erin", body: "isa", status: "done" }), // already answered by Christoph
    comment({ author: "leesidelab", body: "standard air", own: true }),
  ];
  const store = fakeStore([post()], rows);
  const api = mockIg();
  const res = await run(store, api.fetchFn, NOW, () => 0.9);
  assertEquals(res, [{ id: rows[0].id, author: "pilot_anna", status: "replied" }]);
  assertEquals(api.sent, [{ parent: rows[0].remote_id, message: "Exactly, standard air 👌" }]);
  assertEquals([store.claims[0].status, store.claims[0].reply_text], ["sent", "Exactly, standard air 👌"]);
  assertEquals(store.rows.find((r) => r.author === "bob")!.status, "new");
  // next run: nothing more for anna, nothing for the rest
  assertEquals(await run(store, api.fetchFn), []);
  assertEquals(api.sent.length, 1);
});

Deno.test("quiz: only within 72 hours, only published posts with keywords and texts", async () => {
  const late = fakeStore([post({ published_at: "2026-11-01T09:00:00Z" })], [comment()]);
  assertEquals(await run(late, mockIg().fetchFn), []);
  const noTexts = fakeStore([post({ quiz_correct_replies: [] })], [comment()]);
  assertEquals(await run(noTexts, mockIg().fetchFn), []);
  const other = fakeStore([post()], [comment({ media_id: "OTHER" })]);
  assertEquals(await run(other, mockIg().fetchFn), []);
});

Deno.test("quiz: a refused send is not retried and the comment stays open", async () => {
  const rows = [comment()];
  const store = fakeStore([post()], rows);
  const api = mockIg(true);
  assertEquals((await run(store, api.fetchFn))[0].status, "failed");
  assertEquals(store.claims[0].status, "failed");
  assertEquals(store.rows[0].status, "new");
  const ok = mockIg();
  assertEquals(await run(store, ok.fetchFn), []);
  assertEquals(ok.sent.length, 0);
});
