import { test } from "node:test";
import assert from "node:assert/strict";
import { GOALS, costPer, costPerMonth, dailyGain, daySeries, forecast, metric, stageProgress } from "../src/social/growth.js";

const rows = [
  { day: "2026-10-24", metrics: { followers_count: 10, views_total: 100, views: 5 } },
  { day: "2026-10-25", metrics: { followers_count: 12, views_total: 160, views: 9 } },
  { day: "2026-10-27", metrics: { followers_count: 15, views_total: 300 } },
  { day: "2026-10-28", metrics: { followers_count: 15, views_total: 290 } },
];

test("daySeries: values per day, running totals become daily gains (no gap, no drop)", () => {
  assert.deepEqual(daySeries(rows, metric("followers_count")).map((p) => p.value), [10, 12, 15, 15]);
  assert.deepEqual(daySeries(rows, metric("views")).map((p) => [p.from, p.value]), [["2026-10-24", 5], ["2026-10-25", 9]]);
  assert.deepEqual(daySeries(rows, dailyGain("views_total")).map((p) => [p.from, p.value]), [["2026-10-25", 60], ["2026-10-28", 0]]);
});

test("costPerMonth: active recurring costs of the app, per currency", () => {
  const costs = [
    { scope: "leesidelab", amount: 22, currency: "USD", interval: "monthly" },
    { scope: "leesidelab", amount: 120, currency: "CHF", interval: "yearly" },
    { scope: "leesidelab", amount: 5, currency: "CHF", interval: "monthly", active: false },
    { scope: "leesidelab", amount: 300, currency: "CHF", interval: "once" },
    { scope: "downwind", amount: 9, currency: "CHF", interval: "monthly" },
  ];
  assert.deepEqual(costPerMonth(costs, "leesidelab"), { USD: 22, CHF: 10 });
  assert.deepEqual(costPerMonth(null, "x"), {});
});

test("costPer: CHF per 1'000 views and per new follower on a 30-day basis", () => {
  assert.deepEqual(costPer(30, 3000, 15, 30), { perThousandViews: 10, perFollower: 2 });
  assert.deepEqual(costPer(30, 0, 0, 30), { perThousandViews: null, perFollower: null });
  assert.deepEqual(costPer(0, 100, 1, 30), { perThousandViews: null, perFollower: null });
});

test("stageProgress: all needs and the best alternative count", () => {
  const ypp = GOALS.youtube[1];
  const p = stageProgress(ypp, { subscribers: 250, watch_hours_long_365d: 400, shorts_views_90d: 5_000_000 });
  assert.equal(p.best.key, "shorts_views_90d");
  assert.equal(p.share, 0.25);   // subscribers hold it back
  assert.equal(p.done, false);
  assert.equal(stageProgress(ypp, { subscribers: 1200, watch_hours_long_365d: 4100 }).done, true);
  assert.equal(stageProgress(GOALS.instagram[0], { followers: 125 }).share, 0.25);
  assert.equal(stageProgress(ypp, {}).share, 0);
});

test("forecast: days to the goal at the pace of the period", () => {
  assert.deepEqual(forecast(100, 500, 40, 28, "2026-10-28"), { days: 280, date: "2027-08-04" });
  assert.deepEqual(forecast(600, 500, 0, 28, "2026-10-28"), { days: 0, date: "2026-10-28" });
  assert.equal(forecast(100, 500, 0, 28, "2026-10-28"), null);
  assert.equal(forecast(null, 500, 5, 28, "2026-10-28"), null);
});
