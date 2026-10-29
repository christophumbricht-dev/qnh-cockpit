// «Warteschlange» on the page «An Claude» (#claude): what Claude and the gaming PC are doing now, what waits, what
// was finished in the last 24 hours. Pure, tested in tests/render-queue.test.mjs.
// Sources: render_jobs (GPU queue of the gaming PC, migration 20261029100000_render_jobs.sql, written by
// scripts/render-sync.mjs), studio_jobs (Claude im Hintergrund) and claude_inbox (instructions «An Claude»).

export const WHERE = { gpu: "Gaming-PC · Grafikkarte", run: "Claude im Hintergrund", inbox: "An Claude" };
const DAY = 864e5, MIN = 60000;
const TIME = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
const DAYTIME = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", weekday: "short", hour: "2-digit", minute: "2-digit" });
const swissDay = (t) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date(t));

// «06:12» today, «Mi 21:30» on another day
export function when(iso, now = Date.now()) {
  if (!iso) return "";
  const t = Date.parse(iso);
  return swissDay(t) === swissDay(now) ? TIME.format(t) : DAYTIME.format(t);
}

// «12 Min.», «1 Std. 20 Min.», «2 Tg.»
export function span(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.round(h / 24)} Tg.`;
  return m % 60 ? `${h} Std. ${m % 60} Min.` : `${h} Std.`;
}

const cut = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const jobName = (j) => j.title || j.name.replace(/\.ps1$/, "").replace(/^\d+[a-z]?_/, "").replace(/_/g, " ");

// the render helper syncs every 15 min while jobs wait or run (C:\QNH\render\helper.ps1); silent for longer than this =
// the render helper or the PC is down
export const STALE_MIN = 25;

export function lanes({ jobs = [], runs = [], inbox = [], now = Date.now() } = {}) {
  const running = [], planned = [], done = [];
  const recent = (iso) => iso && now - Date.parse(iso) <= DAY;

  // 1. GPU queue
  for (const j of jobs) {
    const base = { key: `gpu:${j.name}`, where: WHERE.gpu, title: jobName(j), file: j.name };
    if (j.status === "running") {
      const quiet = j.last_frame_at ? now - Date.parse(j.last_frame_at) : null;
      const bits = [`seit ${when(j.started_at, now)}`];
      if (j.frames != null) bits.push(`${j.frames} Bilder`);
      if (j.frames_10min) bits.push(`${j.frames_10min} in den letzten 10 Min.`);
      const stuck = quiet != null && quiet > 20 * MIN;
      if (stuck) bits.push(`kein neues Bild seit ${span(quiet)}`);
      running.push({ ...base, tone: stuck ? "warn" : "run", sub: bits.join(" · "), at: j.started_at });
    } else if (j.status === "queued" || j.status === "paused") {
      planned.push({ ...base, tone: j.status === "paused" ? "pause" : "wait", sub: j.status === "paused" ? "pausiert" : `${(j.position ?? 0) + 1}. in der Reihe`,
        order: j.status === "paused" ? 500 + (j.position ?? 0) : (j.position ?? 0), at: null });
    } else if (recent(j.finished_at)) {
      const took = j.started_at ? ` · ${span(Date.parse(j.finished_at) - Date.parse(j.started_at))}` : "";
      done.push({ ...base, tone: j.status === "failed" ? "fail" : "ok", sub: `${when(j.finished_at, now)}${took}${j.result ? ` · ${cut(j.result, 90)}` : ""}`, at: j.finished_at });
    }
  }

  // 2. Claude im Hintergrund (studio_jobs)
  for (const r of runs) {
    const title = r.note ? cut(r.note, 110) : r.trigger === "daily" ? "Tageslauf" : "Lauf auf Knopfdruck";
    const base = { key: `run:${r.id}`, where: WHERE.run, title };
    if (r.status === "running") running.push({ ...base, tone: "run", sub: `seit ${when(r.started_at, now)}${r.machine ? ` · ${r.machine === "gaming" ? "Gaming-PC" : r.machine}` : ""}`, at: r.started_at });
    else if (r.status === "queued") planned.push({ ...base, tone: "wait", sub: "startet in den nächsten 5 Minuten", order: 900, at: r.requested_at });
    else if (recent(r.finished_at)) done.push({ ...base, tone: r.status === "failed" ? "fail" : "ok", sub: `${when(r.finished_at, now)}${r.summary ? ` · ${cut(r.summary, 140)}` : ""}`, at: r.finished_at });
  }

  // 3. instructions «An Claude»
  for (const m of inbox) {
    const base = { key: `inbox:${m.id}`, where: WHERE.inbox, title: cut(m.body, 110) };
    if (m.status === "doing") running.push({ ...base, tone: "run", sub: `Claude arbeitet daran · seit ${when(m.updated_at, now)}`, at: m.updated_at });
    else if (m.status === "open") planned.push({ ...base, tone: "wait", sub: `geschickt ${when(m.created_at, now)}`, order: 1000, at: m.created_at });
    else if ((m.status === "done" || m.status === "failed") && recent(m.done_at ?? m.updated_at)) {
      done.push({ ...base, tone: m.status === "failed" ? "fail" : "ok", sub: `${when(m.done_at ?? m.updated_at, now)}${m.reply ? ` · ${cut(m.reply, 140)}` : ""}`, at: m.done_at ?? m.updated_at });
    }
  }

  running.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  planned.sort((a, b) => a.order - b.order || String(a.at).localeCompare(String(b.at)));
  done.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  // is the gaming PC still reporting while something waits or runs?
  const open = jobs.filter((j) => ["queued", "running", "paused"].includes(j.status));
  const seen = open.length ? Math.max(...open.map((j) => Date.parse(j.seen_at) || 0)) : null;
  const stale = seen != null && now - seen > STALE_MIN * MIN ? span(now - seen) : null;
  // jobs wait, but none runs: the queue on the gaming PC is stopped (or waits for a Blender started by hand)
  const halted = !stale && planned.some((x) => x.tone === "wait" && x.key.startsWith("gpu:")) && !running.some((x) => x.key.startsWith("gpu:"));
  return { running, planned, done, stale, halted, seenAt: seen ? new Date(seen).toISOString() : null };
}

// «Heute»: a render job that failed in the last 24 h, and a gaming PC that stopped reporting
export function agendaItems({ jobs = [], now = Date.now() } = {}) {
  const out = [];
  for (const j of jobs) {
    if (j.status === "failed" && j.finished_at && now - Date.parse(j.finished_at) <= DAY) {
      out.push({ key: `gpu:${j.name}`, lane: "now", tone: "alert", title: `Render-Auftrag mit Fehler: ${cut(jobName(j), 80)}`, sub: cut(j.result ?? "", 90), where: "Gaming-PC", href: "#claude" });
    }
  }
  const l = lanes({ jobs, now });
  if (l.stale) out.push({ key: "gpu:stale", lane: "now", tone: "alert", title: `Gaming-PC meldet sich seit ${l.stale} nicht`, sub: "Render-Helfer oder PC prüfen (Ruhezustand?)", where: "Gaming-PC", href: "#claude" });
  return out;
}
