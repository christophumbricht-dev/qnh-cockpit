// scripts/roadmap.mjs: `set <id> --status done` treats recurring items like the cockpit (scripts/roadmap-lib.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import { CliError, itemFields, setPatch } from "../scripts/roadmap-lib.mjs";

const mwst = { id: "x", status: "next", title: "MWST-Abrechnung", due: "2026-09-30", repeat: "quarterly", repeat_day: 31 };

test("CLI: «done» on a recurring item rolls it forward and keeps it open", () => {
  const { patch, rolled } = setPatch(mwst, { status: "done" }, "2026-10-20", "T");
  assert.equal(rolled, true);
  assert.deepEqual(patch, { status: "next", due: "2026-12-31", repeat_day: 31, last_done_at: "T", snoozed_until: null });
});

test("CLI: --final closes a recurring item for good; one-off items close as before", () => {
  assert.deepEqual(setPatch(mwst, { status: "done", final: true }, "2026-10-20"), { patch: { status: "done", repeat: null, repeat_day: null }, rolled: false });
  assert.deepEqual(setPatch({ ...mwst, repeat: null }, { status: "done" }, "2026-10-20"), { patch: { status: "done" }, rolled: false });
  assert.deepEqual(setPatch(mwst, { status: "done", repeat: "none" }, "2026-10-20").patch, { status: "done", repeat: null, repeat_day: null });
  assert.equal(setPatch(mwst, { title: "MWST Q4" }, "2026-10-20").rolled, false); // no status change: just an edit
});

test("CLI: --repeat and --due set the day the item stays on; bad values are refused", () => {
  assert.deepEqual(itemFields({ title: "Miete", due: "2026-10-31", repeat: "monthly" }), { title: "Miete", due: "2026-10-31", repeat: "monthly", repeat_day: 31 });
  assert.deepEqual(itemFields({ due: "2026-11-15" }, mwst), { due: "2026-11-15", repeat_day: 15 });
  assert.deepEqual(itemFields({ repeat: "weekly" }, mwst), { repeat: "weekly", repeat_day: null });
  assert.throws(() => itemFields({ repeat: "daily" }), CliError);
  assert.throws(() => itemFields({ repeat: true }), /braucht einen Wert/);
  assert.throws(() => itemFields({ status: "erledigt" }), /--status/);
  assert.throws(() => itemFields({ due: "31.12.2026" }), /JJJJ-MM-TT/);
});
