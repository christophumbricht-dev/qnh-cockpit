import test from "node:test";
import assert from "node:assert/strict";
import { aspectLabel, countHashtags, validateItem, validatePost, youtubeIsLong, zurichToUtc, utcToZurichLocal } from "../src/social/validate.js";

const jpg = (w, h, size = 500_000) => ({ type: "image/jpeg", size, width: w, height: h });
const mp4 = (w, h, duration, size = 10_000_000) => ({ type: "video/mp4", size, width: w, height: h, duration });

test("YouTube: landscape or longer than 3 minutes is a normal video, not a Short", () => {
  assert.equal(youtubeIsLong(mp4(1080, 1920, 40)), false);
  assert.equal(youtubeIsLong(mp4(1080, 1920, 179)), false);
  assert.equal(youtubeIsLong(mp4(1080, 1920, 282)), true);
  assert.equal(youtubeIsLong(mp4(1920, 1080, 30)), true);
  assert.equal(youtubeIsLong({ type: "video/mp4" }), false);        // size unknown yet: phone preview
  assert.equal(youtubeIsLong(undefined), false);
});

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

test("carousel: 2–10 items, mixed sizes block approval", () => {
  assert.match(validatePost({ kind: "carousel", items: [jpg(1080, 1080)] }).errors[0], /2 bis 10/);
  const eleven = Array.from({ length: 11 }, () => jpg(1080, 1080));
  assert.match(validatePost({ kind: "carousel", items: eleven }).errors[0], /2 bis 10/);
  const mixed = validatePost({ kind: "carousel", items: [jpg(1080, 1080), jpg(1080, 1350)] });
  assert.match(mixed.errors[0], /dasselbe Format/);
  assert.deepEqual(validatePost({ kind: "carousel", items: [jpg(1080, 1350), jpg(1080, 1350)] }).errors, []);
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

import { parseTagList, validateItem as vItem } from "../src/social/validate.js";
test("user_tags: only feed images, valid usernames and positions; editing keeps positions", () => {
  const img = { type: "image/jpeg", width: 1080, height: 1350, size: 1000 };
  assert.deepEqual(vItem("image", { ...img, user_tags: [{ username: "exploring_the_skies", x: 0.5, y: 0.9 }] }).errors, []);
  assert.match(vItem("story", { ...img, width: 1080, height: 1920, user_tags: [{ username: "a", x: 0.5, y: 0.5 }] }).errors.join(), /nur bei Bildern/);
  assert.match(vItem("image", { ...img, user_tags: [{ username: "not ok!", x: 0.5, y: 0.5 }] }).errors.join(), /Benutzername/);
  assert.match(vItem("image", { ...img, user_tags: [{ username: "a", x: 2, y: 0.5 }] }).errors.join(), /zwischen 0 und 1/);
  assert.deepEqual(parseTagList("@exploring_the_skies, pilot.one", [{ username: "exploring_the_skies", x: 0.1, y: 0.2 }]),
    [{ username: "exploring_the_skies", x: 0.1, y: 0.2 }, { username: "pilot.one", x: 0.5, y: 0.9 }]);
});

test("YouTube: title required (≤ 100), description in bytes, ≤ 15 hashtags, only a video; Instagram rules do not apply", () => {
  const base = { platform: "youtube", kind: "reel", items: [mp4(1080, 1920, 18)], caption: "Föhn explained", first_comment: "", title: "Föhn, part 1" };
  assert.deepEqual(validatePost(base).errors, []);
  assert.match(validatePost({ ...base, title: "  " }).errors.join(), /Titel/);
  assert.match(validatePost({ ...base, title: "x".repeat(101) }).errors.join(), /höchstens 100/);
  assert.match(validatePost({ ...base, caption: "ä".repeat(2600) }).errors.join(), /Bytes/); // 5200 bytes, only 2600 characters
  assert.deepEqual(validatePost({ ...base, caption: "x".repeat(3000) }).errors, []); // longer than Instagram's 2200 is fine
  assert.match(validatePost({ ...base, caption: Array.from({ length: 16 }, (_, i) => `#t${i}`).join(" ") }).warnings.join(), /Spam/);
  assert.match(validatePost({ ...base, caption: Array.from({ length: 61 }, (_, i) => `#t${i}`).join(" ") }).errors.join(), /ignoriert YouTube alle/);
  assert.deepEqual(validatePost({ ...base, items: [mp4(1080, 1080, 18)] }).errors, []); // square is fine on YouTube
  assert.match(validatePost({ ...base, items: [mp4(1920, 1080, 18)] }).warnings.join(), /Querformat/);
  assert.deepEqual(validatePost({ ...base, items: [mp4(1080, 1920, 1200)] }).errors, []); // 20 min: a normal video
  assert.match(validatePost({ ...base, kind: "image", items: [jpg(1080, 1350)] }).errors.join(), /nur ein Video/);
  assert.match(validatePost({ ...base, items: [mp4(1080, 1920, 240)] }).warnings.join(), /kein Short/);
  assert.match(validatePost({ ...base, title: "Part <1>" }).warnings.join(), /< und >/);
});

import { hoursLabel, replyHours } from "../src/social/validate.js";
test("answer below the first comment: needs the comment, 0.5–72 hours, ignored on stories", () => {
  const base = { kind: "image", items: [jpg(1080, 1350)], caption: "QNH", first_comment: "Warum 190?" };
  assert.deepEqual(validatePost({ ...base, first_comment_reply: "Darum.", first_comment_reply_after_hours: 4 }).errors, []);
  assert.match(validatePost({ ...base, first_comment: "", first_comment_reply: "Darum." }).errors.join(), /ersten Kommentar/);
  assert.match(validatePost({ ...base, first_comment_reply: "Darum.", first_comment_reply_after_hours: 100 }).errors.join(), /0\.5 bis 72/);
  assert.deepEqual(validatePost({ ...base, kind: "story", items: [jpg(1080, 1920)], first_comment: "", first_comment_reply: "x" }).errors, []);
  assert.equal(replyHours(undefined), 4);
  assert.equal(replyHours("2.5"), 2.5);
  assert.equal(replyHours(0.2), null);
  assert.equal(hoursLabel(0.5), "30 min");
  assert.equal(hoursLabel(4), "4 h");
});

test("quiz: needs the question, keywords and at least one prepared answer", () => {
  const base = { kind: "reel", items: [mp4(1080, 1920, 20)], caption: "QNH", first_comment: "Why 190?" };
  assert.deepEqual(validatePost({ ...base, quiz_answer: "standard air, ISA", quiz_correct_replies: "Spot on\nExactly" }).errors, []);
  assert.match(validatePost({ ...base, quiz_answer: "ISA" }).errors.join(), /vorbereitete Antwort/);
  assert.match(validatePost({ ...base, quiz_correct_replies: "Spot on" }).errors.join(), /Stichwörter/);
  assert.match(validatePost({ ...base, first_comment: "", quiz_answer: "ISA", quiz_correct_replies: "Yes" }).errors.join(), /Frage/);
});

test("YouTube «für Kinder»: no first comment and no answer, because YouTube switches comments off", () => {
  const base = { platform: "youtube", kind: "reel", items: [mp4(1080, 1920, 40)], caption: "Lumi und der Wind", first_comment: "", title: "Gegen den Wind", made_for_kids: true };
  assert.deepEqual(validatePost(base).errors, []);
  assert.match(validatePost({ ...base, first_comment: "Was meint ihr?" }).errors.join(), /keine Kommentare/);
  assert.match(validatePost({ ...base, kids: true, made_for_kids: undefined, first_comment: "x" }).errors.join(), /keine Kommentare/); // editor field
  assert.deepEqual(validatePost({ ...base, made_for_kids: false, first_comment: "Was meint ihr?" }).errors, []);
});

import { isStudioVideo, validateYoutubeItem } from "../src/social/validate.js";
test("a long studio video in R2: no 50 MB limit, a note above 15 minutes, not part of the review round", () => {
  const item = { path: "studio/ah/v1/video.mp4", type: "video/mp4", source: "r2", size: 828e6, duration: 889 };
  assert.deepEqual(validateYoutubeItem(item), { errors: [], warnings: [] });
  assert.match(validateYoutubeItem({ ...item, duration: 20 * 60 }).warnings[0], /15 Minuten.*bestätigten Kanal/);
  assert.match(validateYoutubeItem({ ...item, source: undefined }).errors[0], /50 MB/);
  assert.equal(isStudioVideo({ media: [item] }), true);
  assert.equal(isStudioVideo({ media: [{ path: "a/1.mp4", type: "video/mp4" }] }), false);
});
