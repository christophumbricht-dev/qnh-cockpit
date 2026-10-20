// Finanzen – pure helpers (unit-tested in tests/finance-calc.test.mjs): monthly equivalents, renewal dates,
// totals per currency, what is due when, CSV export for the Treuhänder.

export const INTERVALS = { monthly: "monatlich", quarterly: "vierteljährlich", yearly: "jährlich", once: "einmalig" };
const PER_MONTH = { monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, once: 0 };
const MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

export const monthly = (c) => Number(c.amount || 0) * (PER_MONTH[c.interval] ?? 0);

// Swiss calendar day as YYYY-MM-DD
export const zurichToday = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(d);
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 864e5);

// Swiss calendar day of a timestamp (paid_at, created_at) – not the UTC day
export const zurichDay = (ts) => (ts ? zurichToday(new Date(ts)) : "");
export const dayOfMonth = (iso) => Number(String(iso).slice(8, 10));

// n months later, on `day` of that month (clamped to its length: day 31 = always the last day of the month)
export function addMonthsOnDay(iso, n, day) {
  const [y, m] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}
// add whole months, keeping the day where possible (31 Jan + 1 month = 28/29 Feb)
export const addMonths = (iso, n) => addMonthsOnDay(iso, n, dayOfMonth(iso));

// next renewal on or after today, from any known renewal date (subscriptions renew by themselves)
export function nextRenewal(cost, today) {
  if (!cost.next_due) return null;
  if (cost.interval === "once") return cost.next_due >= today ? cost.next_due : null;
  const step = MONTHS[cost.interval];
  if (!step) return null;
  let d = cost.next_due, i = 0;
  // from the anchor: n-th renewal (not chained, so the day of month never drifts)
  while (d < today && i < 1200) d = addMonths(cost.next_due, step * ++i);
  return d;
}

// recurring roadmap task: the due date after this one.
//   day = anchor day of the month (roadmap_items.repeat_day; default: the day of `due`), so the date never
//   drifts at month ends: anchor 31 → 31.3., 30.6., 30.9., 31.12. (not 30.12.); anchor 31 = «Monatsende»
export function nextDue(due, repeat, today, day = null) {
  const from = due || today;
  if (repeat === "weekly") {
    let d = addDays(from, 7);
    for (let i = 0; d <= today && i < 600; i++) d = addDays(d, 7); // done late: never in the past
    return d;
  }
  const step = { monthly: 1, quarterly: 3, yearly: 12 }[repeat] ?? 1;
  const anchor = day || dayOfMonth(from);
  // n-th step counted from `from` and placed on the anchor day (not chained from the clamped date)
  let i = 1, d = addMonthsOnDay(from, step, anchor);
  while (d <= today && i < 600) d = addMonthsOnDay(from, step * ++i, anchor); // done late: skip missed dates
  return d;
}

// a recurring roadmap task marked «Erledigt» rolls forward instead of closing – shared by the cockpit
// (src/qnh/ui.js) and the CLI (scripts/roadmap.mjs). → the patch to store, or null when the task really closes
// (not recurring, «einmalig» chosen in the same edit, or already done).
export function recurringDone(item, patch, today, now = new Date().toISOString()) {
  const repeat = "repeat" in patch ? patch.repeat : item.repeat;
  if (patch.status !== "done" || !repeat || item.status === "done") return null;
  const base = patch.due ?? item.due ?? null;
  const day = repeat === "weekly" ? null : ("repeat_day" in patch ? patch.repeat_day : item.repeat_day) || dayOfMonth(base ?? today);
  const due = nextDue(base, repeat, today, day);
  return { ...patch, status: item.status === "idea" ? "next" : item.status, due, repeat_day: day, last_done_at: now, snoozed_until: null };
}

// { CHF: 123.4, USD: 9.9 } for the active costs, per month
export function monthlyTotals(costs) {
  const out = {};
  for (const c of costs) if (c.active !== false) out[c.currency] = (out[c.currency] ?? 0) + monthly(c);
  return out;
}

export function sumBy(rows, key = "currency") {
  const out = {};
  for (const r of rows) if (r.amount != null) out[r[key]] = (out[r[key]] ?? 0) + Number(r.amount);
  return out;
}

const fmt = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (amount, currency = "CHF") => (amount == null ? "–" : `${currency} ${fmt.format(Number(amount))}`);
export const moneyList = (totals) => Object.entries(totals).filter(([, v]) => v > 0.004).map(([cur, v]) => money(v, cur)).join(" + ") || money(0);

// "1'234.50", "1 234,50", "CHF 99.–" → 1234.5 (null when empty)
export function parseAmount(text) {
  const s = String(text ?? "").replace(/CHF|EUR|USD|Fr\.?/gi, "").replace(/[–-]$/, "").replace(/['’\s]/g, "").trim();
  if (!s) return null;
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

// due date of an open bill; without one: 30 days after it was entered («Fälligkeit geschätzt»), so it does not
// sit in «Diese Woche» forever
export const ESTIMATE_DAYS = 30;
export function billDue(b, today) {
  if (b.due_date) return { date: b.due_date, estimated: false };
  return { date: addDays(zurichDay(b.created_at) || today, ESTIMATE_DAYS), estimated: true };
}

// what the money side needs from Christoph, for «Heute» and the Finanzen page
//   bills: open bills by due date (estimated when missing);
//   renewals: subscriptions whose reminder (notice_days before) has come, unless «Behalten» for that renewal
//   (fin_costs.ack_until = the acknowledged renewal date; the next renewal reminds again)
export function financeDue(costs, bills, today, horizon = 7) {
  const items = [];
  for (const b of bills) {
    if (b.status !== "open") continue;
    const { date, estimated } = billDue(b, today);
    items.push({ kind: "bill", row: b, date, days: daysBetween(today, date), estimated });
  }
  for (const c of costs) {
    if (c.active === false || !c.notice_days) continue;
    const next = nextRenewal(c, today);
    if (!next || (c.ack_until && c.ack_until >= next)) continue;
    const remindFrom = addDays(next, -c.notice_days);
    if (daysBetween(today, remindFrom) <= horizon) items.push({ kind: "renewal", row: c, date: next, days: daysBetween(today, next), remindFrom });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// «Heute» lane of a financeDue() item. Bills by due date: overdue → now, in 0–2 days → today, ≤ 7 → week.
// Renewal reminders by when the reminder starts (not by the renewal date): started → today, starts this week → week.
export function financeLane(d, today) {
  if (d.kind === "renewal") return d.remindFrom <= today ? "today" : "week";
  return d.days < 0 ? "now" : d.days <= 2 ? "today" : d.days <= 7 ? "week" : null;
}

// next N days: renewals of every active cost + open bills, for the overview. A renewal whose bill is already
// entered (open bill with that cost_id in the window) is shown once – as the bill.
export function upcoming(costs, bills, today, days = 30) {
  const until = addDays(today, days);
  const out = [];
  // overdue bills are not «upcoming» – they are shown as overdue
  const open = bills.filter((b) => b.status === "open" && b.due_date && b.due_date >= today && b.due_date <= until);
  for (const c of costs) {
    if (c.active === false) continue;
    const dates = [];
    let d = nextRenewal(c, today);
    for (let i = 0; d && d <= until && i < 40; i++) {
      dates.push(d);
      if (c.interval === "once") break;
      d = nextRenewal(c, addDays(d, 1)); // from the anchor (c.next_due), so the day never drifts
    }
    // each open bill of this cost replaces the renewal closest to its due date
    for (const b of open.filter((x) => x.cost_id && x.cost_id === c.id)) {
      if (!dates.length) break;
      let k = 0;
      dates.forEach((x, j) => { if (Math.abs(daysBetween(x, b.due_date)) < Math.abs(daysBetween(dates[k], b.due_date))) k = j; });
      dates.splice(k, 1);
    }
    for (const date of dates) out.push({ kind: "renewal", date, name: c.name, amount: c.amount, currency: c.currency, scope: c.scope, row: c });
  }
  for (const b of open) out.push({ kind: "bill", date: b.due_date, name: b.payee, amount: b.amount, currency: b.currency, scope: b.scope, row: b });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// CSV export for the Treuhänder: which bills belong to a period. A paid bill counts on the day it was paid
// (Swiss day), an open or cancelled one on its due date, one without any date on the day it was entered.
export const bookingDay = (b) => (b.status === "paid" && b.paid_at ? zurichDay(b.paid_at) : b.due_date || zurichDay(b.created_at));
// "year" | "last-year" | "all" → { from, to, label } (inclusive Swiss days; all = no limits)
export function exportPeriod(kind, today) {
  const y = Number(today.slice(0, 4));
  if (kind === "all") return { from: null, to: null, label: "alle" };
  const year = kind === "last-year" ? y - 1 : y;
  return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
}
export const inPeriod = (b, { from, to }) => { const d = bookingDay(b); return (!from || d >= from) && (!to || d <= to); };

// files the private bucket "finance" accepts (same list as its allowed_mime_types)
export const BILL_FILE_TYPES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp" };
export const BILL_FILE_ACCEPT = [...new Set(Object.values(BILL_FILE_TYPES))].join(",") + "," + Object.keys(BILL_FILE_TYPES).map((x) => `.${x}`).join(",");
// → the content type to store, or null when the file is not allowed (some browsers give HEIC files no type)
export function billFileType(file) {
  const type = String(file?.type ?? "").toLowerCase();
  if (Object.values(BILL_FILE_TYPES).includes(type)) return type;
  const ext = String(file?.name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (!type || type === "application/octet-stream") && BILL_FILE_TYPES[ext] ? BILL_FILE_TYPES[ext] : null;
}

// CSV for Excel (semicolon, BOM so umlauts survive). Text that Excel would run as a formula (= + - @, also
// after a leading tab or carriage return) gets a leading apostrophe; numbers stay numbers.
export function toCsv(header, rows) {
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    const formula = typeof v !== "number" && /^[=+\-@\t\r]/.test(s);
    return formula || /[;"\n\r]/.test(s) ? `"${formula ? "'" : ""}${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
