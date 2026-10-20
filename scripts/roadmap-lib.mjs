// Pure helpers for scripts/roadmap.mjs (unit-tested in tests/roadmap-cli.test.mjs): which fields `add` / `set`
// write, and how `set --status done` treats recurring items – the same rule as the cockpit (recurringDone).
import { dayOfMonth, recurringDone } from "../src/finance/calc.js";

export const STATUS = { idea: "Ideen", next: "Als Nächstes", doing: "In Arbeit", done: "Erledigt" };
export const REPEAT = { weekly: "wöchentlich", monthly: "monatlich", quarterly: "vierteljährlich", yearly: "jährlich" };

export class CliError extends Error {}

// command-line options → row fields (only what was given); `item` = the stored row for `set`
export function itemFields(a, item = {}) {
  const row = {};
  for (const k of ["scope", "status", "title", "body", "due"]) if (a[k] !== undefined) row[k] = a[k] === "" ? null : a[k];
  if (row.status && !STATUS[row.status]) throw new CliError(`--status muss einer von ${Object.keys(STATUS).join(", ")} sein`);
  if (row.due && !/^\d{4}-\d{2}-\d{2}$/.test(row.due)) throw new CliError("--due im Format JJJJ-MM-TT (z. B. 2026-12-31)");
  if (row.body === null) row.body = "";
  if (a.repeat !== undefined) {
    if (a.repeat === true) throw new CliError("--repeat braucht einen Wert: weekly, monthly, quarterly, yearly oder none");
    row.repeat = a.repeat === "" || a.repeat === "none" ? null : a.repeat;
    if (row.repeat && !REPEAT[row.repeat]) throw new CliError(`--repeat muss einer von ${Object.keys(REPEAT).join(", ")} oder none sein`);
  }
  // like the cockpit editor: the due date sets the day a monthly/quarterly/yearly task stays on (31 = Monatsende)
  const repeat = "repeat" in row ? row.repeat : item.repeat;
  const due = "due" in row ? row.due : item.due;
  if ("repeat" in row || "due" in row) row.repeat_day = repeat && repeat !== "weekly" && due ? dayOfMonth(due) : null;
  return row;
}

// `set`: → { patch, rolled } – a recurring item «done» rolls forward (rolled = true) unless --final closes it
// for good (then it also stops repeating)
export function setPatch(item, a, today, now = new Date().toISOString()) {
  const patch = itemFields(a, item);
  const rolled = a.final ? null : recurringDone(item, patch, today, now);
  if (rolled) return { patch: rolled, rolled: true };
  if (a.final && patch.status === "done") Object.assign(patch, { repeat: null, repeat_day: null });
  return { patch, rolled: false };
}
