import test from "node:test";
import assert from "node:assert/strict";
import { WEEKPLAN, mondayOf, postState, weekGrid, weekScore } from "../src/social/weekplan.js";
import { isPlaceholder, utcToZurichLocal } from "../src/social/validate.js";

const swissDay = (iso) => utcToZurichLocal(iso).slice(0, 10);
const opts = { swissDay, isPlaceholder };
const accounts = [{ id: "ig", app_id: "leesidelab", platform: "instagram" }, { id: "yt", app_id: "leesidelab", platform: "youtube" }];

test("every channel has one slot per weekday", () => {
  for (const c of WEEKPLAN) assert.deepEqual(c.slots.map((s) => s.day), [0, 1, 2, 3, 4, 5, 6]);
});

test("mondayOf: the Monday of the week, Sunday belongs to the week before", () => {
  assert.equal(mondayOf("2026-10-26"), "2026-10-26");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26");
  assert.equal(mondayOf("2026-11-04"), "2026-11-02");
});

test("postState: approved/out is ok, draft, placeholder, failed", () => {
  assert.equal(postState({ status: "approved" }, isPlaceholder), "ok");
  assert.equal(postState({ status: "published" }, isPlaceholder), "ok");
  assert.equal(postState({ status: "draft", caption: "x", media: [{}] }, isPlaceholder), "draft");
  assert.equal(postState({ status: "draft", caption: "PLATZHALTER · x", media: [] }, isPlaceholder), "placeholder");
  assert.equal(postState({ status: "failed" }, isPlaceholder), "failed");
});

test("weekGrid: posts land on their Swiss day and account; the weakest post sets the day", () => {
  const plan = WEEKPLAN.filter((c) => c.app_id === "leesidelab");
  const posts = [
    { id: 1, account_id: "ig", status: "approved", scheduled_at: "2026-11-02T17:00:00Z" },          // Mo 18:00
    { id: 2, account_id: "ig", status: "draft", caption: "PLATZHALTER · x", media: [], scheduled_at: "2026-11-05T17:00:00Z" },   // Do
    { id: 3, account_id: "ig", status: "approved", scheduled_at: "2026-11-04T17:00:00Z" },          // Mi
    { id: 4, account_id: "ig", status: "draft", caption: "y", media: [{}], scheduled_at: "2026-11-04T18:00:00Z" },   // Mi second post
    { id: 5, account_id: "ig", status: "approved", scheduled_at: "2026-11-01T23:30:00Z" },          // Mo 00:30 Swiss
    { id: 6, account_id: "ig", status: "cancelled", scheduled_at: "2026-11-03T17:00:00Z" },         // ignored
    { id: 7, account_id: "yt", status: "approved", scheduled_at: "2026-11-02T18:00:00Z" },
  ];
  const [ig, yt] = weekGrid(plan, posts, accounts, "2026-11-02", opts);
  assert.equal(ig.account.id, "ig");
  assert.deepEqual(ig.days.map((d) => d.date), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.deepEqual(ig.days.map((d) => d.state), ["ok", "empty", "draft", "placeholder", "empty", "empty", "empty"]);
  assert.deepEqual(ig.days[0].posts.map((p) => p.id), [5, 1]);
  assert.equal(yt.days[0].state, "ok");
  assert.deepEqual(weekScore(ig), { ok: 1, total: 7 });
});

test("weekGrid: a channel without a connected account stays empty", () => {
  const [row] = weekGrid([{ app_id: "wolkenhof", platform: "youtube", slots: [{ day: 0, time: "10:00", format: "Folge" }] }], [], accounts, "2026-11-02", opts);
  assert.equal(row.account, null);
  assert.equal(row.days[0].state, "empty");
});
