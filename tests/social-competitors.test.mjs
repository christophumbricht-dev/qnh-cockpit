import { test } from "node:test";
import assert from "node:assert/strict";
import { channelSummary, fmtDuration, fmtViews, latestViews, median, parseChannel, rated, standouts, videoUrl } from "../src/social/competitors.js";

const NOW = new Date("2026-10-30T12:00:00Z");
const v = (video_id, competitor_id, published, extra = {}) => ({ video_id, competitor_id, published_at: `${published}T12:00:00Z`, is_short: false, duration_s: 900, title: video_id, ...extra });
const d = (video_id, day, views) => ({ video_id, day, views });

test("median and latest views with the growth of the last 7 days", () => {
  assert.deepEqual([median([3, 1, 2]), median([4, 1, 2, 3]), median([]), median([null, 5])], [2, 2.5, null, 5]);
  const m = latestViews([d("a", "2026-10-20", 100), d("a", "2026-10-23", 150), d("a", "2026-10-30", 400), d("b", "2026-10-29", 10)]);
  assert.deepEqual(m.get("a"), { views: 400, day: "2026-10-30", week: 250 });
  assert.deepEqual(m.get("b"), { views: 10, day: "2026-10-29", week: null });
});

test("standouts: views against the usual of the same channel and kind", () => {
  const videos = [
    v("a1", "A", "2026-10-20"), v("a2", "A", "2026-10-10"), v("a3", "A", "2026-09-30"), v("a4", "A", "2026-10-25"),
    v("s1", "A", "2026-10-25", { is_short: true }),
    v("b1", "B", "2026-10-20"), v("b2", "B", "2026-10-10"),          // only 2: no usual, no factor
    v("old", "A", "2026-06-01"),
  ];
  const days = [
    d("a1", "2026-10-30", 1000), d("a2", "2026-10-30", 2000), d("a3", "2026-10-30", 3000), d("a4", "2026-10-30", 5000),
    d("s1", "2026-10-30", 99999), d("b1", "2026-10-30", 1e6), d("b2", "2026-10-30", 10), d("old", "2026-10-30", 15000),
  ];
  const r = rated(videos, days, NOW);
  assert.equal(r.find((x) => x.video_id === "b1").factor, null);
  assert.equal(r.find((x) => x.video_id === "s1").factor, null);   // one Short only
  const top = standouts(videos, days, { now: NOW });
  // a4: 5000 views against the channel's usual of 3000 (median of a1..a4 and old); «old» is outside the 60 days
  assert.deepEqual(top.map((x) => x.video_id), ["a4"]);
  assert.equal(top[0].factor.toFixed(2), "1.67");
  assert.deepEqual(standouts(videos, days, { now: NOW, shorts: true }), []);
});

test("channel summary: uploads in 30 days, usual views and length", () => {
  const videos = [v("a1", "A", "2026-10-20", { duration_s: 600 }), v("a2", "A", "2026-08-10", { duration_s: 1200 }), v("s1", "A", "2026-10-25", { is_short: true, duration_s: 40 })];
  const days = [d("a1", "2026-10-30", 100), d("a2", "2026-10-30", 300), d("s1", "2026-10-30", 50)];
  const [s] = channelSummary([{ id: "A", handle: "@a" }], videos, days, NOW);
  assert.deepEqual([s.long30, s.shorts30, s.longViews, s.shortViews, s.longLength], [1, 1, 200, 50, 900]);
});

test("formats and input", () => {
  assert.deepEqual([fmtDuration(754), fmtDuration(3723), fmtDuration(null)], ["12:34", "1:02:03", ""]);
  // the Swiss grouping of the runtime, like num() everywhere in the cockpit
  assert.deepEqual([fmtViews(12345), fmtViews(1234567), fmtViews(null)], [(12345).toLocaleString("de-CH"), `${(1.2).toLocaleString("de-CH")} Mio.`, "–"]);
  assert.equal(parseChannel("@GreenDotAviation"), "@GreenDotAviation");
  assert.equal(parseChannel("https://www.youtube.com/@MentourPilot/videos"), "@MentourPilot");
  assert.equal(parseChannel("Boldmethod"), "@Boldmethod");
  assert.equal(parseChannel("https://youtube.com/channel/UC1234567890123456789012"), "UC1234567890123456789012");
  assert.equal(parseChannel("zu kurz @a"), null);
  assert.equal(videoUrl({ video_id: "x", is_short: true }), "https://www.youtube.com/shorts/x");
});
