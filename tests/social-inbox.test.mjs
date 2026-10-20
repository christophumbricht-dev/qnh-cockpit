import test from "node:test";
import assert from "node:assert/strict";
import { commentUrl, groupComments, heldCount, openCount, replyPrefill, replyTarget } from "../src/social/inbox.js";

const c = (over) => ({
  id: over.remote_id, account_id: "ig", remote_id: "k", parent_remote_id: null, media_id: "M1", media_title: "", media_permalink: null,
  author: "anna", body: "Hi", posted_at: "2026-10-20T10:00:00Z", own: false, held: false, status: "new", draft: "", deleted_at: null, ...over,
});

const rows = [
  c({ remote_id: "k1", media_title: "Föhn part 1", media_permalink: "https://www.instagram.com/reel/a/", posted_at: "2026-10-20T08:00:00Z", status: "done" }),
  c({ remote_id: "r1", parent_remote_id: "k1", author: "leesidelab", own: true, status: "done", posted_at: "2026-10-20T09:00:00Z" }),
  c({ remote_id: "r2", parent_remote_id: "k1", author: "bob", posted_at: "2026-10-20T09:30:00Z" }), // asks again in the thread
  c({ remote_id: "k2", posted_at: "2026-10-20T07:00:00Z", status: "done" }),
  c({ remote_id: "k3", media_id: "M2", media_title: "Fog", posted_at: "2026-10-20T11:00:00Z" }),
  c({ remote_id: "k4", media_id: "M2", status: "hidden", posted_at: "2026-10-20T06:00:00Z" }),
  c({ remote_id: "k5", media_id: "M2", deleted_at: "2026-10-20T12:00:00Z" }),
  c({ remote_id: "y1", account_id: "yt", media_id: "V1", posted_at: "2026-10-19T10:00:00Z" }),
  c({ remote_id: "y2", account_id: "yt", media_id: "V1", held: true, body: "Earn $$$", posted_at: "2026-10-19T09:00:00Z" }),
];

test("inbox: open comments grouped by post, newest activity first; deleted ones are gone", () => {
  assert.equal(openCount(rows), 3); // r2, k3, y1 – not the held-back y2
  assert.equal(heldCount(rows), 1);
  const posts = groupComments(rows, { filter: "open" });
  assert.deepEqual(posts.map((p) => [p.media_id, p.open, p.threads.map((t) => t.key)]), [
    ["M2", 1, ["ig:k3"]],
    ["M1", 1, ["ig:k1"]],
    ["V1", 1, ["yt:y1"]],
  ]);
  const m1 = posts[1];
  assert.equal(m1.title, "Föhn part 1");
  assert.deepEqual(m1.threads[0].replies.map((r) => r.remote_id), ["r1", "r2"]);
});

test("inbox: done / hidden / all filters and the app filter", () => {
  assert.deepEqual(groupComments(rows, { filter: "done" }).flatMap((p) => p.threads.map((t) => t.key)), ["ig:k2"]);
  assert.deepEqual(groupComments(rows, { filter: "hidden" }).flatMap((p) => p.threads.map((t) => t.key)), ["ig:k4"]);
  assert.deepEqual(groupComments(rows, { filter: "held" }).flatMap((p) => p.threads.map((t) => t.key)), ["yt:y2"]);
  assert.equal(groupComments(rows, { filter: "all" }).flatMap((p) => p.threads).length, 6);
  assert.deepEqual(groupComments(rows, { filter: "all", accountOk: (id) => id === "yt" }).map((p) => p.media_id), ["V1"]);
});

test("inbox: a reply without its parent (deleted or not fetched) still shows up", () => {
  const posts = groupComments([c({ remote_id: "r9", parent_remote_id: "gone" })]);
  assert.equal(posts[0].threads[0].top, null);
  assert.equal(replyTarget(posts[0].threads[0]).remote_id, "r9");
});

test("inbox: the reply box answers the newest open comment and starts with @name inside a thread", () => {
  const th = groupComments(rows, { filter: "open" })[1].threads[0];
  const target = replyTarget(th);
  assert.equal(target.remote_id, "r2");
  assert.equal(replyPrefill(target), "@bob ");
  assert.equal(replyPrefill(c({ remote_id: "k" })), ""); // top comment: no @
  assert.equal(replyPrefill(c({ remote_id: "k", draft: "Danke! Altdorf, Kanton Uri." })), "Danke! Altdorf, Kanton Uri.");
  assert.equal(replyPrefill(c({ remote_id: "x", parent_remote_id: "k", author: "Max Muster" })), ""); // no handle to mention
});

test("inbox: YouTube links jump to the comment", () => {
  assert.equal(commentUrl(c({ remote_id: "Ugx1", media_permalink: "https://www.youtube.com/watch?v=V1" }), "youtube"), "https://www.youtube.com/watch?v=V1&lc=Ugx1");
  assert.equal(commentUrl(c({ remote_id: "k", media_permalink: "https://www.instagram.com/reel/a/" }), "instagram"), "https://www.instagram.com/reel/a/");
  assert.equal(commentUrl(c({ remote_id: "k" }), "instagram"), null);
});
