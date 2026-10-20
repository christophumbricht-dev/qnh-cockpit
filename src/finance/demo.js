// ?demo: invented costs and bills, kept in memory (not Christoph's real numbers).
import { addDays, inPeriod, zurichToday } from "./calc.js";

const today = zurichToday();
const listeners = new Set();
const emit = () => setTimeout(() => listeners.forEach((f) => f()), 0);
const wait = (v, ms = 120) => new Promise((r) => setTimeout(() => r(structuredClone(v)), ms));
const files = new Map();
let n = 100;
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
const lastYear = Number(today.slice(0, 4)) - 1;

const costs = [
  { id: "c1", name: "Apple Developer Program", provider: "Apple", scope: "qnh", category: "Entwicklung", amount: 99, currency: "USD", interval: "yearly", next_due: addDays(today, 24), notice_days: 30, payment: "Kreditkarte", url: "https://developer.apple.com/account", note: "Organisation QNH GmbH", active: true },
  { id: "c2", name: "Supabase Pro", provider: "Supabase", scope: "downwind", category: "Server", amount: 25, currency: "USD", interval: "monthly", next_due: addDays(today, -12), notice_days: 0, payment: "Kreditkarte", url: "https://supabase.com/dashboard/org/_/billing", note: "", active: true },
  { id: "c3", name: "kSuite & kDrive", provider: "Infomaniak", scope: "qnh", category: "Büro", amount: 59.4, currency: "CHF", interval: "yearly", next_due: addDays(today, 140), notice_days: 30, payment: "Rechnung", url: "https://manager.infomaniak.com", note: "", active: true },
  { id: "c4", name: "Domain setqnh.ch", provider: "Infomaniak", scope: "qnh", category: "Web", amount: 15, currency: "CHF", interval: "yearly", next_due: addDays(today, 61), notice_days: 14, payment: "Rechnung", url: null, note: "", active: true },
  { id: "c5", name: "Codemagic", provider: "Codemagic", scope: "downwind", category: "Entwicklung", amount: 0, currency: "USD", interval: "monthly", next_due: addDays(today, 3), notice_days: 0, payment: "–", url: "https://codemagic.io/billing", note: "Gratis-Kontingent", active: true },
  { id: "c6", name: "Geschäftshandy-Abo", provider: "Mobilfunk", scope: "qnh", category: "Telefon", amount: 35, currency: "CHF", interval: "monthly", next_due: addDays(today, 9), notice_days: 0, payment: "LSV", url: null, note: "", active: true },
  { id: "c7", name: "Betriebshaftpflicht", provider: "Versicherung Muster", scope: "qnh", category: "Versicherung", amount: 380, currency: "CHF", interval: "yearly", next_due: addDays(today, 64), notice_days: 60, payment: "Rechnung", url: null, note: "Kündigungsfrist 2 Monate", active: true },
];
const bills = [
  { id: "b1", payee: "Notariat Muster", amount: 850, currency: "CHF", due_date: addDays(today, -2), status: "open", iban: "CH4431999123000889012", reference: "210000000003139471430009017", message: "Gründung QNH GmbH", invoice_no: "2026-117", scope: "qnh", category: "Gründung", cost_id: null, file_path: null, note: "", source: "qr", paid_at: null, created_at: ago(28) },
  { id: "b2", payee: "Infomaniak Network SA", amount: 59.4, currency: "CHF", due_date: addDays(today, 1), status: "open", iban: "CH9300762011623852957", reference: "RF18539007547034", message: "", invoice_no: "INV-58123", scope: "qnh", category: "Büro", cost_id: "c3", file_path: null, note: "", source: "qr", paid_at: null, created_at: ago(20) },
  { id: "b3", payee: "Druckerei Alpenblick", amount: 312.8, currency: "CHF", due_date: addDays(today, 6), status: "open", iban: "CH9300762011623852957", reference: "", message: "Patches und Kleber Downwind", invoice_no: "R-2041", scope: "downwind", category: "Merchandise", cost_id: null, file_path: null, note: "Offerte 2 von 3", source: "cockpit", paid_at: null, created_at: ago(9) },
  { id: "b4", payee: "Handelsregisteramt", amount: 600, currency: "CHF", due_date: addDays(today, -20), status: "paid", iban: null, reference: "", message: "Eintrag GmbH", invoice_no: "", scope: "qnh", category: "Gründung", cost_id: null, file_path: null, note: "", source: "cockpit", paid_at: ago(18), created_at: ago(40) },
  // no due date: «Fälligkeit geschätzt» (30 days after it was entered)
  { id: "b5", payee: "Grafikbüro Leeside", amount: 240, currency: "CHF", due_date: null, status: "open", iban: "CH9300762011623852957", reference: "", message: "Logo-Überarbeitung", invoice_no: "", scope: "leesidelab", category: "Werbung", cost_id: null, file_path: null, note: "", source: "cockpit", paid_at: null, created_at: ago(25) },
  // paid privately by Christoph – the company pays it back (invented)
  { id: "b8", payee: "Beispiel KI Ltd", amount: 21.62, currency: "USD", due_date: addDays(today, -15), status: "paid", net: 20, vat: 1.62, paid_by: "privat", paid_with: "Kreditkarte", reimbursed_at: null, iban: null, reference: "", message: "Zusatzguthaben", invoice_no: "D-201", scope: "downwind", category: "KI-Werkzeuge", cost_id: null, file_path: null, note: "", source: "claude", paid_at: `${addDays(today, -15)}T10:00:00Z` },
  { id: "b9", payee: "Domain-Shop Beispiel", amount: 18.5, currency: "CHF", due_date: addDays(today, -12), status: "paid", net: 17.12, vat: 1.38, paid_by: "privat", paid_with: "Twint", reimbursed_at: null, iban: null, reference: "", message: "Domain beispiel.ch (1 Jahr)", invoice_no: "D-202", scope: "qnh", category: "Domains & Hosting", cost_id: null, file_path: null, note: "", source: "claude", paid_at: `${addDays(today, -12)}T10:00:00Z` },
  // last year (only in the CSV export, not on the page)
  { id: "b6", payee: "Treuhand Muster AG", amount: 420, currency: "CHF", due_date: `${lastYear}-12-20`, status: "paid", iban: "CH9300762011623852957", reference: "", message: "Beratung Gründung", invoice_no: "T-88", scope: "qnh", category: "Treuhand", cost_id: null, file_path: null, note: "", source: "cockpit", paid_at: `${lastYear}-12-18T09:00:00Z`, created_at: `${lastYear}-11-30T09:00:00Z`, archived: true },
];

export const load = () => wait({ costs, bills: bills.filter((b) => !b.archived), privateOk: true });
export async function setReimbursed(ids, at) { for (const b of bills) if (ids.includes(b.id)) b.reimbursed_at = at; emit(); }
export const exportBills = (period) => wait(bills.filter((b) => inPeriod(b, period)), 300);
export async function saveCost(row) {
  let c = costs.find((x) => x.id === row.id);
  if (c) Object.assign(c, row); else costs.push((c = { id: `c${++n}`, active: true, notice_days: 0, ...row }));
  emit();
  return wait(c);
}
export async function deleteCost(id) { costs.splice(costs.findIndex((x) => x.id === id), 1); emit(); }
export async function saveBill(row) {
  let b = bills.find((x) => x.id === row.id);
  if (b) Object.assign(b, row); else bills.push((b = { id: `b${++n}`, status: "open", currency: "CHF", created_at: new Date().toISOString(), ...row }));
  b.paid_at = b.status === "paid" ? b.paid_at ?? new Date().toISOString() : null;
  emit();
  return wait(b);
}
export async function deleteBill(id) { bills.splice(bills.findIndex((x) => x.id === id), 1); emit(); }
export async function upload(path, file) { await wait(null, 200); files.set(path, URL.createObjectURL(file)); return path; }
export async function remove(path) { const u = files.get(path); if (u) URL.revokeObjectURL(u); files.delete(path); }
export const url = async (path) => files.get(path) ?? "icon.svg";
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
