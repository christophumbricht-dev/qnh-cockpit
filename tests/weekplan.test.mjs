import test from "node:test";
import assert from "node:assert/strict";
import { WEEKPLAN, mondayOf } from "../src/social/weekplan.js";


test("every channel has one slot per weekday, Zeitkacheln only Monday and Thursday", () => {
  for (const c of WEEKPLAN) {
    const tage = c.app_id === "leesidelab" && c.platform === "youtube" ? [0, 3] : [0, 1, 2, 3, 4, 5, 6];
    assert.deepEqual(c.slots.map((s) => s.day), tage);
  }
});

test("mondayOf: the Monday of the week, Sunday belongs to the week before", () => {
  assert.equal(mondayOf("2026-10-26"), "2026-10-26");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26");
  assert.equal(mondayOf("2026-11-04"), "2026-11-02");
});
