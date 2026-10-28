import { test } from "node:test";
import assert from "node:assert/strict";
import { afterNewVersion, afterReview, christophsTurn, deadline, isLate, phaseOf, pipelineBlock } from "../src/studio/pipeline.js";

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

test("pipelineBlock: 4 weeks per channel, the weakest item of a day, late marks", () => {
  const items = [
    { id: "a", channel: "leesidelab/youtube", day: "2026-11-02", status: "approved" },
    { id: "b", channel: "leesidelab/youtube", day: "2026-11-02", status: "draft" },
    { id: "c", channel: "leesidelab/youtube", day: "2026-11-24", status: "idea" },
    { id: "d", channel: "leesidelab/youtube", day: "2026-11-03", status: "dropped" },
    { id: "e", channel: "leesidelab/instagram", day: "2026-11-04", status: "idea" },
  ];
  const [row] = pipelineBlock(items, "2026-11-02", "2026-10-28");
  assert.equal(row.channel, "leesidelab/youtube");
  assert.equal(row.weeks.length, 4);
  const mon = row.weeks[0].days[0];
  assert.deepEqual(mon.items.map((i) => i.id), ["a", "b"]);
  assert.equal(mon.phase.color, "blue");
  assert.equal(mon.late, true);   // draft (step 2) was due 14 days before 2.11.
  const tue = row.weeks[0].days[1];
  assert.deepEqual([tue.items.length, tue.phase.label, tue.late], [0, "noch keine Idee", true]);
  assert.equal(row.weeks[3].days[1].phase.who, "christoph");
  assert.equal(row.weeks[3].days[1].late, false);
});
