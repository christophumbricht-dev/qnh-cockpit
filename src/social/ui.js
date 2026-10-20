// Cockpit tab "Social": post queue per app, editor with checks and phone preview, approval.
// Nothing is ever approved automatically – only the "Freigeben" button (and the database checks that too).
import { esc, num } from "../format.js";
import * as data from "./data.js";
import { KINDS, LIMITS, aspectLabel, countHashtags, formatZurich, formatZurichDate, parseTagList, utcToZurichLocal, validatePost, zurichToUtc } from "./validate.js";
import { readPackage } from "./package.js";
import { sparkSvg } from "../charts.js";
import { findPublishedTwin } from "./dupes.js";

const STATUS = { draft: "Entwurf", approved: "Geplant", publishing: "Wird veröffentlicht …", published: "Veröffentlicht", failed: "Fehler" };
const GROUPS = [["Entwürfe", ["draft"]], ["Geplant", ["approved", "publishing"]], ["Veröffentlicht", ["published"]], ["Fehler", ["failed"]]];
const PLATFORM = { instagram: "Instagram", facebook: "Facebook" };
const LOCKED = ["approved", "publishing", "published"];

export function createSocial({ S, render, toast, errorText, appName, appBadge = () => "" }) {
  S.social = { value: null, loading: false, error: null, filter: "all", editor: null, mode: savedMode(), month: null, review: null, stats: null, statsDays: 28, statsSort: "views" };
  let unsubscribe = null;
  let reloadTimer;

  // ---------- data ----------
  async function load(force = false) {
    const st = S.social;
    if (!data.socialConfigured() || st.loading || (st.value && !force)) return;
    st.loading = true;
    try {
      st.value = await data.loadSocial();
      st.error = null;
      if (!unsubscribe) unsubscribe = data.subscribe(() => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => load(true), 300); });
    } catch (err) {
      st.error = err;
    }
    st.loading = false;
    if (!S.social.editor || !document.activeElement?.closest?.(".soc-editor")) render();
  }

  const accounts = () => S.social.value?.accounts ?? [];
  const posts = () => S.social.value?.posts ?? [];
  const places = () => S.social.value?.locations ?? [];
  // not yet published post that looks like something already on Instagram → warning
  const twinOf = (p) => (["draft", "approved", "failed"].includes(p.status) ? findPublishedTwin(p, S.social.value?.published ?? []) : null);
  const twinHtml = (t) => (t ? `<p class="error small dupe">⚠️ Sieht aus wie schon veröffentlicht${t.posted_at ? ` am ${esc(formatZurichDate(t.posted_at))}` : ""}${t.permalink ? ` – <a href="${esc(t.permalink)}" target="_blank" rel="noopener">auf Instagram ansehen</a>` : ""}. Nicht doppelt freigeben – lieber löschen.</p>` : "");
  // package location (name or id) → { id, name } of a saved place, or null
  const resolvePlace = (loc) => {
    if (!loc) return null;
    if (loc.id) return { id: loc.id, name: loc.name || places().find((p) => p.page_id === loc.id)?.name || loc.id };
    const p = places().find((x) => x.name.toLowerCase() === loc.name.toLowerCase());
    return p ? { id: p.page_id, name: p.name } : null;
  };
  const account = (id) => accounts().find((a) => a.id === id);
  const accountLabel = (a) => (a ? `${appName(a.app_id)} · ${PLATFORM[a.platform] ?? a.platform} @${a.handle}` : "Unbekanntes Konto");
  const daysLeft = (iso) => (iso ? Math.floor((new Date(iso) - Date.now()) / 864e5) : null);
  const firstLines = (text, n = 3) => String(text ?? "").split("\n").filter(Boolean).slice(0, n).join("\n");

  // ---------- overview card + badge ----------
  function overviewCard() {
    if (!data.socialConfigured()) return "";
    const st = S.social;
    if (!st.value) return `<section class="card"><div class="card-head"><span class="dot dot-social"></span><div><h2>Social</h2><p class="muted">Beiträge aller Apps</p></div></div>${st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : `<p class="muted loading">Lädt …</p>`}</section>`;
    const planned = posts().filter((p) => p.status === "approved").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const failed = posts().filter((p) => p.status === "failed").length;
    const drafts = posts().filter((p) => p.status === "draft").length;
    const expiring = accounts().filter((a) => a.active && daysLeft(a.token_expires_at) !== null && daysLeft(a.token_expires_at) < 14);
    const tile = (label, value, sub, alert) => `<a class="tile${alert ? " alert" : ""}" href="#social"><span class="tile-label">${label}</span><span class="tile-num">${value}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ""}</a>`;
    return `<section class="card"><div class="card-head"><span class="dot dot-social"></span><div><h2>Social</h2><p class="muted">Beiträge aller Apps</p></div></div>
      <div class="tiles">
        ${tile("Geplant", num(planned.length), planned[0] ? `nächster: ${formatZurich(planned[0].scheduled_at)}` : "", false)}
        ${tile("Entwürfe", num(drafts), "", false)}
        ${tile("Fehler", num(failed), "", failed > 0)}
        ${expiring.length ? tile("Token läuft ab", num(expiring.length), expiring.map((a) => `@${a.handle}: ${daysLeft(a.token_expires_at)} Tage`).join(", "), true) : ""}
      </div></section>`;
  }
  const badge = () => posts().filter((p) => p.status === "failed").length;

  // ---------- list ----------
  function view() {
    if (!data.socialConfigured()) {
      return `<section class="card"><h2>Social</h2><p class="note">QNH Core ist noch nicht eingerichtet. Anleitung: <code>docs/social-setup.md</code>.</p></section>`;
    }
    const st = S.social;
    if (st.editor) return editorView(st.editor);
    if (!st.value) return st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    const apps = [...new Set(accounts().map((a) => a.app_id))];
    const shown = posts().filter((p) => st.filter === "all" || account(p.account_id)?.app_id === st.filter);
    const chips = [["all", "Alle Apps"], ...apps.map((id) => [id, appName(id)])]
      .map(([v, l]) => `<button class="chip${v === "all" ? "" : " chip-app"}${st.filter === v ? " on" : ""}" data-action="soc-filter" data-value="${esc(v)}" title="${esc(l)}">${v === "all" ? "" : appBadge(v)}${esc(l)}</button>`).join("");
    const accountRows = accounts().map((a) => {
      const left = daysLeft(a.token_expires_at);
      const token = left === null ? "Token: Ablauf unbekannt" : left < 0 ? "Token abgelaufen" : `Token gültig bis ${formatZurichDate(a.token_expires_at)}`;
      return `<li><b>${esc(accountLabel(a))}</b>${a.active ? "" : " (inaktiv)"} <span class="${left !== null && left < 14 ? "warn" : "muted"}">· ${esc(token)}</span></li>`;
    }).join("");
    const modes = [["list", "Liste"], ["calendar", "Kalender"], ["stats", "Statistik"]].map(([v, l]) =>
      `<button class="chip${st.mode === v ? " on" : ""}" data-action="soc-mode" data-value="${v}">${l}</button>`).join("");
    return `<div class="toolbar"><div class="chips">${modes}<span class="chip-sep"></span>${chips}</div>
        <div class="row-right">
          ${reviewQueue().length ? `<button class="btn" data-action="soc-review">Freigabe-Runde (${reviewQueue().length})</button>` : ""}
          <button class="btn ghost" data-action="soc-pick-package">Paket importieren</button>
          <button class="btn" data-action="soc-new"${accounts().length ? "" : " disabled"}>Neuer Beitrag</button>
        </div></div>
      ${accounts().length ? `<ul class="accounts">${accountRows}</ul>` : `<p class="note">Noch kein Konto verbunden (docs/social-setup.md, Schritt «Konto eintragen»).</p>`}
      ${st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : ""}
      ${st.mode === "stats" ? statsView() : st.mode === "calendar" ? calendarView(shown) : GROUPS.map(([title, statuses]) => {
        const rows = shown.filter((p) => statuses.includes(p.status))
          .sort((a, b) => (title === "Veröffentlicht" ? byTime(b, a, "published_at") : byTime(a, b, "scheduled_at")));
        return `<h3 class="group">${title} <span class="muted">${rows.length}</span></h3>${rows.length ? rows.map(postItem).join("") : `<p class="muted small">–</p>`}`;
      }).join("")}`;
  }

  // ---------- statistics ----------
  const STAT_COLS = [["views", "Views"], ["reach", "Reichweite"], ["likes", "Likes"], ["comments", "Kommentare"], ["saved", "Gespeichert"], ["shares", "Geteilt"], ["follows", "Neue Follower"]];
  const KIND_LABEL = { FEED: "Bild", CAROUSEL: "Karussell", REELS: "Reel", STORY: "Story" };
  async function loadStats(force = false) {
    const st = S.social;
    if (st.stats?.loading || (st.stats?.value && !force && st.stats.days === st.statsDays)) return;
    st.stats = { loading: true, value: st.stats?.value, days: st.statsDays };
    render();
    try { st.stats = { value: await data.loadStats(st.statsDays), days: st.statsDays }; }
    catch (err) { st.stats = { error: err, days: st.statsDays }; }
    render();
  }
  function statsView() {
    const st = S.social;
    if (!st.stats || st.stats.days !== st.statsDays) { setTimeout(() => loadStats(), 0); return `<p class="muted loading">Lädt Statistik …</p>`; }
    if (st.stats.error) {
      const missing = /does not exist|could not find/i.test(errorText(st.stats.error));
      return `<p class="${missing ? "note" : "error"}">${missing ? "Die Statistik ist noch nicht eingerichtet (Migration 20261019120000_social_stats.sql)." : esc(errorText(st.stats.error))}</p>`;
    }
    if (!st.stats.value) return `<p class="muted loading">Lädt Statistik …</p>`;
    const { accountDays, mediaDays } = st.stats.value;
    const accs = accounts().filter((a) => st.filter === "all" || a.app_id === st.filter);
    const daysChips = [[7, "7 Tage"], [28, "28 Tage"], [90, "90 Tage"]].map(([d, l]) => `<button class="chip${st.statsDays === d ? " on" : ""}" data-action="soc-stats-days" data-value="${d}">${l}</button>`).join("");
    const head = `<div class="cal-head"><div class="chips">${daysChips}</div>
      <button class="btn ghost" data-action="soc-stats-refresh"${st.stats.loading ? " disabled" : ""}>${st.stats.loading ? "Holt Zahlen …" : "Jetzt aktualisieren"}</button></div>`;
    const blocks = accs.map((acc) => {
      const series = accountDays.filter((d) => d.account_id === acc.id);
      const last = series.at(-1)?.metrics ?? {}, first = series[0]?.metrics ?? {};
      const sum = (k) => series.reduce((s, d) => s + (Number(d.metrics[k]) || 0), 0);
      const latest = new Map();
      for (const m of mediaDays.filter((x) => x.account_id === acc.id)) latest.set(m.media_id, m);
      const since = new Date(Date.now() - st.statsDays * 864e5).toISOString();
      const media = [...latest.values()].filter((m) => !m.posted_at || m.posted_at >= since)
        .sort((a, b) => (Number(b.metrics[st.statsSort]) || 0) - (Number(a.metrics[st.statsSort]) || 0));
      const delta = last.followers_count != null && first.followers_count != null ? last.followers_count - first.followers_count : null;
      const followerSeries = series.map((d) => d.metrics.followers_count).filter((v) => v != null);
      const tile = (label, value, sub = "") => `<div class="stat-tile"><span class="muted small">${label}</span><b>${value}</b>${sub ? `<span class="small muted">${sub}</span>` : ""}</div>`;
      if (!series.length && !media.length) return `<section class="card"><h3>${appBadge(acc.app_id)} @${esc(acc.handle)}</h3><p class="muted">Noch keine Zahlen. Sie werden täglich um ca. 06:23 abgeholt – oder jetzt mit «Jetzt aktualisieren».</p></section>`;
      return `<section class="card stats-card"><h3>${appBadge(acc.app_id)} @${esc(acc.handle)}</h3>
        <div class="stat-tiles">
          ${tile("Follower", last.followers_count ?? "–", delta != null ? `${delta >= 0 ? "+" : ""}${delta} in ${st.statsDays} Tagen` : "")}
          ${tile("Reichweite", num(sum("reach")), "erreichte Konten, Summe")}
          ${tile("Views", num(sum("views")))}
          ${tile("Interaktionen", num(sum("total_interactions")), `${num(sum("profile_links_taps"))} Link-Taps`)}
        </div>
        ${followerSeries.length > 1 ? `<div class="stats-spark"><span class="muted small">Follower-Verlauf</span>${sparkSvg(followerSeries, "line")}</div>` : `<p class="muted small">Follower-Verlauf erscheint ab dem zweiten Tag. Manche Werte liefert Instagram erst ab 100 Followern.</p>`}
        ${media.length ? `<div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>Beitrag</th>${STAT_COLS.map(([k, l]) => `<th><button class="link${st.statsSort === k ? " on" : ""}" data-action="soc-stats-sort" data-value="${k}">${l}${st.statsSort === k ? " ▾" : ""}</button></th>`).join("")}</tr></thead>
          <tbody>${media.map((m) => `<tr><td><a href="${esc(m.permalink ?? "#")}" target="_blank" rel="noopener">${esc(m.caption.split("\n")[0].slice(0, 60) || "(ohne Text)")}</a><br><span class="muted small">${esc(KIND_LABEL[m.kind] ?? m.kind)} · ${m.posted_at ? esc(formatZurichDate(m.posted_at)) : ""}</span></td>${STAT_COLS.map(([k]) => `<td>${m.metrics[k] == null ? "–" : num(m.metrics[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted">Keine Beiträge in diesem Zeitraum.</p>`}
      </section>`;
    }).join("");
    return `${head}${blocks}<p class="hint">Zahlen von Instagram, einmal täglich abgeholt (Verzögerung bis 48 h). Nach einer Spalte sortieren: Spaltentitel antippen.</p>`;
  }

  // ---------- calendar (month view, Swiss time) ----------
  function savedMode() {
    try { const m = localStorage.getItem("qnh-social-mode"); return ["calendar", "stats"].includes(m) ? m : "list"; } catch { return "list"; }
  }
  const dayKey = (iso) => (iso ? utcToZurichLocal(iso).slice(0, 10) : null);
  const todayKey = () => dayKey(new Date().toISOString());

  function calendarView(list) {
    const st = S.social;
    const month = st.month ?? todayKey().slice(0, 7);
    const [y, mo] = month.split("-").map(Number);
    const startDow = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // Monday first
    let cells = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(y, mo - 1, 1 + i - startDow)).toISOString().slice(0, 10));
    if (cells[35].slice(0, 7) !== month) cells = cells.slice(0, 35);
    const byDay = new Map();
    for (const p of list) {
      const k = dayKey(p.published_at ?? p.scheduled_at);
      if (k) byDay.set(k, [...(byDay.get(k) ?? []), p]);
    }
    const title = new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, 15)));
    const shift = (n) => new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
    const today = todayKey();
    const unplanned = list.filter((p) => !p.scheduled_at && !p.published_at).length;
    const dayHtml = (k) => {
      const dayPosts = (byDay.get(k) ?? []).sort((a, b) => String(a.published_at ?? a.scheduled_at).localeCompare(String(b.published_at ?? b.scheduled_at)));
      const chips = dayPosts.map((p) => {
        const a = account(p.account_id);
        const movable = ["draft", "failed", "approved"].includes(p.status);
        const time = utcToZurichLocal(p.published_at ?? p.scheduled_at).slice(11, 16);
        return `<button class="cal-post ${p.status}" data-action="soc-open" data-id="${p.id}"${movable ? ` draggable="true" data-cal-post="${p.id}"` : ""} title="${esc((firstLines(p.caption, 1) || KINDS[p.kind]) + (todoOpen(p.todo) ? `\n\nVon Hand: ${p.todo}` : ""))}"><b>${esc(time)}</b>${todoOpen(p.todo) ? " ✋" : ""} ${esc(KINDS[p.kind])} · @${esc(a?.handle ?? "")}</button>`;
      }).join("");
      const cls = `cal-day${k.slice(0, 7) !== month ? " other" : ""}${k === today ? " today" : ""}${k < today ? " past" : ""}`;
      const add = k >= today ? `<button class="cal-add" data-action="soc-new-on" data-value="${k}" aria-label="Neuer Beitrag am ${k}">+</button>` : "";
      return `<div class="${cls}" data-cal-day="${k}"><span class="cal-num">${Number(k.slice(8))}</span>${add}${chips}</div>`;
    };
    return `<div class="cal-head">
        <button class="icon-mini" data-action="soc-month" data-value="${shift(-1)}" aria-label="Vormonat">‹</button>
        <h3>${esc(title)}</h3>
        <button class="icon-mini" data-action="soc-month" data-value="${shift(1)}" aria-label="Nächster Monat">›</button>
        <button class="chip" data-action="soc-month" data-value="${today.slice(0, 7)}">Heute</button>
        ${unplanned ? `<span class="muted small">${unplanned} ohne Datum – siehe Liste</span>` : ""}
      </div>
      <div class="cal">${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}${cells.map(dayHtml).join("")}</div>
      <p class="hint">Entwürfe und geplante Beiträge auf einen anderen Tag ziehen (die Uhrzeit bleibt). «+» legt einen Beitrag für diesen Tag an.</p>`;
  }

  async function reschedule(id, day) {
    const p = posts().find((x) => x.id === id);
    if (!p || p.status === "published" || p.status === "publishing") return;
    const time = p.scheduled_at ? utcToZurichLocal(p.scheduled_at).slice(11, 16) : "18:00";
    const iso = zurichToUtc(`${day}T${time}`);
    if (new Date(iso).getTime() < Date.now()) return toast("Dieser Zeitpunkt liegt in der Vergangenheit.");
    try {
      if (p.status === "approved") {
        if (!confirm(`Geplanten Beitrag auf ${formatZurich(iso)} verschieben? Er bleibt freigegeben.`)) return;
        await data.setStatus(id, "draft");
        await data.setStatus(id, "approved", iso);
      } else {
        await data.updatePost(id, { scheduled_at: iso });
      }
      toast(`Verschoben auf ${formatZurich(iso)}`);
      await load(true);
    } catch (err) {
      toast(errorText(err));
    }
  }

  function thumb(item, cls = "thumb") {
    if (!item) return `<span class="${cls} empty"></span>`;
    const src = item.url ?? data.mediaUrl(item.path);
    if (!/^video\//.test(item.type)) return `<img class="${cls}" src="${esc(src)}" alt="${esc(item.alt ?? "")}" loading="lazy">`;
    // phone preview: playable with sound and controls (cover as poster); elsewhere a still frame with ▶
    const poster = item.poster ? ` poster="${esc(item.poster)}"` : "";
    if (cls.includes("phone-img")) return `<video class="${cls}" src="${esc(src)}" controls playsinline loop preload="metadata"${poster}></video>`;
    return `<span class="video-thumb"><video class="${cls}" src="${esc(src)}#t=0.5" muted playsinline preload="metadata"${poster}></video><span class="play" aria-hidden="true">▶</span></span>`;
  }

  // "what Christoph still does by hand in Instagram" – shown unless it says there is nothing to do
  const todoOpen = (t) => Boolean(t?.trim()) && !/^nichts\b/i.test(t.trim());
  // "Bild s1-beta" → link to the story image (save it on the phone); web addresses → link + copy button for link stickers
  function todoHtml(t) {
    return esc(t.trim())
      .replace(/https?:\/\/[^\s<«»]+[^\s<«».,;:!?)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a> <button class="link copy" data-action="soc-copy" data-value="${u}">kopieren</button>`)
      .replace(/\bBild ([a-z]\d{0,2}-[a-z0-9-]+)/gi, (m, name) => `<a class="asset" href="${esc(data.assetUrl(name.toLowerCase()))}" target="_blank" rel="noopener">Bild ${esc(name)} ⤓</a>`);
  }
  // step-by-step help for the recurring hand jobs, shown under the note when it mentions them
  const HOWTO = [
    [/anpinnen|anheften|pin (the )?comment/i, /kommentar/i, "Ersten Kommentar anpinnen", [
      "Den veröffentlichten Beitrag in der Instagram-App öffnen (Profil → Beitrag antippen).",
      "Unter dem Beitrag auf die Sprechblase 💬 tippen – die Kommentare öffnen sich.",
      "Deinen ersten Kommentar suchen (der mit den Hashtags).",
      "iPhone: den Kommentar nach links wischen. Android: den Kommentar gedrückt halten.",
      "Auf die Stecknadel 📌 tippen und mit «Anpinnen» bestätigen. Er steht jetzt oben.",
    ]],
    [/story/i, /teilen|hinzufügen|share/i, "Beitrag in die Story teilen", [
      "Den veröffentlichten Beitrag bzw. das Reel in der Instagram-App öffnen.",
      "Auf den Papierflieger ✈️ (Teilen) tippen – beim Reel rechts, beim Bild unter dem Beitrag.",
      "«Zu Story hinzufügen» wählen (manchmal «Zu deiner Story hinzufügen»).",
      "Optional: Beitrag mit zwei Fingern grösser ziehen, Text oder Sticker ergänzen – steht im To-do, welcher.",
      "Unten links auf «Deine Story» tippen – fertig. Wer die Story antippt, kommt direkt zum Beitrag.",
    ]],
    [/profil/i, /fixier|anpinn|pin/i, "Im Profil fixieren", [
      "Den veröffentlichten Beitrag in der Instagram-App öffnen.",
      "Auf die drei Punkte ⋯ tippen – beim Bild oben rechts, beim Reel unten rechts.",
      "«In deinem Profil fixieren» wählen. Der Beitrag steht jetzt oben in deinem Raster (höchstens 3).",
      "Alten fixierten Beitrag lösen: dort ⋯ → «Fixierung aufheben».",
    ]],
    [/highlight/i, /./, "Story ins Highlight legen", [
      "Die Story zuerst wie oben posten.",
      "Die eigene Story öffnen (Profilbild antippen) → unten rechts «Highlight» (Herz-Symbol).",
      "Das genannte Highlight wählen (z. B. «Beta») – oder «Neu» und den Namen eingeben.",
    ]],
  ];
  function howtoHtml(t) {
    const found = HOWTO.filter(([a, b]) => String(t).split("\n").some((line) => a.test(line) && b.test(line)));
    return found.map(([, , title, steps]) => `<details class="howto"><summary>So geht's: ${title}</summary><ol>${steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></details>`).join("");
  }
  const todoBox = (t) => (todoOpen(t) ? `<div class="soc-todo"><b>Selbst in Instagram erledigen</b><p>${todoHtml(t)}</p>${howtoHtml(t)}</div>` : "");

  function postItem(p) {
    const a = account(p.account_id);
    const when = p.status === "published" ? p.published_at : p.scheduled_at;
    const btn = (action, label, ghost = true) => `<button class="btn${ghost ? " ghost" : ""}" data-action="${action}" data-id="${p.id}">${label}</button>`;
    const actions = [];
    if (p.status === "draft" || p.status === "failed") actions.push(btn("soc-open", "Bearbeiten", false));
    else actions.push(btn("soc-open", "Ansehen"));
    if (p.status === "approved") actions.push(btn("soc-withdraw", "Zurückziehen"));
    if (["draft", "approved", "failed"].includes(p.status)) actions.push(btn("soc-publish-now", "Jetzt veröffentlichen"));
    actions.push(btn("soc-duplicate", "Duplizieren"));
    if (p.permalink) actions.push(`<a class="btn ghost" href="${esc(p.permalink)}" target="_blank" rel="noopener">Auf ${PLATFORM[a?.platform] ?? "Instagram"} öffnen</a>`);
    if (p.status === "draft") actions.push(btn("soc-delete", "Löschen"));
    return `<article class="item soc-item">
      ${p.media_deleted_at ? `<span class="thumb empty"></span>` : thumb(p.media?.[0])}
      <div>
        <div class="meta"><b>${esc(accountLabel(a))}</b><span>${KINDS[p.kind] ?? p.kind}${p.media?.length > 1 ? ` · ${p.media.length} Dateien` : ""}</span>
          <span>${when ? esc(formatZurich(when)) : "kein Zeitpunkt"}</span><span class="pill ${p.status}">${STATUS[p.status] ?? p.status}</span>
          ${p.source === "package" ? `<span class="muted">aus Paket</span>` : ""}
          ${p.location?.name ? `<span class="muted">📍 ${esc(p.location.name)}</span>` : ""}
          ${(() => { const who = [...new Set((p.media ?? []).flatMap((m) => (m.user_tags ?? []).map((t) => "@" + t.username)))]; return who.length ? `<span class="muted">markiert: ${esc(who.join(", "))}</span>` : ""; })()}</div>
        <p class="text">${esc(firstLines(p.caption, 2) || (p.kind === "story" ? "(Story ohne Text)" : "(kein Text)"))}</p>
        ${twinHtml(twinOf(p))}
        ${todoBox(p.todo)}
        ${p.last_error ? `<p class="error small">${esc(p.last_error)}</p>` : ""}
        <div class="actions">${actions.join("")}</div>
      </div>
    </article>`;
  }

  // ---------- editor ----------
  function tomorrowAt18() {
    const local = utcToZurichLocal(new Date(Date.now() + 864e5).toISOString());
    return `${local.slice(0, 10)}T18:00`;
  }

  // ---------- review round: drafts one after another, oldest date first ----------
  // review = { skipped: Set<id>, done: n } while the round runs
  // chronological by a timestamp field (as dates, so "…Z" and "…+00:00" compare correctly); posts without one last
  function byTime(a, b, field) {
    const ta = a[field] ? new Date(a[field]).getTime() : Infinity, tb = b[field] ? new Date(b[field]).getTime() : Infinity;
    return ta === tb ? String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) : ta - tb;
  }

  function reviewQueue() {
    const st = S.social;
    return posts()
      .filter((p) => p.status === "draft" && (st.filter === "all" || account(p.account_id)?.app_id === st.filter))
      .sort((a, b) => byTime(a, b, "scheduled_at"));
  }
  function nextInReview(currentId) {
    const st = S.social;
    const next = reviewQueue().find((p) => p.id !== currentId && !st.review.skipped.has(p.id));
    if (next) return openEditor(next);
    toast(`Freigabe-Runde fertig: ${st.review.done} freigegeben${st.review.skipped.size ? `, ${st.review.skipped.size} für später` : ""}.`);
    st.review = null;
    st.editor = null;
    render();
  }

  function openEditor(post, { duplicate = false } = {}) {
    const fallback = accounts().find((a) => S.social.filter === "all" || a.app_id === S.social.filter) ?? accounts()[0];
    const items = (post?.media ?? []).map((m) => (duplicate ? { ...m, copyFrom: m.path, path: null } : { ...m }));
    S.social.editor = {
      id: post && !duplicate ? post.id : crypto.randomUUID(),
      isNew: !post || duplicate,
      status: post && !duplicate ? post.status : "draft",
      account_id: post?.account_id ?? fallback?.id,
      kind: post?.kind ?? "image",
      caption: post?.caption ?? "",
      first_comment: post?.first_comment ?? "",
      todo: duplicate ? "" : post?.todo ?? "",
      location: post?.location ?? null,
      scheduledLocal: post?.scheduled_at ? utcToZurichLocal(post.scheduled_at) : tomorrowAt18(),
      items,
      cover: post?.cover_path ? (duplicate ? { copyFrom: post.cover_path, type: "image/jpeg" } : { path: post.cover_path, type: "image/jpeg" }) : null,
      source: duplicate ? "duplicate" : post?.source ?? "editor",
      permalink: duplicate ? null : post?.permalink,
      last_error: duplicate ? null : post?.last_error,
      mediaDeleted: !duplicate && !!post?.media_deleted_at,
      dirty: duplicate,
      busy: false,
      preview: 0,
    };
    render();
    window.scrollTo(0, 0);
  }

  const readonly = (ed) => !ed.isNew && LOCKED.includes(ed.status);
  const checks = (ed, forApproval = false) =>
    validatePost({ kind: ed.kind, items: ed.items, caption: ed.caption, first_comment: ed.first_comment },
      { forApproval, scheduledAt: zurichToUtc(ed.scheduledLocal) });

  function checksHtml(ed) {
    const { errors, warnings } = checks(ed);
    if (!errors.length && !warnings.length) return `<p class="ok small">Alles in Ordnung.</p>`;
    return `${errors.map((e) => `<p class="error small">✗ ${esc(e)}</p>`).join("")}${warnings.map((w) => `<p class="warn small">! ${esc(w)}</p>`).join("")}`;
  }

  function counterHtml(ed) {
    const tags = countHashtags(ed.caption);
    const cls = ed.caption.length > LIMITS.caption || tags > LIMITS.hashtagsMax ? "error" : tags > LIMITS.hashtagsWarn ? "warn" : "muted";
    return `<span class="${cls}">${ed.caption.length} / ${LIMITS.caption} Zeichen · ${tags} Hashtag${tags === 1 ? "" : "s"}</span>`;
  }

  function editorView(ed) {
    const ro = readonly(ed);
    const dis = ro || ed.busy ? " disabled" : "";
    const acc = account(ed.account_id);
    const kinds = Object.entries(KINDS).map(([k, l]) =>
      `<button class="chip${ed.kind === k ? " on" : ""}" data-action="soc-kind" data-value="${k}"${dis}>${l}</button>`).join("");
    const accept = ed.kind === "image" ? ".jpg,.jpeg,image/jpeg" : ed.kind === "reel" ? "video/mp4,video/quicktime" : ".jpg,.jpeg,image/jpeg,video/mp4,video/quicktime";
    const itemsHtml = ed.items.map((it, i) => `<li class="soc-file">
        ${thumb({ ...it, url: it.url ?? (it.path ? data.mediaUrl(it.path) : it.copyFrom ? data.mediaUrl(it.copyFrom) : undefined) }, "thumb small")}
        <div><span class="small muted">${/^video\//.test(it.type) ? "Video" : "Bild"} · ${aspectLabel(it.width, it.height)}${it.width ? ` · ${it.width}×${it.height}` : ""}${it.duration ? ` · ${Math.round(it.duration)} s` : ""}${it.size ? ` · ${(it.size / 1048576).toFixed(1)} MB` : ""}</span>
          ${/^video\//.test(it.type) ? "" : `<input name="soc-alt-${i}" placeholder="Alternativtext (für Screenreader)" value="${esc(it.alt ?? "")}" maxlength="${LIMITS.alt}"${dis}>
          ${ed.kind === "image" || ed.kind === "carousel" ? `<label class="tag-field">Markieren <input name="soc-tags-${i}" placeholder="@benutzername, …" value="${esc((it.user_tags ?? []).map((t) => "@" + t.username).join(", "))}"${dis}></label>` : ""}`}</div>
        ${ro ? "" : `<button class="link" data-action="soc-remove" data-value="${i}">Entfernen</button>`}
      </li>`).join("");
    const actions = [];
    if (!ro) {
      actions.push(`<button class="btn ghost" data-action="soc-save"${dis}>Speichern (Entwurf)</button>`);
      actions.push(`<button class="btn" data-action="soc-approve"${dis}>Freigeben …</button>`);
    }
    if (!ed.isNew && ed.status === "approved") actions.push(`<button class="btn ghost" data-action="soc-withdraw" data-id="${ed.id}"${ed.busy ? " disabled" : ""}>Zurückziehen</button>`);
    if (["draft", "approved", "failed"].includes(ed.status)) actions.push(`<button class="btn ghost" data-action="soc-publish-now" data-id="${ed.id}"${ed.busy ? " disabled" : ""}>Jetzt veröffentlichen …</button>`);
    if (!ed.isNew) actions.push(`<button class="btn ghost" data-action="soc-duplicate" data-id="${ed.id}">Duplizieren</button>`);
    if (ed.permalink) actions.push(`<a class="btn ghost" href="${esc(ed.permalink)}" target="_blank" rel="noopener">Auf Instagram öffnen</a>`);

    const rv = S.social.review;
    const rvBar = rv && !ed.isNew ? (() => {
      const queue = reviewQueue().filter((p) => !rv.skipped.has(p.id));
      return `<div class="review-bar"><b>Freigabe-Runde</b><span class="muted">${rv.done} freigegeben · noch ${queue.length} Entw${queue.length === 1 ? "urf" : "ürfe"}</span>
        <span class="row-right"><button class="btn ghost" data-action="soc-review-skip"${ed.busy ? " disabled" : ""}>Später freigeben ›</button></span></div>`;
    })() : "";
    return `${rvBar}<div class="toolbar"><button class="link" data-action="soc-close">${rv ? "← Runde beenden" : "← Zurück zur Liste"}</button>
        <span class="muted">${ed.isNew ? (ed.source === "duplicate" ? "Duplikat" : "Neuer Beitrag") : `${STATUS[ed.status] ?? ed.status}`}${ro ? " · zum Ändern zuerst zurückziehen oder duplizieren" : ""}</span></div>
      <section class="soc-editor">
        <div class="soc-form card">
          ${ed.last_error ? `<p class="error">${esc(ed.last_error)}</p>` : ""}
          ${ed.isNew ? "" : twinHtml(twinOf({ ...ed, remote_media_id: posts().find((p) => p.id === ed.id)?.remote_media_id }))}
          <label class="field">Konto
            <select name="soc-account"${dis}>${accounts().map((a) => `<option value="${a.id}"${a.id === ed.account_id ? " selected" : ""}>${esc(accountLabel(a))}</option>`).join("")}</select></label>
          <div class="field">Art<div class="chips">${kinds}</div></div>
          ${ed.mediaDeleted ? `<p class="note">Die Dateien wurden 14 Tage nach der Veröffentlichung gelöscht.</p>` : ""}
          ${ro ? "" : `<div class="dropzone" data-drop="files" data-action="soc-pick-files" role="button" tabindex="0">
              <b>${ed.kind === "carousel" ? "Bilder oder Videos" : ed.kind === "reel" ? "Video" : ed.kind === "story" ? "Bild oder Video" : "Bild"} hierher ziehen</b> oder klicken
              <span class="small muted">${ed.kind === "reel" || ed.kind === "story" ? "Hochformat 9:16" : "JPEG, 4:5 / 1:1 / 1.91:1"} · Videos als MP4 (H.264)</span></div>`}
          <ul class="soc-files">${itemsHtml}</ul>
          ${ed.kind === "reel" ? `<div class="field">Titelbild (optional, JPEG)
            ${ed.cover ? `<div class="soc-file">${thumb({ ...ed.cover, url: ed.cover.url ?? data.mediaUrl(ed.cover.path ?? ed.cover.copyFrom) }, "thumb small")}${ro ? "" : `<button class="link" data-action="soc-remove-cover">Entfernen</button>`}</div>`
              : ro ? `<span class="muted small">keines</span>` : `<button class="btn ghost" data-action="soc-pick-cover">Titelbild wählen</button>`}</div>` : ""}
          ${ed.kind === "story" ? "" : `<label class="field">Text <span class="counter" id="soc-counter">${counterHtml(ed)}</span>
            <textarea name="soc-caption" rows="7" maxlength="2400"${dis}>${esc(ed.caption)}</textarea></label>
          <label class="field">Erster Kommentar (optional, z. B. Hashtags)
            <textarea name="soc-comment" rows="2" maxlength="2400"${dis}>${esc(ed.first_comment)}</textarea></label>`}
          ${data.locationSupported() && ed.kind !== "story" ? `<label class="field">Standort (optional)
            <select name="soc-location"${dis}>
              <option value="">Kein Standort</option>
              ${[...places().map((p) => [p.page_id, p.name]), ...(ed.location && !places().some((p) => p.page_id === ed.location.id) ? [[ed.location.id, ed.location.name || ed.location.id]] : [])]
                .map(([v, l]) => `<option value="${esc(v)}"${ed.location?.id === v ? " selected" : ""}>${esc(l)}</option>`).join("")}
              <option value="__new">+ Neuen Ort hinzufügen …</option>
            </select></label>` : ""}
          <label class="field">Veröffentlichen am (Schweizer Zeit)
            <input type="datetime-local" name="soc-time" value="${esc(ed.scheduledLocal)}"${dis}></label>
          ${data.todoSupported() ? `<label class="field soc-todo-field"><span><b>Selbst in Instagram erledigen</b> <span class="muted small">– nur für dich, wird nicht veröffentlicht</span></span>
            ${todoOpen(ed.todo) ? `<p class="soc-todo-preview">${todoHtml(ed.todo)}</p>${howtoHtml(ed.todo)}` : ""}
            <textarea name="soc-todo" rows="3" maxlength="2000" placeholder="z. B. Am Vortag Story mit Umfrage-Sticker · @exploring_the_skies markieren · Standort setzen"${ed.busy ? " disabled" : ""}>${esc(ed.todo ?? "")}</textarea>
            ${ro ? `<button class="btn ghost" data-action="soc-save-todo"${ed.busy ? " disabled" : ""}>Notiz speichern</button>` : ""}</label>` : ""}
          <div id="soc-checks" class="soc-checks">${checksHtml(ed)}</div>
          <div class="actions">${actions.join("")}</div>
        </div>
        <aside class="soc-preview" id="soc-preview">${previewHtml(ed, acc)}</aside>
      </section>`;
  }

  function previewHtml(ed, acc) {
    const handle = acc?.handle ?? "konto";
    const it = ed.items[Math.min(ed.preview, ed.items.length - 1)];
    const src = (x) => ({ ...x, url: x.url ?? (x.path ? data.mediaUrl(x.path) : x.copyFrom ? data.mediaUrl(x.copyFrom) : undefined) });
    const slider = ed.kind === "carousel" && ed.items.length > 1;
    const media = slider
      ? `<div class="phone-track" data-slider>${ed.items.map((x) => `<div class="slide">${thumb(src(x), "phone-img")}</div>`).join("")}</div>
        <span class="phone-count">${ed.preview + 1}/${ed.items.length}</span>
        <button class="phone-nav prev" data-action="soc-slide" data-value="-1" aria-label="Vorheriges Bild">‹</button>
        <button class="phone-nav next" data-action="soc-slide" data-value="1" aria-label="Nächstes Bild">›</button>`
      : it ? thumb({ ...it, url: it.url ?? (it.path ? data.mediaUrl(it.path) : it.copyFrom ? data.mediaUrl(it.copyFrom) : undefined),
          poster: ed.kind === "reel" && ed.cover ? ed.cover.url ?? data.mediaUrl(ed.cover.path ?? ed.cover.copyFrom) : undefined }, "phone-img") : `<span class="phone-img empty">Noch keine Datei</span>`;
    const vertical = ed.kind === "story" || ed.kind === "reel";
    const shape = slider ? ed.items[0] : it;
    const ratio = vertical ? "9 / 16" : shape?.width ? `${shape.width} / ${shape.height}` : "4 / 5";
    const dots = ed.kind === "carousel" && ed.items.length > 1
      ? `<div class="phone-dots">${ed.items.map((_, i) => `<button class="${i === ed.preview ? "on" : ""}" data-action="soc-preview" data-value="${i}" aria-label="Datei ${i + 1}"></button>`).join("")}</div>` : "";
    const cap = ed.caption.length > 125 ? `${esc(ed.caption.slice(0, 125))}… <span class="muted">mehr</span>` : esc(ed.caption);
    return `<div class="phone${vertical ? " vertical" : ""}">
      <div class="phone-head"><span class="avatar"></span><b>${esc(handle)}</b>${ed.kind === "story" ? `<span class="muted small">Story</span>` : ""}</div>
      <div class="phone-media${slider ? " slider" : ""}" style="aspect-ratio:${ratio}">${media}</div>
      ${dots}
      ${vertical ? "" : `<div class="phone-caption"><b>${esc(handle)}</b> ${cap}</div>${ed.first_comment.trim() ? `<div class="phone-comment"><b>${esc(handle)}</b> ${esc(ed.first_comment.slice(0, 80))}</div>` : ""}`}
    </div>
    <p class="small muted">Vorschau, ungefähr wie auf dem iPhone. Instagram schneidet Feed-Bilder auf 4:5 bis 1.91:1 zu.</p>`;
  }

  function refreshBits() {
    const ed = S.social.editor;
    if (!ed) return;
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set("soc-counter", counterHtml(ed));
    set("soc-checks", checksHtml(ed));
    set("soc-preview", previewHtml(ed, account(ed.account_id)));
    syncSlider(false);
  }

  // ---------- carousel preview: swipe / arrows / dots ----------
  const track = () => document.querySelector("#soc-preview [data-slider]");
  function syncSlider(smooth) {
    const t = track(), ed = S.social.editor;
    if (!t || !ed) return;
    t.scrollTo({ left: ed.preview * t.clientWidth, behavior: smooth ? "smooth" : "instant" });
    markSlide();
  }
  function markSlide() {
    const ed = S.social.editor, box = document.getElementById("soc-preview");
    if (!ed || !box) return;
    box.querySelectorAll(".phone-dots button").forEach((b, i) => b.classList.toggle("on", i === ed.preview));
    const c = box.querySelector(".phone-count");
    if (c) c.textContent = `${ed.preview + 1}/${ed.items.length}`;
    box.querySelector(".phone-nav.prev")?.toggleAttribute("hidden", ed.preview === 0);
    box.querySelector(".phone-nav.next")?.toggleAttribute("hidden", ed.preview >= ed.items.length - 1);
  }
  function slideTo(i) {
    const ed = S.social.editor;
    if (!ed) return;
    ed.preview = Math.max(0, Math.min(ed.items.length - 1, i));
    if (track()) syncSlider(true); else refreshBits();
  }
  // swiping (touch, trackpad) scrolls the track; the slide in view becomes the current one
  function onScroll(e) {
    const t = e.target;
    if (!(t instanceof Element) || !t.matches("[data-slider]")) return false;
    const ed = S.social.editor;
    const i = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
    if (ed && i !== ed.preview) { ed.preview = i; markSlide(); }
    return true;
  }
  const afterRender = () => { if (S.social.editor) syncSlider(false); };

  async function probe(file) {
    const url = URL.createObjectURL(file);
    const base = { file, url, type: file.type || guessType(file.name), size: file.size, alt: "" };
    if (/^video\//.test(base.type)) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.src = url;
      await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 8000); });
      return { ...base, width: v.videoWidth || undefined, height: v.videoHeight || undefined, duration: Number.isFinite(v.duration) ? v.duration : undefined };
    }
    try {
      const bmp = await createImageBitmap(file);
      const r = { ...base, width: bmp.width, height: bmp.height };
      bmp.close();
      return r;
    } catch {
      return base;
    }
  }
  const guessType = (name) => (/\.jpe?g$/i.test(name) ? "image/jpeg" : /\.mp4$/i.test(name) ? "video/mp4" : /\.mov$/i.test(name) ? "video/quicktime" : "");

  async function addFiles(fileList) {
    const ed = S.social.editor;
    if (!ed || readonly(ed)) return;
    const added = await Promise.all([...fileList].map(probe));
    ed.items = ed.kind === "carousel" ? [...ed.items, ...added].slice(0, 12) : added.slice(0, 1);
    ed.preview = 0;
    ed.dirty = true;
    render();
  }

  // uploads new files / copies for duplicates, then inserts or updates the post (always as it is: draft/failed)
  async function persist(ed) {
    const media = [];
    for (const [i, it] of ed.items.entries()) {
      let path = it.path;
      if (it.file) path = await data.uploadFile(ed.id, it.file, i);
      else if (it.copyFrom) path = await data.copyFile(it.copyFrom, ed.id, it.type, i);
      media.push({ path, type: it.type, alt: it.alt ?? "", width: it.width ?? null, height: it.height ?? null, duration: it.duration ?? null,
        ...(it.user_tags?.length && !/^video\//.test(it.type) ? { user_tags: it.user_tags } : {}) });
      Object.assign(it, { path, file: undefined, copyFrom: undefined });
    }
    let cover_path = null;
    if (ed.kind === "reel" && ed.cover) {
      cover_path = ed.cover.path;
      if (ed.cover.file) cover_path = await data.uploadFile(ed.id, ed.cover.file, "cover");
      else if (ed.cover.copyFrom) cover_path = await data.copyFile(ed.cover.copyFrom, ed.id, "image/jpeg", "cover");
      Object.assign(ed.cover, { path: cover_path, file: undefined, copyFrom: undefined });
    }
    const row = {
      account_id: ed.account_id, kind: ed.kind, caption: ed.kind === "story" ? "" : ed.caption,
      first_comment: ed.kind === "story" ? "" : ed.first_comment, media, cover_path,
      scheduled_at: zurichToUtc(ed.scheduledLocal), source: ed.source, todo: ed.todo ?? "", location: ed.kind === "story" ? null : ed.location ?? null,
    };
    const saved = ed.isNew ? await data.insertPost(ed.id, row) : await data.updatePost(ed.id, row);
    ed.isNew = false;
    ed.dirty = false;
    ed.status = saved?.status ?? ed.status;
    return saved;
  }

  function confirmText(title, ed) {
    const acc = account(ed.account_id);
    const lines = firstLines(ed.caption) || (ed.kind === "story" ? "(Story)" : "(kein Text)");
    return `${title}\n\nKonto: ${accountLabel(acc)}\nArt: ${KINDS[ed.kind]}\nZeit: ${formatZurich(zurichToUtc(ed.scheduledLocal))}\n\n${lines}`;
  }

  async function busy(ed, fn) {
    ed.busy = true;
    render();
    try {
      await fn();
    } catch (err) {
      toast(errorText(err));
    }
    ed.busy = false;
    if (S.social.editor === ed) render();
  }

  const editorFor = (id) => {
    const ed = S.social.editor;
    if (ed && ed.id === id) return ed;
    const p = posts().find((x) => x.id === id);
    return p ? { id: p.id, isNew: false, status: p.status, account_id: p.account_id, kind: p.kind, caption: p.caption, first_comment: p.first_comment, scheduledLocal: utcToZurichLocal(p.scheduled_at), items: p.media, busy: false } : null;
  };

  async function publishNow(id) {
    const ed = editorFor(id);
    if (!ed) return;
    const now = new Date().toISOString();
    if (!ed.isNew || S.social.editor?.id === id) {
      const { errors } = checks({ ...ed, scheduledLocal: utcToZurichLocal(now) }, true);
      if (errors.length) return toast(errors[0]);
    }
    if (!confirm(confirmText("Jetzt veröffentlichen? Der Beitrag geht sofort online.", { ...ed, scheduledLocal: utcToZurichLocal(now) }))) return;
    await busy(ed, async () => {
      if (S.social.editor?.id === id && (ed.dirty || ed.isNew)) await persist(ed);
      if (ed.status === "approved") await data.setStatus(id, "draft");
      await data.setStatus(id, "approved", now);
      ed.status = "approved";
      toast("Wird veröffentlicht …");
      const results = await data.publishNow(id);
      const r = results.find((x) => x.id === id);
      if (r?.error) toast(r.error);
      else if (r?.status === "published") toast("Veröffentlicht");
      else if (r?.status === "processing") toast("Instagram verarbeitet das Video noch – der Status aktualisiert sich von selbst.");
      await load(true);
      if (S.social.editor?.id === id) S.social.editor.status = posts().find((p) => p.id === id)?.status ?? ed.status;
    });
  }

  // ---------- events (called from main.js) ----------
  async function onClick(action, el) {
    const st = S.social;
    const ed = st.editor;
    const id = el.dataset.id;
    switch (action) {
      case "soc-filter": st.filter = el.dataset.value; render(); return true;
      case "soc-stats-days": st.statsDays = Number(el.dataset.value); render(); return true;
      case "soc-stats-sort": st.statsSort = el.dataset.value; render(); return true;
      case "soc-stats-refresh":
        st.stats = { ...st.stats, loading: true }; render();
        try {
          const res = await data.refreshStats();
          const bad = res.filter((r) => r.status !== "ok");
          toast(bad.length ? `@${bad[0].account}: ${bad[0].error}` : "Statistik aktualisiert");
        } catch (err) { toast(errorText(err)); }
        st.stats = null; await loadStats(true); return true;
      case "soc-mode": st.mode = el.dataset.value; try { localStorage.setItem("qnh-social-mode", st.mode); } catch {} render(); return true;
      case "soc-month": st.month = el.dataset.value; render(); return true;
      case "soc-new-on":
        openEditor(null);
        if (S.social.editor) { S.social.editor.scheduledLocal = `${el.dataset.value}T18:00`; render(); }
        return true;
      case "soc-new": openEditor(null); return true;
      case "soc-open": openEditor(posts().find((p) => p.id === id)); return true;
      case "soc-duplicate": openEditor(posts().find((p) => p.id === id) ?? (ed && { ...ed, media: ed.items, scheduled_at: zurichToUtc(ed.scheduledLocal), cover_path: ed.cover?.path }), { duplicate: true }); return true;
      case "soc-close":
        if (ed?.dirty && !confirm("Änderungen verwerfen?")) return true;
        st.editor = null; st.review = null; render(); load(true); return true;
      case "soc-copy":
        try { await navigator.clipboard.writeText(el.dataset.value); toast("Link kopiert – im Story-Editor beim Link-Sticker einfügen"); }
        catch { prompt("Link kopieren:", el.dataset.value); }
        return true;
      case "soc-save-todo":
        await busy(ed, async () => { await data.setTodo(ed.id, ed.todo ?? ""); ed.dirty = false; toast("Notiz gespeichert"); await load(true); });
        return true;
      case "soc-review": {
        st.review = { skipped: new Set(), done: 0 };
        const first = reviewQueue()[0];
        if (first) openEditor(first); else st.review = null;
        return true;
      }
      case "soc-review-skip":
        if (ed?.dirty && !confirm("Änderungen verwerfen?")) return true;
        st.review.skipped.add(ed.id);
        nextInReview(ed.id);
        return true;
      case "soc-kind":
        if (ed && !readonly(ed)) { ed.kind = el.dataset.value; if (ed.kind !== "carousel") ed.items = ed.items.slice(0, 1); ed.dirty = true; render(); }
        return true;
      case "soc-remove": ed.items.splice(Number(el.dataset.value), 1); ed.preview = 0; ed.dirty = true; render(); return true;
      case "soc-remove-cover": ed.cover = null; ed.dirty = true; render(); return true;
      case "soc-preview": slideTo(Number(el.dataset.value)); return true;
      case "soc-slide": slideTo(ed.preview + Number(el.dataset.value)); return true;
      case "soc-save": {
        const { errors } = checks(ed);
        if (errors.length) { toast(`Noch nicht speicherbar: ${errors[0]}`); return true; }
        await busy(ed, async () => { await persist(ed); toast("Entwurf gespeichert"); await load(true); });
        return true;
      }
      case "soc-approve": {
        const { errors } = checks(ed, true);
        if (errors.length) { toast(errors[0]); refreshBits(); return true; }
        const twin = twinOf({ ...ed, remote_media_id: posts().find((p) => p.id === ed.id)?.remote_media_id });
        if (twin && !confirm(`Achtung: Dieser Beitrag sieht aus wie einer, der schon auf Instagram ist${twin.posted_at ? ` (${formatZurichDate(twin.posted_at)})` : ""}. Trotzdem freigeben?`)) return true;
        if (!confirm(confirmText("Diesen Beitrag freigeben? Er wird zur geplanten Zeit automatisch veröffentlicht.", ed))) return true;
        await busy(ed, async () => {
          await persist(ed);
          await data.setStatus(ed.id, "approved", zurichToUtc(ed.scheduledLocal));
          toast(`Freigegeben für ${formatZurich(zurichToUtc(ed.scheduledLocal))}`);
          st.editor = null;
          await load(true);
          if (st.review) { st.review.done++; nextInReview(ed.id); }
        });
        render();
        return true;
      }
      case "soc-withdraw":
        if (!confirm("Freigabe zurückziehen? Der Beitrag wird wieder ein Entwurf und nicht veröffentlicht.")) return true;
        try {
          await data.setStatus(id, "draft");
          if (ed?.id === id) ed.status = "draft";
          toast("Zurückgezogen");
          await load(true);
        } catch (err) { toast(errorText(err)); }
        render();
        return true;
      case "soc-delete":
        if (!confirm("Diesen Entwurf löschen?")) return true;
        try { await data.deletePost(id); toast("Gelöscht"); await load(true); } catch (err) { toast(errorText(err)); }
        return true;
      case "soc-publish-now": await publishNow(id); return true;
      case "soc-pick-package": {
        const files = await pickFiles(".zip,application/zip,.json,image/jpeg,video/mp4,video/quicktime", true);
        if (files.length) await importPackage(files);
        return true;
      }
      case "soc-pick-files": {
        if (!ed || readonly(ed)) return true;
        const accept = ed.kind === "image" ? ".jpg,.jpeg,image/jpeg" : ed.kind === "reel" ? "video/mp4,video/quicktime" : ".jpg,.jpeg,image/jpeg,video/mp4,video/quicktime";
        const files = await pickFiles(accept, ed.kind === "carousel");
        if (files.length) await addFiles(files);
        return true;
      }
      case "soc-pick-cover": {
        const [file] = await pickFiles(".jpg,.jpeg,image/jpeg", false);
        if (file && S.social.editor) { S.social.editor.cover = await probe(file); S.social.editor.dirty = true; render(); }
        return true;
      }
    }
    return false;
  }

  function onInput(e) {
    const ed = S.social.editor;
    const name = e.target.name ?? "";
    if (!ed || !name.startsWith("soc-")) return false;
    if (name === "soc-caption") ed.caption = e.target.value;
    else if (name === "soc-comment") ed.first_comment = e.target.value;
    else if (name === "soc-todo") { ed.todo = e.target.value; ed.dirty = true; return true; }
    else if (name === "soc-time") ed.scheduledLocal = e.target.value;
    else if (name.startsWith("soc-alt-")) ed.items[Number(name.slice(8))].alt = e.target.value;
    else if (name.startsWith("soc-tags-")) { const it = ed.items[Number(name.slice(9))]; it.user_tags = parseTagList(e.target.value, it.user_tags); }
    else return false;
    ed.dirty = true;
    refreshBits();
    return true;
  }

  async function onChange(e) {
    const name = e.target.name ?? "";
    const ed = S.social.editor;
    if (name === "soc-account" && ed) { ed.account_id = e.target.value; ed.dirty = true; refreshBits(); return true; }
    if (name === "soc-location" && ed) {
      const v = e.target.value;
      if (v !== "__new") { const p = places().find((x) => x.page_id === v); ed.location = v ? { id: v, name: p?.name ?? ed.location?.name ?? v } : null; ed.dirty = true; return true; }
      const placeName = prompt("Name des Ortes (so erscheint er in deiner Liste), z. B. «Flugplatz Birrfeld»:")?.trim();
      const raw = placeName ? prompt("Facebook-Seiten-ID des Ortes (nur Ziffern) – oder den Link zur Facebook-Seite, wenn er «?id=…» enthält:")?.trim() : "";
      const pageId = (raw ?? "").match(/(?:[?&]id=)?(\d{5,25})/)?.[1];
      if (!placeName || !pageId) { if (placeName) toast("Keine gültige ID gefunden – siehe Anleitung «Standort» in docs/social-setup.md."); render(); return true; }
      try {
        await data.addLocation(pageId, placeName);
        ed.location = { id: pageId, name: placeName };
        ed.dirty = true;
        await load(true);
        toast(`Ort «${placeName}» gespeichert`);
      } catch (err) { toast(errorText(err)); }
      render();
      return true;
    }
    return false;
  }

  function onDragStart(e) {
    const chip = e.target.closest?.("[data-cal-post]");
    if (!chip) return false;
    e.dataTransfer.setData("text/x-post", chip.dataset.calPost);
    e.dataTransfer.effectAllowed = "move";
    return true;
  }

  function onDrop(e) {
    const day = e.target.closest?.("[data-cal-day]");
    if (day && [...(e.dataTransfer?.types ?? [])].includes("text/x-post")) {
      e.preventDefault();
      day.classList.remove("over");
      reschedule(e.dataTransfer.getData("text/x-post"), day.dataset.calDay);
      return true;
    }
    const zone = e.target.closest?.("[data-drop]");
    if (!zone) return false;
    e.preventDefault();
    zone.classList.remove("over");
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    return true;
  }
  function onDragOver(e) {
    const day = e.target.closest?.("[data-cal-day]");
    if (day && [...(e.dataTransfer?.types ?? [])].includes("text/x-post")) {
      e.preventDefault();
      day.classList.add("over");
      return true;
    }
    const zone = e.target.closest?.("[data-drop]");
    if (!zone) return false;
    e.preventDefault();
    zone.classList.add("over");
    return true;
  }

  // File dialogs use a fresh input outside the rendered page: the page may re-render while the dialog is open
  // (e.g. a data refresh when the window gets focus back), and a replaced input would lose the selection.
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement("input"), { type: "file", accept, multiple, hidden: true });
      const done = (files) => { input.remove(); resolve(files); };
      input.addEventListener("change", () => done([...input.files]), { once: true });
      input.addEventListener("cancel", () => done([]), { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  // ---------- post packages (S4) ----------
  async function importPackage(fileList) {
    try {
      const pkg = await readPackage(fileList, accounts());
      const ed = {
        id: crypto.randomUUID(), isNew: true, status: "draft", account_id: pkg.account.id, kind: pkg.kind,
        caption: pkg.caption, first_comment: pkg.first_comment, todo: pkg.todo, location: resolvePlace(pkg.location), scheduledLocal: pkg.suggested_time ? utcToZurichLocal(pkg.suggested_time) : tomorrowAt18(),
        items: await Promise.all(pkg.files.map(async (f, i) => ({ ...(await probe(f)), alt: pkg.alt[i] ?? "", user_tags: pkg.tags[i] }))),
        cover: pkg.cover ? await probe(pkg.cover) : null, source: "package", dirty: false, busy: false, preview: 0,
      };
      await persist(ed); // saved as a draft – a package is never approved
      toast(`Paket importiert: Entwurf für ${accountLabel(pkg.account)}`);
      await load(true);
      openEditor(posts().find((p) => p.id === ed.id) ?? null);
    } catch (err) {
      toast(`Paket nicht importiert: ${errorText(err)}`);
    }
  }

  return { onScroll, afterRender, todoOpen, load, view, overviewCard, badge, onClick, onInput, onChange, onDrop, onDragOver, onDragStart };
}
