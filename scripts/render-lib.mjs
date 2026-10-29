// Render queue of the gaming PC → cockpit (migration 20261029100000_render_jobs.sql). Pure helpers, tested in
// tests/render-queue.test.mjs; reading the files and the upload are in render-sync.mjs.
// Sources in C:\QNH\render: queue\*.ps1 (waiting, run in name order), queue\pausiert\*.ps1 (paused by the render
// helper), queue\done\*.ps1 (finished), gpu_queue.log («dd.MM HH:mm start|end <job>» lines with the job output in
// between, Swiss time, no year) and status.json (the render helper's view of the running job: pictures, last picture).

const ZURICH = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Zurich", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });

// minutes Zurich is ahead of UTC at instant t
function zurichOffset(t) {
  const p = Object.fromEntries(ZURICH.formatToParts(new Date(t)).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000) / 60000;
}

// Swiss wall-clock time → Date (summer and winter time)
export function zurichTime(y, mo, d, h = 0, mi = 0, s = 0) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = wall - zurichOffset(wall) * 60000;
  t = wall - zurichOffset(t) * 60000;
  return new Date(t);
}

// «2026-10-29 06:49:09» (render helper, Swiss time) → ISO string or null
export function parseLocalStamp(s) {
  const m = String(s ?? "").match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?$/);
  return m ? zurichTime(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)).toISOString() : null;
}

// gpu_queue.log is written by Windows PowerShell 5.1 (Out-File): UTF-16 LE, usually with BOM
export function decodeLog(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  let zeros = 0;
  for (let i = 1; i < Math.min(buf.length, 400); i += 2) if (buf[i] === 0) zeros++;
  return zeros > 50 ? buf.toString("utf16le") : buf.toString("utf8");
}

const EVENT = /^(\d\d)\.(\d\d) (\d\d):(\d\d) (start|end) ([A-Za-z0-9._-]{1,80}\.ps1)\s*$/;

// «28.10 21:30» has no year: the latest date not more than 2 days in the future
function eventTime(dd, mm, hh, mi, now) {
  const y = new Date(now).getUTCFullYear();
  let t = zurichTime(y, mm, dd, hh, mi);
  if (t.getTime() > now + 2 * 864e5) t = zurichTime(y - 1, mm, dd, hh, mi);
  return t.toISOString();
}

// the outcome of a job: its last «… DONE» / «… FAILED» line; failed also on a Python error or missing pictures
export function outcome(lines) {
  const res = [...lines].reverse().find((l) => /\b(DONE|FAILED)\b/.test(l));
  const failed = res ? /FAILED/.test(res) : lines.some((l) => /Traceback|frames missing|BLENDER FAILED/.test(l));
  return { result: res ? res.trim().slice(0, 300) : null, failed };
}

// → runs in log order: { name, started_at, finished_at, result, failed }; a start without end = still running
export function parseLog(text, now = Date.now()) {
  const runs = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\u0000/g, "");
    const m = line.match(EVENT);
    if (!m) { if (cur) cur.out.push(line); continue; }
    const [, dd, mm, hh, mi, kind, name] = m;
    const at = eventTime(+dd, +mm, +hh, +mi, now);
    if (kind === "start") {
      // the queue was stopped in the middle of a job (window closed, PC restarted): no end line ever comes
      if (cur) Object.assign(cur, { finished_at: at }, outcome(cur.out), { failed: true, result: "abgebrochen (Warteschlange war gestoppt)" });
      cur = { name, started_at: at, finished_at: null, out: [] };
      runs.push(cur);
    } else if (cur && cur.name === name) {
      Object.assign(cur, { finished_at: at }, outcome(cur.out));
      cur = null;
    }
  }
  return runs.map(({ out, ...r }) => ({ result: null, failed: false, ...r }));
}

// the job's own description: its first comment line up to the first «:» outside «…» and (…)
export function jobTitle(text) {
  const first = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => /^#\s*\S/.test(l));
  if (!first) return null;
  const s = first.replace(/^#\s*/, "").trim();
  let depth = 0, cut = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "«" || c === "(") depth++;
    else if ((c === "»" || c === ")") && depth > 0) depth--;
    else if (c === ":" && depth === 0 && (s[i + 1] === " " || i === s.length - 1)) { cut = i; break; }
  }
  const t = s.slice(0, cut).trim();
  return t.length > 160 ? `${t.slice(0, 159).trimEnd()}…` : t;
}

const DAY = 864e5;

// everything the cockpit shows, one row per job name (table render_jobs). Waiting, paused and running jobs win over
// an earlier finished run of the same name; finished runs are kept for 7 days.
export function buildRows({ queued = [], paused = [], titles = {}, runs = [], status = null, now = Date.now(), machine = "gaming" }) {
  const seen = new Date(now).toISOString();
  const rows = new Map();
  const base = (name) => ({ name, machine, title: titles[name] ?? null, position: null, started_at: null, finished_at: null, result: null,
    frames: null, frames_10min: null, last_frame_at: null, seen_at: seen });
  for (const r of runs) {
    if (!r.finished_at || now - Date.parse(r.finished_at) > 7 * DAY) continue;
    rows.set(r.name, { ...base(r.name), status: r.failed ? "failed" : "done", started_at: r.started_at, finished_at: r.finished_at, result: r.result });
  }
  // the helper sees whether the queue process lives; a stopped queue leaves its last job in the folder without an end line
  const last = runs[runs.length - 1];
  const alive = status?.warteschlange_laeuft !== false;
  const running = alive && last && !last.finished_at && queued.includes(last.name) ? last : null;
  if (running) {
    const st = status && status.auftrag === running.name ? status : null;
    rows.set(running.name, { ...base(running.name), status: "running", started_at: running.started_at,
      frames: Number.isFinite(st?.bilder_im_ordner) ? st.bilder_im_ordner : null,
      frames_10min: Number.isFinite(st?.bilder_letzte_10_min) ? st.bilder_letzte_10_min : null,
      last_frame_at: parseLocalStamp(st?.letztes_bild) });
  }
  queued.filter((n) => n !== running?.name).forEach((name, i) => rows.set(name, { ...base(name), status: "queued", position: i }));
  paused.forEach((name, i) => rows.set(name, { ...base(name), status: "paused", position: i }));
  return [...rows.values()];
}
