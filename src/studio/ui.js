// Cockpit page «Digital Studio» (#studio): Christoph looks at every post at most twice. Sichtung 1: the finished
// post with everything, markers on time/page/spot and on the texts. Claude works through them (npm run studio).
// Sichtung 2: the new version with Claude's notes, ok / noch nicht per marker, «Freigeben» = the Social approval.
// The <video> element lives outside the re-rendered HTML and is put back into its slot after every render, so
// playback is not interrupted; time and playhead are updated directly, not by re-rendering.
import { esc } from "../format.js";
import * as data from "./data.js";
import { CATEGORIES, MARKER_STATUS, R2_FREE_BYTES, SCOPES, STATUS, TARGETS, anchor, arrowStep, fmtGB, fmtTime, isPages, keyAction, markersFor, openCount, r2Flag, r2Usage, remap, roundOrder, sceneAt, sceneJump, sortMarkers } from "./logic.js";
import { WEEKPLAN, WEEK_DAYS, addDaysIso, mondayOf } from "../social/weekplan.js";
import { DEADLINE_DAYS, LOOKING, PIPELINE, PIPELINE_CHANNELS, STEPS, christophsTurn, deadline, inPipeline, isLate, phaseOf, pipelineBlock } from "./pipeline.js";

const CHANNEL_NAME = { "leesidelab/instagram": "Leeside · Instagram", "leesidelab/youtube": "Leeside · YouTube", "downwind/instagram": "Downwind · Instagram", "wolkenhof/youtube": "Wolkenhof · YouTube" };
const FORMAT_NAME = { video_long: "Langes Video", reel: "Reel", short: "Short", carousel: "Karussell", image: "Bild", story: "Story" };
// one formatter, and the day cached for a minute: today() runs for every card and cell of a render
const ZURICH_DAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" });
let todayCache = { at: 0, day: "" };
const today = () => { const now = Date.now(); if (now - todayCache.at > 60_000) todayCache = { at: now, day: ZURICH_DAY.format(new Date(now)) }; return todayCache.day; };
// playback speed in steps of 25 % (Christoph 29.10.2026: «−25 % / +25 %»). Every video starts at 100 %: a remembered slow
// or fast speed silenced the next video (Safari plays no sound below 50 % or above 200 %; «Ton startet nicht immer»)
const RATE_STEP = 0.25, RATE_MIN = 0.25, RATE_MAX = 3;
const clampRate = (r) => Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(r / RATE_STEP) * RATE_STEP));
const dm = (iso) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.` : "ohne Tag");

export function createStudio({ S, render, toast, errorText, approvePost, handleFor = (c) => c.split("/")[0], openDay = () => {} }) {
  S.studio = { value: undefined, loading: false, error: null, itemId: null, round: null, page: 0, form: null, filter: "all", weekStart: null, local: {}, urls: {}, mediaFor: null };
  const st = () => S.studio;
  let unsubscribe = null, reloadTimer, again = false, ownWriteAt = 0, busy = false;
  // per load: versions by item (sorted), open marker counts by item, R2 usage
  let index = { versions: new Map(), open: new Map(), r2: { bytes: 0, files: 0 } };
  const video = document.createElement("video");
  video.playsInline = true;
  // the opened video buffers ahead, so sound and picture start together instead of stuttering while the first
  // seconds still come from R2 (the iPhone decides on its own)
  video.preload = "auto";
  video.className = "st-video";
  video.muted = false;
  video.volume = 1;
  let rate = 1;
  // the browser resets the speed when a new file is loaded
  video.addEventListener("loadedmetadata", () => { video.playbackRate = rate; });
  video.addEventListener("error", async () => {
    const it = item(), ver = it && current(it);
    if (!ver || ver.source?.kind !== "r2" || st().local[ver.id] || video.dataset.retried === ver.id) return;
    video.dataset.retried = ver.id;
    const at = video.currentTime;
    data.forgetMedia(ver.source);
    const url = await data.mediaUrl(ver.source);
    if (url && st().mediaFor === ver.id) { st().urls[ver.id] = url; video.src = url; video.currentTime = at; }
  });

  // ---------- data ----------
  // a reload asked for while one runs is not lost: it runs once more right after
  async function load(force = false) {
    if (st().loading) { if (force) again = true; return; }
    if (st().value !== undefined && !force) return;
    st().loading = true;
    try {
      st().value = await data.loadStudio();
      st().error = null;
      buildIndex();
      // realtime: reload half a second after a change, but not for the echo of Christoph's own click (already reloaded)
      if (st().value && !unsubscribe) unsubscribe = data.subscribe(() => { if (Date.now() - ownWriteAt < 2500) return; clearTimeout(reloadTimer); reloadTimer = setTimeout(() => load(true), 500); });
    } catch (err) { st().error = err; }
    st().loading = false;
    if (again) { again = false; return load(true); }
    if (!document.activeElement?.closest?.(".st-form")) render();
  }
  function buildIndex() {
    const v = st().value;
    const versions = new Map(), open = new Map();
    for (const x of v?.versions ?? []) (versions.get(x.item_id) ?? versions.set(x.item_id, []).get(x.item_id)).push(x);
    for (const list of versions.values()) list.sort((a, b) => a.version - b.version);
    for (const m of v?.markers ?? []) if (m.status === "draft" || m.status === "open" || m.status === "not_yet") open.set(m.item_id, (open.get(m.item_id) ?? 0) + 1);
    index = { versions, open, r2: r2Usage(v?.versions) };
  }
  // a write by Christoph, then a fresh load (the realtime echo of it is skipped)
  async function wrote(fn) {
    ownWriteAt = Date.now();
    await fn();
    ownWriteAt = Date.now();
    await load(true);
  }
  const items = () => st().value?.items ?? [];
  const item = () => items().find((i) => i.id === st().itemId) ?? null;
  const versionsOf = (it) => index.versions.get(it.id) ?? [];
  const current = (it) => { const list = versionsOf(it); return list.find((v) => v.version === it.current_version) ?? list.at(-1) ?? null; };
  const markersOf = (it) => sortMarkers(markersFor(st().value?.markers ?? [], it));
  // Christoph's turn: an idea to confirm, a draft or a version to look at
  const waiting = () => items().filter((i) => christophsTurn(i.status));
  const ideas = () => items().filter((i) => i.status === "idea").sort((a, b) => String(a.day).localeCompare(String(b.day)));

  // the marker as it sits on the current version (remapped through its scene when it was set on an older one)
  function placed(m, ver) {
    if (m.version === ver?.version || m.at == null) return { at: m.at, removed: false };
    return remap(m, ver?.scenes, ver?.duration);
  }

  // ---------- for «Heute» and the sidebar ----------
  const openRequests = () => (st().value?.requests ?? []).filter((q) => q.status === "pending");
  const badge = () => waiting().length + openRequests().length;
  function agenda() {
    const out = [];
    const n = waiting().filter((i) => LOOKING.includes(i.status)).length;
    if (n) out.push({ key: "studio", lane: "today", tone: "info", title: `${n} ${n === 1 ? "Beitrag wartet" : "Beiträge warten"} auf Sichtung`, sub: "Digital Studio", where: "Studio", href: "#studio" });
    const k = ideas().length;
    if (k) out.push({ key: "studio-ideas", lane: "today", tone: "info", title: `${k} ${k === 1 ? "Idee wartet" : "Ideen warten"} auf dein Ok`, sub: "Ablauf, Schritt 1", where: "Studio", href: "#studio" });
    const t = today();
    const late = items().filter((i) => i.day && christophsTurn(i.status) && inPipeline(i.channel, i.format) && isLate(i.status, i.day, t)).length;
    if (late) out.push({ key: "studio-late", lane: "now", tone: "alert", title: `${late} ${late === 1 ? "Beitrag ist" : "Beiträge sind"} im Ablauf im Verzug und ${late === 1 ? "wartet" : "warten"} auf dich`, sub: "Digital Studio", where: "Studio", href: "#studio" });
    const q = openRequests().length;
    if (q) out.push({ key: "studio-requests", lane: "today", tone: "info", title: `${q} ${q === 1 ? "Frage" : "Fragen"} von Claude ${q === 1 ? "wartet" : "warten"} auf dich`, sub: "zum Beispiel Vertonen mit ElevenLabs", where: "Studio", href: "#studio" });
    const last = st().value?.jobs?.[0];
    if (last?.status === "failed") out.push({ key: "studio-run-failed", lane: "now", tone: "alert", title: "Der letzte Claude-Lauf im Hintergrund ist fehlgeschlagen", sub: String(last.summary ?? "").slice(0, 120), where: "Studio", href: "#studio" });
    // R2 has no spending cap: flag it from 80 % of the free 10 GB, and loudly once it costs something
    const r2 = index.r2;
    const flag = r2Flag(r2.bytes);
    if (flag) out.push(flag.level === "cost"
      ? { key: "studio-r2", lane: "now", tone: "alert", title: `Cloudflare R2 kostet jetzt etwa ${flag.usd.toFixed(2)} pro Monat`, sub: `${fmtGB(r2.bytes)} gespeichert, gratis sind ${fmtGB(R2_FREE_BYTES)}. Alte Fassungen löschen?`, where: "Studio", href: "#studio" }
      : { key: "studio-r2", lane: "today", tone: "info", title: `Cloudflare R2 fast voll: ${fmtGB(r2.bytes)} von ${fmtGB(R2_FREE_BYTES)} gratis`, sub: "Darüber kostet es etwas. Alte Fassungen löschen?", where: "Studio", href: "#studio" });
    return out;
  }

  // ---------- Ablauf: 4-week block ----------
  function pipelineHtml(monday = st().blockStart ?? mondayOf(today())) {
    if (!st().value) return "";
    const t = today();
    // a channel chosen above: only its 4 weeks (Christoph 28.10.2026)
    const f = st().filter;
    const rows = pipelineBlock(items(), monday, t, 4, PIPELINE.filter((p) => f === "all" || p.channel === f));
    const cell = (d, channel) => {
      const it = d.items[0];
      const who = d.phase.who === "christoph" ? `<span class="pl-you" title="du bist dran">du</span>` : "";
      const tip = `${dm(d.date)} · ${d.items.length ? FORMAT_NAME[d.items[0].format] ?? "" : d.slot ? `geplant: ${d.slot.format}` : "frei"}\nSchritt ${d.phase.n} ${d.phase.name}: ${d.phase.label}${d.items.map((i) => `\n${i.title}`).join("")}${d.late ? "\nim Verzug" : ""}`;
      const attrs = it ? `data-action="st-open" data-id="${esc(it.id)}"` : `data-action="st-day" data-channel="${esc(channel)}" data-value="${esc(d.date)}"`;
      return `<button class="pl-cell pl-${d.phase.color}${d.late ? " pl-late" : ""}${d.date === t ? " today" : ""}${d.items.length ? "" : " pl-free"}" ${attrs} title="${esc(tip)}" aria-label="${esc(tip)}">${who}</button>`;
    };
    const legend = STEPS.filter(Boolean).map((s) => `<span class="pl-key pl-${s.color}"></span> ${s.n < 5 ? `${s.n} ` : ""}${esc(s.name)}`).join(" ");
    return `<section class="card pl-block"><div class="blk-head"><b>Ablauf: Idee → Entwurf → Video → Feinschliff</b>
        <button class="btn ghost" data-action="st-block" data-value="-28" aria-label="4 Wochen zurück">‹</button><span>4 Wochen ab ${esc(dm(monday))}</span><button class="btn ghost" data-action="st-block" data-value="28" aria-label="4 Wochen vor">›</button></div>
      ${rows.map((r) => `<p class="st-ch">${esc(CHANNEL_NAME[r.channel] ?? r.channel)} · ${esc(r.label)}</p><div class="blk-grid"><span></span>${WEEK_DAYS.map((d) => `<span class="blk-dow">${d}</span>`).join("")}<span class="blk-dow">Woche</span>
        ${r.weeks.map((w) => `<span class="blk-week">${esc(dm(w.monday))}</span>${w.days.map((d) => cell(d, r.channel)).join("")}<span class="pl-count${w.late ? " pl-short" : ""}" title="${esc(r.label)} in dieser Woche (Ziel ${r.perWeek})">${w.count}/${r.perWeek}</span>`).join("")}</div>`).join("")}
      <p class="muted small blk-legend">${legend} · <span class="pl-key pl-late-key"></span> im Verzug · «du» = du bist dran · rechts: Beiträge der Woche (rot = zu wenige Ideen)</p>
      <p class="muted small">Fristen vor dem Sendetag: Idee ${DEADLINE_DAYS[1]} Tage, Entwurf ${DEADLINE_DAYS[2]}, Video ${DEADLINE_DAYS[3]}, Feinschliff ${DEADLINE_DAYS[4]}.</p></section>`;
  }

  // ---------- Claude in the background (gaming PC, scripts/studio-worker.mjs) ----------
  const WHEN = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const when = (iso) => (iso ? WHEN.format(new Date(iso)) : "");
  function requestHtml(q) {
    const cost = [q.sentences != null ? `${q.sentences} Sätze` : "", q.credits != null ? `etwa ${q.credits.toLocaleString("de-CH")} Credits` : ""].filter(Boolean).join(", ");
    return `<div class="st-req">
      <div><b>${esc(q.title)}</b>${cost ? `<span class="muted small"> · ${esc(cost)}</span>` : ""}
        ${q.body ? `<details><summary class="small">Text ansehen</summary><p class="st-pkg-text small">${esc(q.body)}</p></details>` : ""}</div>
      ${q.status === "pending"
        ? `<div class="st-idea-act"><button class="btn ghost" data-action="st-req" data-id="${esc(q.id)}" data-value="declined">Nein</button><button class="btn" data-action="st-req" data-id="${esc(q.id)}" data-value="approved">✓ ${q.kind === "voice" ? "Vertonen ok" : "Ok"}</button></div>`
        : `<span class="pill st-approved">ok, beim nächsten Lauf</span>`}</div>`;
  }
  function runsHtml() {
    const v = st().value;
    if (!v.runsReady) return "";
    const jobs = v.jobs ?? [];
    const active = jobs.find((j) => j.status === "queued" || j.status === "running");
    const last = jobs.find((j) => j.status === "done" || j.status === "failed");
    const state = active?.status === "running" ? `läuft seit ${esc(when(active.started_at))}`
      : active ? `wartet auf den Gaming-PC (startet innert 5 Minuten)${active.trigger === "daily" ? ", Tageslauf" : ""}` : "";
    const reqs = v.requests ?? [];
    return `<section class="card st-runs"><div class="st-week-head"><b>Claude im Hintergrund</b>
        <button class="btn" data-action="st-run"${active ? " disabled" : ""}>▶ Claude jetzt starten</button></div>
      <p class="muted small">Läuft jeden Tag um 08:00 am Gaming-PC von selbst und erledigt alles, wo «Claude ist dran» steht. Der Knopf startet einen Lauf sofort.</p>
      ${state ? `<p class="small"><b>Jetzt:</b> ${state}${active?.note ? ` · «${esc(active.note)}»` : ""}</p>` : ""}
      ${last ? `<p class="small ${last.status === "failed" ? "error" : ""}"><b>Letzter Lauf</b> ${esc(when(last.finished_at ?? last.started_at))}${last.status === "failed" ? " (fehlgeschlagen)" : ""}: ${esc(last.summary ?? "")}</p>` : `<p class="muted small">Noch kein Lauf.</p>`}
      ${reqs.length ? `<h3>Fragen von Claude</h3>${reqs.map(requestHtml).join("")}` : ""}</section>`;
  }

  function ideasHtml() {
    const list = ideas();
    if (!list.length) return "";
    return `<section class="card st-ideas"><h3>Ideen (${list.length}): dein Ok</h3>${list.map((i) => `<div class="st-idea">
        <div><span class="muted small">${esc(CHANNEL_NAME[i.channel] ?? i.channel)} · ${esc(FORMAT_NAME[i.format] ?? i.format)} · ${esc(dm(i.day))}${i.day ? ` · Ok bis ${esc(dm(deadline(i.day, 1)))}` : ""}</span>
          <b>${esc(i.title)}</b>${i.pitch ? `<p class="st-pkg-text">${esc(i.pitch)}</p>` : ""}</div>
        <div class="st-idea-act"><button class="btn" data-action="st-idea-ok" data-id="${esc(i.id)}">Idee ok</button>
          <button class="btn ghost" data-action="st-idea-drop" data-id="${esc(i.id)}">Andere Idee …</button></div></div>`).join("")}</section>`;
  }
  const itemForPost = (postId) => items().find((i) => i.social_post_id === postId) ?? null;

  // ---------- media ----------
  async function ensureMedia(it) {
    const ver = current(it);
    if (!ver) return;
    const key = ver.id;
    if (st().mediaFor === key) return;
    st().mediaFor = key;
    // thumbnails of a long video: R2 keys or Social bucket paths
    const thumbs = ver.meta?.thumbnails ?? [];
    const turls = await Promise.all(thumbs.map((t) => data.mediaUrl(t?.key ? { kind: "r2", key: t.key } : t?.path ? { kind: "storage", path: t.path } : null)));
    if (st().mediaFor !== key) return;   // another post was opened meanwhile
    turls.forEach((u, i) => { st().urls[`${key}#t${i}`] = u; });
    if (isPages(it.format)) { if (turls.length) render(); return; }
    const url = st().local[key] ?? await data.mediaUrl(ver.source);
    if (st().mediaFor !== key) return;
    st().urls[key] = url;
    if (url && video.src !== url) { rate = 1; video.src = url; video.load(); }
    if (!url) video.removeAttribute("src");
    render();
  }
  // a tap on the iPhone or laptop: the video alone in full screen with the browser's own controls (Christoph 29.10.2026);
  // the iPhone has no element full screen, only its video player (webkitEnterFullscreen)
  function full() {
    const it = item();
    if (!it) return;
    if (isPages(it.format)) { document.querySelector(".st-frame.pages img")?.requestFullscreen?.().catch(() => {}); return; }
    if (!video.currentSrc) return;
    video.controls = true;
    if (video.requestFullscreen) video.requestFullscreen().catch(() => { video.controls = false; });
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    else { video.controls = false; return; }
    if (video.paused) video.play().catch(() => {});
  }
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) { video.controls = false; tick(); } });
  video.addEventListener("webkitendfullscreen", () => { video.controls = false; tick(); });

  function pickLocal(ver) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/mp4,video/quicktime,video/*";
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      if (st().local[ver.id]) URL.revokeObjectURL(st().local[ver.id]);
      st().local[ver.id] = url;
      st().urls[ver.id] = url;
      st().mediaFor = ver.id;
      rate = 1;
      video.src = url;
      video.load();
      render();
    }, { once: true });
    input.click();
  }

  // ---------- views ----------
  function view() {
    const s = st();
    if (s.value === null) return `<section class="card"><h2>Digital Studio einrichten</h2><p class="note">Einmal im Supabase SQL-Editor <code>supabase/migrations/20261028100000_studio.sql</code> ausführen und die Funktion <code>studio-media</code> hochladen (Anleitung <code>docs/studio-setup.md</code>).</p></section>`;
    if (!s.value) return s.error ? `<p class="error">${esc(errorText(s.error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    const it = item();
    if (it) return itemView(it);
    return overview();
  }

  function overview() {
    const s = st();
    const monday = s.weekStart ?? mondayOf(today());
    const channels = [...new Set([...WEEKPLAN.map((c) => `${c.app_id}/${c.platform}`), ...items().map((i) => i.channel)])];
    const shown = channels.filter((c) => s.filter === "all" || c === s.filter);
    const chips = [["all", "Alle Kanäle"], ...channels.map((c) => [c, CHANNEL_NAME[c] ?? c])]
      .map(([v, l]) => `<button class="chip${s.filter === v ? " on" : ""}" data-action="st-filter" data-value="${esc(v)}">${esc(l)}</button>`).join("");
    const weeks = [0, 1, 2, 3].map((w) => addDaysIso(monday, 7 * w));
    const week = (mon) => {
      const end = addDaysIso(mon, 6);
      const inWeek = items().filter((i) => i.day && i.day >= mon && i.day <= end && shown.includes(i.channel) && i.status !== "dropped");
      const toSee = inWeek.filter((i) => LOOKING.includes(i.status));
      const rows = shown.map((c) => {
        const list = inWeek.filter((i) => i.channel === c).sort((a, b) => a.day.localeCompare(b.day));
        return `<div class="st-row"><span class="st-ch">${esc(CHANNEL_NAME[c] ?? c)}</span><div class="st-cards">${list.length ? list.map(card).join("") : `<span class="muted small">nichts im Studio</span>`}</div></div>`;
      }).join("");
      return `<section class="card st-week"><div class="st-week-head"><b>Woche ${esc(dm(mon))} bis ${esc(dm(end))}</b>
          ${toSee.length ? `<button class="btn" data-action="st-round" data-value="${esc(mon)}">Woche ansehen (${toSee.length})</button>` : `<span class="muted small">nichts zu sichten</span>`}</div>${rows}</section>`;
    };
    const noDay = items().filter((i) => !i.day && shown.includes(i.channel));
    return `<div class="toolbar"><div class="chips">${chips}</div>
        <div class="row-right"><button class="btn ghost" data-action="st-week" data-value="-7" aria-label="Woche zurück">‹</button><button class="btn ghost" data-action="st-week" data-value="7" aria-label="Woche vor">›</button>${s.weekStart ? `<button class="link" data-action="st-week" data-value="0">Diese Woche</button>` : ""}</div></div>
      <p class="muted small">Jeder Beitrag höchstens zweimal: Sichtung 1 mit Markern, Sichtung 2 mit Claudes Antworten und Freigabe. Lange YouTube-Videos und alles auf Instagram haben davor Idee und Entwurf.</p>
      ${(() => { const r2 = index.r2; const fl = r2Flag(r2.bytes); return r2.files ? `<p class="small ${fl?.level === "cost" ? "error" : fl ? "warn-text" : "muted"}">Cloudflare R2: ${fmtGB(r2.bytes)} von ${fmtGB(R2_FREE_BYTES)} gratis (${r2.files} Dateien)${fl?.level === "cost" ? `, kostet etwa ${fl.usd.toFixed(2)} pro Monat` : ""}.</p>` : ""; })()}
      ${runsHtml()}
      ${s.filter === "all" || PIPELINE_CHANNELS.includes(s.filter) ? `${ideasHtml()}${pipelineHtml()}` : ""}
      ${weeks.map(week).join("")}
      ${noDay.length ? `<section class="card st-week"><b>Ohne Tag</b><div class="st-cards">${noDay.map(card).join("")}</div></section>` : ""}`;
  }

  function card(it) {
    const n = index.open.get(it.id) ?? 0;
    const pl = inPipeline(it.channel, it.format) ? phaseOf(it.status) : null;
    return `<button class="st-card st-${it.status}${pl ? ` pl-card-${pl.color}${it.day && isLate(it.status, it.day, today()) ? " pl-late" : ""}` : ""}" data-action="st-open" data-id="${esc(it.id)}">
      <span class="st-card-top"><span class="muted small">${it.day ? WEEK_DAYS[(new Date(`${it.day}T12:00:00Z`).getUTCDay() + 6) % 7] : ""} ${esc(dm(it.day))} · ${esc(FORMAT_NAME[it.format] ?? it.format)}</span>${n ? `<span class="count-chip calm">${n}</span>` : ""}</span>
      <b>${esc(it.title || "(ohne Titel)")}</b><span class="st-state">${pl ? `Schritt ${pl.n} · ` : ""}${esc(STATUS[it.status])}${it.current_version > 1 ? ` · Fassung ${it.current_version}` : ""}</span></button>`;
  }

  // step 1: the idea as Claude proposed it
  function ideaView(it) {
    const done = it.status !== "idea";
    return `<section class="card st-ideas"><h3>Idee</h3><p class="st-pkg-text">${esc(it.pitch || "(keine Beschreibung)")}</p>
      ${it.idea_note ? `<p class="st-note"><b>Deine Notiz:</b> ${esc(it.idea_note)}</p>` : ""}
      ${done ? `<p class="muted small">${esc(STATUS[it.status])}</p>` : `<div class="st-idea-act"><button class="btn" data-action="st-idea-ok" data-id="${esc(it.id)}">Idee ok</button>
        <button class="btn ghost" data-action="st-idea-drop" data-id="${esc(it.id)}">Andere Idee …</button></div>
        <p class="muted small">Bei «Idee ok» macht Claude einen einfachen Entwurf mit Gratis-Stimme.${it.day ? ` Ok bis ${esc(dm(deadline(it.day, 1)))}.` : ""}</p>`}</section>`;
  }

  function itemView(it) {
    const s = st();
    const ver = current(it);
    queueMicrotask(() => ensureMedia(it));
    const ms = markersOf(it);
    const r = s.round;
    const nav = r ? `<span class="muted small">Wochenrunde ${r.idx + 1} von ${r.ids.length}</span>
        <button class="btn ghost" data-action="st-round-step" data-value="-1"${r.idx ? "" : " disabled"}>‹ Zurück</button>
        <button class="btn ghost" data-action="st-round-step" data-value="1"${r.idx < r.ids.length - 1 ? "" : " disabled"}>Weiter ›</button>` : "";
    return `<div class="st-head"><button class="link" data-action="st-close">‹ Übersicht</button>${nav}${topAction(it, ms)}</div>
      <div class="st-title"><div><span class="muted small">${esc(CHANNEL_NAME[it.channel] ?? it.channel)} · ${esc(FORMAT_NAME[it.format] ?? it.format)} · ${esc(dm(it.day))}</span>
        <h2>${esc(it.title || "(ohne Titel)")}</h2></div><span class="pill st-${it.status}">${inPipeline(it.channel, it.format) ? `Schritt ${phaseOf(it.status).n} · ` : ""}${esc(STATUS[it.status])}${ver ? ` · Fassung ${it.current_version}` : ""}</span></div>
      ${it.status !== "dropped" ? stepper(it) : ""}
      ${claudeNote(it)}
      ${(st().value?.requests ?? []).filter((q) => q.item_id === it.id).map(requestHtml).join("")}
      ${it.pitch || it.status === "idea" ? ideaView(it) : ""}
      ${["idea", "idea_ok", "dropped"].includes(it.status) && !ver ? "" : `<div class="st-body${it.format === "video_long" ? " wide" : ""}">
        <div class="st-stage">${ver ? (isPages(it.format) ? pagesView(it, ver, ms) : playerView(it, ver, ms)) : `<p class="note">Noch keine Fassung. Sie kommt mit dem Import oder mit <code>npm run studio -- upload</code>.</p>`}</div>
        <aside class="st-side">${formView(it)}${markerList(it, ver, ms)}${actions(it, ms)}</aside>
      </div>`}
      ${ver ? packageView(it, ver) : ""}`;
  }

  // the one button that moves the post on, always at the top (also without any marker: «approve as it is»)
  // the buttons that move the post on, always at the top; each says what happens next (Christoph 28.10.2026)
  function topAction(it, ms) {
    const drafts = ms.filter((m) => m.status === "draft").length;
    const notYet = ms.filter((m) => m.status === "not_yet").length;
    const n = drafts + notYet;
    const pts = (k) => `${k} ${k === 1 ? "Punkt" : "Punkte"}`;
    const btn = (action, label, ghost = false, id = "") => `<button class="btn${ghost ? " ghost" : ""}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}>${label}</button>`;
    const wrap = (html) => `<div class="st-top">${html}</div>`;
    const full = inPipeline(it.channel, it.format);
    switch (it.status) {
      case "idea": return wrap(btn("st-idea-drop", "Andere Idee …", true, it.id) + btn("st-idea-ok", "✓ Idee ok: Entwurf machen", false, it.id));
      case "draft": return wrap(drafts
        ? btn("st-finish", `${pts(drafts)} an Claude: Video machen`)
        : btn("st-finish", "✓ Entwurf passt: Video machen"));
      case "review1": return wrap(n
        ? btn("st-approve", "Trotzdem freigeben", true) + btn("st-finish", `${pts(n)} an Claude: Feinschliff`)
        : btn("st-approve", full ? "✓ Passt so: freigeben (ohne Feinschliff)" : "✓ Passt so: freigeben"));
      case "review2": return wrap(n
        ? btn("st-again", `${pts(n)} nochmals an Claude`)
        : btn("st-approve", "✓ Freigeben: geht raus"));
      case "approved": return wrap(`<span class="pill st-approved">✓ freigegeben${it.day ? `, ${it.day < today() ? "ging" : "geht"} am ${esc(dm(it.day))} raus` : ""}</span>`);
      case "idea_ok": case "draft_done": case "work": return wrap(`<span class="muted small">Claude ist dran</span>`);
      default: return "";
    }
  }

// which Claude chat does the work for a channel (table «Zuständiger Chat» in C:QNHCLAUDE.md)
  const CHAT = { "leesidelab/instagram": "Leesidelab Instagram channel", "leesidelab/youtube": "Set QNH GmbH", "downwind/instagram": "Downwind Social", "wolkenhof/youtube": "Wolkenhof 2" };
  const WHAT = { idea_ok: "den Entwurf", draft_done: "das Video", work: "den Feinschliff" };
  // when Claude is on: what, by when (deadline of the step) and which chat; the chats look at the studio at every start
  function claudeNote(it) {
    const what = WHAT[it.status];
    if (!what) return "";
    const by = it.day ? deadline(it.day, phaseOf(it.status).n) : null;
    const late = it.day && isLate(it.status, it.day, today());
    return `<p class="note small st-claude${late ? " late" : ""}">Claude macht ${what}${by ? ` bis ${esc(dm(by))}` : ""}${late ? " (im Verzug)." : by ? "" : "."} Zuständig: Chat «${esc(CHAT[it.channel] ?? "Set QNH GmbH")}». Er schaut beim nächsten Start ins Studio, die neue Fassung erscheint dann hier.</p>`;
  }

  // where the post stands: the steps of the Ablauf (or only the two looks for posts outside it), whose turn it is
  function stepper(it) {
    const full = inPipeline(it.channel, it.format);
    const steps = full
      ? [["Idee", ["idea"], []], ["Entwurf", ["draft"], ["idea_ok"]], ["Video · Sichtung 1", ["review1"], ["draft_done"]], ["Feinschliff · Sichtung 2", ["review2"], ["work"]], ["bereit", [], []]]
      : [["Sichtung 1", ["review1"], []], ["Feinschliff · Sichtung 2", ["review2"], ["work"]], ["bereit", [], []]];
    const idx = it.status === "approved" ? steps.length - 1 : steps.findIndex(([, mine, claude]) => mine.includes(it.status) || claude.includes(it.status));
    // idea_ok belongs to the draft step (Claude makes it)
    const cur = it.status === "idea_ok" ? (full ? 1 : idx) : idx;
    const late = it.day && it.status !== "approved" && isLate(it.status, it.day, today());
    return `<ol class="st-steps${late ? " late" : ""}" aria-label="Stand">${steps.map(([label, mine], i) => {
      const state = i < cur || it.status === "approved" ? "done" : i === cur ? "now" : "next";
      const who = state === "now" && it.status !== "approved" ? (mine.includes(it.status) ? "du bist dran" : "Claude ist dran") : "";
      return `<li class="st-step ${state} pl-${full ? STEPS[Math.min(i + 1, 5)].color : i === steps.length - 1 ? "green" : i ? "yellow" : "orange"}"><span class="st-dot">${state === "done" ? "✓" : i + 1}</span><span><b>${esc(label)}</b>${who ? `<small>${who}</small>` : ""}</span></li>`;
    }).join("")}</ol>${late ? `<p class="small error">Im Verzug: dieser Schritt hätte bis ${esc(dm(deadline(it.day, phaseOf(it.status).n)))} fertig sein sollen.</p>` : ""}`;
  }

  // ---------- device frames: the post as the viewer sees it (Christoph 28.10.2026) ----------
  // Instagram: a phone with the feed post (carousel, picture) or the full-screen reel/story with its overlay;
  // YouTube: a laptop with the player and the title below (Shorts: a phone). The overlays never take clicks,
  // so markers can still be set on the picture, and they show where Instagram covers the picture.
  const isPhone = (it) => it.channel.endsWith("/instagram") || it.format !== "video_long";
  const fullScreen = (it) => ["reel", "short", "story"].includes(it.format);
  function chosenTitle(ver) {
    const m = ver?.meta ?? {};
    return (m.titles ?? [])[m.chosen_title ?? 0] ?? "";
  }
  function screenOverlay(it, ver) {
    if (!fullScreen(it)) return "";
    const handle = handleFor(it.channel);
    const text = it.channel.endsWith("/youtube") ? chosenTitle(ver) || it.title : ver?.meta?.caption ?? "";
    if (it.format === "story") return `<div class="dev-ui dev-story" aria-hidden="true"><span class="dev-bar"></span><span class="dev-who"><i class="dev-av"></i>${esc(handle)}</span></div>`;
    return `<div class="dev-ui dev-reel" aria-hidden="true"><div class="dev-side"><span>♡</span><span>💬</span><span>➤</span><span>⋯</span></div>
      <div class="dev-cap"><span class="dev-who"><i class="dev-av"></i>${esc(handle)}</span><p>${esc(String(text).split("\n").find(Boolean) ?? "")}</p></div></div>`;
  }
  function device(it, ver, frame) {
    const handle = handleFor(it.channel);
    if (!isPhone(it)) {
      const desc = String(ver?.meta?.description ?? ver?.meta?.caption ?? "").split("\n").filter(Boolean).slice(0, 2).join(" ");
      return `<div class="dev-laptop" data-action="st-full" title="Vollbild"><div class="dev-lid"><div class="dev-screen dev-yt">${frame}
          <div class="yt-meta"><b>${esc(chosenTitle(ver) || it.title)}</b><span class="dev-who"><i class="dev-av"></i>${esc(handle)}</span>${desc ? `<p>${esc(desc)}</p>` : ""}</div></div></div><div class="dev-base"></div></div>`;
    }
    const status = `<div class="ios-status" aria-hidden="true"><span>9:41</span><i class="ios-island"></i><span>▮▮▮ ▭</span></div>`;
    const tabs = it.channel.endsWith("/instagram") && it.format !== "story" ? `<div class="ig-tabs" aria-hidden="true"><span>⌂</span><span>⌕</span><span>⊕</span><span>▶</span><span>◯</span></div>` : "";
    if (fullScreen(it)) return `<div class="dev-phone" data-action="st-full" title="Vollbild"><div class="dev-screen dev-full${it.format === "story" ? " dev-storyscreen" : ""}">${status}<div class="dev-content">${frame}</div>${tabs}</div></div>`;
    const cap = String(ver?.meta?.caption ?? "");
    return `<div class="dev-phone" data-action="st-full" title="Vollbild"><div class="dev-screen dev-feed">${status}<div class="dev-content">
        <div class="ig-head"><span class="dev-who"><i class="dev-av"></i>${esc(handle)}</span><span>⋯</span></div>${frame}
        <div class="ig-act"><span>♡ 💬 ➤</span><span>⌑</span></div>
        <div class="ig-cap"><b>${esc(handle)}</b> ${esc(cap.slice(0, 220))}${cap.length > 220 ? " … mehr" : ""}</div>
        ${ver?.meta?.first_comment ? `<div class="ig-com"><b>${esc(handle)}</b> ${esc(ver.meta.first_comment.slice(0, 120))}</div>` : ""}</div>${tabs}</div></div>`;
  }

  function playerView(it, ver, ms) {
    const s = st();
    const url = s.urls[ver.id];
    const vertical = it.format !== "video_long";
    const dur = ver.duration || video.duration || 0;
    const ticks = (ver.scenes ?? []).map((sc) => `<span class="st-scene" style="left:${dur ? (sc.start / dur) * 100 : 0}%" title="${esc(sc.label)}"></span>`).join("");
    const mticks = ms.filter((m) => m.target === "medium").map((m) => { const p = placed(m, ver); return p.at == null ? "" : `<button class="st-mtick st-m-${m.status}" style="left:${dur ? (p.at / dur) * 100 : 0}%" data-action="st-seek" data-value="${p.at}" title="${esc(m.body)}"></button>`; }).join("");
    const spot = s.form?.x != null ? `<span class="st-spot form" style="left:${s.form.x}%;top:${s.form.y}%"></span>` : "";
    const spots = ms.filter((m) => m.target === "medium" && m.x != null).map((m) => { const p = placed(m, ver); return p.at == null ? "" : `<span class="st-spot st-m-${m.status}" data-at="${p.at}" style="left:${m.x}%;top:${m.y}%" title="${esc(m.body)}"></span>`; }).join("");
    return `${device(it, ver, `<div class="st-frame${vertical ? " vertical" : ""}">
        <div class="st-video-slot" id="st-video-slot"></div>
        ${screenOverlay(it, ver)}
        <div class="st-overlay${s.form?.target === "medium" ? " placing" : ""}" data-action="st-spot">${spots}${spot}</div>
        ${url ? "" : `<div class="st-nomedia"><p>${ver.source?.kind === "r2" ? "Das Video liegt in Cloudflare R2, ist aber gerade nicht erreichbar." : "Kein Video verfügbar."}</p><button class="btn" data-action="st-local">Video vom PC öffnen</button></div>`}
      </div>`)}
      <div class="st-timeline" data-action="st-scrub">${ticks}${mticks}<span class="st-playhead" id="st-playhead"></span></div>
      <div class="st-time"><b id="st-time">${fmtTime(video.currentTime || 0)}</b><span class="muted" id="st-scene">${esc(sceneAt(ver.scenes, video.currentTime || 0)?.label ?? "")}</span><span class="muted">${fmtTime(dur)}</span></div>
      <div class="st-controls">
        <button class="btn ghost" data-action="st-key" data-value="sceneBack" title="Zum Szenenanfang">⏮</button>
        <button class="btn ghost" data-action="st-key" data-value="back" title="Zurück (Pfeil links)">−${arrowStep(it.format)} s</button>
        <button class="btn" data-action="st-key" data-value="toggle" title="Start / Pause (Leertaste)" id="st-play">${video.paused ? "▶" : "❚❚"}</button>
        <button class="btn ghost" data-action="st-key" data-value="stop" title="Stopp">■</button>
        <button class="btn ghost" data-action="st-key" data-value="fwd" title="Vor (Pfeil rechts)">+${arrowStep(it.format)} s</button>
        <button class="btn ghost" data-action="st-key" data-value="sceneFwd" title="Nächste Szene">⏭</button>
        <button class="btn ghost" data-action="st-key" data-value="frameBack" title="Ein Bild zurück (Komma, in der Pause)">‹|</button>
        <button class="btn ghost" data-action="st-key" data-value="frameFwd" title="Ein Bild vor (Punkt, in der Pause)">|›</button>
        <button class="btn ghost" data-action="st-sound" id="st-sound" title="Ton ein/aus">${video.muted ? "🔇" : "🔊"}</button>
        <button class="btn st-mark" data-action="st-key" data-value="mark" title="Marker (M)">● Marker</button>
      </div>
      <div class="st-rates" role="group" aria-label="Geschwindigkeit">
        <button class="btn ghost" data-action="st-rate" data-value="-1" title="25 % langsamer"${rate <= RATE_MIN ? " disabled" : ""}>− 25 %</button>
        <button class="chip${rate === 1 ? " on" : ""}" data-action="st-rate" data-value="0" title="Zurück auf 100 %">${Math.round(rate * 100)} %</button>
        <button class="btn ghost" data-action="st-rate" data-value="1" title="25 % schneller"${rate >= RATE_MAX ? " disabled" : ""}>+ 25 %</button>
      </div>
      ${rate < 0.5 || rate > 2 ? `<p class="small warn-text">Bei ${rate * 100} % spielen Safari und das iPhone keinen Ton ab, Chrome nur verzerrt. Für den Ton 100 % wählen.</p>` : ""}
      ${url && ver.source?.kind !== "local" ? `<p class="small"><button class="link" data-action="st-local">Video stattdessen vom PC öffnen</button></p>` : ""}
      <p class="small" id="st-audio"></p>
      <p class="muted small st-keys">Version ${typeof __BUILD__ === "string" ? __BUILD__ : "dev"} · Leertaste Start/Pause · ← → ${arrowStep(it.format)} s · , . ein Bild (in der Pause) · M Marker · Klick aufs Bild: Vollbild, beim Marker: Stelle</p>`;
  }

  function pagesView(it, ver, ms) {
    const s = st();
    const pages = data.pageUrls(ver.source);
    const p = Math.min(s.page, Math.max(0, pages.length - 1));
    const spots = ms.filter((m) => m.target === "medium" && m.page === p && m.x != null).map((m) => `<span class="st-spot st-m-${m.status}" style="left:${m.x}%;top:${m.y}%" title="${esc(m.body)}"></span>`).join("");
    const spot = s.form?.x != null && s.form.page === p ? `<span class="st-spot form" style="left:${s.form.x}%;top:${s.form.y}%"></span>` : "";
    return `${device(it, ver, `<div class="st-frame vertical pages">${pages.length ? `<img src="${esc(pages[p])}" alt="Seite ${p + 1}">` : `<p class="note">Keine Bilder.</p>`}
        <div class="st-overlay${s.form?.target === "medium" ? " placing" : ""}" data-action="st-spot">${spots}${spot}</div>
        ${pages.length > 1 ? `<span class="ig-dots" aria-hidden="true">${pages.map((_, i) => `<i class="${i === p ? "on" : ""}"></i>`).join("")}</span>` : ""}</div>`)}
      <div class="st-strip">${pages.map((u, i) => `<button class="st-thumb${i === p ? " on" : ""}" data-action="st-page" data-value="${i}"><img src="${esc(u)}" alt="Seite ${i + 1}"><span>${i + 1}${ms.some((m) => m.page === i) ? " ●" : ""}</span></button>`).join("")}</div>
      <div class="st-controls"><button class="btn ghost" data-action="st-key" data-value="prevPage">‹ Seite</button><span class="muted">${p + 1} / ${pages.length}</span>
        <button class="btn ghost" data-action="st-key" data-value="nextPage">Seite ›</button><button class="btn st-mark" data-action="st-key" data-value="mark">● Marker</button></div>
      <p class="muted small st-keys">← → Seite · M Marker · Klick ins Bild beim Marker: Stelle</p>`;
  }

  function formView(it) {
    const f = st().form;
    if (!f) return `<div class="st-quick"><button class="btn ghost" data-action="st-mark-target" data-value="general">Rückmeldung zum ganzen Beitrag</button></div>`;
    const where = f.target !== "medium" ? TARGETS[f.target] : f.page != null ? `Seite ${f.page + 1}` : `${fmtTime(f.at)}${f.scene_label ? ` · ${f.scene_label}` : ""}`;
    return `<form class="st-form card" data-form="st-marker">
      <div class="st-form-head"><b>${f.id ? "Marker ändern" : "Neuer Marker"}</b><span class="muted small">${esc(where)}${f.x != null ? " · Stelle gesetzt" : f.target === "medium" ? " · Klick ins Bild für die Stelle" : ""}</span></div>
      <div class="chips">${Object.entries(CATEGORIES).map(([k, l]) => `<button type="button" class="chip${f.category === k ? " on" : ""}" data-action="st-cat" data-value="${k}">${esc(l)}</button>`).join("")}</div>
      <textarea name="st-body" rows="3" placeholder="Was soll anders sein?" required>${esc(f.body ?? "")}</textarea>
      <div class="row-right"><button class="btn">Speichern</button><button type="button" class="btn ghost" data-action="st-cancel">Abbrechen</button></div>
    </form>`;
  }

  function markerList(it, ver, ms) {
    if (!ms.length) return `<p class="muted small">Noch keine Marker.${it.status === "review1" ? " Mit M oder «● Marker» setzen." : ""}</p>`;
    const review2 = it.status === "review2";
    return `<ul class="st-markers">${ms.map((m) => {
      const p = placed(m, ver);
      const where = m.target !== "medium" ? TARGETS[m.target] : m.page != null ? `Seite ${m.page + 1}` : p.removed ? "Szene entfernt" : fmtTime(p.at);
      const jump = m.target === "medium" && (p.at != null || m.page != null);
      const editable = m.status === "draft";
      return `<li class="st-m st-m-${m.status}">
        <div class="st-m-top">${jump ? `<button class="link" data-action="st-seek" data-value="${m.page != null ? `p${m.page}` : p.at}">${esc(where)}</button>` : `<b class="small">${esc(where)}</b>`}
          <span class="muted small">${esc(CATEGORIES[m.category] ?? m.category)}</span><span class="pill st-m-${m.status}">${esc(MARKER_STATUS[m.status])}</span></div>
        <p>${esc(m.body)}</p>
        ${m.note ? `<p class="st-note"><b>Claude:</b> ${esc(m.note)}</p>` : ""}
        ${m.scope ? `<p class="muted small">Regel: ${esc(SCOPES[m.scope])}${m.rule ? ` · ${esc(m.rule)}` : ""}</p>` : ""}
        <div class="st-m-actions">${editable ? `<button class="link" data-action="st-edit" data-id="${esc(m.id)}">Ändern</button><button class="link danger" data-action="st-del" data-id="${esc(m.id)}">Löschen</button>` : ""}
          ${review2 && ["done", "rejected", "ok", "not_yet"].includes(m.status) ? `<button class="btn ghost${m.status === "ok" ? " on" : ""}" data-action="st-judge" data-id="${esc(m.id)}" data-value="ok">ok</button><button class="btn ghost${m.status === "not_yet" ? " on" : ""}" data-action="st-judge" data-id="${esc(m.id)}" data-value="not_yet">noch nicht</button>` : ""}</div>
      </li>`;
    }).join("")}</ul>`;
  }

  // the buttons sit in the top bar (topAction); here only the count of Christoph's points while Claude works
  function actions(it, ms) {
    const n = ["idea_ok", "draft_done", "work"].includes(it.status) ? openCount(ms) : 0;
    return n ? `<p class="note small">${n} ${n === 1 ? "Punkt" : "Punkte"} von dir in Arbeit.</p>` : "";
  }

  // D4: the whole package of the version: title/thumbnail choice, texts, chapters, shorts, Claude's assumptions
  function packageView(it, ver) {
    const m = ver.meta ?? {};
    const block = (target, label, text) => text ? `<div class="st-pkg-item"><div class="st-pkg-head"><b>${esc(label)}</b><button class="link" data-action="st-mark-target" data-value="${target}">Marker</button></div><p class="st-pkg-text">${esc(text)}</p></div>` : "";
    const locked = it.status === "approved";
    const titles = (m.titles ?? []).length ? `<div class="st-pkg-item"><div class="st-pkg-head"><b>Titel${m.titles.length > 1 ? " (auswählen)" : ""}</b><button class="link" data-action="st-mark-target" data-value="title">Marker</button></div>
      ${m.titles.map((t, i) => `<label class="st-choice"><input type="radio" name="st-title" data-action="st-choose" data-kind="chosen_title" data-value="${i}"${(m.chosen_title ?? 0) === i ? " checked" : ""}${locked ? " disabled" : ""}> ${esc(t)}</label>`).join("")}</div>` : "";
    const thumbs = (m.thumbnails ?? []).length ? `<div class="st-pkg-item"><div class="st-pkg-head"><b>Titelbild${m.thumbnails.length > 1 ? " (auswählen)" : ""}</b><button class="link" data-action="st-mark-target" data-value="thumbnail">Marker</button></div>
      <div class="st-strip">${m.thumbnails.map((t, i) => { const u = st().urls[`${ver.id}#t${i}`]; return `<button class="st-thumbpick${(m.chosen_thumbnail ?? 0) === i ? " on" : ""}" data-action="st-choose" data-kind="chosen_thumbnail" data-value="${i}"${locked ? " disabled" : ""}>${u ? `<img class="st-thumbimg" src="${esc(u)}" alt="Titelbild ${i + 1}">` : `<span class="muted small">${esc(t?.name ?? `Bild ${i + 1}`)}<br>(nur am PC)</span>`}</button>`; }).join("")}</div></div>` : "";
    const shorts = (m.shorts ?? []).length ? `<div class="st-pkg-item"><b>Shorts daraus</b><ul class="small">${m.shorts.map((s) => `<li>${esc(s.title ?? s.label ?? "")}${s.start != null ? ` · ${fmtTime(s.start)} bis ${fmtTime(s.end)}` : ""}</li>`).join("")}</ul></div>` : "";
    const assumptions = (m.assumptions ?? []).length ? `<div class="st-pkg-item"><b>Annahmen von Claude</b><ul class="small">${m.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : "";
    const body = [titles, thumbs, block("caption", "Caption", m.caption), block("description", "Beschreibung", m.description), block("description", "Kapitel", m.chapters),
      block("first_comment", "Erster Kommentar", m.first_comment), block("quiz", "Quiz-Antworten", (m.quiz_correct_replies ?? []).join("\n")), shorts, assumptions].join("");
    return body ? `<section class="card st-pkg"><h3>Paket</h3>${body}</section>` : "";
  }

  // ---------- video glue ----------
  function afterRender() {
    const slot = document.getElementById("st-video-slot");
    if (slot && video.parentElement !== slot) slot.appendChild(video);
    tick();
  }
  function tick() {
    const it = item();
    const ver = it && current(it);
    const el = document.getElementById("st-time");
    if (!el || !ver) return;
    const t = video.currentTime || 0;
    el.textContent = fmtTime(t);
    const sc = document.getElementById("st-scene");
    if (sc) sc.textContent = sceneAt(ver.scenes, t)?.label ?? "";
    const ph = document.getElementById("st-playhead");
    const dur = ver.duration || video.duration || 0;
    if (ph && dur) ph.style.left = `${(t / dur) * 100}%`;
    const play = document.getElementById("st-play");
    if (play) play.textContent = video.paused ? "▶" : "❚❚";
    const snd = document.getElementById("st-sound");
    if (snd) snd.textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
    // after a moment of playing: does the browser really decode sound? (Chrome counts bytes, Safari lists tracks)
    const au = document.getElementById("st-audio");
    if (au && !video.paused && video.currentTime > 0.8) {
      const bytes = video.webkitAudioDecodedByteCount;
      const has = bytes != null ? bytes > 0 : video.audioTracks ? video.audioTracks.length > 0 : video.mozHasAudio ?? null;
      au.textContent = video.muted ? "Ton ist ausgeschaltet (🔇 antippen)." : has === false ? "Dieses Video hat keine Tonspur, oder der Browser spielt sie bei dieser Geschwindigkeit nicht ab." : has ? `Ton läuft (Lautstärke ${Math.round(video.volume * 100)} %). Hörst du nichts, Lautstärke am Gerät oder Stummschaltung des Tabs prüfen.` : "";
    }
    for (const s of document.querySelectorAll(".st-spot[data-at]")) s.classList.toggle("near", Math.abs(Number(s.dataset.at) - t) < 1.5);
  }
  for (const ev of ["timeupdate", "play", "pause", "seeked", "loadedmetadata", "volumechange"]) video.addEventListener(ev, tick);
  let raf = 0;
  video.addEventListener("play", () => { const f = () => { tick(); if (!video.paused) raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); });
  video.addEventListener("pause", () => cancelAnimationFrame(raf));

  function seek(t) {
    const it = item();
    const ver = it && current(it);
    const dur = ver?.duration || video.duration || 0;
    video.currentTime = Math.max(0, dur ? Math.min(dur, t) : t);
    tick();
  }

  function act(action) {
    const it = item();
    if (!it) return false;
    const ver = current(it);
    const fps = ver?.fps || 30;
    const step = arrowStep(it.format);
    switch (action) {
      case "toggle": if (video.paused) video.play().catch(() => toast("Video lässt sich nicht abspielen.")); else video.pause(); return true;
      case "stop": video.pause(); seek(0); return true;
      case "back": seek(video.currentTime - step); return true;
      case "fwd": seek(video.currentTime + step); return true;
      case "frameBack": if (video.paused) seek(video.currentTime - 1 / fps); return true;
      case "frameFwd": if (video.paused) seek(video.currentTime + 1 / fps); return true;
      case "sceneBack": seek(sceneJump(ver?.scenes, video.currentTime, -1, ver?.duration)); return true;
      case "sceneFwd": seek(sceneJump(ver?.scenes, video.currentTime, 1, ver?.duration || video.duration)); return true;
      case "prevPage": st().page = Math.max(0, st().page - 1); render(); return true;
      case "nextPage": st().page = Math.min(data.pageUrls(ver?.source).length - 1, st().page + 1); render(); return true;
      case "mark": startMarker(it, "medium"); return true;
      case "blur": document.activeElement?.blur?.(); return true;
      default: return false;
    }
  }

  function startMarker(it, target) {
    const ver = current(it);
    if (!ver) return;
    video.pause();
    const base = { item_id: it.id, version: ver.version, target, category: target === "medium" ? "picture" : "text", body: "", x: null, y: null };
    if (target === "medium" && isPages(it.format)) st().form = { ...base, page: st().page, at: null };
    else if (target === "medium") {
      const t = Math.round((video.currentTime || 0) * 1000) / 1000;
      const a = anchor(ver.scenes, t);
      st().form = { ...base, at: t, page: null, ...a, scene_label: sceneAt(ver.scenes, t)?.label ?? null };
    } else st().form = { ...base, at: null, page: null, scene_id: null, offset_s: null };
    render();
    setTimeout(() => document.querySelector('[name="st-body"]')?.focus(), 0);
  }

  // ---------- events ----------
  const inText = (el) => !!el?.closest?.("input, textarea, select, [contenteditable='true']");
  function onKeydown(e) {
    if (S.tab !== "studio" || S.sheet || S.search?.open || document.fullscreenElement || !item() || e.ctrlKey || e.metaKey || e.altKey) return false;
    const a = keyAction({ key: e.key, inText: inText(e.target), format: item().format, paused: video.paused });
    if (!a) return false;
    e.preventDefault();
    return act(a);
  }

  function openItem(id, round = null) {
    st().itemId = id;
    st().round = round;
    st().page = 0;
    st().form = null;
    st().mediaFor = null;
    video.pause();
    location.hash = `#studio/${id}`;
  }

  const WRITES = new Set(["st-run", "st-req", "st-approve", "st-finish", "st-again", "st-idea-ok", "st-idea-drop", "st-judge", "st-del", "st-choose"]);
  async function onClick(action, el) {
    if (!WRITES.has(action)) return handleClick(action, el);
    if (busy) return true;
    busy = true;
    try { return await handleClick(action, el); } finally { busy = false; }
  }
  async function handleClick(action, el) {
    const s = st();
    const id = el.dataset.id;
    switch (action) {
      case "st-filter": s.filter = el.dataset.value; break;
      case "st-week": { const n = Number(el.dataset.value); s.weekStart = n === 0 ? null : addDaysIso(s.weekStart ?? mondayOf(today()), n); break; }
      case "st-open": openItem(id); return true;
      case "st-close": s.itemId = null; s.round = null; video.pause(); location.hash = "#studio"; return true;
      case "st-round": {
        const mon = el.dataset.value, end = addDaysIso(mon, 6);
        const list = roundOrder(items().filter((i) => i.day >= mon && i.day <= end && LOOKING.includes(i.status) && (s.filter === "all" || i.channel === s.filter)));
        if (list.length) openItem(list[0].id, { ids: list.map((i) => i.id), idx: 0 });
        return true;
      }
      case "st-round-step": {
        const r = s.round;
        if (!r) return true;
        const idx = Math.max(0, Math.min(r.ids.length - 1, r.idx + Number(el.dataset.value)));
        openItem(r.ids[idx], { ...r, idx });
        return true;
      }
      case "st-key": act(el.dataset.value); return true;
      case "st-day": openDay(el.dataset.channel, el.dataset.value); return true;
      case "st-sound":
        video.muted = !video.muted;
        if (!video.muted && video.volume === 0) video.volume = 1;
        break;
      case "st-full": full(); return true;
      case "st-rate": {
        const step = Number(el.dataset.value);
        rate = step === 0 ? 1 : clampRate(rate + step * RATE_STEP);
        video.playbackRate = rate;
        break;
      }
      case "st-local": { const it = item(); if (it) pickLocal(current(it)); return true; }
      case "st-seek": {
        const v = String(el.dataset.value);
        if (v.startsWith("p")) { s.page = Number(v.slice(1)); break; }
        video.pause();
        seek(Number(v));
        return true;
      }
      case "st-page": s.page = Number(el.dataset.value); break;
      case "st-mark-target": { const it = item(); if (it) startMarker(it, el.dataset.value); return true; }
      case "st-cat": if (s.form) s.form.category = el.dataset.value; break;
      case "st-choose": {
        const it = item(), ver = it && current(it);
        if (!ver) return true;
        try { await wrote(() => data.setVersionMeta(ver.id, { ...ver.meta, [el.dataset.kind]: Number(el.dataset.value) })); } catch (err) { toast(errorText(err)); }
        return true;
      }
      case "st-cancel": s.form = null; break;
      case "st-edit": { const m = (s.value?.markers ?? []).find((x) => x.id === id); if (m) s.form = { ...m }; break; }
      case "st-del":
        if (!confirm("Diesen Marker löschen?")) return true;
        try { await wrote(() => data.deleteMarker(id)); } catch (err) { toast(errorText(err)); }
        return true;
      case "st-judge":
        try { await wrote(() => data.judgeMarker(id, el.dataset.value)); } catch (err) { toast(errorText(err)); }
        return true;
      case "st-finish": {
        const it = item();
        try {
          await wrote(() => data.finishReview(it));
          toast(it.status === "draft" ? "Danke. Claude macht jetzt das richtige Video." : "Sichtung abgeschlossen. Claude setzt die Marker um.");
          nextInRound();
        } catch (err) { toast(errorText(err)); }
        return true;
      }
      case "st-idea-ok": case "st-idea-drop": {
        const it = items().find((i) => i.id === id);
        if (!it) return true;
        const ok = action === "st-idea-ok";
        const note = ok ? "" : prompt("Was passt nicht? Claude schlägt dann eine andere Idee vor. (leer lassen geht auch)");
        if (note === null) return true;
        try { await wrote(() => data.judgeIdea(it, ok, note.trim())); toast(ok ? "Idee ok. Claude macht den Entwurf." : "Verworfen. Claude schlägt eine andere Idee vor."); } catch (err) { toast(errorText(err)); }
        return true;
      }
      case "st-run": {
        const note = prompt("Was soll Claude machen? Leer lassen: alles, was ansteht.");
        if (note === null) return true;
        try {
          let ok;
          await wrote(async () => { ok = await data.startRun(note.trim()); });
          toast(ok ? "Claude startet in den nächsten 5 Minuten am Gaming-PC." : "Es wartet schon ein Lauf.");
        } catch (err) { toast(errorText(err)); }
        return true;
      }
      case "st-req":
        try { await wrote(() => data.answerRequest(id, el.dataset.value)); toast(el.dataset.value === "approved" ? "Ok. Claude vertont beim nächsten Lauf." : "Abgelehnt."); } catch (err) { toast(errorText(err)); }
        return true;
      case "st-block": {
        const n = Number(el.dataset.value);
        s.blockStart = addDaysIso(s.blockStart ?? mondayOf(today()), n);
        break;
      }
      case "st-again": {
        const it = item();
        try {
          await wrote(() => data.finishReview(it));   // new drafts become open; «noch nicht» stays for Claude
          toast("Zurück an Claude. Die nächste Fassung zeigt nur diese Punkte.");
          nextInRound();
        } catch (err) { toast(errorText(err)); }
        return true;
      }
      case "st-approve": await approve(item()); return true;
      default: return false;
    }
    render();
    return true;
  }

  function nextInRound() {
    const r = st().round;
    if (r && r.idx < r.ids.length - 1) openItem(r.ids[r.idx + 1], { ...r, idx: r.idx + 1 });
    else { st().itemId = null; st().round = null; location.hash = "#studio"; render(); }
  }

  // «Freigeben» = the Social approval with all its checks; without a draft yet (long video before the import) the
  // studio remembers it with the content hash, and the import takes it over only if the content is unchanged
  async function approve(it) {
    if (!it) return;
    const ver = current(it);
    const done = { status: "approved", approved_at: new Date().toISOString() };
    try {
      if (it.social_post_id) {
        if (!(await approvePost(it.social_post_id))) return;
        // the post is approved now; the studio step must follow, one retry if the network hiccups
        await wrote(() => data.setItem(it.id, done).catch(() => data.setItem(it.id, done)));
      } else {
        if (!confirm("Freigeben? Der Entwurf existiert noch nicht. Der Import übernimmt deine Freigabe, aber nur, wenn der Inhalt genau dieser Fassung entspricht.")) return;
        await wrote(() => data.setItem(it.id, { ...done, approved_hash: ver?.hash ?? null }));
        toast("Freigabe gemerkt.");
      }
      nextInRound();
    } catch (err) {
      toast(`${errorText(err)}${it.social_post_id ? " Der Beitrag selbst ist freigegeben, im Studio nochmals «Freigeben» tippen." : ""}`);
    }
  }

  // click into the paused picture: the spot of the marker being written (x/y in percent)
  function onPointer(e) {
    const ov = e.target.closest?.('[data-action="st-spot"]');
    const tl = e.target.closest?.('[data-action="st-scrub"]');
    if (tl && !e.target.closest(".st-mtick")) {
      const it = item();
      const ver = it && current(it);
      const r = tl.getBoundingClientRect();
      const dur = ver?.duration || video.duration || 0;
      if (dur) seek(((e.clientX - r.left) / r.width) * dur);
      return true;
    }
    if (!ov) return false;
    const f = st().form;
    if (!f || f.target !== "medium") {
      full();
      return true;
    }
    const r = ov.getBoundingClientRect();
    f.x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    f.y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    render();
    return true;
  }

  async function onSubmit(form) {
    if (form.dataset.form !== "st-marker") return false;
    const f = st().form;
    const body = form.elements["st-body"].value.trim();
    if (!f || !body) return true;
    try {
      await wrote(() => data.saveMarker({ ...f, body }));
      st().form = null;
    } catch (err) { toast(errorText(err)); }
    render();
    return true;
  }
  function onInput(e) {
    if (e.target.name === "st-body" && st().form) { st().form.body = e.target.value; return true; }
    return false;
  }

  const setItemFromRoute = (id) => {
    if (id && id !== st().itemId) { st().itemId = id; st().form = null; st().mediaFor = null; st().page = 0; }
    if (!id) { st().itemId = null; st().round = null; video.pause(); }
  };

  return { load, view, afterRender, onClick, onKeydown, onPointer, onSubmit, onInput, badge, agenda, itemForPost, setItemFromRoute };
}
