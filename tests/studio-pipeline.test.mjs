import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCK_ROWS, inPipeline, afterNewVersion, afterReview, christophsTurn, deadline, isLate, phaseOf, pipelineBlock } from "../src/studio/pipeline.js";

test("phaseOf: step, colour and whose turn", () => {
  assert.deepEqual([phaseOf(null).n, phaseOf(null).color, phaseOf(null).who], [1, "grey", "claude"]);
  assert.deepEqual([phaseOf("idea").n, phaseOf("idea").who], [1, "christoph"]);
  assert.deepEqual([phaseOf("idea_ok").color, phaseOf("draft").who], ["blue", "christoph"]);
  assert.deepEqual([phaseOf("draft_done").color, phaseOf("review1").color], ["orange", "orange"]);
  assert.deepEqual([phaseOf("work").color, phaseOf("review2").who], ["yellow", "christoph"]);
  assert.equal(phaseOf("approved").color, "green");
  assert.equal(christophsTurn("work"), false);
  assert.equal(christophsTurn("review2"), true);
});

test("deadlines count back from the air date; late only after the deadline", () => {
  assert.equal(deadline("2026-11-22", 1), "2026-11-01");
  assert.equal(deadline("2026-11-22", 4), "2026-11-19");
  assert.equal(deadline("2026-11-22", 5), null);
  assert.equal(isLate(null, "2026-11-22", "2026-11-01"), false);
  assert.equal(isLate(null, "2026-11-22", "2026-11-02"), true);
  assert.equal(isLate("review1", "2026-11-22", "2026-11-15"), false);
  assert.equal(isLate("review1", "2026-11-22", "2026-11-16"), true);
  assert.equal(isLate("approved", "2026-11-22", "2026-11-22"), false);
});

test("transitions after a review and after a new version", () => {
  assert.equal(afterReview("draft"), "draft_done");
  assert.equal(afterReview("review1"), "work");
  assert.equal(afterReview("review2"), "work");
  assert.equal(afterNewVersion("idea_ok"), "draft");
  assert.equal(afterNewVersion("draft_done"), "review1");
  assert.equal(afterNewVersion("review1"), "review1");
  assert.equal(afterNewVersion("work"), "review2");
  assert.equal(afterNewVersion("approved"), "review2");
});

test("pipelineBlock: only long videos, weakest item per day, weekly goal of 2", () => {
  const items = [
    { id: "a", channel: "leesidelab/youtube", format: "video_long", day: "2026-11-02", status: "approved" },
    { id: "b", channel: "leesidelab/youtube", format: "video_long", day: "2026-11-02", status: "draft" },
    { id: "s", channel: "leesidelab/youtube", format: "short", day: "2026-11-03", status: "review1" },
    { id: "c", channel: "leesidelab/youtube", format: "video_long", day: "2026-11-24", status: "idea" },
    { id: "d", channel: "leesidelab/youtube", format: "video_long", day: "2026-11-25", status: "dropped" },
  ];
  const [row] = pipelineBlock(items, "2026-11-02", "2026-10-28");
  assert.deepEqual([row.channel, row.perWeek, row.weeks.length], ["leesidelab/youtube", 2, 4]);
  const w1 = row.weeks[0];
  assert.deepEqual(w1.days[0].items.map((i) => i.id), ["a", "b"]);
  assert.equal(w1.days[0].phase.color, "blue");
  assert.equal(w1.days[0].late, true);            // draft was due 14 days before 2.11.
  assert.equal(w1.days[1].items.length, 0);       // the Short is not part of the Ablauf
  assert.equal(w1.days[1].late, false);           // a free day is never late
  assert.deepEqual([w1.count, w1.missing, w1.late], [2, 0, false]);
  const w2 = row.weeks[1];                        // 9.11.: no long video, idea deadline 19.10. passed
  assert.deepEqual([w2.count, w2.missing, w2.late], [0, 2, true]);
  const w4 = row.weeks[3];                        // 23.11.: one idea, deadline 2.11. not yet
  assert.deepEqual([w4.count, w4.missing, w4.late], [1, 1, false]);
});

test("pipelineBlock: the Shorts row has the YouTube week and is never late for missing ideas", () => {
  const items = [
    { id: "s", channel: "leesidelab/youtube", format: "short", day: "2026-11-03", status: "review1" },
    { id: "l", channel: "leesidelab/youtube", format: "video_long", day: "2026-11-03", status: "review1" },
  ];
  const [row] = pipelineBlock(items, "2026-11-02", "2026-11-20", 1, BLOCK_ROWS.filter((r) => r.looksOnly));
  const w = row.weeks[0];
  assert.deepEqual([row.perWeek, w.count, w.late], [7, 1, false]);
  assert.deepEqual(w.days[1].items.map((i) => i.id), ["s"]);
  assert.deepEqual([w.days[1].phase.n, w.days[1].phase.color], [3, "orange"]);
  assert.equal(w.days[0].slot.note, "Short");
  assert.equal(inPipeline("leesidelab/youtube", "short"), false);
});

test("pipelineBlock: N/A on days with nothing on purpose", () => {
  const long = (id, day) => ({ id, channel: "leesidelab/youtube", format: "video_long", day, status: "idea" });
  const [row] = pipelineBlock([long("a", "2026-11-03"), long("b", "2026-11-06"), long("c", "2026-11-10")], "2026-11-02", "2026-10-28", 2);
  // week 1 has its 2: the free days are N/A; week 2 has 1 of 2: the free days are still open
  assert.deepEqual(row.weeks[0].days.map((d) => d.off), [true, false, true, true, false, true, true]);
  assert.equal(row.weeks[1].days.some((d) => d.off), false);
  // a row with a standard week: every day has its slot, so nothing is N/A
  const [ig] = pipelineBlock([], "2026-11-02", "2026-10-28", 1, BLOCK_ROWS.filter((r) => r.channel === "leesidelab/instagram"));
  assert.equal(ig.weeks[0].days.some((d) => d.off), false);
});
