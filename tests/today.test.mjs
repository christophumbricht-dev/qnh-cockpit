import test from "node:test";
import assert from "node:assert/strict";
import { buildAgenda, dueLabel, laneForDate, needsYou } from "../src/today.js";

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
