import test from "node:test";
import assert from "node:assert/strict";
import { bucket, mondayOf, niceMax, chartSvg } from "../src/charts.js";

const days = (n, from = "2026-10-01") => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return { day: d.toISOString().slice(0, 10), flights: 1, pilots_total: 10 + i };
});

test("mondayOf", () => {
  assert.equal(mondayOf("2026-10-13"), "2026-10-12"); // Tuesday
  assert.equal(mondayOf("2026-10-12"), "2026-10-12"); // Monday
  assert.equal(mondayOf("2026-10-18"), "2026-10-12"); // Sunday
});

test("up to 31 days stay daily", () => {
  const { weekly, periods } = bucket(days(30), { sum: ["flights"] });
  assert.equal(weekly, false);
  assert.equal(periods.length, 30);
});

test("longer ranges become weeks: sums add up, totals take the last day", () => {
  const rows = days(90);
  const { weekly, periods } = bucket(rows, { sum: ["flights"], last: ["pilots_total"] });
  assert.equal(weekly, true);
  assert.equal(periods.reduce((s, p) => s + p.flights, 0), 90);
  assert.equal(periods.at(-1).pilots_total, rows.at(-1).pilots_total);
  assert.ok(periods.every((p) => mondayOf(p.from) === p.key));
  assert.ok(periods.slice(1, -1).every((p) => p.days === 7)); // first/last week may be partial
});

test("niceMax", () => {
  assert.equal(niceMax(0), 4);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(23), 25);
  assert.equal(niceMax(412), 500);
});

test("chartSvg escapes and has one hit target per period", () => {
  const { weekly, periods } = bucket(days(14), { sum: ["flights"] });
  const svg = chartSvg({ periods, weekly, key: "flights", kind: "bar", label: `<x>` });
  assert.ok(svg.includes("&lt;x&gt;"));
  assert.equal(svg.match(/class="hit"/g).length, 14);
});
