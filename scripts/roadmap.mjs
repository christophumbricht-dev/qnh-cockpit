#!/usr/bin/env node
// Roadmap bridge between the cockpit (QNH Core) and Claude Code sessions on this PC.
//
//   npm run roadmap -- login                 once: e-mail → paste the sign-in link from the e-mail
//   npm run roadmap -- pull                  writes roadmap-local/ROADMAP.md (+ .json), shows what changed
//   npm run roadmap -- add --scope downwind --status next --title "…" [--body "…"] [--due 2026-12-15] [--repeat monthly]
//   npm run roadmap -- set <id> [--status done] [--title "…"] [--body "…"] [--due …] [--scope …] [--repeat …|none]
//   npm run roadmap -- set <id> --status done --final    a recurring task: close it for good (else it rolls forward)
//
// Recurring tasks (--repeat weekly|monthly|quarterly|yearly) behave as in the cockpit: «done» moves the due date
// to the next time (same rule: recurringDone in src/finance/calc.js) and the task stays open.
//
// Signs in as Christoph's admin account (same rules as the cockpit – nothing more). The session
// (refresh token) is kept in .qnh-session.json and the mirror in roadmap-local/ – both gitignored,
// because the repository is public and the roadmap is internal.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { ROOT, args, fail, saveSession, signedIn, supabase } from "./qnh-session.mjs";
import { zurichToday } from "../src/finance/calc.js";
import { CliError, REPEAT, STATUS, itemFields, setPatch } from "./roadmap-lib.mjs";

const OUT = join(ROOT, "roadmap-local");
const SCOPES = { qnh: "QNH", downwind: "Downwind", secondseat: "SecondSeat" };
const chDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("de-CH");

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
  saveSession(result.data.session);
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
        lines.push(`- **${i.title}**${i.due ? ` (bis ${i.due})` : ""}${i.repeat ? ` ↻ ${REPEAT[i.repeat] ?? i.repeat}` : ""} · ${i.source === "claude" ? "von Claude" : "von Christoph"} · \`${i.id}\``);
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
  const { data: item, error: readError } = await sb.from("roadmap_items").select("*").eq("id", id).single();
  if (readError) fail(readError.message);
  // a recurring task «done» rolls forward (as in the cockpit) – unless --final closes it for good
  const { patch, rolled } = setPatch(item, a, zurichToday());
  const { data, error } = await sb.from("roadmap_items").update(patch).eq("id", id).select().single();
  if (error) fail(error.message);
  if (rolled) {
    console.log(`↻ wiederkehrend (${REPEAT[data.repeat] ?? data.repeat}): «${data.title}» erledigt – nächstes Mal am ${chDate(data.due)}, bleibt offen [${STATUS[data.status]}].`);
    console.log(`  Endgültig abschliessen: npm run roadmap -- set ${id} --status done --final`);
  } else console.log(`✓ aktualisiert: [${data.scope} · ${STATUS[data.status]}] ${data.title}${data.repeat ? ` ↻ ${REPEAT[data.repeat]}` : ""}${a.final && item.repeat ? " (wiederkehrend beendet)" : ""}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const a = args(rest, ["final"]);
try {
  if (cmd === "login") await login(a._[0] ?? a.email);
  else if (cmd === "pull") await pull();
  else if (cmd === "add") await add(a);
  else if (cmd === "set") await set(a._[0], a);
  else console.log("Befehle: login | pull | add --scope … --status … --title … [--repeat …] | set <id> --status … [--final]");
} catch (err) {
  if (err instanceof CliError) fail(err.message);
  throw err;
}
