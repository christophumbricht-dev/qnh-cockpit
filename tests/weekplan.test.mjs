import test from "node:test";
import assert from "node:assert/strict";
import { WEEKPLAN, mondayOf } from "../src/social/weekplan.js";


test("every channel has one slot per weekday", () => {
  for (const c of WEEKPLAN) assert.deepEqual(c.slots.map((s) => s.day), [0, 1, 2, 3, 4, 5, 6]);
});

test("mondayOf: the Monday of the week, Sunday belongs to the week before", () => {
  assert.equal(mondayOf("2026-10-26"), "2026-10-26");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26");
  assert.equal(mondayOf("2026-11-04"), "2026-11-02");
});
