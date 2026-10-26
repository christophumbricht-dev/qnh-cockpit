#!/usr/bin/env node
// Finanzen from the command line – signs in as Christoph's admin account (same rules as the cockpit, session from
// `npm run roadmap -- login`).
//
//   npm run finanzen -- import "C:\…\ausgaben.json" [--dry]   receipts (with their PDF) into Finanzen; safe to run again
//   npm run finanzen -- offen                                   what the company still owes Christoph
//
// The receipts and ausgaben.json stay in the local Ablage – never in this public repository.
// Format and rules: scripts/finanzen-lib.mjs, docs/finanzen.md.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { args, fail, signedIn } from "./qnh-session.mjs";
import { money, moneyList, owedPrivately, sumBy } from "../src/finance/calc.js";
import { ImportError, fileType, planImport } from "./finanzen-lib.mjs";

const BUCKET = "finance";
const EXT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp" };
const chDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("de-CH");

function dbError(error) {
  const m = error?.message ?? String(error);
  if (/paid_by|reimbursed_at|paid_with|column .* does not exist/i.test(m)) return "Zuerst die Migration supabase/migrations/20261021120000_finance_private.sql im Supabase SQL-Editor ausführen.";
  if (/fin_bills|fin_costs/.test(m) && /does not exist|could not find/i.test(m)) return "Zuerst die Migration supabase/migrations/20261021100000_finance.sql im Supabase SQL-Editor ausführen.";
  return m;
}

async function importFile(sb, file, opt) {
  if (!file) fail('Welche Datei? npm run finanzen -- import "C:\\…\\ausgaben.json"');
  if (!existsSync(file)) fail(`Datei nicht gefunden: ${file}`);
  const dir = dirname(resolve(file));
  let json;
  try { json = JSON.parse(readFileSync(file, "utf8")); } catch (err) { fail(`${file} ist kein gültiges JSON (${err.message}).`); }

  const [bills, costs, probe] = await Promise.all([
    sb.from("fin_bills").select("id, payee, invoice_no, due_date, amount, currency"),
    sb.from("fin_costs").select("id, name"),
    sb.from("fin_bills").select("paid_by").limit(1),
  ]);
  for (const r of [bills, costs, probe]) if (r.error) fail(dbError(r.error));

  let plan;
  try { plan = planImport(json.expenses, { bills: bills.data, costs: costs.data }); } catch (err) {
    if (err instanceof ImportError) fail(err.message);
    throw err;
  }
  // every receipt file must be there (and inside the folder of ausgaben.json) before anything is written
  for (const p of plan.bills) {
    if (!p.file) continue;
    const abs = resolve(dir, p.file);
    if (!abs.startsWith(dir + sep)) fail(`${p.file}: liegt nicht im Ordner von ${file}.`);
    if (!existsSync(abs)) fail(`Beleg fehlt: ${p.file}`);
    Object.assign(p, { abs, type: fileType(p.file) });
  }

  console.log(`${plan.bills.length} neue Belege, ${plan.costs.length} neue Abos, ${plan.skipped.length} übersprungen.`);
  for (const s of plan.skipped) console.log(`  · übersprungen: ${s.label} (${s.why})`);
  if (opt.dry) {
    for (const c of plan.costs) console.log(`  + Abo ${c.name} · ${money(c.amount, c.currency)} · ${c.interval}${c.next_due ? ` · nächste ${chDate(c.next_due)}` : ""}`);
    for (const p of plan.bills) console.log(`  + ${chDate(p.row.due_date)} ${p.row.payee} · ${money(p.row.amount, p.row.currency)}${p.file ? "" : " (ohne Datei)"}`);
    console.log("Probelauf – nichts gespeichert.");
    return;
  }

  for (const c of plan.costs) {
    const { data, error } = await sb.from("fin_costs").insert(c).select("id").single();
    if (error) fail(`Abo ${c.name}: ${dbError(error)}`);
    c.id = data.id;
    console.log(`  + Abo ${c.name} · ${money(c.amount, c.currency)}${c.next_due ? ` · nächste ${chDate(c.next_due)}` : ""}`);
  }
  for (const p of plan.bills) {
    let path = null;
    if (p.abs) {
      path = `bills/${p.row.due_date.slice(0, 7)}/${randomUUID()}.${EXT[p.type]}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, readFileSync(p.abs), { contentType: p.type, upsert: false });
      if (error) fail(`${p.file}: Hochladen ging nicht (${error.message}). Nochmals starten – Gespeichertes wird übersprungen.`);
    }
    const { error } = await sb.from("fin_bills").insert({ ...p.row, file_path: path, cost_id: p.cost?.id ?? null });
    if (error) {
      if (path) await sb.storage.from(BUCKET).remove([path]); // not linked: take it back
      fail(`${p.row.payee} ${p.row.invoice_no}: ${dbError(error)}`);
    }
    console.log(`  + ${chDate(p.row.due_date)} ${p.row.payee} · ${money(p.row.amount, p.row.currency)}`);
  }
  console.log("✓ Import fertig – im Cockpit unter Finanzen.");
  await owed(sb);
}

async function owed(sb) {
  const { data, error } = await sb.from("fin_bills").select("payee, amount, currency, due_date, status, paid_by, reimbursed_at").eq("paid_by", "privat").is("reimbursed_at", null);
  if (error) fail(dbError(error));
  const open = data.filter(owedPrivately);
  console.log(open.length ? `Offen an Christoph: ${moneyList(sumBy(open))} (${open.length} Belege)` : "Offen an Christoph: nichts.");
}

const cmd = process.argv[2];
const opt = args(process.argv.slice(3), ["dry"]);
if (cmd === "import") await importFile(await signedIn(), opt._[0], opt);
else if (cmd === "offen") await owed(await signedIn());
else fail('Befehle: import "<ausgaben.json>" [--dry] · offen');
