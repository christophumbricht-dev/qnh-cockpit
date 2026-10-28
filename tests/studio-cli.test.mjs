import { test } from "node:test";
import assert from "node:assert/strict";
import { CliError, approvalCarriesOver, checkMeta, checkScenes, itemFromPost, rejectPatch, resolvePatch, sha256, slugOf, statusAfterNewVersion,
  summary, versionFromPost, workMarkers } from "../scripts/studio-lib.mjs";

test("slugOf makes package folders studio names", () => {
  assert.equal(slugOf("2026-11-08_Panel-1"), "2026-11-08_panel-1");
  assert.equal(slugOf("Föhn Langvideo"), "fohn-langvideo");
  assert.throws(() => slugOf("!"), CliError);
});

test("checkScenes keeps order and refuses broken scenes", () => {
  assert.deepEqual(checkScenes([{ id: "a", start: 0, end: 5 }, { id: "b", label: "B", start: 5, end: 9 }], 9.2),
    [{ id: "a", label: "a", start: 0, end: 5 }, { id: "b", label: "B", start: 5, end: 9 }]);
  assert.throws(() => checkScenes([{ id: "a", start: 0, end: 5 }, { id: "a", start: 5, end: 6 }]), /zweimal/);
  assert.throws(() => checkScenes([{ id: "a", start: 4, end: 5 }, { id: "b", start: 2, end: 6 }]), /vor dem Ende/);
  assert.throws(() => checkScenes([{ id: "a", start: 0, end: 50 }], 30), /nach dem Video/);
  assert.throws(() => checkScenes({}), CliError);
});

test("checkMeta normalises lists and checks title length and fps", () => {
  const m = checkMeta({ titles: "Föhn", shorts: ["Kurz"], fps: 30 });
  assert.deepEqual(m.titles, ["Föhn"]);
  assert.deepEqual(m.shorts, [{ title: "Kurz" }]);
  assert.throws(() => checkMeta({ titles: ["x".repeat(101)] }), /100/);
  assert.throws(() => checkMeta({ fps: 500 }), /fps/);
});

test("summary splits Christoph's and Claude's turn", () => {
  const items = [{ id: "1", status: "review1" }, { id: "2", status: "work" }, { id: "3", status: "approved" }, { id: "4", status: "review2" }];
  const markers = [{ item_id: "2", status: "open" }, { item_id: "2", status: "done" }, { item_id: "2", status: "not_yet" }];
  const s = summary(items, markers);
  assert.deepEqual(s.christoph.map((i) => i.id), ["1", "4"]);
  assert.equal(s.claude[0].open.length, 2);
  assert.equal(s.approved.length, 1);
});

test("workMarkers: open and «noch nicht», in order of page and time", () => {
  const ms = [{ id: "c", item_id: "x", status: "open", at: 30 }, { id: "a", item_id: "x", status: "not_yet", at: 2 }, { id: "d", item_id: "x", status: "draft", at: 1 },
    { id: "b", item_id: "x", status: "open", at: null, target: "caption" }];
  assert.deepEqual(workMarkers({ id: "x" }, ms).map((m) => m.id), ["b", "a", "c"]);
});

test("resolve and reject are done in the next version and need a reason", () => {
  assert.deepEqual(resolvePatch({ current_version: 2 }, " kürzer ", "all", "Keine Striche"),
    { status: "done", note: "kürzer", scope: "all", rule: "Keine Striche", done_version: 3 });
  assert.equal(resolvePatch({ current_version: 1 }, "ok").scope, null);
  assert.throws(() => resolvePatch({ current_version: 1 }, ""), CliError);
  assert.throws(() => resolvePatch({ current_version: 1 }, "x", "all"), /Regeltext/);
  assert.throws(() => resolvePatch({ current_version: 1 }, "x", "alle", "r"), /post, channel oder all/);
  assert.equal(rejectPatch({ current_version: 4 }, "Fakt stimmt").done_version, 5);
  assert.throws(() => rejectPatch({ current_version: 1 }, " "), CliError);
});

test("a new version: review 1 stays, otherwise review 2", () => {
  assert.equal(statusAfterNewVersion("review1"), "review1");
  assert.equal(statusAfterNewVersion("work"), "review2");
  assert.equal(statusAfterNewVersion("approved"), "review2");
});

test("versionFromPost and itemFromPost from a Social draft", () => {
  const reel = { id: "p1", kind: "reel", caption: "Oil pressure high\nmore", first_comment: "Answer?", scheduled_at: "2026-11-08T17:00:00Z",
    media: [{ path: "p1/a.mp4", type: "video/mp4", still: "p1/a.jpg", duration: 18.5 }] };
  const v = versionFromPost(reel, { assumptions: ["Musik −14 LUFS"] });
  assert.deepEqual(v.source, { kind: "storage", path: "p1/a.mp4", still: "p1/a.jpg" });
  assert.equal(v.duration, 18.5);
  assert.deepEqual(v.meta, { caption: reel.caption, first_comment: "Answer?", assumptions: ["Musik −14 LUFS"] });
  const it = itemFromPost(reel, { app_id: "leesidelab", platform: "instagram" }, "2026-11-08-panel-1");
  assert.deepEqual(it, { channel: "leesidelab/instagram", format: "reel", title: "Oil pressure high", slug: "2026-11-08-panel-1", day: "2026-11-08", social_post_id: "p1" });
  const car = versionFromPost({ kind: "carousel", media: [{ path: "a.jpg", type: "image/jpeg" }, { path: "b.jpg", type: "image/jpeg" }] });
  assert.deepEqual(car.source, { kind: "storage", pages: ["a.jpg", "b.jpg"] });
  const yt = itemFromPost({ id: "p2", kind: "reel", title: "Föhn", caption: "", media: [{ type: "video/mp4", duration: 340 }] }, { app_id: "leesidelab", platform: "youtube" }, "foehn");
  assert.equal(yt.format, "video_long");
});

test("a studio approval carries over only for exactly the approved content", () => {
  const bytes = Buffer.from("video");
  const h = sha256(bytes);
  const version = { hash: h, meta: { titles: ["A", "B"], chosen_title: 1, description: "Text" } };
  const item = { status: "approved", approved_hash: h };
  const draft = { videoHash: h, caption: "Text ", title: "B" };
  assert.equal(approvalCarriesOver(item, version, draft), true);
  assert.equal(approvalCarriesOver(item, version, { ...draft, title: "A" }), false);
  assert.equal(approvalCarriesOver(item, version, { ...draft, caption: "Text neu" }), false);
  assert.equal(approvalCarriesOver(item, version, { ...draft, videoHash: sha256(Buffer.from("other")) }), false);
  assert.equal(approvalCarriesOver({ ...item, status: "review2" }, version, draft), false);
  assert.equal(approvalCarriesOver({ ...item, approved_hash: "old" }, version, draft), false);
});
