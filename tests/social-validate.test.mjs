import test from "node:test";
import assert from "node:assert/strict";
import { aspectLabel, countHashtags, validateItem, validatePost, zurichToUtc, utcToZurichLocal } from "../src/social/validate.js";

const jpg = (w, h, size = 500_000) => ({ type: "image/jpeg", size, width: w, height: h });
const mp4 = (w, h, duration, size = 10_000_000) => ({ type: "video/mp4", size, width: w, height: h, duration });

test("aspect labels", () => {
  assert.equal(aspectLabel(1080, 1350), "4:5");
  assert.equal(aspectLabel(1080, 1080), "1:1");
  assert.equal(aspectLabel(1910, 1000), "1.91:1");
  assert.equal(aspectLabel(1080, 1920), "9:16");
});

test("feed images: JPEG, 8 MB, 4:5 … 1.91:1", () => {
  assert.deepEqual(validateItem("image", jpg(1080, 1350)).errors, []);
  assert.match(validateItem("image", { ...jpg(1080, 1080), type: "image/png" }).errors[0], /JPEG/);
  assert.match(validateItem("image", jpg(1080, 1080, 9 * 1024 * 1024)).errors[0], /8 MB/);
  assert.match(validateItem("image", jpg(1080, 1920)).errors[0], /4:5 bis 1\.91:1/); // too tall for the feed
  assert.match(validateItem("image", jpg(1200, 1000)).warnings[0], /Ungewohntes Format/);
});

test("story and reel: 9:16 and video length", () => {
  assert.deepEqual(validateItem("story", jpg(1080, 1920)).errors, []);
  assert.match(validateItem("story", jpg(1080, 1080)).errors[0], /9:16/);
  assert.deepEqual(validateItem("reel", mp4(1080, 1920, 30)).errors, []);
  assert.match(validateItem("reel", mp4(1080, 1920, 2)).errors[0], /3–15 min/);
  assert.match(validateItem("story", mp4(1080, 1920, 61)).errors[0], /3–60 s/);
  assert.match(validateItem("reel", mp4(1920, 1080, 30)).errors[0], /9:16/);
  assert.match(validateItem("reel", jpg(1080, 1920)).errors.join(" "), /braucht ein Video/);
  assert.match(validateItem("reel", { ...mp4(1080, 1920, 30), type: "video/webm" }).errors[0], /MP4/);
  assert.match(validateItem("reel", mp4(1080, 1920, 30, 60 * 1024 * 1024)).errors[0], /50 MB/);
});

test("carousel: 2–10 items, mixed sizes warn", () => {
  assert.match(validatePost({ kind: "carousel", items: [jpg(1080, 1080)] }).errors[0], /2 bis 10/);
  const eleven = Array.from({ length: 11 }, () => jpg(1080, 1080));
  assert.match(validatePost({ kind: "carousel", items: eleven }).errors[0], /2 bis 10/);
  const mixed = validatePost({ kind: "carousel", items: [jpg(1080, 1080), jpg(1080, 1350)] });
  assert.deepEqual(mixed.errors, []);
  assert.match(mixed.warnings[0], /ersten Bildes/);
  assert.match(validatePost({ kind: "image", items: [jpg(1080, 1080), jpg(1080, 1080)] }).errors[0], /Karussell/);
});

test("caption and hashtags", () => {
  assert.equal(countHashtags("Flug nach #LSZF mit #DA40 und #flygirl_ch #über"), 4);
  const ok = { kind: "image", items: [jpg(1080, 1080)] };
  assert.match(validatePost({ ...ok, caption: "x".repeat(2201) }).errors[0], /2200/);
  const tags = (n) => Array.from({ length: n }, (_, i) => `#t${i}`).join(" ");
  assert.deepEqual(validatePost({ ...ok, caption: tags(15) }).warnings, []);
  assert.match(validatePost({ ...ok, caption: tags(16) }).warnings[0], /Spam/);
  assert.match(validatePost({ ...ok, caption: tags(31) }).errors[0], /höchstens 30/);
  assert.match(validatePost({ kind: "story", items: [jpg(1080, 1920)], caption: "hi" }).warnings[0], /ignoriert/);
});

test("approval needs a time that is not in the past", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  const p = { kind: "image", items: [jpg(1080, 1080)] };
  assert.match(validatePost(p, { forApproval: true, now }).errors[0], /Zeitpunkt/);
  assert.match(validatePost(p, { forApproval: true, scheduledAt: "2026-10-20T09:00:00Z", now }).errors[0], /Vergangenheit/);
  assert.deepEqual(validatePost(p, { forApproval: true, scheduledAt: "2026-10-20T12:00:00Z", now }).errors, []);
});

test("Swiss time ↔ UTC, including both DST switches", () => {
  assert.equal(zurichToUtc("2026-07-01T12:00"), "2026-07-01T10:00:00.000Z"); // summer, UTC+2
  assert.equal(zurichToUtc("2026-12-01T12:00"), "2026-12-01T11:00:00.000Z"); // winter, UTC+1
  assert.equal(zurichToUtc("2026-03-29T03:30"), "2026-03-29T01:30:00.000Z"); // just after the spring switch
  assert.equal(zurichToUtc("2026-10-25T04:00"), "2026-10-25T03:00:00.000Z"); // just after the autumn switch
  assert.equal(utcToZurichLocal("2026-07-01T10:00:00Z"), "2026-07-01T12:00");
  assert.equal(utcToZurichLocal("2026-12-31T23:30:00Z"), "2027-01-01T00:30");
  for (const local of ["2026-01-15T08:05", "2026-06-30T23:59", "2026-11-02T18:30"]) assert.equal(utcToZurichLocal(zurichToUtc(local)), local);
  assert.equal(zurichToUtc("nonsense"), null);
});
