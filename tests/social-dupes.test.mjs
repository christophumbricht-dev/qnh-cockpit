import test from "node:test";
import assert from "node:assert/strict";
import { captionKey, findPublishedTwin } from "../src/social/dupes.js";

const published = [{ media_id: "17900001", account_id: "acc", caption: "Why does it pour on the south side of the Alps while the north gets warm? 🔥\nFöhn, part 1/3.", posted_at: "2026-10-19T16:00:00Z" }];

test("same caption start on the same account is a twin – emoji, case and punctuation ignored", () => {
  assert.equal(captionKey("Föhn day – read this FIRST! ✈️"), captionKey("föhn day read this first"));
  assert.equal(findPublishedTwin({ account_id: "acc", caption: "Why does it pour on the south side of the Alps while the north gets warm?\n\n#weather" }, published).media_id, "17900001");
});

test("no twin: other account, other text, too short, or the post itself", () => {
  assert.equal(findPublishedTwin({ account_id: "other", caption: published[0].caption }, published), null);
  assert.equal(findPublishedTwin({ account_id: "acc", caption: "Fog, part 1/3: why the valley stays grey" }, published), null);
  assert.equal(findPublishedTwin({ account_id: "acc", caption: "" }, published), null);
  assert.equal(findPublishedTwin({ account_id: "acc", caption: published[0].caption, remote_media_id: "17900001" }, published), null);
});
