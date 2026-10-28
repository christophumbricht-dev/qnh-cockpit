// Cockpit page «Digital Studio» (#studio): Christoph looks at every post at most twice. Sichtung 1: the finished
// post with everything, markers on time/page/spot and on the texts. Claude works through them (npm run studio).
// Sichtung 2: the new version with Claude's notes, ok / noch nicht per marker, «Freigeben» = the Social approval.
// The <video> element lives outside the re-rendered HTML and is put back into its slot after every render, so
// playback is not interrupted; time and playhead are updated directly, not by re-rendering.
import { esc } from "../format.js";
import * as data from "./data.js";
import { CATEGORIES, MARKER_STATUS, SCOPES, STATUS, TARGETS, anchor, arrowStep, fmtTime, isPages, keyAction, markersFor, openCount, remap, roundOrder, sceneAt, sceneJump, sortMarkers } from "./logic.js";
import { WEEKPLAN, WEEK_DAYS, addDaysIso, mondayOf } from "../social/weekplan.js";
import { DEADLINE_DAYS, LOOKING, STEPS, christophsTurn, deadline, inPipeline, isLate, phaseOf, pipelineBlock } from "./pipeline.js";

const CHANNEL_NAME = { "leesidelab/instagram": "Leeside · Instagram", "leesidelab/youtube": "Leeside · YouTube", "downwind/instagram": "Downwind · Instagram", "wolkenhof/youtube": "Wolkenhof · YouTube" };
const FORMAT_NAME = { video_long: "Langes Video", reel: "Reel", short: "Short", carousel: "Karussell", image: "Bild", story: "Story" };
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
const dm = (iso) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.` : "ohne Tag");

export function createStudio({ S, render, toast, errorText, approvePost }) {
  S.studio = { value: undefined, loading: false, error: null, itemId: null, round: null, page: 0, form: null, filter: "all", weekStart: null, local: {}, urls: {}, mediaFor: null };
  const st = () => S.studio;
  let unsubscribe = null, reloadTimer;
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "metadata";
  video.className = "st-video";

  // ---------- data ----------
  async function load(force = false) {
    if (st().loading || (st().value !== undefined && !force)) return;
    st().loading = true;
    try {
      st().value = await data.loadStudio();
      st().error = null;
      if (st().value && !unsubscribe) unsubscribe = data.subscribe(() => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => load(true), 500); });
    } catch (err) { st().error = err; }
    st().loading = false;
    if (!document.activeElement?.closest?.(".st-form")) render();
  }
  const items = () => st().value?.items ?? [];
  const item = () => items().find((i) => i.id === st().itemId) ?? null;
  const versionsOf = (it) => (st().value?.versions ?? []).filter((v) => v.item_id === it.id).sort((a, b) => a.version - b.version);
  const current = (it) => versionsOf(it).find((v) => v.version === it.current_version) ?? versionsOf(it).at(-1) ?? null;
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
  const badge = () => waiting().length;
  function agenda() {
    const out = [];
    const n = waiting().filter((i) => LOOKING.includes(i.status)).length;
    if (n) out.push({ key: "studio", lane: "today", tone: "info", title: `${n} ${n === 1 ? "Beitrag wartet" : "Beiträge warten"} auf Sichtung`, sub: "Digital Studio", where: "Studio", href: "#studio" });
    const k = ideas().length;
    if (k) out.push({ key: "studio-ideas", lane: "today", tone: "info", title: `${k} ${k === 1 ? "Idee wartet" : "Ideen warten"} auf dein Ok`, sub: "YouTube-Ablauf, Schritt 1", where: "Studio", href: "#studio" });
    const late = items().filter((i) => inPipeline(i.channel) && i.day && christophsTurn(i.status) && isLate(i.status, i.day, today())).length;
    if (late) out.push({ key: "studio-late", lane: "now", tone: "alert", title: `${late} YouTube-${late === 1 ? "Video ist" : "Videos sind"} im Verzug und ${late === 1 ? "wartet" : "warten"} auf dich`, sub: "Digital Studio", where: "Studio", href: "#studio" });
    return out;
  }

  // ---------- YouTube-Ablauf: 4-week block (also shown in Social → Wochenplan) ----------
  function pipelineHtml(monday = st().blockStart ?? mondayOf(today()), { nav = true } = {}) {
    if (!st().value) return "";
    const t = today();
    const rows = pipelineBlock(items(), monday, t);
    const cell = (d) => {
      const it = d.items[0];
      const who = d.phase.who === "christoph" ? `<span class="pl-you" title="du bist dran">du</span>` : "";
      const tip = `${dm(d.date)} · ${d.slot?.format ?? "kein fester Platz"}\nSchritt ${d.phase.n} ${d.phase.name}: ${d.phase.label}${d.items.map((i) => `\n${i.title}`).join("")}${d.late ? "\nim Verzug" : ""}`;
      const attrs = it ? `data-action="st-open" data-id="${esc(it.id)}"` : `data-action="noop"`;
      return `<button class="pl-cell pl-${d.phase.color}${d.late ? " pl-late" : ""}${d.date === t ? " today" : ""}${d.slot || d.items.length ? "" : " pl-free"}" ${attrs} title="${esc(tip)}" aria-label="${esc(tip)}">${who}</button>`;
    };
    const legend = STEPS.filter(Boolean).map((s) => `<span class="pl-key pl-${s.color}"></span> ${s.n < 5 ? `${s.n} ` : ""}${esc(s.name)}`).join(" ");
    return `<section class="card pl-block"><div class="blk-head"><b>YouTube-Ablauf</b>
        ${nav ? `<button class="btn ghost" data-action="st-block" data-value="-28" aria-label="4 Wochen zurück">‹</button><span>4 Wochen ab ${esc(dm(monday))}</span><button class="btn ghost" data-action="st-block" data-value="28" aria-label="4 Wochen vor">›</button>` : `<span>4 Wochen ab ${esc(dm(monday))}</span>`}</div>
      ${rows.map((r) => `<p class="st-ch">${esc(CHANNEL_NAME[r.channel] ?? r.channel)}</p><div class="blk-grid"><span></span>${WEEK_DAYS.map((d) => `<span class="blk-dow">${d}</span>`).join("")}
        ${r.weeks.map((w) => `<span class="blk-week">${esc(dm(w.monday))}</span>${w.days.map(cell).join("")}`).join("")}</div>`).join("")}
      <p class="muted small blk-legend">${legend} · <span class="pl-key pl-late-key"></span> im Verzug · «du» = du bist dran</p>
      <p class="muted small">Fristen vor dem Sendetag: Idee ${DEADLINE_DAYS[1]} Tage, Entwurf ${DEADLINE_DAYS[2]}, Video ${DEADLINE_DAYS[3]}, Feinschliff ${DEADLINE_DAYS[4]}.</p></section>`;
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
    turls.forEach((u, i) => { st().urls[`${key}#t${i}`] = u; });
    if (isPages(it.format)) { if (turls.length) render(); return; }
    const url = st().local[key] ?? await data.mediaUrl(ver.source);
    st().urls[key] = url;
    if (url && video.src !== url) { video.src = url; video.load(); }
    if (!url) video.removeAttribute("src");
    render();
  }
  function pickLocal(ver) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/mp4,video/quicktime,video/*";
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      st().local[ver.id] = url;
      st().urls[ver.id] = url;
      st().mediaFor = ver.id;
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
      <p class="muted small">Jeder Beitrag höchstens zweimal: Sichtung 1 mit Markern, Sichtung 2 mit Claudes Antworten und Freigabe. YouTube-Videos haben davor Idee und Entwurf.</p>
      ${s.filter === "all" || inPipeline(s.filter) ? `${ideasHtml()}${pipelineHtml()}` : ""}
      ${weeks.map(week).join("")}
      ${noDay.length ? `<section class="card st-week"><b>Ohne Tag</b><div class="st-cards">${noDay.map(card).join("")}</div></section>` : ""}`;
  }

  function card(it) {
    const n = openCount((st().value?.markers ?? []).filter((m) => m.item_id === it.id));
    const pl = inPipeline(it.channel) ? phaseOf(it.status) : null;
    return `<button class="st-card st-${it.status}${pl ? ` pl-card-${pl.color}${isLate(it.status, it.day, today()) ? " pl-late" : ""}` : ""}" data-action="st-open" data-id="${esc(it.id)}">
      <span class="st-card-top"><span class="muted small">${esc(WEEK_DAYS[(new Date(`${it.day}T12:00:00Z`).getUTCDay() + 6) % 7] ?? "")} ${esc(dm(it.day))} · ${esc(FORMAT_NAME[it.format] ?? it.format)}</span>${n ? `<span class="count-chip calm">${n}</span>` : ""}</span>
      <b>${esc(it.title || "(ohne Titel)")}</b><span class="st-state">${pl ? `Schritt ${pl.n} · ` : ""}${esc(STATUS[it.status])}${it.current_version > 1 ? ` · Fassung ${it.current_version}` : ""}</span></button>`;
  }

  // step 1: the idea as Claude proposed it
  function ideaView(it) {
    const done = it.status !== "idea";
    return `<section class="card st-ideas"><h3>Idee</h3><p class="st-pkg-text">${esc(it.pitch || "(keine Beschreibung)")}</p>
      ${it.idea_note ? `<p class="st-note"><b>Deine Notiz:</b> ${esc(it.idea_note)}</p>` : ""}
      ${done ? `<p class="muted small">${esc(STATUS[it.status])}</p>` : `<div class="st-idea-act"><button class="btn" data-action="st-idea-ok" data-id="${esc(it.id)}">Idee ok</button>
        <button class="btn ghost" data-action="st-idea-drop" data-id="${esc(it.id)}">Andere Idee …</button></div>
        <p class="muted small">Bei «Idee ok» macht Claude einen einfachen Entwurf mit Gratis-Stimme. Ok bis ${esc(dm(deadline(it.day, 1)))}.</p>`}</section>`;
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
    return `<div class="st-head"><button class="link" data-action="st-close">‹ Übersicht</button>${nav}</div>
      <div class="st-title"><div><span class="muted small">${esc(CHANNEL_NAME[it.channel] ?? it.channel)} · ${esc(FORMAT_NAME[it.format] ?? it.format)} · ${esc(dm(it.day))}</span>
        <h2>${esc(it.title || "(ohne Titel)")}</h2></div><span class="pill st-${it.status}">${inPipeline(it.channel) ? `Schritt ${phaseOf(it.status).n} · ` : ""}${esc(STATUS[it.status])}${ver ? ` · Fassung ${it.current_version}` : ""}</span></div>
      ${it.pitch || it.status === "idea" ? ideaView(it) : ""}
      ${["idea", "idea_ok", "dropped"].includes(it.status) && !ver ? "" : `<div class="st-body${it.format === "video_long" ? " wide" : ""}">
        <div class="st-stage">${ver ? (isPages(it.format) ? pagesView(it, ver, ms) : playerView(it, ver, ms)) : `<p class="note">Noch keine Fassung. Sie kommt mit dem Import oder mit <code>npm run studio -- upload</code>.</p>`}</div>
        <aside class="st-side">${formView(it)}${markerList(it, ver, ms)}${actions(it, ms)}</aside>
      </div>`}
      ${ver ? packageView(it, ver) : ""}`;
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
    return `<div class="st-frame${vertical ? " vertical" : ""}">
        <div class="st-video-slot" id="st-video-slot"></div>
        <div class="st-overlay" data-action="st-spot">${spots}${spot}</div>
        ${url ? "" : `<div class="st-nomedia"><p>${ver.source?.kind === "r2" ? "Das Video liegt in Cloudflare R2, ist aber gerade nicht erreichbar (Funktion studio-media noch nicht eingerichtet?)." : "Kein Video verfügbar."}</p><button class="btn" data-action="st-local">Video vom PC öffnen</button></div>`}
      </div>
      <div class="st-timeline" data-action="st-scrub">${ticks}${mticks}<span class="st-playhead" id="st-playhead"></span></div>
      <div class="st-time"><b id="st-time">${fmtTime(video.currentTime || 0)}</b><span class="muted" id="st-scene">${esc(sceneAt(ver.scenes, video.currentTime || 0)?.label ?? "")}</span><span class="muted">${fmtTime(dur)}</span></div>
      <div class="st-controls">
        <button class="btn ghost" data-action="st-key" data-value="sceneBack" title="Zum Szenenanfang">⏮</button>
        <button class="btn ghost" data-action="st-key" data-value="back" title="Zurück (Pfeil links)">−${arrowStep(it.format)} s</button>
        <button class="btn" data-action="st-key" data-value="toggle" title="Start / Pause (Leertaste)" id="st-play">${video.paused ? "▶" : "❚❚"}</button>
        <button class="btn ghost" data-action="st-key" data-value="stop" title="Stopp">■</button>
        <button class="btn ghost" data-action="st-key" data-value="fwd" title="Vor (Pfeil rechts)">+${arrowStep(it.format)} s</button>
        <button class="btn ghost" data-action="st-key" data-value="sceneFwd" title="Nächste Szene">⏭</button>
        <button class="btn ghost" data-action="st-key" data-value="frameBack" title="Ein Bild zurück (Komma, in der Pause)">‹ Bild</button>
        <button class="btn ghost" data-action="st-key" data-value="frameFwd" title="Ein Bild vor (Punkt, in der Pause)">Bild ›</button>
        <button class="btn st-mark" data-action="st-key" data-value="mark" title="Marker (M)">● Marker</button>
        ${url && ver.source?.kind !== "local" ? `<button class="link" data-action="st-local">Datei vom PC</button>` : ""}
      </div>
      <p class="muted small st-keys">Leertaste Start/Pause · ← → ${arrowStep(it.format)} s · , . ein Bild (in der Pause) · M Marker · Klick ins Bild beim Marker: Stelle</p>`;
  }

  function pagesView(it, ver, ms) {
    const s = st();
    const pages = data.pageUrls(ver.source);
    const p = Math.min(s.page, Math.max(0, pages.length - 1));
    const spots = ms.filter((m) => m.target === "medium" && m.page === p && m.x != null).map((m) => `<span class="st-spot st-m-${m.status}" style="left:${m.x}%;top:${m.y}%" title="${esc(m.body)}"></span>`).join("");
    const spot = s.form?.x != null && s.form.page === p ? `<span class="st-spot form" style="left:${s.form.x}%;top:${s.form.y}%"></span>` : "";
    return `<div class="st-frame vertical pages">${pages.length ? `<img src="${esc(pages[p])}" alt="Seite ${p + 1}">` : `<p class="note">Keine Bilder.</p>`}
        <div class="st-overlay" data-action="st-spot">${spots}${spot}</div></div>
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

  function actions(it, ms) {
    const drafts = ms.filter((m) => m.status === "draft").length;
    // step 2: the draft (Windows voice, simple pictures): input for the real video, no approval yet
    if (it.status === "draft") {
      return `<div class="st-actions"><button class="btn" data-action="st-finish">${drafts ? `Input abschicken (${drafts} Marker)` : "Entwurf passt: Video machen"}</button>
        <p class="muted small">Der Entwurf ist noch nicht das Video: Stimme und Bilder sind nur zum Vorstellen. Sag hier, was anders werden soll.</p></div>`;
    }
    if (it.status === "idea_ok" || it.status === "draft_done") return `<p class="note small">${esc(STATUS[it.status])}.${openCount(ms) ? ` ${openCount(ms)} ${openCount(ms) === 1 ? "Punkt" : "Punkte"} von dir.` : ""}</p>`;
    if (it.status === "idea" || it.status === "dropped") return "";
    if (it.status === "review1") {
      return `<div class="st-actions">${drafts ? `<button class="btn" data-action="st-finish">Sichtung abschliessen (${drafts} ${drafts === 1 ? "Marker" : "Marker"})</button>` : ""}
        <button class="btn ${drafts ? "ghost" : ""}" data-action="st-approve">${drafts ? "Trotzdem freigeben" : "Alles gut: freigeben"}</button></div>`;
    }
    if (it.status === "work") return `<p class="note small">Claude arbeitet an ${openCount(ms)} ${openCount(ms) === 1 ? "Punkt" : "Punkten"}. Die neue Fassung kommt hierher zurück.</p>`;
    if (it.status === "review2") {
      const notYet = ms.filter((m) => m.status === "not_yet").length;
      const unjudged = ms.filter((m) => m.status === "done" || m.status === "rejected").length;
      return `<div class="st-actions">${notYet || drafts ? `<button class="btn" data-action="st-again">Noch nicht freigeben (${notYet + drafts} ${notYet + drafts === 1 ? "Punkt" : "Punkte"} zurück an Claude)</button>` : ""}
        <button class="btn${notYet || drafts ? " ghost" : ""}" data-action="st-approve"${notYet ? " disabled" : ""}>Freigeben${unjudged ? ` (${unjudged} ohne Urteil)` : ""}</button></div>`;
    }
    return `<p class="ok small">Freigegeben${it.approved_at ? ` am ${esc(new Date(it.approved_at).toLocaleDateString("de-CH"))}` : ""}.</p>`;
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
    for (const s of document.querySelectorAll(".st-spot[data-at]")) s.classList.toggle("near", Math.abs(Number(s.dataset.at) - t) < 1.5);
  }
  for (const ev of ["timeupdate", "play", "pause", "seeked", "loadedmetadata"]) video.addEventListener(ev, tick);
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
    if (S.tab !== "studio" || !item() || e.ctrlKey || e.metaKey || e.altKey) return false;
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

  async function onClick(action, el) {
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
        try { await data.setVersionMeta(ver.id, { ...ver.meta, [el.dataset.kind]: Number(el.dataset.value) }); await load(true); } catch (err) { toast(errorText(err)); }
        return true;
      }
      case "st-cancel": s.form = null; break;
      case "st-edit": { const m = (s.value?.markers ?? []).find((x) => x.id === id); if (m) s.form = { ...m }; break; }
      case "st-del":
        if (!confirm("Diesen Marker löschen?")) return true;
        try { await data.deleteMarker(id); await load(true); } catch (err) { toast(errorText(err)); }
        return true;
      case "st-judge":
        try { await data.judgeMarker(id, el.dataset.value); await load(true); } catch (err) { toast(errorText(err)); }
        return true;
      case "st-finish": {
        const it = item();
        try {
          await data.finishReview(it);
          toast(it.status === "draft" ? "Danke. Claude macht jetzt das richtige Video." : "Sichtung abgeschlossen. Claude setzt die Marker um.");
          await load(true);
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
        try { await data.judgeIdea(it, ok, note.trim()); toast(ok ? "Idee ok. Claude macht den Entwurf." : "Verworfen. Claude schlägt eine andere Idee vor."); await load(true); } catch (err) { toast(errorText(err)); }
        return true;
      }
      case "st-block": {
        const n = Number(el.dataset.value);
        s.blockStart = addDaysIso(s.blockStart ?? mondayOf(today()), n);
        break;
      }
      case "st-again": {
        const it = item();
        try {
          await data.finishReview(it);   // new drafts become open; «noch nicht» stays for Claude
          toast("Zurück an Claude. Die nächste Fassung zeigt nur diese Punkte.");
          await load(true);
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
    if (it.social_post_id) {
      const ok = await approvePost(it.social_post_id);
      if (!ok) return;
      await data.setItem(it.id, { status: "approved", approved_at: new Date().toISOString() });
    } else {
      if (!confirm("Freigeben? Der Entwurf existiert noch nicht. Der Import übernimmt deine Freigabe, aber nur, wenn der Inhalt genau dieser Fassung entspricht.")) return;
      await data.setItem(it.id, { status: "approved", approved_at: new Date().toISOString(), approved_hash: ver?.hash ?? null });
      toast("Freigabe gemerkt.");
    }
    await load(true);
    nextInRound();
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
      if (!isPages(item()?.format)) act("toggle");
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
      await data.saveMarker({ ...f, body });
      st().form = null;
      await load(true);
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

  // Social → Wochenplan: the step of a YouTube day as a small tag (links into the studio)
  function dayPhase(channel, date) {
    if (!st().value || !inPipeline(channel)) return "";
    const list = items().filter((i) => i.channel === channel && i.day === date && i.status !== "dropped");
    const it = list.length ? list.reduce((a, b) => (phaseOf(b.status).n < phaseOf(a.status).n ? b : a)) : null;
    const p = phaseOf(it?.status ?? null);
    const late = date >= today() && isLate(it?.status ?? null, date, today());
    const tag = `<span class="pl-tag pl-${p.color}${late ? " pl-late" : ""}">${p.n < 5 ? `Schritt ${p.n} · ` : "✓ "}${esc(p.label)}</span>`;
    return it ? `<a class="pl-taglink" href="#studio/${esc(it.id)}">${tag}</a>` : tag;
  }

  return { load, view, afterRender, onClick, onKeydown, onPointer, onSubmit, onInput, badge, agenda, itemForPost, setItemFromRoute, pipelineHtml, dayPhase };
}
