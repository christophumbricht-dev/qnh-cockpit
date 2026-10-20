// ?demo: invented costs and bills, kept in memory (not Christoph's real numbers).
import { addDays, zurichToday } from "./calc.js";

const today = zurichToday();
const listeners = new Set();
const emit = () => setTimeout(() => listeners.forEach((f) => f()), 0);
const wait = (v, ms = 120) => new Promise((r) => setTimeout(() => r(structuredClone(v)), ms));
const files = new Map();
let n = 100;

const costs = [
  { id: "c1", name: "Apple Developer Program", provider: "Apple", scope: "qnh", category: "Entwicklung", amount: 99, currency: "USD", interval: "yearly", next_due: addDays(today, 24), notice_days: 30, payment: "Kreditkarte", url: "https://developer.apple.com/account", note: "Organisation QNH GmbH", active: true },
  { id: "c2", name: "Supabase Pro", provider: "Supabase", scope: "downwind", category: "Server", amount: 25, currency: "USD", interval: "monthly", next_due: addDays(today, -12), notice_days: 0, payment: "Kreditkarte", url: "https://supabase.com/dashboard/org/_/billing", note: "", active: true },
  { id: "c3", name: "kSuite & kDrive", provider: "Infomaniak", scope: "qnh", category: "Büro", amount: 59.4, currency: "CHF", interval: "yearly", next_due: addDays(today, 140), notice_days: 30, payment: "Rechnung", url: "https://manager.infomaniak.com", note: "", active: true },
  { id: "c4", name: "Domain setqnh.ch", provider: "Infomaniak", scope: "qnh", category: "Web", amount: 15, currency: "CHF", interval: "yearly", next_due: addDays(today, 61), notice_days: 14, payment: "Rechnung", url: null, note: "", active: true },
  { id: "c5", name: "Codemagic", provider: "Codemagic", scope: "downwind", category: "Entwicklung", amount: 0, currency: "USD", interval: "monthly", next_due: addDays(today, 3), notice_days: 0, payment: "–", url: "https://codemagic.io/billing", note: "Gratis-Kontingent", active: true },
  { id: "c6", name: "Geschäftshandy-Abo", provider: "Mobilfunk", scope: "qnh", category: "Telefon", amount: 35, currency: "CHF", interval: "monthly", next_due: addDays(today, 9), notice_days: 0, payment: "LSV", url: null, note: "", active: true },
];
const bills = [
  { id: "b1", payee: "Notariat Muster", amount: 850, currency: "CHF", due_date: addDays(today, -2), status: "open", iban: "CH4431999123000889012", reference: "210000000003139471430009017", message: "Gründung QNH GmbH", invoice_no: "2026-117", scope: "qnh", category: "Gründung", cost_id: null, file_path: null, note: "", source: "qr", paid_at: null },
  { id: "b2", payee: "Infomaniak Network SA", amount: 59.4, currency: "CHF", due_date: addDays(today, 1), status: "open", iban: "CH9300762011623852957", reference: "RF18539007547034", message: "", invoice_no: "INV-58123", scope: "qnh", category: "Büro", cost_id: "c3", file_path: null, note: "", source: "qr", paid_at: null },
  { id: "b3", payee: "Druckerei Alpenblick", amount: 312.8, currency: "CHF", due_date: addDays(today, 6), status: "open", iban: "CH9300762011623852957", reference: "", message: "Patches und Kleber Downwind", invoice_no: "R-2041", scope: "downwind", category: "Merchandise", cost_id: null, file_path: null, note: "Offerte 2 von 3", source: "cockpit", paid_at: null },
  { id: "b4", payee: "Handelsregisteramt", amount: 600, currency: "CHF", due_date: addDays(today, -20), status: "paid", iban: null, reference: "", message: "Eintrag GmbH", invoice_no: "", scope: "qnh", category: "Gründung", cost_id: null, file_path: null, note: "", source: "cockpit", paid_at: new Date(Date.now() - 18 * 864e5).toISOString() },
];

export const load = () => wait({ costs, bills });
export async function saveCost(row) {
  let c = costs.find((x) => x.id === row.id);
  if (c) Object.assign(c, row); else costs.push((c = { id: `c${++n}`, active: true, notice_days: 0, ...row }));
  emit();
  return wait(c);
}
export async function deleteCost(id) { costs.splice(costs.findIndex((x) => x.id === id), 1); emit(); }
export async function saveBill(row) {
  let b = bills.find((x) => x.id === row.id);
  if (b) Object.assign(b, row); else bills.push((b = { id: `b${++n}`, status: "open", currency: "CHF", ...row }));
  b.paid_at = b.status === "paid" ? b.paid_at ?? new Date().toISOString() : null;
  emit();
  return wait(b);
}
export async function deleteBill(id) { bills.splice(bills.findIndex((x) => x.id === id), 1); emit(); }
export async function upload(path, file) { files.set(path, URL.createObjectURL(file)); return path; }
export const url = async (path) => files.get(path) ?? "icon.svg";
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
