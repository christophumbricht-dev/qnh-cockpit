#!/usr/bin/env node
// Claude in the background on the gaming PC (28.10.2026, Christoph: «alles vom Cockpit aus, du rechnest im Hintergrund»).
// Run by the Windows task «QNH Studio-Lauf» every 5 minutes (scripts/studio-worker-task.ps1):
//   1. once a Swiss day from 08:00 it queues the daily run (studio_jobs, trigger daily)
//   2. it claims the oldest waiting run (also the ones from the cockpit button «Claude jetzt starten»)
//   3. it starts Claude Code headless in C:\QNH with the instructions in docs/studio-worker.md and writes Claude's
//      short report back to the run; the cockpit shows it.
// Every run is a fresh Claude session: nothing depends on an open chat. One run at a time (lock file).
// Log and lock in %USERPROFILE%\.qnh-machine (not AppData, see C:\QNH\CLAUDE.md).
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { ROOT, signedIn } from "./qnh-session.mjs";
import { dailyDue, summaryOf } from "./studio-lib.mjs";

const HOME = join(homedir(), ".qnh-machine");
const LOG = join(HOME, "studio-worker.log");
const LOCK = join(HOME, "studio-worker.lock");
const QNH = join(ROOT, "..", "..");                       // C:\QNH
const PROMPT = join(ROOT, "docs", "studio-worker.md");
const MAX_MS = 150 * 60_000;                              // a run stops after 2.5 h
const MACHINE = /gaming/i.test(hostname()) ? "gaming" : hostname().toLowerCase().slice(0, 40);

mkdirSync(HOME, { recursive: true });
const log = (msg) => appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);

function takeLock() {
  if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs < MAX_MS + 10 * 60_000) return false;   // a run is going on
  writeFileSync(LOCK, String(process.pid));
  return true;
}

// the instructions: the part of docs/studio-worker.md between the two «PROMPT» lines, plus Christoph's note
function prompt(job) {
  const doc = readFileSync(PROMPT, "utf8");
  const m = doc.match(/<!-- PROMPT -->([\s\S]*?)<!-- \/PROMPT -->/);
  if (!m) throw new Error("docs/studio-worker.md: kein <!-- PROMPT --> Abschnitt");
  const extra = job.note ? `\n\nChristoph wrote for this run (his request, do this first): «${job.note}»` : "";
  return `${m[1].trim()}\n\nThis run: ${job.trigger === "daily" ? "the daily 08:00 run" : "started by Christoph with the cockpit button"}, run id ${job.id}.${extra}`;
}

function runClaude(text) {
  return new Promise((resolve) => {
    // the prompt goes in through stdin: no quoting problems with long text on Windows
    const child = spawn("claude", ["-p", "--permission-mode", "acceptEdits",
      "--allowedTools", "Bash", "Read", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch", "--max-turns", "400"],
    { cwd: QNH, shell: true, windowsHide: true, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "qnh-studio-worker" } });
    let out = "";
    const keep = (d) => { out = (out + d.toString()).slice(-60_000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => { log("timeout, stopping Claude"); child.kill(); }, MAX_MS);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: -1, out: `Claude liess sich nicht starten: ${err.message}` }); });
    child.stdin.end(text);
  });
}

async function main() {
  if (!takeLock()) return;
  try {
    const sb = await signedIn();
    // 1. the daily run
    const { data: lastDaily, error: e0 } = await sb.from("studio_jobs").select("requested_at").eq("trigger", "daily").order("requested_at", { ascending: false }).limit(1);
    if (e0) throw new Error(e0.message);
    if (dailyDue(new Date(), lastDaily?.[0]?.requested_at)) {
      const { error } = await sb.from("studio_jobs").insert({ trigger: "daily" });
      log(error ? `daily not queued: ${error.message}` : "daily run queued");
    }
    // 2. claim the oldest waiting run (only if it is still waiting: the update decides)
    const { data: waiting } = await sb.from("studio_jobs").select("*").eq("status", "queued").order("requested_at").limit(1);
    const job = waiting?.[0];
    if (!job) return;
    const { data: claimed } = await sb.from("studio_jobs").update({ status: "running", started_at: new Date().toISOString(), machine: MACHINE })
      .eq("id", job.id).eq("status", "queued").select("*");
    if (!claimed?.length) return;
    log(`run ${job.id} (${job.trigger}) started`);
    // 3. Claude
    const { code, out } = await runClaude(prompt(job));
    const ok = code === 0;
    const summary = ok ? summaryOf(out) : `Fehler (Code ${code}): ${summaryOf(out)}`;
    // the session may have rotated while Claude ran (it uses npm run studio too): sign in fresh for the report
    const sb2 = await signedIn();
    await sb2.from("studio_jobs").update({ status: ok ? "done" : "failed", finished_at: new Date().toISOString(), summary }).eq("id", job.id);
    log(`run ${job.id} ${ok ? "done" : `failed (${code})`}`);
    writeFileSync(join(HOME, "studio-worker-last.txt"), out);
  } catch (err) {
    log(`error: ${err.message}`);
  } finally {
    rmSync(LOCK, { force: true });
  }
}

main();
