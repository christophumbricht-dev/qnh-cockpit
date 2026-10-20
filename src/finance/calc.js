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

// add whole months, keeping the day where possible (31 Jan + 1 month = 28/29 Feb)
export function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

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

// recurring roadmap task: the due date after this one
export function nextDue(due, repeat, today) {
  const from = due || today;
  const step = { weekly: null, monthly: 1, quarterly: 3, yearly: 12 }[repeat];
  let d = repeat === "weekly" ? addDays(from, 7) : addMonths(from, step ?? 1);
  // done late: never schedule the next one in the past
  for (let i = 0; d <= today && i < 600; i++) d = repeat === "weekly" ? addDays(d, 7) : addMonths(d, step ?? 1);
  return d;
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

// what the money side needs from Christoph, for «Heute» and the Finanzen page
//   bills: open bills by due date; renewals: subscriptions whose reminder (notice_days before) has come
export function financeDue(costs, bills, today, horizon = 7) {
  const items = [];
  for (const b of bills) {
    if (b.status !== "open") continue;
    const days = b.due_date ? daysBetween(today, b.due_date) : null;
    items.push({ kind: "bill", row: b, date: b.due_date, days });
  }
  for (const c of costs) {
    if (c.active === false || !c.notice_days) continue;
    const next = nextRenewal(c, today);
    if (!next) continue;
    const remindFrom = addDays(next, -c.notice_days);
    if (daysBetween(today, remindFrom) <= horizon) items.push({ kind: "renewal", row: c, date: next, days: daysBetween(today, next) });
  }
  return items.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
}

// next N days: renewals of every active cost + open bills, for the overview
export function upcoming(costs, bills, today, days = 30) {
  const until = addDays(today, days);
  const out = [];
  for (const c of costs) {
    if (c.active === false) continue;
    let d = nextRenewal(c, today);
    for (let i = 0; d && d <= until && i < 40; i++) {
      out.push({ kind: "renewal", date: d, name: c.name, amount: c.amount, currency: c.currency, scope: c.scope, row: c });
      if (c.interval === "once") break;
      d = nextRenewal({ ...c, next_due: d }, addDays(d, 1));
    }
  }
  // overdue bills are not «upcoming» – they are shown as overdue
  for (const b of bills) if (b.status === "open" && b.due_date && b.due_date >= today && b.due_date <= until) out.push({ kind: "bill", date: b.due_date, name: b.payee, amount: b.amount, currency: b.currency, scope: b.scope, row: b });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// CSV for Excel (semicolon, BOM so umlauts survive)
export function toCsv(header, rows) {
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[;"\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
