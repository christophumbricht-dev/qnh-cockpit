// «Heute»: everything that needs Christoph, in three lanes. Pure (tests/today.test.mjs); the items are
// collected in main.js from the apps, store, social, roadmap and finance.
//   item: { key, lane: "now" | "today" | "week", tone: "alert" | "info", title, sub?, where?, app?, scope?, href?, date?, actions? }
import { daysBetween } from "./finance/calc.js";

export const LANES = [
  ["now", "Jetzt", "Überfällig oder kaputt – zuerst"],
  ["today", "Heute", "Heute erledigen"],
  ["week", "Diese Woche", "Kommt in den nächsten Tagen"],
];

// a due date → lane: overdue now, due today (or within `todayDays`) today, within 7 days this week, later not shown
export function laneForDate(date, today, { todayDays = 0, weekDays = 7 } = {}) {
  if (!date) return null;
  const d = daysBetween(today, date);
  if (d < 0) return "now";
  if (d <= todayDays) return "today";
  if (d <= weekDays) return "week";
  return null;
}

export function dueLabel(date, today) {
  if (!date) return "";
  const d = daysBetween(today, date);
  if (d < -1) return `seit ${-d} Tagen überfällig`;
  if (d === -1) return "seit gestern überfällig";
  if (d === 0) return "heute";
  if (d === 1) return "morgen";
  return new Date(`${date}T12:00:00`).toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "numeric" });
}

// lanes in order; inside a lane: alerts first, then by date, then by title; duplicates (same key) once
export function buildAgenda(items) {
  const lanes = Object.fromEntries(LANES.map(([k]) => [k, []]));
  const seen = new Set();
  for (const it of items) {
    if (!it || !lanes[it.lane] || seen.has(it.key)) continue;
    seen.add(it.key);
    lanes[it.lane].push(it);
  }
  for (const list of Object.values(lanes)) {
    list.sort((a, b) => (a.tone === "alert" ? 0 : 1) - (b.tone === "alert" ? 0 : 1)
      || (a.date ?? "9999").localeCompare(b.date ?? "9999") || String(a.title).localeCompare(String(b.title), "de"));
  }
  return lanes;
}

// how many things need Christoph today (now + today; «Diese Woche» is a look ahead)
export const needsYou = (lanes) => lanes.now.length + lanes.today.length;
