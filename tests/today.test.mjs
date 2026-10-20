import test from "node:test";
import assert from "node:assert/strict";
import { buildAgenda, dueLabel, isoWeek, laneForDate, needsYou } from "../src/today.js";
import { financeDue, financeLane } from "../src/finance/calc.js";

test("lanes from due dates", () => {
  assert.equal(laneForDate("2026-10-19", "2026-10-20"), "now");
  assert.equal(laneForDate("2026-10-20", "2026-10-20"), "today");
  assert.equal(laneForDate("2026-10-22", "2026-10-20"), "week");
  assert.equal(laneForDate("2026-10-22", "2026-10-20", { todayDays: 2 }), "today");
  assert.equal(laneForDate("2026-10-28", "2026-10-20"), null);
  assert.equal(laneForDate(null, "2026-10-20"), null);
  assert.equal(dueLabel("2026-10-18", "2026-10-20"), "seit 2 Tagen überfällig");
  assert.equal(dueLabel("2026-10-21", "2026-10-20"), "morgen");
});

test("agenda: three lanes, alerts first, then by date; each item once", () => {
  const lanes = buildAgenda([
    { key: "a", lane: "today", tone: "info", title: "Kommentare", date: null },
    { key: "b", lane: "today", tone: "alert", title: "Build fehlgeschlagen" },
    { key: "c", lane: "today", tone: "info", title: "Rechnung", date: "2026-10-20" },
    { key: "d", lane: "now", tone: "alert", title: "Überfällig" },
    { key: "d", lane: "now", tone: "alert", title: "Überfällig (doppelt)" },
    { key: "e", lane: "week", tone: "info", title: "Abo" },
    { key: "f", lane: null, title: "nicht anzeigen" },
  ]);
  assert.deepEqual(lanes.today.map((i) => i.key), ["b", "c", "a"]);
  assert.deepEqual(lanes.now.map((i) => i.title), ["Überfällig"]);
  assert.equal(needsYou(lanes), 4);
});

test("finance on «Heute»: a renewal reminder is for today once it has started – and counts in the header", () => {
  const today = "2026-10-20";
  const costs = [
    { id: "apple", name: "Apple", amount: 99, currency: "USD", interval: "yearly", next_due: "2026-11-15", notice_days: 30 }, // reminder since 16.10.
    { id: "ins", name: "Haftpflicht", amount: 380, currency: "CHF", interval: "yearly", next_due: "2026-12-22", notice_days: 60 }, // from 23.10.
  ];
  const bills = [
    { id: "late", status: "open", due_date: "2026-10-18" },
    { id: "soon", status: "open", due_date: "2026-10-22" },
    { id: "week", status: "open", due_date: "2026-10-26" },
    { id: "later", status: "open", due_date: "2026-11-30" },
  ];
  const lanes = Object.fromEntries(financeDue(costs, bills, today).map((d) => [d.row.id, financeLane(d, today)]));
  assert.deepEqual(lanes, { apple: "today", ins: "week", late: "now", soon: "today", week: "week", later: null });
  const agenda = buildAgenda(Object.entries(lanes).map(([key, lane]) => ({ key, lane, title: key })));
  assert.equal(needsYou(agenda), 3); // late + soon + the Apple reminder
});

test("calendar week (ISO, as on Swiss calendars)", () => {
  assert.equal(isoWeek("2026-10-20"), 43);
  assert.equal(isoWeek("2026-01-01"), 1); // a Thursday
  assert.equal(isoWeek("2027-01-01"), 53); // a Friday: still week 53 of 2026
  assert.equal(isoWeek("2027-01-04"), 1);
  assert.equal(isoWeek("2025-12-29"), 1); // Monday of week 1 of 2026
  assert.equal(isoWeek("2026-12-31"), 53);
});
