import test from "node:test";
import assert from "node:assert/strict";
import { DELETABLE, classify } from "../scripts/social-storage.mjs";

const NOW = Date.parse("2026-11-12T08:00:00Z");
const ago = (d) => new Date(NOW - d * 86400_000).toISOString();
const post = (id, status, paths, published_at = null) => ({ id, status, published_at, json: JSON.stringify({ id, media: paths.map((path) => ({ path })) }) });
const file = (path, days = 10) => ({ path, size: 1000, created_at: ago(days) });
const kind = (files, posts, studio = "[]") => Object.fromEntries(classify(files, posts, studio, NOW, 3).map((f) => [f.path, f.kind]));

test("files of drafts, approved and failed posts are never deletable", () => {
  const k = kind([file("a/1.mp4"), file("a/2.mp4"), file("a/3.mp4")], [post("p1", "draft", ["a/1.mp4"]), post("p2", "approved", ["a/2.mp4"]), post("p3", "failed", ["a/3.mp4"])]);
  for (const v of Object.values(k)) assert.equal(DELETABLE.has(v), false);
});

test("video of a post published long ago goes, its pictures and a fresh post stay", () => {
  const k = kind([file("a/old.mp4"), file("a/old.jpg"), file("a/new.mp4")], [post("p1", "published", ["a/old.mp4", "a/old.jpg"], ago(5)), post("p2", "published", ["a/new.mp4"], ago(1))]);
  assert.deepEqual(k, { "a/old.mp4": "alt", "a/old.jpg": "bild", "a/new.mp4": "frisch" });
});

test("a file shared with a draft stays even if the other post is old", () => {
  const k = kind([file("a/x.mp4")], [post("p1", "published", ["a/x.mp4"], ago(30)), post("p2", "draft", ["a/x.mp4"])]);
  assert.equal(k["a/x.mp4"], "aktiv");
});

test("cancelled posts, orphans, studio-only and brand-new files", () => {
  const k = kind([file("a/c.mp4"), file("a/lost.mp4"), file("a/today.mp4", 0.5), file("a/st.mp4")], [post("p1", "cancelled", ["a/c.mp4"])], JSON.stringify([{ scenes: [{ path: "a/st.mp4" }] }]));
  assert.deepEqual(k, { "a/c.mp4": "abgebrochen", "a/lost.mp4": "verwaist", "a/today.mp4": "neu", "a/st.mp4": "studio" });
});

test("a path that is only the beginning of another path is not a match", () => {
  const k = kind([file("a/1.mp4")], [post("p1", "draft", ["a/1.mp4.bak"])]);
  assert.equal(k["a/1.mp4"], "verwaist");
});
