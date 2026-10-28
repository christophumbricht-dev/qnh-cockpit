import test from "node:test";
import assert from "node:assert/strict";
import { anchor, arrowStep, fmtTime, formatOf, keyAction, markersFor, openCount, remap, roundOrder, sceneAt, sceneJump, sortMarkers } from "../src/studio/logic.js";

const V1 = [{ id: "intro", label: "Intro", start: 0, end: 28 }, { id: "rain", label: "Regen", start: 28, end: 77 }, { id: "case", label: "Unfall", start: 77, end: 157 }];
const V2 = [{ id: "intro", label: "Intro", start: 0, end: 20 }, { id: "case", label: "Unfall", start: 20, end: 90 }];

test("fmtTime shows minutes, seconds and tenths", () => {
  assert.equal(fmtTime(0), "00:00.0");
  assert.equal(fmtTime(75.25), "01:15.3");
  assert.equal(fmtTime(3599.94), "59:59.9");
});

test("sceneAt and anchor: start inclusive, end exclusive, the last scene keeps its end", () => {
  assert.equal(sceneAt(V1, 28).id, "rain");
  assert.equal(sceneAt(V1, 157).id, "case");
  assert.equal(sceneAt(V1, 200), null);
  assert.deepEqual(anchor(V1, 30.5), { scene_id: "rain", offset_s: 2.5 });
  assert.deepEqual(anchor([], 10), { scene_id: null, offset_s: null });
});

test("remap: same scene and distance on the new version; a removed scene is said plainly", () => {
  assert.deepEqual(remap({ at: 80, scene_id: "case", offset_s: 3 }, V2), { at: 23, removed: false });
  assert.deepEqual(remap({ at: 150, scene_id: "case", offset_s: 73 }, V2), { at: 90, removed: false });   // clamped to the shorter scene
  assert.deepEqual(remap({ at: 40, scene_id: "rain", offset_s: 12 }, V2), { at: null, removed: true });
  assert.deepEqual(remap({ at: 40, scene_id: null }, [], 30), { at: 30, removed: false });                // no scenes: keep the time
  assert.deepEqual(remap({ at: null, page: 2 }, V2), { at: null, removed: false });                       // carousel page
});

test("keys: space in a text field writes a space, M marks, arrows page a carousel, frames only in pause", () => {
  assert.equal(keyAction({ key: " ", inText: true }), null);
  assert.equal(keyAction({ key: "Escape", inText: true }), "blur");
  assert.equal(keyAction({ key: " " }), "toggle");
  assert.equal(keyAction({ key: "m" }), "mark");
  assert.equal(keyAction({ key: "ArrowRight", format: "carousel" }), "nextPage");
  assert.equal(keyAction({ key: " ", format: "carousel" }), null);
  assert.equal(keyAction({ key: ".", paused: false }), null);
  assert.equal(keyAction({ key: ".", paused: true }), "frameFwd");
  assert.equal(arrowStep("video_long"), 5);
  assert.equal(arrowStep("reel"), 1);
});

test("sceneJump: back to the scene start, or the one before when just after it; forward to the next", () => {
  assert.equal(sceneJump(V1, 40, -1), 28);
  assert.equal(sceneJump(V1, 28.2, -1), 0);
  assert.equal(sceneJump(V1, 40, 1, 157), 77);
  assert.equal(sceneJump(V1, 100, 1, 157), 157);
  assert.equal(sceneJump([], 10, -1, 30), 0);
  assert.equal(sceneJump([], 10, 1, 30), 30);
});

test("markersFor: Sichtung 2 shows only what was worked on for this version, plus new drafts", () => {
  const item = { id: "i", status: "review2", current_version: 3 };
  const ms = [
    { id: 1, item_id: "i", version: 1, status: "ok", done_version: 2 },
    { id: 2, item_id: "i", version: 1, status: "done", done_version: 3 },     // «noch nicht» in round 2, redone for v3
    { id: 3, item_id: "i", version: 3, status: "draft" },
    { id: 4, item_id: "x", version: 3, status: "draft" },
  ];
  assert.deepEqual(markersFor(ms, item).map((m) => m.id), [2, 3]);
  assert.deepEqual(markersFor(ms, { ...item, status: "work" }).map((m) => m.id), [1, 2, 3]);
  assert.equal(openCount(ms), 2);
});

test("round order: reels and shorts, then carousels, then long videos, by day", () => {
  const items = [
    { id: "long", format: "video_long", day: "2026-11-02", channel: "leesidelab/youtube" },
    { id: "car", format: "carousel", day: "2026-11-01", channel: "downwind/instagram" },
    { id: "r2", format: "reel", day: "2026-11-03", channel: "leesidelab/instagram" },
    { id: "r1", format: "short", day: "2026-11-02", channel: "leesidelab/youtube" },
  ];
  assert.deepEqual(roundOrder(items).map((i) => i.id), ["r1", "r2", "car", "long"]);
});

test("sortMarkers: medium by time or page first, texts after; formatOf maps social posts", () => {
  const s = sortMarkers([{ target: "caption", created_at: "1" }, { target: "medium", at: 20 }, { target: "medium", at: 5 }]);
  assert.deepEqual(s.map((m) => m.at ?? m.target), [5, 20, "caption"]);
  assert.equal(formatOf("reel", "instagram"), "reel");
  assert.equal(formatOf("reel", "youtube", 60), "short");
  assert.equal(formatOf("reel", "youtube", 600), "video_long");
  assert.equal(formatOf("carousel", "instagram"), "carousel");
});
