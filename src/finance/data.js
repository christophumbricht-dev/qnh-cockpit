// Finanzen in QNH Core (tables fin_costs, fin_bills; private bucket "finance"). Admins only – the database decides.
import { DEMO, client } from "../api.js";
import { QNH } from "../apps.js";
import * as demo from "./demo.js";
import { billFileType, inPeriod } from "./calc.js";

const BUCKET = "finance";
const sb = () => client(QNH);
const must = (r, what) => { if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code, what }); return r.data; };

export const financeConfigured = () => DEMO || Boolean(QNH.url && QNH.anonKey);

const COST_FIELDS = ["name", "provider", "scope", "category", "amount", "currency", "interval", "next_due", "notice_days", "payment", "url", "note", "active", "ack_until"];
const BILL_FIELDS = ["payee", "amount", "currency", "due_date", "status", "iban", "reference", "message", "invoice_no", "scope", "category", "cost_id", "file_path", "note", "source"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k] === "" && ["next_due", "due_date", "url", "iban", "cost_id", "ack_until", "file_path"].includes(k) ? null : o[k]]));

// null = not set up yet (migration 20261021100000_finance.sql missing).
// For the page: open bills and what changed in the last 400 days (the CSV export loads its own, complete list).
export async function loadFinance() {
  if (DEMO) return demo.load();
  const [costs, bills] = await Promise.all([
    sb().from("fin_costs").select("*").order("name"),
    sb().from("fin_bills").select("*").or(`status.eq.open,updated_at.gte.${new Date(Date.now() - 400 * 864e5).toISOString()}`).order("due_date", { ascending: true, nullsFirst: false }).limit(500),
  ]);
  if (costs.error && /does not exist|could not find/i.test(costs.error.message)) return null;
  return { costs: must(costs, "costs"), bills: must(bills, "bills") };
}

export async function saveCost(row) {
  if (DEMO) return demo.saveCost(row);
  const r = pick(row, COST_FIELDS);
  return row.id
    ? must(await sb().from("fin_costs").update(r).eq("id", row.id).select().single(), "cost")
    : must(await sb().from("fin_costs").insert(r).select().single(), "cost");
}
export async function deleteCost(id) {
  if (DEMO) return demo.deleteCost(id);
  must(await sb().from("fin_costs").delete().eq("id", id), "cost");
}

// CSV for the Treuhänder: EVERY bill of the period (see bookingDay in calc.js), paged – not just what the page shows.
// The database filter is a little wider (UTC vs. Swiss day); the exact cut is made here.
const PAGE = 1000;
export async function exportBills(period) {
  if (DEMO) return demo.exportBills(period);
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb().from("fin_bills").select("*");
    if (period.from) {
      const lo = new Date(Date.parse(`${period.from}T00:00:00Z`) - 864e5).toISOString();
      const hi = new Date(Date.parse(`${period.to}T00:00:00Z`) + 2 * 864e5).toISOString();
      q = q.or(`and(paid_at.gte.${lo},paid_at.lt.${hi}),and(due_date.gte.${period.from},due_date.lte.${period.to}),and(due_date.is.null,created_at.gte.${lo},created_at.lt.${hi})`);
    }
    const rows = must(await q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1), "export");
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.filter((b) => inPeriod(b, period));
}

export async function saveBill(row) {
  if (DEMO) return demo.saveBill(row);
  const r = pick(row, BILL_FIELDS);
  return row.id
    ? must(await sb().from("fin_bills").update(r).eq("id", row.id).select().single(), "bill")
    : must(await sb().from("fin_bills").insert(r).select().single(), "bill");
}
export const setBillStatus = (id, status) => saveBill({ id, status });
export async function deleteBill(bill) {
  if (DEMO) return demo.deleteBill(bill.id);
  must(await sb().from("fin_bills").delete().eq("id", bill.id), "bill");
  if (bill.file_path) await sb().storage.from(BUCKET).remove([bill.file_path]).catch(() => {});
}

const EXT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp" };
// only the types the bucket accepts (calc.js BILL_FILE_TYPES); called after the bill is saved
export async function uploadBillFile(file) {
  const type = billFileType(file);
  if (!type) throw new Error("Nur PDF, JPG, PNG, HEIC oder WebP.");
  const path = `bills/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${EXT[type]}`;
  if (DEMO) return demo.upload(path, file);
  must(await sb().storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false }), "upload");
  return path;
}
// throws when it fails – callers that only tidy up ignore that (a leftover file is private and harmless)
export async function removeBillFile(path) {
  if (!path) return;
  if (DEMO) return demo.remove(path);
  const r = await sb().storage.from(BUCKET).remove([path]);
  if (r.error) throw Object.assign(new Error(r.error.message), { what: "file" });
}
// private bucket: a link that works for 5 minutes
export async function fileUrl(path) {
  if (DEMO) return demo.url(path);
  return must(await sb().storage.from(BUCKET).createSignedUrl(path, 300), "file").signedUrl;
}

export function subscribe(onChange) {
  if (DEMO) return demo.subscribe(onChange);
  const ch = sb().channel("finance")
    .on("postgres_changes", { event: "*", schema: "public", table: "fin_bills" }, onChange)
    .subscribe();
  return () => sb().removeChannel(ch);
}
