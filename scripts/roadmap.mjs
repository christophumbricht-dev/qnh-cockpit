#!/usr/bin/env node
// Roadmap bridge between the cockpit (QNH Core) and Claude Code sessions on this PC.
//
//   npm run roadmap -- login                 once: e-mail → paste the sign-in link from the e-mail
//   npm run roadmap -- pull                  writes roadmap-local/ROADMAP.md (+ .json), shows what changed
//   npm run roadmap -- add --scope downwind --status next --title "…" [--body "…"] [--due 2026-12-15]
//   npm run roadmap -- set <id> [--status done] [--title "…"] [--body "…"] [--due …] [--scope …]
//
// Signs in as Christoph's admin account (same rules as the cockpit – nothing more). The session
// (refresh token) is kept in .qnh-session.json and the mirror in roadmap-local/ – both gitignored,
// because the repository is public and the roadmap is internal.

import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION = join(ROOT, ".qnh-session.json");
const OUT = join(ROOT, "roadmap-local");
const STATUS = { idea: "Ideen", next: "Als Nächstes", doing: "In Arbeit", done: "Erledigt" };
const SCOPES = { qnh: "QNH", downwind: "Downwind", secondseat: "SecondSeat" };

function env() {
  const file = join(ROOT, ".env");
  const vars = existsSync(file)
    ? Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]))
    : {};
  const url = process.env.VITE_QNH_SUPABASE_URL ?? vars.VITE_QNH_SUPABASE_URL;
  const key = process.env.VITE_QNH_SUPABASE_ANON_KEY ?? vars.VITE_QNH_SUPABASE_ANON_KEY;
  if (!url || !key) fail("VITE_QNH_SUPABASE_URL / VITE_QNH_SUPABASE_ANON_KEY fehlen in .env");
  return { url, key };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function args(list) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith("--")) out[list[i].slice(2)] = list[++i];
    else out._.push(list[i]);
  }
  return out;
}

const supabase = () => {
  const { url, key } = env();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

async function signedIn() {
  if (!existsSync(SESSION)) fail("Noch nicht angemeldet: npm run roadmap -- login");
  const saved = JSON.parse(readFileSync(SESSION, "utf8"));
  const sb = supabase();
  const { data, error } = await sb.auth.refreshSession({ refresh_token: saved.refresh_token });
  if (error || !data.session) fail(`Anmeldung abgelaufen (${error?.message ?? "keine Sitzung"}): npm run roadmap -- login`);
  // refresh tokens rotate – keep the new one
  writeFileSync(SESSION, JSON.stringify({ ...saved, refresh_token: data.session.refresh_token, email: data.session.user.email }, null, 2));
  return sb;
}

async function login(email) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  email ||= (await rl.question("E-Mail deines Cockpit-Kontos: ")).trim();
  const sb = supabase();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: "https://cockpit.setqnh.ch" } });
  if (error) fail(error.message);
  console.log(`\nE-Mail an ${email} gesendet.`);
  console.log("Den Link in der E-Mail NICHT anklicken, sondern: Rechtsklick → «Link-Adresse kopieren» und hier einfügen.");
  console.log("(Steht ein 6-stelliger Code in der E-Mail, kannst du auch den eingeben.)\n");
  const answer = (await rl.question("Link oder Code: ")).trim();
  rl.close();
  let result;
  if (/^\d{6}$/.test(answer)) {
    result = await sb.auth.verifyOtp({ email, token: answer, type: "email" });
  } else {
    let u;
    try { u = new URL(answer); } catch { fail("Das ist weder ein Link noch ein Code."); }
    // Outlook "Safe Links" (and similar) wrap the real link in ?url=…
    for (let i = 0; i < 3 && !u.searchParams.has("token") && u.searchParams.has("url"); i++) {
      try { u = new URL(u.searchParams.get("url")); } catch { break; }
    }
    const token = u.searchParams.get("token") ?? u.searchParams.get("token_hash");
    if (!token) fail("Im Link fehlt der Token – bitte die Link-Adresse aus der E-Mail kopieren.");
    result = await sb.auth.verifyOtp({ token_hash: token, type: u.searchParams.get("type") === "signup" ? "signup" : "magiclink" });
  }
  if (result.error || !result.data.session) fail(`Anmeldung fehlgeschlagen: ${result.error?.message ?? "keine Sitzung"} (Link schon benutzt oder abgelaufen? Nochmals login.)`);
  writeFileSync(SESSION, JSON.stringify({ refresh_token: result.data.session.refresh_token, email: result.data.session.user.email }, null, 2));
  const { data: admin } = await sb.rpc("is_qnh_admin");
  console.log(`✓ Angemeldet als ${result.data.session.user.email}${admin ? " (Admin)" : " – ACHTUNG: kein QNH-Admin, die Roadmap bleibt leer"}`);
}

async function pull() {
  const sb = await signedIn();
  const { data, error } = await sb.from("roadmap_items").select("*").order("scope").order("status").order("sort").order("created_at");
  if (error) fail(error.message);
  mkdirSync(OUT, { recursive: true });
  const jsonFile = join(OUT, "roadmap.json");
  const before = existsSync(jsonFile) ? JSON.parse(readFileSync(jsonFile, "utf8")) : { items: [], pulled_at: null };
  const prev = new Map(before.items.map((i) => [i.id, i]));
  const changed = data.filter((i) => !prev.has(i.id) || prev.get(i.id).updated_at !== i.updated_at);
  const removed = before.items.filter((i) => !data.some((d) => d.id === i.id));
  writeFileSync(jsonFile, JSON.stringify({ pulled_at: new Date().toISOString(), items: data }, null, 2));

  const lines = [`# Roadmap (Stand ${new Date().toLocaleString("de-CH", { timeZone: "Europe/Zurich" })})`, "",
    "> Lokale Kopie aus dem Cockpit (QNH Core). Nicht von Hand bearbeiten – ändern im Cockpit oder mit `npm run roadmap -- add/set`.", ""];
  for (const scope of [...new Set(data.map((i) => i.scope))]) {
    lines.push(`## ${SCOPES[scope] ?? scope}`, "");
    for (const st of Object.keys(STATUS)) {
      const list = data.filter((i) => i.scope === scope && i.status === st);
      if (!list.length) continue;
      lines.push(`### ${STATUS[st]}`, "");
      for (const i of list) {
        lines.push(`- **${i.title}**${i.due ? ` (bis ${i.due})` : ""} · ${i.source === "claude" ? "von Claude" : "von Christoph"} · \`${i.id}\``);
        if (i.body) lines.push(...i.body.split("\n").map((l) => `  ${l}`));
      }
      lines.push("");
    }
  }
  writeFileSync(join(OUT, "ROADMAP.md"), lines.join("\n"));

  console.log(`✓ ${data.length} Einträge → roadmap-local/ROADMAP.md`);
  if (before.pulled_at) {
    for (const i of changed) console.log(`  ${prev.has(i.id) ? "geändert" : "neu"}: [${SCOPES[i.scope] ?? i.scope} · ${STATUS[i.status]}] ${i.title} (${i.source === "claude" ? "Claude" : "Christoph"})`);
    for (const i of removed) console.log(`  gelöscht: ${i.title}`);
    if (!changed.length && !removed.length) console.log("  keine Änderungen seit dem letzten Abholen");
  }
}

function itemFields(a) {
  const row = {};
  for (const k of ["scope", "status", "title", "body", "due"]) if (a[k] !== undefined) row[k] = a[k] === "" ? null : a[k];
  if (row.status && !STATUS[row.status]) fail(`--status muss einer von ${Object.keys(STATUS).join(", ")} sein`);
  if (row.body === null) row.body = "";
  return row;
}

async function add(a) {
  if (!a.title) fail('--title "…" fehlt');
  const sb = await signedIn();
  const { data, error } = await sb.from("roadmap_items").insert({ scope: "qnh", status: "idea", ...itemFields(a), source: "claude" }).select().single();
  if (error) fail(error.message);
  console.log(`✓ hinzugefügt: [${data.scope} · ${STATUS[data.status]}] ${data.title} \`${data.id}\``);
}

async function set(id, a) {
  if (!id) fail("ID fehlt: npm run roadmap -- set <id> --status done");
  const sb = await signedIn();
  const { data, error } = await sb.from("roadmap_items").update(itemFields(a)).eq("id", id).select().single();
  if (error) fail(error.message);
  console.log(`✓ aktualisiert: [${data.scope} · ${STATUS[data.status]}] ${data.title}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const a = args(rest);
if (cmd === "login") await login(a._[0] ?? a.email);
else if (cmd === "pull") await pull();
else if (cmd === "add") await add(a);
else if (cmd === "set") await set(a._[0], a);
else console.log("Befehle: login | pull | add --scope … --status … --title … | set <id> --status …");
