// Render queue of the gaming PC → cockpit page «An Claude» (migration 20261029100000_render_jobs.sql).
//   node scripts/render-sync.mjs [--dry] [--root C:\QNH\render] [--machine gaming]
// Reads the GPU queue in C:\QNH\render (job files, gpu_queue.log, status.json of the render helper) and writes table
// render_jobs. Started by the render helper (C:\QNH\render\helper.ps1) when something changed, at most every few
// minutes; signs in like the social import (.qnh-session.json of this computer). Logic in render-lib.mjs.
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { args, ROOT, signedIn } from "./qnh-session.mjs";
import { buildRows, decodeLog, jobTitle, parseLog } from "./render-lib.mjs";

const a = args(process.argv.slice(2), ["dry"]);
const R = a.root ?? join(ROOT, "..", "..", "render");
const Q = join(R, "queue");
const machine = /^[a-z0-9-]{2,24}$/.test(a.machine ?? "") ? a.machine : "gaming";

const jobs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^[A-Za-z0-9._-]{1,80}\.ps1$/.test(f)).sort() : []);

function head(file, n = 4096) {
  try { const fd = openSync(file, "r"); const b = Buffer.alloc(n); const k = readSync(fd, b, 0, n, 0); closeSync(fd); return b.subarray(0, k).toString("utf8"); } catch { return ""; }
}

// the last MB of the log (UTF-16: start on an even byte)
function logTail(file, max = 1 << 20) {
  if (!existsSync(file)) return "";
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = size > max ? (size - max) & ~1 : 0;
    const b = Buffer.alloc(size - start);
    readSync(fd, b, 0, b.length, start);
    if (start === 0) return decodeLog(b);
    let zeros = 0;
    for (let i = 1; i < Math.min(b.length, 400); i += 2) if (b[i] === 0) zeros++;
    return zeros > 50 ? b.toString("utf16le") : b.toString("utf8");
  } finally { closeSync(fd); }
}

function status() {
  try { return JSON.parse(readFileSync(join(R, "status.json"), "utf8").replace(/^\uFEFF/, "")); } catch { return null; }
}

const queued = jobs(Q), paused = jobs(join(Q, "pausiert")), done = jobs(join(Q, "done"));
const titles = {};
for (const [dir, list] of [[Q, queued], [join(Q, "pausiert"), paused], [join(Q, "done"), done]]) {
  for (const f of list) titles[f] ??= jobTitle(head(join(dir, f)));
}
const now = Date.now();
const rows = buildRows({ queued, paused, titles, runs: parseLog(logTail(join(R, "gpu_queue.log")), now), status: status(), now, machine });

if (a.dry) {
  for (const r of rows) console.log(`${r.status.padEnd(8)} ${r.name}  ${r.title ?? ""}${r.result ? `  → ${r.result}` : ""}`);
  process.exit(0);
}

const sb = await signedIn();
const up = await sb.from("render_jobs").upsert(rows, { onConflict: "name" });
if (up.error) {
  if (/does not exist|could not find/i.test(up.error.message)) { console.log("Tabelle render_jobs fehlt noch: Migration 20261029100000_render_jobs.sql einspielen."); process.exit(0); }
  console.error(`Hochladen fehlgeschlagen: ${up.error.message}`);
  process.exit(1);
}
// jobs that wait or run no more (file removed or renamed) go away; finished ones stay
const { data: open, error } = await sb.from("render_jobs").select("name").eq("machine", machine).in("status", ["queued", "paused", "running"]);
if (error) { console.error(error.message); process.exit(1); }
const keep = new Set(rows.filter((r) => r.status !== "done" && r.status !== "failed").map((r) => r.name));
const gone = (open ?? []).map((r) => r.name).filter((n) => !keep.has(n));
if (gone.length) await sb.from("render_jobs").delete().in("name", gone).in("status", ["queued", "paused", "running"]);
console.log(`Warteschlange: ${rows.filter((r) => r.status === "running").length} läuft, ${rows.filter((r) => r.status === "queued").length} warten, ${rows.filter((r) => r.status === "done" || r.status === "failed").length} fertig (7 Tage).`);
