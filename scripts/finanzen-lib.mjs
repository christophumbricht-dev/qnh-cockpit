// Pure logic of `npm run finanzen -- import` (tests/finanzen-import.test.mjs): an ausgaben.json from the local Ablage
// → rows for fin_costs and fin_bills. The file itself stays outside the repository (real amounts and receipt numbers).
//
// ausgaben.json: { "expenses": [ { date, vendor, title, category, app, currency, net, vat, gross, paid_with, doc_no,
//   file, reimburse, status, remark, recurring?, renews?, cost_name? } ] }
//   reimburse false / status "privat"   → not the company's: skipped
//   status "bezahlt_gmbh"               → the company paid it (nothing to pay back)
//   status "zurueckbezahlt"             → paid back already
//   recurring "monatlich, nächste 2026-11-10" / renews "2027-10-08" / title "(bis 04.10.2027)" → also an Abo in «Kosten & Abos»
import { BILL_FILE_TYPES } from "../src/finance/calc.js";

export class ImportError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cut = (s, n) => String(s ?? "").trim().slice(0, n);
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
function num(v, where, what) {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v) * 100) / 100;
  if (!Number.isFinite(n) || n < 0) throw new ImportError(`${where}: ${what} ist keine gültige Zahl.`);
  return n;
}

// receipt file → its content type (only what the bucket takes), or null
export const fileType = (name) => BILL_FILE_TYPES[String(name ?? "").split(".").pop().toLowerCase()] ?? null;

// «Apple Developer Program (bis 04.10.2027)» → «Apple Developer Program»; «Claude Max 20x, Oktober (…)» → «Claude Max 20x»
export function costName(e) {
  if (e.cost_name) return cut(e.cost_name, 80);
  return cut(String(e.title ?? "").replace(/\s*\([^)]*\)/g, "").split(/,\s/)[0], 80) || cut(e.vendor, 80);
}

// a receipt of a subscription? → { interval, next_due, notice_days } (yearly ones remind 30 days before) or null
export function subscriptionOf(e) {
  const rec = String(e.recurring ?? "");
  if (rec) {
    const interval = /monat|month/i.test(rec) ? "monthly" : /quartal|quarter/i.test(rec) ? "quarterly" : /jähr|jahr|year/i.test(rec) ? "yearly" : null;
    if (interval) return { interval, next_due: rec.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, notice_days: interval === "monthly" ? 0 : 30 };
  }
  if (DATE.test(e.renews ?? "")) return { interval: "yearly", next_due: e.renews, notice_days: 30 };
  const bis = String(e.title ?? "").match(/\(bis (\d{1,2})\.(\d{1,2})\.(\d{4})\)/);
  if (bis) return { interval: "yearly", next_due: `${bis[3]}-${bis[2].padStart(2, "0")}-${bis[1].padStart(2, "0")}`, notice_days: 30 };
  return null;
}

// one expense → a fin_bills row (without file_path / cost_id); null = private, not the company's
export function billRow(e, nowIso) {
  if (!e || typeof e !== "object") throw new ImportError("Ein Eintrag in «expenses» ist kein Objekt.");
  if (e.reimburse === false || e.status === "privat") return null;
  const where = `${e.date ?? "ohne Datum"} ${e.vendor ?? "ohne Anbieter"}`;
  if (!DATE.test(e.date ?? "")) throw new ImportError(`${where}: «date» fehlt oder ist nicht JJJJ-MM-TT.`);
  const payee = cut(e.vendor, 120);
  if (!payee) throw new ImportError(`${where}: «vendor» fehlt.`);
  const amount = num(e.gross ?? e.amount, where, "«gross»");
  if (amount == null) throw new ImportError(`${where}: «gross» (Betrag inkl. MWST) fehlt.`);
  const currency = String(e.currency ?? "CHF").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ImportError(`${where}: Währung «${e.currency}» ist nicht CHF/USD/EUR …`);
  const scope = String(e.app ?? e.scope ?? "qnh").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,30}$/.test(scope)) throw new ImportError(`${where}: App/Marke «${scope}» ist ungültig.`);
  const company = e.status === "bezahlt_gmbh";
  return {
    payee, amount, currency, due_date: e.date, status: "paid", paid_at: `${e.date}T10:00:00Z`, // noon in Switzerland
    net: num(e.net, where, "«net»"), vat: num(e.vat, where, "«vat»"), paid_with: cut(e.paid_with, 60),
    paid_by: company ? "firma" : "privat",
    reimbursed_at: !company && e.status === "zurueckbezahlt" ? (DATE.test(e.reimbursed_at ?? "") ? `${e.reimbursed_at}T10:00:00Z` : nowIso) : null,
    invoice_no: cut(e.doc_no, 40), scope, category: cut(e.category, 40), message: cut(e.title, 140), note: cut(e.remark, 1000), source: "claude",
  };
}

// what to create: subscriptions first (the bills link to them), then the bills. Receipts already in the cockpit
// (same payee + number) and doubles inside the file are skipped, so running the import again changes nothing.
export function planImport(expenses, { bills = [], costs = [] } = {}, nowIso = new Date().toISOString()) {
  if (!Array.isArray(expenses)) throw new ImportError("In der Datei fehlt die Liste «expenses».");
  const plan = { costs: [], bills: [], skipped: [] };
  const seen = new Set();
  for (const e of expenses) {
    const row = billRow(e, nowIso);
    const label = `${e?.date ?? ""} ${e?.vendor ?? ""}${e?.doc_no ? ` ${e.doc_no}` : ""}`.trim();
    if (!row) { plan.skipped.push({ label, why: "privat – nicht übernommen" }); continue; }
    // a receipt without number counts as the same when payee, day, amount and currency match
    const key = row.invoice_no ? `${row.payee.toLowerCase()}|${row.invoice_no}` : `${row.payee.toLowerCase()}|${row.due_date}|${row.amount}|${row.currency}`;
    if (seen.has(key)) { plan.skipped.push({ label, why: "doppelt in der Datei" }); continue; }
    const inCockpit = (b) => same(b.payee, row.payee) && (row.invoice_no ? b.invoice_no === row.invoice_no
      : !b.invoice_no && b.due_date === row.due_date && Number(b.amount) === Number(row.amount) && b.currency === row.currency);
    if (bills.some(inCockpit)) { plan.skipped.push({ label, why: "schon im Cockpit" }); continue; }
    seen.add(key);
    if (e.file && !fileType(e.file)) throw new ImportError(`${label}: «${e.file}» – nur PDF, JPG, PNG, HEIC oder WebP.`);
    const sub = subscriptionOf(e);
    let cost = null;
    if (sub) {
      const name = costName(e);
      cost = costs.find((c) => same(c.name, name)) ?? plan.costs.find((c) => same(c.name, name)) ?? null;
      if (!cost) {
        cost = { name, provider: cut(e.vendor, 80), scope: row.scope, category: row.category || "Software", amount: row.amount, currency: row.currency, ...sub, payment: row.paid_with, note: "", active: true };
        plan.costs.push(cost);
      }
    }
    plan.bills.push({ row, file: e.file ? String(e.file) : null, cost });
  }
  return plan;
}
