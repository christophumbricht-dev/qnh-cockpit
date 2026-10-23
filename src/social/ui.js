// Cockpit tab "Social": post queue per app, editor with checks and phone preview, approval.
// Nothing is ever approved automatically – only the "Freigeben" button (and the database checks that too).
import { esc, num } from "../format.js";
import * as data from "./data.js";
import { NO_TOPIC, guessTopic, topicOf } from "./topics.js";
import { KINDS, LIMITS, REPLY_HOURS, YOUTUBE, aspectLabel, countHashtags, formatZurich, formatZurichDate, hoursLabel, parseTagList, quizList, replyHours, utcToZurichLocal, utf8Bytes, validatePost, zurichToUtc } from "./validate.js";
import { IMPORT, readPackage } from "./package.js";
import { sparkSvg } from "../charts.js";
import { findPublishedTwin } from "./dupes.js";
import { createInbox } from "./inbox-ui.js";
import { createOutreach } from "./outreach-ui.js";

const STATUS = { draft: "Entwurf", approved: "Geplant", publishing: "Wird veröffentlicht …", published: "Veröffentlicht", failed: "Fehler" };
const GROUPS = [["Entwürfe", ["draft"]], ["Geplant", ["approved", "publishing"]], ["Veröffentlicht", ["published"]], ["Fehler", ["failed"]]];
const PLATFORM = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };
const LOCKED = ["approved", "publishing", "published"];
// status filter above the post list: [value, label, test, tooltip]
const STATUS_FILTERS = [
  ["all", "Alle", () => true, ""],
  ["review", "Zu prüfen", (p) => p.status === "draft" || p.status === "failed", "Entwürfe und fehlgeschlagene Beiträge – hier braucht es dich"],
  ["draft", "Entwürfe", (p) => p.status === "draft", ""],
  ["approved", "Freigegeben", (p) => p.status === "approved" || p.status === "publishing", "freigegeben, wird zur geplanten Zeit veröffentlicht"],
  ["published", "Veröffentlicht", (p) => p.status === "published", ""],
  ["failed", "Fehlgeschlagen", (p) => p.status === "failed", ""],
  ["todo", "Offene Aufgaben", null, "Beiträge mit noch nicht abgehakten «Selbst in Instagram erledigen»-Punkten"],
  ["ai", "KI-Info", (p) => p.ai_generated === true, "mit «KI-Info» markiert"],
];

export function createSocial({ S, render, toast, errorText, appName, appBadge = () => "", brands = () => [] }) {
  S.social = { value: null, loading: false, error: null, filter: "all", editor: null, mode: savedMode(), month: null, review: null, stats: null, statsDays: 28, statsSort: "views", q: "", status: "all", platform: savedPlatform(), byTopic: false, reviewTopic: null };
  let unsubscribe = null;
  let reloadTimer;
  const inbox = createInbox({ S, render, toast, errorText, appName, appBadge, brands, reload: () => load(true) });
  const outreach = createOutreach({ S, render, toast, errorText });
  let connectChecked = false;

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
    if (st.value) {
      inbox.watch();
      outreach.watch();
      if (!connectChecked) { connectChecked = true; inbox.finishConnect(); } // back from «YouTube verbinden»
    }
    const typing = document.activeElement?.closest?.(".soc-editor, .cmt-reply, .out-item, .out-settings, .out-watch");
    if (!typing) render();
  }

  const accounts = () => S.social.value?.accounts ?? [];
  // accounts the editor can publish to (YouTube needs the title column from 20261020110000_social_youtube.sql)
  const publishable = () => accounts().filter((a) => a.platform !== "youtube" || data.titleSupported());
  const isYoutube = (accountId) => account(accountId)?.platform === "youtube";
  const platformName = (accountId) => PLATFORM[account(accountId)?.platform] ?? "Instagram";
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
    const tile = (label, value, sub, alert, href = "#social") => `<a class="tile${alert ? " alert" : ""}" href="${href}"><span class="tile-label">${label}</span><span class="tile-num">${value}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ""}</a>`;
    const open = inbox.count();
    return `<section class="card"><div class="card-head"><span class="dot dot-social"></span><div><h2>Social</h2><p class="muted">Beiträge aller Apps</p></div></div>
      <div class="tiles">
        ${tile("Geplant", num(planned.length), planned[0] ? `nächster: ${formatZurich(planned[0].scheduled_at)}` : "", false)}
        ${tile("Entwürfe", num(drafts), "", false)}
        ${tile("Fehler", num(failed), "", failed > 0)}
        ${open ? tile("Kommentare", num(open), "warten auf Antwort", false, "#social/kommentare") : ""}
        ${expiring.length ? tile("Token läuft ab", num(expiring.length), expiring.map((a) => `@${a.handle}: ${daysLeft(a.token_expires_at)} Tage`).join(", "), true) : ""}
      </div></section>`;
  }
  const badge = () => posts().filter((p) => p.status === "failed").length + inbox.count();

  // ---------- list ----------
  function view() {
    if (!data.socialConfigured()) {
      return `<section class="card"><h2>Social</h2><p class="note">QNH Core ist noch nicht eingerichtet. Anleitung: <code>docs/social-setup.md</code>.</p></section>`;
    }
    const st = S.social;
    if (st.editor) return editorView(st.editor);
    if (!st.value) return st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    const apps = [...new Set(accounts().map((a) => a.app_id))];
    const shown = posts().filter((p) => (st.filter === "all" || account(p.account_id)?.app_id === st.filter) && onPlatform(p) && matchesSearch(p));
    const chips = [["all", "Alle Apps"], ...apps.map((id) => [id, appName(id)])]
      .map(([v, l]) => `<button class="chip${v === "all" ? "" : " chip-app"}${st.filter === v ? " on" : ""}" data-action="soc-filter" data-value="${esc(v)}" title="${esc(l)}">${v === "all" ? "" : appBadge(v)}${esc(l)}</button>`).join("");
    const openComments = inbox.count(false);
    const openOut = outreach.count();
    const modes = [["list", "Beiträge"], ["calendar", "Kalender"], ["comments", `Kommentare${openComments ? ` · ${openComments}` : ""}`], ["outreach", `Bei anderen${openOut ? ` · ${openOut}` : ""}`], ["stats", "Statistik"]].map(([v, l]) =>
      `<button class="seg-btn${st.mode === v ? " on" : ""}" data-action="soc-mode" data-value="${v}" aria-pressed="${st.mode === v}">${l}</button>`).join("");
    const connect = inbox.connectRow();
    const channelList = accounts().filter((a) => st.filter === "all" || a.app_id === st.filter);
    if (st.byTopic) {
      return `<div class="soc-top">
        <h2 class="soc-topics-title">Themen</h2>
        <div class="row-right">
          ${reviewQueue().length ? `<button class="btn" data-action="soc-review">Freigabe-Runde (${reviewQueue().length})</button>` : ""}
          <button class="btn desk-only" data-action="soc-new"${publishable().length ? "" : " disabled"}>Neuer Beitrag</button>
        </div></div>
      ${apps.length > 1 ? `<div class="chips soc-apps">${chips}</div>` : ""}
      ${st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : ""}
      ${searchBar(shown)}
      ${topicView(shown)}`;
    }
    return `<div class="soc-top">
        <div class="seg" role="group" aria-label="Ansicht">${modes}</div>
        <div class="row-right">
          ${reviewQueue().length ? `<button class="btn" data-action="soc-review">Freigabe-Runde (${reviewQueue().length})</button>` : ""}
          <button class="btn ghost desk-only" data-action="soc-pick-package">Paket importieren</button>
          <button class="btn desk-only" data-action="soc-new"${publishable().length ? "" : " disabled"}>Neuer Beitrag</button>
        </div></div>
      ${apps.length > 1 && st.mode !== "outreach" ? `<div class="chips soc-apps">${chips}</div>` : ""}
      ${st.mode !== "list" ? "" : accounts().length ? `<div class="channels">${channelList.map(channelCard).join("")}${connect ? `<div class="channel-card add"><b>Kanal hinzufügen</b><span class="muted small">YouTube: hier verbinden. Instagram: docs/social-setup.md</span>${connect}</div>` : ""}</div>`
        : `<p class="note">Noch kein Konto verbunden (docs/social-setup.md, Schritt «Konto eintragen»).</p>`}
      ${st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : ""}
      ${st.mode === "list" || st.mode === "calendar" ? searchBar(shown) : ""}
      ${st.mode === "stats" ? statsView() : st.mode === "comments" ? inbox.view() : st.mode === "outreach" ? outreach.view() : st.mode === "calendar" ? calendarView(shown) : listView(shown)}`;
  }

  // ---------- search + status filter ----------
  function statusTest(v) {
    if (v === "todo") return (p) => todoOpen(p.todo);
    return STATUS_FILTERS.find((f) => f[0] === v)?.[2] ?? (() => true);
  }
  // everything Christoph might remember about a post: text, title, account, app, place, tags, hand jobs, status
  function matchesSearch(p) {
    const words = S.social.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const a = account(p.account_id);
    const hay = [p.caption, p.title, p.first_comment, p.first_comment_reply, ...(p.quiz_answer ?? []), p.todo, p.last_error, a?.handle && `@${a.handle}`, a && appName(a.app_id), a && PLATFORM[a.platform],
      p.location?.name, STATUS[p.status], KINDS[p.kind], p.ai_generated && "KI", p.source === "package" && "Paket",
      ...(p.media ?? []).flatMap((m) => (m.user_tags ?? []).map((t) => "@" + t.username)),
      p.scheduled_at && formatZurich(p.scheduled_at), p.published_at && formatZurich(p.published_at)]
      .filter(Boolean).join(" \n ").toLowerCase();
    return words.every((w) => hay.includes(w));
  }
  // platform filter (Instagram / YouTube): list, calendar and the review round; remembered per device
  function savedPlatform() {
    try { const v = localStorage.getItem("qnh-social-platform"); return ["instagram", "youtube"].includes(v) ? v : "all"; } catch { return "all"; }
  }
  function onPlatform(p) {
    const pf = S.social.platform;
    return pf === "all" || account(p.account_id)?.platform === pf;
  }
  function platformChips() {
    const st = S.social;
    const have = new Set(accounts().map((a) => a.platform));
    if (!(have.has("instagram") && have.has("youtube"))) return "";
    return [["all", "Alle"], ["instagram", "Instagram"], ["youtube", "YouTube"]].map(([v, l]) =>
      `<button class="seg-btn${st.platform === v ? " on" : ""}" data-action="soc-platform" data-value="${v}" aria-pressed="${st.platform === v}">${l}</button>`).join("");
  }
  function searchBar(shown) {
    const st = S.social;
    const pf = platformChips();
    const chips = st.mode !== "list" && !st.byTopic ? "" : STATUS_FILTERS.map(([v, label, , tip]) => {
      const n = v === "all" ? shown.length : shown.filter(statusTest(v)).length;
      if (n === 0 && v !== "all" && st.status !== v) return ""; // hide empty filters, except the active one
      return `<button class="chip${st.status === v ? " on" : ""}" data-action="soc-status" data-value="${v}" aria-pressed="${st.status === v}"${tip ? ` title="${esc(tip)}"` : ""}>${esc(label)} <span class="muted">${n}</span></button>`;
    }).join("");
    return `<div class="soc-search">
        <div class="soc-search-row">
          <input type="search" name="soc-search" value="${esc(st.q)}" placeholder="Suchen: Text, Konto, Ort, #hashtag, @markiert …" autocomplete="off" spellcheck="false" aria-label="Beiträge durchsuchen">
          ${pf ? `<div class="seg seg-small" role="group" aria-label="Plattform">${pf}</div>` : ""}
        </div>
        ${chips ? `<div class="chips soc-status" role="group" aria-label="Nach Status filtern">${chips}</div>` : ""}
      </div>`;
  }
  // ---------- Themen: the same posts and cards, grouped by topic (approving here approves the very same post) ----------
  const PLURAL = { Bild: "Bilder", Karussell: "Karussells", Reel: "Reels", Story: "Storys" };
  function topicSummary(rows) {
    const kinds = new Map();
    for (const p of rows) {
      const k = isYoutube(p.account_id) ? "YouTube-Short" : KINDS[p.kind] ?? p.kind;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    const parts = [...kinds].map(([k, n]) => `${n} ${n === 1 ? k : PLURAL[k] ?? (k === "YouTube-Short" ? "YouTube-Shorts" : k)}`);
    const done = rows.filter((p) => ["approved", "publishing", "published"].includes(p.status)).length;
    return `${parts.join(" · ")} · ${done} von ${rows.length} freigegeben`;
  }
  function topicView(shown) {
    const st = S.social;
    const rows = st.status === "all" ? shown : shown.filter(statusTest(st.status));
    if (!rows.length) return `<p class="muted">${st.q.trim() ? "Nichts gefunden." : "Keine Beiträge."}</p>`;
    const groups = new Map();
    for (const p of rows) { const t = topicOf(p); groups.set(t, [...(groups.get(t) ?? []), p]); }
    // upcoming topics first (by their next planned post), then the ones already done (newest first), «Ohne Thema» last
    const now = Date.now();
    const next = (ps) => Math.min(...ps.filter((p) => p.status !== "published" && p.scheduled_at).map((p) => new Date(p.scheduled_at).getTime()).filter((t) => t >= now - 864e5), Infinity);
    const last = (ps) => Math.max(...ps.map((p) => new Date(p.published_at ?? p.scheduled_at ?? 0).getTime()));
    const order = [...groups.entries()].sort(([ta, a], [tb, b]) => (ta === NO_TOPIC) - (tb === NO_TOPIC) || next(a) - next(b) || last(b) - last(a));
    return order.map(([topic, ps]) => {
      const sorted = [...ps].sort((a, b) => byTime(a, b, "scheduled_at"));
      const drafts = ps.filter((p) => p.status === "draft").length;
      return `<section class="topic-group">
        <div class="topic-head"><h3 class="group">${esc(topic)} <span class="muted">${ps.length}</span></h3>
          ${drafts ? `<button class="btn ghost" data-action="soc-review-topic" data-value="${esc(topic)}">Freigabe-Runde (${drafts})</button>` : ""}</div>
        <p class="muted small topic-sum">${esc(topicSummary(ps))}</p>
        ${sorted.map(postItem).join("")}
      </section>`;
    }).join("");
  }

  function listView(shown) {
    const st = S.social;
    const searching = st.q.trim() !== "";
    if (st.status !== "all") {
      // one flat list: published newest first, everything else by planned time
      const rows = shown.filter(statusTest(st.status)).sort((a, b) => (a.status === "published" && b.status === "published" ? byTime(b, a, "published_at") : byTime(a, b, "scheduled_at")));
      return rows.length ? rows.map(postItem).join("") : `<p class="muted">${searching ? "Nichts gefunden." : "Keine Beiträge mit diesem Status."}</p>`;
    }
    if (searching && !shown.length) return `<p class="muted">Nichts gefunden für «${esc(st.q.trim())}».</p>`;
    return GROUPS.map(([title, statuses]) => {
      const rows = shown.filter((p) => statuses.includes(p.status))
        .sort((a, b) => (title === "Veröffentlicht" ? byTime(b, a, "published_at") : byTime(a, b, "scheduled_at")));
      if (searching && !rows.length) return "";
      return `<h3 class="group">${title} <span class="muted">${rows.length}</span></h3>${rows.length ? rows.map(postItem).join("") : `<p class="muted small">–</p>`}`;
    }).join("");
  }

  // «Mi 21.10. 19:00»
  const shortZurich = (iso) => new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(/\.,? /, " ").replace(",", "");
  // one card per channel: connection, next post, pipeline, comments
  function channelCard(a) {
    const left = daysLeft(a.token_expires_at);
    const status = !a.active ? ["inaktiv", "off"] : a.platform === "youtube" ? ["verbunden", "ok"]
      : left === null ? ["verbunden", "ok"] : left < 0 ? ["Token abgelaufen", "bad"] : left < 14 ? [`Token noch ${left} Tage`, "warn"] : ["verbunden", "ok"];
    const mine = posts().filter((p) => p.account_id === a.id);
    const now = Date.now();
    const next = mine.filter((p) => p.status === "approved" && p.scheduled_at && new Date(p.scheduled_at).getTime() > now).sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))[0];
    const approved = mine.filter((p) => p.status === "approved").length;
    const drafts = mine.filter((p) => p.status === "draft").length;
    const month = mine.filter((p) => p.status === "published" && p.published_at && now - new Date(p.published_at).getTime() < 30 * 864e5).length;
    const c = inbox.countFor(a.id);
    const youtube = a.platform === "youtube";
    return `<article class="channel-card">
      <div class="channel-head">${appBadge(a.app_id)}<div><b>${esc(youtube ? a.handle || appName(a.app_id) : `@${a.handle}`)}</b><span class="muted small">${esc(PLATFORM[a.platform] ?? a.platform)} · ${esc(appName(a.app_id))}</span></div></div>
      <span class="ch-status ${status[1]}">${esc(status[0])}</span>
      <dl class="channel-stats">
        <div><dt>Nächster Beitrag</dt><dd>${next ? esc(shortZurich(next.scheduled_at)) : "–"}</dd></div>
        <div><dt>Pipeline</dt><dd>${approved} frei · ${drafts} ${drafts === 1 ? "Entwurf" : "Entwürfe"}</dd></div>
        <div><dt>Kommentare</dt><dd${c.open ? ' class="hot"' : ""}>${c.open ? `${c.open} offen` : "keine offen"}${c.held ? ` · ${c.held} zurück` : ""}</dd></div>
        <div><dt>Veröffentlicht, 30 Tage</dt><dd>${month}</dd></div>
      </dl>
      <div class="channel-actions">
        ${c.open || c.held ? `<button class="link" data-action="soc-mode" data-value="comments">Kommentare</button>` : ""}
        ${youtube ? `<button class="link" data-action="soc-yt-reconnect" data-value="${esc(a.app_id)}">neu verbinden</button>` : ""}
      </div>
    </article>`;
  }

  // ---------- statistics ----------
  const STAT_COLS = [["views", "Views"], ["reach", "Reichweite"], ["likes", "Likes"], ["comments", "Kommentare"], ["saved", "Gespeichert"], ["shares", "Geteilt"], ["follows", "Neue Follower"]];
  // YouTube: Wiedergabe und Klickrate aus YouTube Analytics (Prozentwerte mit «%»)
  const YT_STAT_COLS = [["views", "Views"], ["likes", "Likes"], ["comments", "Kommentare"], ["watch_minutes", "Wiedergabe (Min.)"], ["avg_view_pct", "Ø angesehen"], ["ctr", "Klickrate"]];
  const PCT_COLS = new Set(["avg_view_pct", "ctr"]);
  const statCell = (k, v) => (v == null ? "–" : PCT_COLS.has(k) ? `${Math.round(v)} %` : num(Math.round(v)));
  const KIND_LABEL = { FEED: "Bild", CAROUSEL: "Karussell", REELS: "Reel", STORY: "Story", SHORT: "Short" };
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
    // Instagram first, then YouTube (same app next to each other)
    const accs = accounts().filter((a) => ["instagram", "youtube"].includes(a.platform) && (st.filter === "all" || a.app_id === st.filter))
      .sort((a, b) => String(a.app_id).localeCompare(String(b.app_id)) || (a.platform === "instagram" ? -1 : 1));
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
      if (!series.length && !media.length) return `<section class="card"><h3>${appBadge(acc.app_id)} @${esc(acc.handle)} <span class="muted small">${esc(PLATFORM[acc.platform] ?? acc.platform)}</span></h3><p class="muted">Noch keine Zahlen. Sie werden täglich um ca. 06:23 abgeholt – oder jetzt mit «Jetzt aktualisieren».</p></section>`;
      return `<section class="card stats-card"><h3>${appBadge(acc.app_id)} @${esc(acc.handle)} <span class="muted small">${esc(PLATFORM[acc.platform] ?? acc.platform)}</span></h3>
        <div class="stat-tiles">
          ${acc.platform === "youtube" ? `${tile("Abonnenten", last.followers_count ?? "–", delta != null ? `${delta >= 0 ? "+" : ""}${delta} in ${st.statsDays} Tagen` : "")}
            ${tile("Aufrufe gesamt", last.views_total != null ? num(last.views_total) : "–", first.views_total != null && last.views_total != null ? `+${num(last.views_total - first.views_total)} in ${st.statsDays} Tagen` : "")}
            ${tile("Videos", last.media_count ?? "–")}
            ${tile("Wiedergabezeit", last.watch_minutes_28d != null ? num(Math.round(last.watch_minutes_28d / 60)) + " h" : "–", "letzte 28 Tage")}
            ${tile("Ø angesehen", last.avg_view_pct_28d != null ? `${Math.round(last.avg_view_pct_28d)} %` : "–", last.avg_view_duration_28d != null ? `${Math.round(last.avg_view_duration_28d)} s pro Aufruf` : "")}
            ${tile("Klickrate", last.ctr_28d != null ? `${(Math.round(last.ctr_28d * 10) / 10).toString().replace(".", ",")} %` : "–", last.impressions_28d != null ? `${num(last.impressions_28d)} Impressionen` : "Vorschaubilder, 28 Tage")}` : `
          ${tile("Follower", last.followers_count ?? "–", delta != null ? `${delta >= 0 ? "+" : ""}${delta} in ${st.statsDays} Tagen` : "")}
          ${tile("Reichweite", num(sum("reach")), "erreichte Konten, Summe")}
          ${tile("Views", num(sum("views")))}
          ${tile("Interaktionen", num(sum("total_interactions")), `${num(sum("profile_links_taps"))} Link-Taps`)}`}
        </div>
        ${followerSeries.length > 1 ? `<div class="stats-spark"><span class="muted small">Follower-Verlauf</span>${sparkSvg(followerSeries, "line")}</div>` : `<p class="muted small">Follower-Verlauf erscheint ab dem zweiten Tag. Manche Werte liefert Instagram erst ab 100 Followern.</p>`}
        ${media.length ? `<div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>Beitrag</th>${(acc.platform === "youtube" ? YT_STAT_COLS : STAT_COLS).map(([k, l]) => `<th><button class="link${st.statsSort === k ? " on" : ""}" data-action="soc-stats-sort" data-value="${k}">${l}${st.statsSort === k ? " ▾" : ""}</button></th>`).join("")}</tr></thead>
          <tbody>${media.map((m) => `<tr><td><a href="${esc(m.permalink ?? "#")}" target="_blank" rel="noopener">${esc(m.caption.split("\n")[0].slice(0, 60) || "(ohne Text)")}</a><br><span class="muted small">${esc(KIND_LABEL[m.kind] ?? m.kind)} · ${m.posted_at ? esc(formatZurichDate(m.posted_at)) : ""}</span></td>${(acc.platform === "youtube" ? YT_STAT_COLS : STAT_COLS).map(([k]) => `<td>${statCell(k, m.metrics[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted">Keine Beiträge in diesem Zeitraum.</p>`}
      </section>`;
    }).join("");
    return `${head}${blocks}<p class="hint">Zahlen von Instagram und YouTube, einmal täglich abgeholt (Instagram: Verzögerung bis 48 h). Nach einer Spalte sortieren: Spaltentitel antippen.</p>`;
  }

  // ---------- calendar (month view, Swiss time) ----------
  function savedMode() {
    try { const m = localStorage.getItem("qnh-social-mode"); return ["calendar", "stats", "comments", "outreach"].includes(m) ? m : "list"; } catch { return "list"; }
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
        return `<button class="cal-post ${p.status}" data-action="soc-open" data-id="${p.id}"${movable ? ` draggable="true" data-cal-post="${p.id}"` : ""} title="${esc((firstLines(p.caption, 1) || KINDS[p.kind]) + (todoOpen(p.todo) ? `\n\nVon Hand: ${p.todo}` : ""))}"><b>${esc(time)}</b>${todoOpen(p.todo) ? " ✋" : ""} ${esc(a?.platform === "youtube" ? "YouTube" : KINDS[p.kind])} · @${esc(a?.handle ?? "")}</button>`;
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

  // post list: a still image only (videos would be downloaded just to show a frame)
  function listThumb(p) {
    const first = p.media?.[0];
    if (!first) return `<span class="thumb empty"></span>`;
    if (!/^video\//.test(first.type)) return thumb(first);
    return p.cover_path
      ? `<span class="video-thumb">${thumb({ path: p.cover_path, type: "image/jpeg", alt: "" })}<span class="play" aria-hidden="true">▶</span></span>`
      : `<span class="thumb video-tile" aria-label="Video">▶</span>`;
  }

  function thumb(item, cls = "thumb") {
    if (!item) return `<span class="${cls} empty"></span>`;
    const src = item.url ?? data.mediaUrl(item.path);
    if (!/^video\//.test(item.type)) return `<img class="${cls}" src="${esc(src)}" alt="${esc(item.alt ?? "")}" loading="lazy" decoding="async">`;
    // phone preview: playable with sound and controls (cover as poster); elsewhere a still frame with ▶
    const poster = item.poster ? ` poster="${esc(item.poster)}"` : "";
    if (cls.includes("phone-img")) return `<video class="${cls}" src="${esc(src)}" controls playsinline loop preload="${item.poster ? "none" : "metadata"}"${poster}></video>`;
    return `<span class="video-thumb"><video class="${cls}" src="${esc(src)}#t=0.5" muted playsinline preload="metadata"${poster}></video><span class="play" aria-hidden="true">▶</span></span>`;
  }

  // "what Christoph still does by hand in Instagram" – shown unless it says there is nothing to do
  // one task per line; a done task starts with "✓ " (stored in the note, so every device and the CLI see it)
  const todoLines = (t) => (/^nichts\b/i.test(String(t ?? "").trim()) ? [] : String(t ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => ({ done: /^✓\s*/.test(l), text: l.replace(/^✓\s*/, "") })));
  const todoOpen = (t) => todoLines(t).some((l) => !l.done);
  const todoFirstOpen = (t) => todoLines(t).find((l) => !l.done)?.text ?? "";
  function toggleTodoLine(t, index) {
    const lines = String(t ?? "").split("\n");
    let n = -1;
    return lines.map((l) => {
      if (!l.trim()) return l;
      n++;
      if (n !== index) return l;
      return /^\s*✓\s*/.test(l) ? l.replace(/^\s*✓\s*/, "") : `✓ ${l.trim()}`;
    }).join("\n");
  }
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
  // checklist: tick each hand job off after doing it in the app
  function todoBox(t, where = "Instagram", id = null) {
    const lines = todoLines(t);
    if (!lines.length) return "";
    const done = lines.filter((l) => l.done).length, all = done === lines.length;
    const items = lines.map((l, i) => `<li class="${l.done ? "done" : ""}"><label>${id ? `<input type="checkbox" data-action="soc-todo-check" data-id="${esc(id)}" data-value="${i}"${l.done ? " checked" : ""}>` : ""}<span>${todoHtml(l.text)}</span></label></li>`).join("");
    return `<div class="soc-todo${all ? " all-done" : ""}"><b>${all ? "✓ Alles erledigt" : `Selbst in ${esc(where)} erledigen`}</b> <span class="muted small">${done}/${lines.length}</span>
      <ul class="todo-check">${items}</ul>${all ? "" : howtoHtml(lines.filter((l) => !l.done).map((l) => l.text).join("\n"))}</div>`;
  }

  function postItem(p) {
    const a = account(p.account_id);
    const when = p.status === "published" ? p.published_at : p.scheduled_at;
    const btn = (action, label, ghost = true) => `<button class="btn${ghost ? " ghost" : ""}" data-action="${action}" data-id="${p.id}">${label}</button>`;
    const actions = [];
    if (p.status === "draft" || p.status === "failed") actions.push(btn("soc-open", "Bearbeiten", false));
    else actions.push(btn("soc-open", "Ansehen"));
    if (p.status === "approved") actions.push(btn("soc-withdraw", "Zurückziehen"));
    if (p.status === "failed") actions.push(btn("soc-retry", "Erneut versuchen", false));
    if (["draft", "approved", "failed"].includes(p.status)) actions.push(btn("soc-publish-now", "Jetzt veröffentlichen"));
    actions.push(btn("soc-duplicate", "Duplizieren"));
    if (p.permalink) actions.push(`<a class="btn ghost" href="${esc(p.permalink)}" target="_blank" rel="noopener">Auf ${PLATFORM[a?.platform] ?? "Instagram"} öffnen</a>`);
    if (p.status === "draft") actions.push(btn("soc-delete", "Löschen"));
    return `<article class="item soc-item">
      ${p.media_deleted_at ? `<span class="thumb empty"></span>` : listThumb(p)}
      <div>
        <div class="meta">${platformIcon(a?.platform)}<b>${esc(accountLabel(a))}</b><span>${a?.platform === "youtube" ? "Video (Short)" : KINDS[p.kind] ?? p.kind}${p.media?.length > 1 ? ` · ${p.media.length} Dateien` : ""}</span>
          <span>${when ? esc(formatZurich(when)) : "kein Zeitpunkt"}</span><span class="pill ${p.status}">${STATUS[p.status] ?? p.status}</span>
          ${p.source === "package" ? `<span class="muted">aus Paket</span>` : ""}
          ${p.location?.name ? `<span class="muted">📍 ${esc(p.location.name)}</span>` : ""}
          ${p.ai_generated && !isYoutube(p.account_id) ? `<span class="pill ai" title="Wird mit «KI-Info» veröffentlicht">KI</span>` : ""}
          ${(() => { const who = [...new Set((p.media ?? []).flatMap((m) => (m.user_tags ?? []).map((t) => "@" + t.username)))]; return who.length ? `<span class="muted">markiert: ${esc(who.join(", "))}</span>` : ""; })()}</div>
        ${p.title ? `<p class="text"><b>${esc(p.title)}</b></p>` : ""}
        <p class="text">${esc(firstLines(p.caption, 2) || (p.kind === "story" ? "(Story ohne Text)" : "(kein Text)"))}</p>
        ${replyHtml(p)}
        ${quizHtml(p)}
        ${twinHtml(twinOf(p))}
        ${todoBox(p.todo, PLATFORM[a?.platform] ?? "Instagram", p.id)}
        ${p.last_error ? `<p class="error small">${esc(p.last_error)}</p>` : ""}
        <div class="actions">${actions.join("")}</div>
      </div>
    </article>`;
  }

  // ---------- answer below our own first comment (sent by the server hours after publishing) ----------
  const hasReply = (p) => p.kind !== "story" && String(p.first_comment_reply ?? "").trim() !== "";
  // when it goes out: hours after publishing (or after the planned time while not yet published)
  function replyDue(p) {
    const h = replyHours(p.first_comment_reply_after_hours) ?? REPLY_HOURS.default;
    const base = p.published_at ?? p.scheduled_at;
    return base ? new Date(new Date(base).getTime() + h * 3600e3).toISOString() : null;
  }
  // status line for list and editor: planned · sending · sent · not sent
  function replyHtml(p) {
    if (!hasReply(p)) return "";
    const h = replyHours(p.first_comment_reply_after_hours) ?? REPLY_HOURS.default;
    const text = `«${esc(firstLines(p.first_comment_reply, 1))}»`;
    const s = p.first_comment_reply_status;
    if (s === "sent") return `<p class="small soc-reply ok">↳ Antwort auf den ersten Kommentar gesendet ${esc(formatZurich(p.first_comment_reply_sent_at))}: ${text}</p>`;
    if (s === "failed") return `<p class="small soc-reply error">↳ ${esc(p.first_comment_reply_error || "Antwort nicht gesendet.")}</p>`;
    if (s === "sending") return `<p class="small soc-reply muted">↳ Antwort wird gesendet … ${text}</p>`;
    const due = replyDue(p);
    return `<p class="small soc-reply muted">↳ Antwort auf den ersten Kommentar ${hoursLabel(h)} nach dem Veröffentlichen${due ? ` (ca. ${esc(formatZurich(due))})` : ""}: ${text}</p>`;
  }

  // quiz: a correct answer from somebody gets one of the prepared texts automatically (server, comments run)
  const quizOf = (p) => ({ keys: quizList(p.quiz_answer), texts: quizList(p.quiz_correct_replies, /\n/) });
  function quizHtml(p) {
    const { keys, texts } = quizOf(p);
    if (p.kind === "story" || !keys.length) return "";
    return `<p class="small soc-reply muted">? Quiz: richtig bei «${esc(keys.join("», «"))}» → automatisch «${esc(texts.join("» oder «"))}» (einmal pro Person, 72 h lang)</p>`;
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
      .filter((p) => p.status === "draft" && (st.filter === "all" || account(p.account_id)?.app_id === st.filter) && onPlatform(p) && (!st.reviewTopic || topicOf(p) === st.reviewTopic))
      .sort((a, b) => byTime(a, b, "scheduled_at"));
  }
  function nextInReview(currentId) {
    const st = S.social;
    const next = reviewQueue().find((p) => p.id !== currentId && !st.review.skipped.has(p.id));
    if (next) return openEditor(next);
    toast(`Freigabe-Runde fertig: ${st.review.done} freigegeben${st.review.skipped.size ? `, ${st.review.skipped.size} für später` : ""}.`);
    st.review = null; st.reviewTopic = null;
    st.editor = null;
    render();
  }

  function openEditor(post, { duplicate = false } = {}) {
    const fallback = publishable().find((a) => S.social.filter === "all" || a.app_id === S.social.filter) ?? publishable()[0];
    const items = (post?.media ?? []).map((m) => (duplicate ? { ...m, copyFrom: m.path, path: null } : { ...m }));
    S.social.editor = {
      id: post && !duplicate ? post.id : crypto.randomUUID(),
      isNew: !post || duplicate,
      status: post && !duplicate ? post.status : "draft",
      updated_at: post && !duplicate ? post.updated_at ?? null : null,
      account_id: post?.account_id ?? fallback?.id,
      kind: post?.kind ?? (fallback?.platform === "youtube" ? "reel" : "image"),
      title: post?.title ?? "",
      caption: post?.caption ?? "",
      first_comment: post?.first_comment ?? "",
      first_comment_reply: post?.first_comment_reply ?? "",
      first_comment_reply_after_hours: replyHours(post?.first_comment_reply_after_hours) ?? REPLY_HOURS.default,
      quiz_answer: quizList(post?.quiz_answer).join(", "),
      quiz_correct_replies: quizList(post?.quiz_correct_replies, /\n/).join("\n"),
      todo: duplicate ? "" : post?.todo ?? "",
      location: post?.location ?? null,
      ai: post?.ai_generated === true,
      // YouTube «für Kinder»: neue Beiträge der Marke Wolkenhof sind es von selbst
      kids: post ? post.made_for_kids === true : kidsDefault(fallback?.id),
      topic: duplicate ? post?.topic ?? "" : post?.topic ?? "",
      topicGuess: post ? guessTopic(post) : null,
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
    validatePost({ kind: ed.kind, items: ed.items, caption: ed.caption, first_comment: ed.first_comment, first_comment_reply: ed.first_comment_reply,
      first_comment_reply_after_hours: ed.first_comment_reply_after_hours, quiz_answer: ed.quiz_answer, quiz_correct_replies: ed.quiz_correct_replies,
      platform: account(ed.account_id)?.platform, title: ed.title },
      { forApproval, scheduledAt: zurichToUtc(ed.scheduledLocal) });

  function checksHtml(ed) {
    const { errors, warnings } = checks(ed);
    if (!errors.length && !warnings.length) return `<p class="ok small">Alles in Ordnung.</p>`;
    return `${errors.map((e) => `<p class="error small">✗ ${esc(e)}</p>`).join("")}${warnings.map((w) => `<p class="warn small">! ${esc(w)}</p>`).join("")}`;
  }

  function counterHtml(ed) {
    const tags = countHashtags(ed.caption);
    if (isYoutube(ed.account_id)) {
      const bytes = utf8Bytes(ed.caption);
      const cls = bytes > YOUTUBE.descriptionBytes || tags > YOUTUBE.hashtagsMax ? "error" : tags > YOUTUBE.hashtagsWarn ? "warn" : "muted";
      return `<span class="${cls}">${bytes} / ${YOUTUBE.descriptionBytes} Bytes · ${tags} Hashtag${tags === 1 ? "" : "s"}</span>`;
    }
    const cls = ed.caption.length > LIMITS.caption || tags > LIMITS.hashtagsMax ? "error" : tags > LIMITS.hashtagsWarn ? "warn" : "muted";
    return `<span class="${cls}">${ed.caption.length} / ${LIMITS.caption} Zeichen · ${tags} Hashtag${tags === 1 ? "" : "s"}</span>`;
  }

  function titleCounter(ed) {
    const n = String(ed.title ?? "").trim().length;
    return `<span class="${n > YOUTUBE.title || !n ? "error" : "muted"}">${n} / ${YOUTUBE.title} Zeichen</span>`;
  }

  // neue YouTube-Beiträge der Marke Wolkenhof (Kindersendung) sind von selbst «für Kinder»
  const kidsDefault = (accountId) => { const a = account(accountId); return a?.platform === "youtube" && a?.app_id === "wolkenhof"; };

  function editorView(ed) {
    const ro = readonly(ed);
    const dis = ro || ed.busy ? " disabled" : "";
    const acc = account(ed.account_id);
    const yt = isYoutube(ed.account_id);
    const where = platformName(ed.account_id);
    const kinds = Object.entries(yt ? { reel: "Video (Short)" } : KINDS).map(([k, l]) =>
      `<button class="chip${ed.kind === k ? " on" : ""}" data-action="soc-kind" data-value="${k}"${dis}>${l}</button>`).join("");
    const accept = ed.kind === "image" ? ".jpg,.jpeg,image/jpeg,.png,image/png,.webp,image/webp,.heic,.heif" : ed.kind === "reel" ? "video/mp4,video/quicktime" : ".jpg,.jpeg,image/jpeg,.png,image/png,.webp,image/webp,.heic,.heif,video/mp4,video/quicktime";
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
      actions.push(`<button class="btn" data-action="soc-approve"${dis}>${platformIcon(acc?.platform)} Freigeben für ${esc(PLATFORM[acc?.platform] ?? "Instagram")} …</button>`);
    }
    const aiHint = ed.ai && !isYoutube(ed.account_id) ? `<p class="note small ai-hint">🤖 Wird mit <b>KI-Info</b> veröffentlicht – später nicht mehr änderbar.</p>` : "";
    if (!ed.isNew && ed.status === "approved") actions.push(`<button class="btn ghost" data-action="soc-withdraw" data-id="${ed.id}"${ed.busy ? " disabled" : ""}>Zurückziehen</button>`);
    if (["draft", "approved", "failed"].includes(ed.status)) actions.push(`<button class="btn ghost" data-action="soc-publish-now" data-id="${ed.id}"${ed.busy ? " disabled" : ""}>Jetzt veröffentlichen …</button>`);
    if (!ed.isNew) actions.push(`<button class="btn ghost" data-action="soc-duplicate" data-id="${ed.id}">Duplizieren</button>`);
    if (ed.permalink) actions.push(`<a class="btn ghost" href="${esc(ed.permalink)}" target="_blank" rel="noopener">Auf ${esc(where)} öffnen</a>`);

    const rv = S.social.review;
    const rvBar = rv && !ed.isNew ? (() => {
      const queue = reviewQueue().filter((p) => !rv.skipped.has(p.id));
      return `<div class="review-bar"><b>Freigabe-Runde</b>${platformBadge(acc)}<span class="muted">${rv.done} freigegeben · noch ${queue.length} Entw${queue.length === 1 ? "urf" : "ürfe"}</span>
        <span class="row-right"><button class="btn ghost" data-action="soc-review-skip"${ed.busy ? " disabled" : ""}>Später freigeben ›</button></span></div>`;
    })() : "";
    return `${rvBar}<div class="toolbar"><button class="link" data-action="soc-close">${rv ? "← Runde beenden" : "← Zurück zur Liste"}</button>
        <span class="muted">${ed.isNew ? (ed.source === "duplicate" ? "Duplikat" : "Neuer Beitrag") : `${STATUS[ed.status] ?? ed.status}`}${ro ? " · zum Ändern zuerst zurückziehen oder duplizieren" : ""}</span></div>
      <section class="soc-editor">
        <div class="soc-form card">
          ${ed.last_error ? `<p class="error">${esc(ed.last_error)}</p>` : ""}
          ${ed.isNew ? "" : twinHtml(twinOf({ ...ed, remote_media_id: posts().find((p) => p.id === ed.id)?.remote_media_id }))}
          <label class="field">Konto
            <select name="soc-account"${dis}>${publishable().map((a) => `<option value="${a.id}"${a.id === ed.account_id ? " selected" : ""}>${esc(accountLabel(a))}</option>`).join("")}</select></label>
          <div class="field">Art<div class="chips">${kinds}</div></div>
          ${ed.mediaDeleted ? `<p class="note">Die Dateien wurden 14 Tage nach der Veröffentlichung gelöscht.</p>` : ""}
          ${ro ? "" : `<div class="dropzone" data-drop="files" data-action="soc-pick-files" role="button" tabindex="0">
              <b>${ed.kind === "carousel" ? "Bilder oder Videos" : ed.kind === "reel" ? "Video" : ed.kind === "story" ? "Bild oder Video" : "Bild"} hierher ziehen</b> oder klicken
              <span class="small muted">${ed.kind === "reel" || ed.kind === "story" ? "Hochformat 9:16" : "JPEG, 4:5 / 1:1 / 1.91:1"} · Videos als MP4 (H.264)</span></div>`}
          <ul class="soc-files">${itemsHtml}</ul>
          ${yt ? `<label class="field">Titel <span class="counter" id="soc-title-counter">${titleCounter(ed)}</span>
            <input name="soc-title" maxlength="${YOUTUBE.title}" value="${esc(ed.title ?? "")}" placeholder="z. B. Föhn: Warum ist es in Altdorf so warm?"${dis}></label>
            ${data.kidsSupported() ? `<label class="field ai-field"><span class="ai-row"><input type="checkbox" name="soc-kids"${ed.kids ? " checked" : ""}${dis}><span><b>Für Kinder</b> (COPPA) – YouTube schaltet Kommentare und personalisierte Werbung ab</span></span></label>` : ""}` : ""}
          ${ed.kind === "reel" && !yt ? `<div class="field">Titelbild (optional, JPEG)
            ${ed.cover ? `<div class="soc-file">${thumb({ ...ed.cover, url: ed.cover.url ?? data.mediaUrl(ed.cover.path ?? ed.cover.copyFrom) }, "thumb small")}${ro ? "" : `<button class="link" data-action="soc-remove-cover">Entfernen</button>`}</div>`
              : ro ? `<span class="muted small">keines</span>` : `<button class="btn ghost" data-action="soc-pick-cover">Titelbild wählen</button>`}</div>` : ""}
          ${ed.kind === "story" ? "" : `<label class="field">${yt ? "Beschreibung" : "Text"} <span class="counter" id="soc-counter">${counterHtml(ed)}</span>
            <textarea name="soc-caption" rows="7" maxlength="${yt ? 5200 : 2400}"${dis}>${esc(ed.caption)}</textarea></label>
          <label class="field">${yt ? "Erster Kommentar (optional – anpinnen geht nur in YouTube von Hand)" : "Erster Kommentar (optional, z. B. Hashtags)"}
            <textarea name="soc-comment" rows="2" maxlength="2400"${dis}>${esc(ed.first_comment)}</textarea></label>
          ${data.replySupported() ? replyField(ed, dis) : ""}`}
          ${data.aiSupported() && !yt ? `<label class="field ai-field"><span class="ai-row"><input type="checkbox" name="soc-ai"${ed.ai ? " checked" : ""}${dis}><span><b>KI-Info</b> – mit KI erstellt (z. B. KI-Stimme, KI-Musik, KI-Bild)</span></span>
            <span class="muted small">Instagram zeigt dann «KI-Info» unter deinem Namen. Nach dem Veröffentlichen nicht mehr änderbar.</span></label>` : ""}
          ${data.locationSupported() && ed.kind !== "story" && !yt ? `<label class="field">Standort (optional)
            <select name="soc-location"${dis}>
              <option value="">Kein Standort</option>
              ${[...places().map((p) => [p.page_id, p.name]), ...(ed.location && !places().some((p) => p.page_id === ed.location.id) ? [[ed.location.id, ed.location.name || ed.location.id]] : [])]
                .map(([v, l]) => `<option value="${esc(v)}"${ed.location?.id === v ? " selected" : ""}>${esc(l)}</option>`).join("")}
              <option value="__new">+ Neuen Ort hinzufügen …</option>
            </select></label>${ed.newPlace ? newPlaceHtml(ed.newPlace) : ""}` : ""}
          <label class="field">Veröffentlichen am (Schweizer Zeit)
            <input type="datetime-local" name="soc-time" value="${esc(ed.scheduledLocal)}"${dis}></label>
          ${data.todoSupported() ? `<label class="field soc-todo-field"><span><b>Selbst in ${esc(where)} erledigen</b> <span class="muted small">– nur für dich, wird nicht veröffentlicht</span></span>
            ${todoLines(ed.todo).length ? todoBox(ed.todo, "", ed.isNew ? null : ed.id).replace(/<b>[^<]*<\/b>/, "") : ""}
            <textarea name="soc-todo" rows="3" maxlength="2000" placeholder="z. B. Am Vortag Story mit Umfrage-Sticker · @exploring_the_skies markieren · Standort setzen"${ed.busy ? " disabled" : ""}>${esc(ed.todo ?? "")}</textarea>
            ${ro ? `<button class="btn ghost" data-action="soc-save-todo"${ed.busy ? " disabled" : ""}>Notiz speichern</button>` : ""}</label>` : ""}
          ${data.topicSupported() ? `<label class="field">Thema <span class="muted small">– nur zum Sortieren unter «Themen», wird nicht veröffentlicht</span>
            <input type="text" name="soc-topic" list="soc-topic-list" maxlength="80" value="${esc(ed.topic ?? "")}" placeholder="${esc(ed.topicGuess ? `${ed.topicGuess} (erkannt)` : "z. B. Föhn, Vereisung")}" autocomplete="off"${ed.busy ? " disabled" : ""}>
            <datalist id="soc-topic-list">${[...new Set(posts().map((p) => topicOf(p)).filter((t) => t !== NO_TOPIC))].sort().map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
            ${ro ? `<button class="btn ghost" data-action="soc-save-topic"${ed.busy ? " disabled" : ""}>Thema speichern</button>` : ""}</label>` : ""}
          <div id="soc-checks" class="soc-checks">${checksHtml(ed)}</div>
          ${aiHint}<div class="actions">${actions.join("")}</div>
        </div>
        <aside class="soc-preview">
          <div class="card soc-when">
            <div class="soc-when-row"><label class="field"><span class="soc-when-head">${platformBadge(acc)}</span><b>Veröffentlichung</b> <span class="muted small">Schweizer Zeit</span>
              <input type="datetime-local" name="soc-time-top" value="${esc(ed.scheduledLocal)}"${dis}></label>
              ${ro ? "" : `<button class="btn soc-approve-big" data-action="soc-approve"${dis}>Freigeben</button>`}</div>
            <div id="soc-when-hint" class="small">${whenHint(ed)}</div>
            ${S.social.review && !ed.isNew ? `<button class="btn ghost soc-later" data-action="soc-review-skip"${ed.busy ? " disabled" : ""}>Später freigeben ›</button>` : ""}
          </div>
          <div id="soc-preview">${previewHtml(ed, acc)}</div>
        </aside>
      </section>`;
  }

  // ---------- new place: find the ID with one click, paste the link, the cockpit reads the ID ----------
  // Instagram wants the ID of the place's Facebook page. The API cannot search places (needs extra Meta approval),
  // so the cockpit opens the search and reads the ID out of whatever link is pasted.
  function placeIdFrom(raw) {
    const s = String(raw ?? "").trim();
    return s.match(/instagram\.com\/explore\/locations\/(\d{5,25})/)?.[1]
      ?? s.match(/[?&]id=(\d{5,25})/)?.[1]
      ?? s.match(/facebook\.com\/(?:pages\/[^/]+\/|people\/[^/]+\/)?(\d{5,25})(?:[/?#]|$)/)?.[1]
      ?? s.match(/^(\d{5,25})$/)?.[1] ?? null;
  }
  function placeHint(np) {
    const id = placeIdFrom(np.link);
    if (!np.link.trim()) return `<span class="muted">Noch kein Link.</span>`;
    if (id) return `<span class="ok-text">✓ ID erkannt: <b>${esc(id)}</b></span>`;
    if (/facebook\.com\//.test(np.link)) return `<span class="error">Dieser Facebook-Link enthält keine Zahl. Auf der Seite «Info» → «Seitentransparenz» steht die Seiten-ID – die hier einfügen.</span>`;
    return `<span class="error">Keine ID gefunden. Einen Instagram-Standort-Link (…/explore/locations/123…/) oder die Zahl einfügen.</span>`;
  }
  function newPlaceHtml(np) {
    return `<div class="card soc-newplace">
      <b>Neuer Ort</b>
      <label class="field">Name (so erscheint er in deiner Liste)
        <input type="text" name="soc-place-name" value="${esc(np.name)}" placeholder="z. B. Flugplatz Birrfeld" autocomplete="off"></label>
      <div class="row-wrap"><span class="muted small">ID suchen:</span>
        <button class="btn ghost" data-action="soc-place-search" data-value="google">🔎 Instagram-Standorte (Google)</button>
        <button class="btn ghost" data-action="soc-place-search" data-value="facebook">🔎 Facebook-Seiten</button></div>
      <p class="muted small">In den Treffern einen Link wie <code>instagram.com/explore/locations/<b>1234567</b>/…</code> kopieren – oder in der Instagram-App bei einem Beitrag auf den Ort tippen → Teilen → Link kopieren.</p>
      <label class="field">Link oder ID einfügen
        <input type="text" name="soc-place-link" value="${esc(np.link)}" placeholder="https://www.instagram.com/explore/locations/…" autocomplete="off"></label>
      <div id="soc-place-hint" class="small">${placeHint(np)}</div>
      <div class="actions"><button class="btn" data-action="soc-place-save">Ort speichern</button><button class="btn ghost" data-action="soc-place-cancel">Abbrechen</button></div>
    </div>`;
  }

  // Instagram / YouTube mark, so it is clear at a glance where a post goes
  const PLATFORM_SVG = {
    instagram: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f9a825"/><stop offset=".5" stop-color="#e1306c"/><stop offset="1" stop-color="#833ab4"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#igg)"/><circle cx="12" cy="12" r="4.4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.3" fill="#fff"/></svg>`,
    youtube: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="1" y="4.5" width="22" height="15" rx="4.5" fill="#ff0033"/><path d="M10 8.6v6.8l5.8-3.4z" fill="#fff"/></svg>`,
  };
  const platformIcon = (platform) => PLATFORM_SVG[platform] ? `<span class="plat-icon" title="${esc(PLATFORM[platform] ?? platform)}">${PLATFORM_SVG[platform]}</span>` : "";
  const platformBadge = (acc) => acc ? `<span class="plat-badge plat-${esc(acc.platform)}">${platformIcon(acc.platform)}<b>${esc(PLATFORM[acc.platform] ?? acc.platform)}</b><span class="muted">${esc(acc.platform === "youtube" ? acc.handle || "" : "@" + acc.handle)}</span></span>` : "";

  // «Mi 28.10., 18:00 · in 5 Tagen» above the phone; warns when the time is already past
  function whenHint(ed) {
    if (!ed.scheduledLocal) return `<span class="muted">Noch kein Zeitpunkt</span>`;
    const at = new Date(zurichToUtc(ed.scheduledLocal));
    if (Number.isNaN(at.getTime())) return "";
    const day = (d) => new Date(utcToZurichLocal(d.toISOString()).slice(0, 10) + "T00:00:00Z").getTime();
    const days = Math.round((day(at) - day(new Date())) / 864e5);
    const rel = at < new Date() ? `<span class="error">liegt in der Vergangenheit</span>`
      : days === 0 ? "heute" : days === 1 ? "morgen" : `in ${days} Tagen`;
    return `<span class="muted">${esc(formatZurich(at.toISOString()))}</span> · ${rel}`;
  }

  function replyField(ed, dis) {
    const post = ed.isNew ? null : posts().find((p) => p.id === ed.id);
    if (post && post.status === "published") return replyHtml(post) + quizHtml(post);
    return `<label class="field">Antwort darauf (optional, z. B. die Auflösung der Frage)
        <textarea name="soc-reply" rows="2" maxlength="${LIMITS.reply + 200}" placeholder="Schreibt das Cockpit selbst als Antwort unter den ersten Kommentar"${dis}>${esc(ed.first_comment_reply)}</textarea></label>
      <label class="field soc-reply-hours">Antwort senden nach
        <span><input type="number" name="soc-reply-hours" min="${REPLY_HOURS.min}" max="${REPLY_HOURS.max}" step="0.5" value="${esc(ed.first_comment_reply_after_hours)}"${dis}> Stunden
        <span class="muted small" id="soc-reply-when">${replyWhen(ed)}</span></span></label>
      <label class="field">Quiz: richtige Lösung (optional, Stichwörter mit Komma)
        <input name="soc-quiz-answer" maxlength="1000" value="${esc(ed.quiz_answer)}" placeholder="z. B. standard air, ISA, standard atmosphere"${dis}></label>
      <label class="field">Automatische Antwort bei richtiger Lösung <span class="muted small">eine pro Zeile, das Cockpit wählt zufällig</span>
        <textarea name="soc-quiz-replies" rows="3" maxlength="2000" placeholder="Spot on 👏&#10;Exactly, standard air 👌"${dis}>${esc(ed.quiz_correct_replies)}</textarea></label>`;
  }
  function replyWhen(ed) {
    const h = replyHours(ed.first_comment_reply_after_hours);
    const at = zurichToUtc(ed.scheduledLocal);
    return h && at && ed.first_comment_reply.trim() ? `ca. ${esc(formatZurich(new Date(new Date(at).getTime() + h * 3600e3).toISOString()))}` : "";
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
      <div class="phone-head"><span class="avatar"></span><b>${esc(handle)}</b>${ed.ai && !isYoutube(ed.account_id) ? `<span class="phone-ai">KI-Info</span>` : ""}${ed.kind === "story" ? `<span class="muted small">Story</span>` : ""}</div>
      <div class="phone-media${slider ? " slider" : ""}" style="aspect-ratio:${ratio}">${media}</div>
      ${dots}
      ${isYoutube(ed.account_id) ? `<div class="phone-caption"><b>${esc(ed.title || "(Titel fehlt)")}</b><br><span class="muted small">@${esc(handle)} · YouTube Short</span></div>` : ""}
      ${vertical ? "" : `<div class="phone-caption"><b>${esc(handle)}</b> ${cap}</div>${ed.first_comment.trim() ? `<div class="phone-comment"><b>${esc(handle)}</b> ${esc(ed.first_comment.slice(0, 80))}</div>` : ""}${ed.first_comment.trim() && ed.first_comment_reply?.trim() ? `<div class="phone-comment reply"><b>${esc(handle)}</b> ${esc(ed.first_comment_reply.slice(0, 80))} <span class="small">· nach ${hoursLabel(replyHours(ed.first_comment_reply_after_hours) ?? REPLY_HOURS.default)}</span></div>` : ""}`}
    </div>
    <p class="small muted">${isYoutube(ed.account_id) ? "Vorschau, ungefähr wie ein YouTube Short auf dem iPhone. Das Titelbild wählt YouTube selbst (ändern geht in der YouTube-App)." : "Vorschau, ungefähr wie auf dem iPhone. Instagram schneidet Feed-Bilder auf 4:5 bis 1.91:1 zu."}</p>`;
  }

  function refreshBits() {
    const ed = S.social.editor;
    if (!ed) return;
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set("soc-counter", counterHtml(ed));
    set("soc-title-counter", titleCounter(ed));
    set("soc-checks", checksHtml(ed));
    set("soc-preview", previewHtml(ed, account(ed.account_id)));
    set("soc-reply-when", replyWhen(ed));
    set("soc-when-hint", whenHint(ed));
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
  const afterRender = () => {
    if (S.social.editor) syncSlider(false);
    const s = document.activeElement;
    if (s?.name === "soc-search") s.setSelectionRange(s.value.length, s.value.length);
  };

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

  // Instagram takes JPEG only: PNG/WebP (and HEIC where the browser can read it) become JPEG here
  async function toJpeg(file) {
    const type = file.type || guessType(file.name);
    if (!/^image\//.test(type) && !/\.(png|webp|heic|heif)$/i.test(file.name)) return file;
    if (type === "image/jpeg") return file;
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); // transparent PNG → white, not black
      g.drawImage(bmp, 0, 0);
      bmp.close();
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw new Error("toBlob");
      toast(`«${file.name}» als JPEG übernommen`);
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch {
      toast(`«${file.name}» kann der Browser nicht umwandeln – bitte als JPEG (.jpg) speichern und nochmals hochladen.`);
      return null;
    }
  }

  async function addFiles(fileList) {
    const ed = S.social.editor;
    if (!ed || readonly(ed)) return;
    const files = (await Promise.all([...fileList].map(toJpeg))).filter(Boolean);
    if (!files.length) return;
    const added = await Promise.all(files.map(probe));
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
    if (ed.kind === "reel" && ed.cover && !isYoutube(ed.account_id)) { // YouTube: no cover through the API
      cover_path = ed.cover.path;
      if (ed.cover.file) cover_path = await data.uploadFile(ed.id, ed.cover.file, "cover");
      else if (ed.cover.copyFrom) cover_path = await data.copyFile(ed.cover.copyFrom, ed.id, "image/jpeg", "cover");
      Object.assign(ed.cover, { path: cover_path, file: undefined, copyFrom: undefined });
    }
    const row = {
      account_id: ed.account_id, kind: ed.kind, title: isYoutube(ed.account_id) ? String(ed.title ?? "").trim() : "", caption: ed.kind === "story" ? "" : ed.caption,
      first_comment: ed.kind === "story" ? "" : ed.first_comment, media, cover_path: isYoutube(ed.account_id) ? null : cover_path,
      scheduled_at: zurichToUtc(ed.scheduledLocal), source: ed.source, todo: ed.todo ?? "", topic: String(ed.topic ?? "").trim() || null, location: ed.kind === "story" || isYoutube(ed.account_id) ? null : ed.location ?? null,
      ai_generated: !isYoutube(ed.account_id) && ed.ai === true,
      made_for_kids: isYoutube(ed.account_id) && ed.kids === true,
      first_comment_reply: ed.kind === "story" ? "" : String(ed.first_comment_reply ?? "").trim(),
      first_comment_reply_after_hours: replyHours(ed.first_comment_reply_after_hours) ?? REPLY_HOURS.default,
      quiz_answer: ed.kind === "story" ? [] : quizList(ed.quiz_answer),
      quiz_correct_replies: ed.kind === "story" ? [] : quizList(ed.quiz_correct_replies, /\n/),
    };
    const saved = ed.isNew ? await data.insertPost(ed.id, row) : await data.updatePost(ed.id, row, ed.updated_at);
    ed.updated_at = saved?.updated_at ?? ed.updated_at;
    ed.isNew = false;
    ed.dirty = false;
    ed.status = saved?.status ?? ed.status;
    return saved;
  }

  function confirmText(title, ed) {
    const acc = account(ed.account_id);
    const lines = firstLines(ed.caption) || (ed.kind === "story" ? "(Story)" : "(kein Text)");
    const yt = acc?.platform === "youtube";
    return `${title}\n\nKonto: ${accountLabel(acc)}\nArt: ${yt ? "YouTube-Video" : KINDS[ed.kind]}\nZeit: ${formatZurich(zurichToUtc(ed.scheduledLocal))}\n\n${yt ? `«${ed.title}»\n` : ""}${lines}${replyConfirm(ed)}${!yt && ed.ai ? "\n\n🤖 Mit KI-Info – später nicht mehr änderbar." : ""}`;
  }

  // the approval covers the prepared answer too – say so in the confirmation
  function replyConfirm(ed) {
    if (ed.kind === "story" || !String(ed.first_comment ?? "").trim()) return "";
    const { keys, texts } = quizOf(ed);
    const h = replyHours(ed.first_comment_reply_after_hours) ?? REPLY_HOURS.default;
    const reply = hasReply(ed) ? `\n↳ Antwort nach ${hoursLabel(h)}, automatisch: «${firstLines(ed.first_comment_reply, 2)}»` : "";
    const quiz = keys.length ? `\nQuiz: richtig bei «${keys.join("», «")}» → automatisch «${texts.join("» oder «")}»` : "";
    return reply || quiz ? `\n\nErster Kommentar: «${firstLines(ed.first_comment, 1)}»${reply}${quiz}` : "";
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
    return p ? { id: p.id, isNew: false, status: p.status, account_id: p.account_id, kind: p.kind, title: p.title ?? "", caption: p.caption, first_comment: p.first_comment, first_comment_reply: p.first_comment_reply ?? "", first_comment_reply_after_hours: p.first_comment_reply_after_hours, quiz_answer: p.quiz_answer, quiz_correct_replies: p.quiz_correct_replies, scheduledLocal: utcToZurichLocal(p.scheduled_at), items: p.media, busy: false } : null;
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
      else if (r?.status === "processing") toast(isYoutube(ed.account_id) ? "YouTube-Upload läuft noch – der nächste Durchgang (alle 10 Minuten) macht weiter." : "Instagram verarbeitet das Video noch – der Status aktualisiert sich von selbst.");
      else if (r?.status === "waiting") toast("Tageslimit erreicht – wird automatisch später veröffentlicht.");
      await load(true);
      if (S.social.editor?.id === id) S.social.editor.status = posts().find((p) => p.id === id)?.status ?? ed.status;
    });
  }

  // ---------- events (called from main.js) ----------
  async function onClick(action, el) {
    if (action.startsWith("soc-cmt-") || action.startsWith("soc-yt-")) return inbox.onClick(action, el);
    if (action.startsWith("soc-out-")) return outreach.onClick(action, el);
    const st = S.social;
    const ed = st.editor;
    const id = el.dataset.id;
    switch (action) {
      case "soc-filter":
        st.filter = el.dataset.value;
        if (!st.byTopic) try { history.replaceState(null, "", st.filter === "all" ? "#social" : `#social/${st.filter}`); } catch { /* sandboxed */ }
        render();
        return true;
      case "soc-status": st.status = el.dataset.value; render(); return true;
      case "soc-platform":
        st.platform = el.dataset.value;
        try { localStorage.setItem("qnh-social-platform", st.platform); } catch { /* private mode */ }
        render();
        return true;
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
        st.editor = null; st.review = null; st.reviewTopic = null; render(); load(true); return true;
      case "soc-copy":
        try { await navigator.clipboard.writeText(el.dataset.value); toast("Link kopiert – im Story-Editor beim Link-Sticker einfügen"); }
        catch { prompt("Link kopieren:", el.dataset.value); }
        return true;
      case "soc-todo-check": {
        const p = posts().find((x) => x.id === id);
        if (!p) return true;
        const before = p.todo;
        p.todo = toggleTodoLine(before, Number(el.dataset.value));
        if (st.editor?.id === id) st.editor.todo = p.todo;
        render();
        try { const row = await data.setTodo(id, p.todo); if (row?.updated_at) { p.updated_at = row.updated_at; if (st.editor?.id === id) st.editor.updated_at = row.updated_at; } }
        catch (err) { p.todo = before; if (st.editor?.id === id) st.editor.todo = before; toast(errorText(err)); render(); }
        return true;
      }
      case "soc-retry": {
        // failed → approved again, due in 2 minutes (the publish run every 10 min picks it up)
        const p = posts().find((x) => x.id === id);
        if (!p) return true;
        const when = new Date(Date.now() + 2 * 60e3).toISOString();
        const { errors } = validatePost({ kind: p.kind, items: p.media ?? [], caption: p.caption, first_comment: p.first_comment, first_comment_reply: p.first_comment_reply,
          first_comment_reply_after_hours: p.first_comment_reply_after_hours, quiz_answer: p.quiz_answer, quiz_correct_replies: p.quiz_correct_replies, title: p.title }, { forApproval: true, scheduledAt: when });
        if (!p.media?.length) { toast("Kein Bild/Video im Beitrag – zuerst «Bearbeiten» und hochladen."); return true; }
        if (errors.length) { toast(errors[0]); return true; }
        if (!confirm("Nochmals versuchen? Der Beitrag wird in den nächsten Minuten veröffentlicht.")) return true;
        try { await data.setStatus(id, "approved", when); toast("Wird in den nächsten Minuten erneut veröffentlicht."); await load(true); }
        catch (err) { toast(errorText(err)); }
        return true;
      }
      case "soc-save-topic":
        await busy(ed, async () => { const row = await data.setTopic(ed.id, ed.topic); if (row?.updated_at) ed.updated_at = row.updated_at; ed.dirty = false; toast("Thema gespeichert"); await load(true); });
        return true;
      case "soc-save-todo":
        await busy(ed, async () => { const row = await data.setTodo(ed.id, ed.todo ?? ""); if (row?.updated_at) ed.updated_at = row.updated_at; ed.dirty = false; toast("Notiz gespeichert"); await load(true); });
        return true;
      case "soc-review-topic":
        st.reviewTopic = el.dataset.value;
      // falls through: same review round, only this topic
      case "soc-review": {
        if (action === "soc-review") st.reviewTopic = null;
        st.review = { skipped: new Set(), done: 0 };
        const first = reviewQueue()[0];
        if (first) openEditor(first); else { st.review = null; st.reviewTopic = null; }
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
      case "soc-place-search": {
        const np = ed?.newPlace; if (!np) return true;
        const q = np.name.trim();
        if (!q) { toast("Zuerst den Namen des Ortes eingeben."); return true; }
        const url = el.dataset.value === "facebook"
          ? `https://www.facebook.com/search/pages/?q=${encodeURIComponent(q)}`
          : `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com/explore/locations "${q}"`)}`;
        window.open(url, "_blank", "noopener");
        return true;
      }
      case "soc-place-cancel": if (ed) { ed.newPlace = null; render(true); } return true;
      case "soc-place-save": {
        const np = ed?.newPlace; if (!np) return true;
        const placeName = np.name.trim(), pageId = placeIdFrom(np.link);
        if (!placeName) { toast("Bitte einen Namen eingeben."); return true; }
        if (!pageId) { toast("Keine gültige ID im Link gefunden."); return true; }
        try {
          await data.addLocation(pageId, placeName);
          ed.location = { id: pageId, name: placeName };
          ed.newPlace = null;
          ed.dirty = true;
          await load(true);
          toast(`Ort «${placeName}» gespeichert`);
        } catch (err) { toast(errorText(err)); }
        render(true);
        return true;
      }
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
        const accept = ed.kind === "image" ? ".jpg,.jpeg,image/jpeg,.png,image/png,.webp,image/webp,.heic,.heif" : ed.kind === "reel" ? "video/mp4,video/quicktime" : ".jpg,.jpeg,image/jpeg,.png,image/png,.webp,image/webp,.heic,.heif,video/mp4,video/quicktime";
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
    if (inbox.onInput(e)) return true;
    if (outreach.onInput(e)) return true;
    const ed = S.social.editor;
    const name = e.target.name ?? "";
    if (name === "soc-search") { S.social.q = e.target.value; render(); return true; }
    if (!ed || !name.startsWith("soc-")) return false;
    if (name === "soc-place-name" || name === "soc-place-link") {
      ed.newPlace[name === "soc-place-name" ? "name" : "link"] = e.target.value;
      const h = document.getElementById("soc-place-hint");
      if (h) h.innerHTML = placeHint(ed.newPlace);
      return true;
    }
    if (name === "soc-caption") ed.caption = e.target.value;
    else if (name === "soc-title") ed.title = e.target.value;
    else if (name === "soc-comment") ed.first_comment = e.target.value;
    else if (name === "soc-reply") ed.first_comment_reply = e.target.value;
    else if (name === "soc-reply-hours") ed.first_comment_reply_after_hours = e.target.value;
    else if (name === "soc-quiz-answer") ed.quiz_answer = e.target.value;
    else if (name === "soc-quiz-replies") ed.quiz_correct_replies = e.target.value;
    else if (name === "soc-todo") { ed.todo = e.target.value; ed.dirty = true; return true; }
    else if (name === "soc-topic") { ed.topic = e.target.value; ed.dirty = true; return true; }
    else if (name === "soc-time" || name === "soc-time-top") {
      ed.scheduledLocal = e.target.value;
      // keep the two time fields (form and the card above the phone) in step without re-rendering
      const other = document.querySelector(`[name="${name === "soc-time" ? "soc-time-top" : "soc-time"}"]`);
      if (other) other.value = e.target.value;
    }
    else if (name.startsWith("soc-alt-")) ed.items[Number(name.slice(8))].alt = e.target.value;
    else if (name.startsWith("soc-tags-")) { const it = ed.items[Number(name.slice(9))]; it.user_tags = parseTagList(e.target.value, it.user_tags); }
    else return false;
    ed.dirty = true;
    refreshBits();
    return true;
  }

  async function onChange(e) {
    if (inbox.onChange(e)) return true;
    const name = e.target.name ?? "";
    const ed = S.social.editor;
    if (name === "soc-account" && ed) {
      const wasYt = isYoutube(ed.account_id);
      ed.account_id = e.target.value;
      ed.dirty = true;
      if (ed.isNew) ed.kids = kidsDefault(ed.account_id);
      // YouTube takes one video; switching platform changes the form → full render
      if (isYoutube(ed.account_id)) { ed.kind = "reel"; ed.items = ed.items.filter((i) => /^video\//.test(i.type)).slice(0, 1); }
      if (wasYt !== isYoutube(ed.account_id)) render(); else refreshBits();
      return true;
    }
    if (name === "soc-ai" && ed) { ed.ai = e.target.checked; ed.dirty = true; render(); return true; }
    if (name === "soc-kids" && ed) { ed.kids = e.target.checked; ed.dirty = true; render(); return true; }
    if (name === "soc-location" && ed) {
      const v = e.target.value;
      if (v !== "__new") { const p = places().find((x) => x.page_id === v); ed.location = v ? { id: v, name: p?.name ?? ed.location?.name ?? v } : null; ed.dirty = true; return true; }
      ed.newPlace = { name: "", link: "" };
      render(true);
      setTimeout(() => document.querySelector('[name="soc-place-name"]')?.focus(), 0);
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
        title: pkg.title ?? "", caption: pkg.caption, first_comment: pkg.first_comment, first_comment_reply: pkg.first_comment_reply, first_comment_reply_after_hours: pkg.first_comment_reply_after_hours, quiz_answer: pkg.quiz_answer.join(", "), quiz_correct_replies: pkg.quiz_correct_replies.join("\n"), todo: IMPORT.todo ? pkg.todo : "", ai: pkg.ai === true, kids: pkg.made_for_kids === true, location: resolvePlace(pkg.location), scheduledLocal: pkg.suggested_time ? utcToZurichLocal(pkg.suggested_time) : tomorrowAt18(),
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

  // #social/kommentare opens the inbox, #social/bei-anderen the suggestions (links from «Heute»)
  const setMode = (mode) => { if (["list", "calendar", "comments", "stats", "outreach"].includes(mode)) S.social.mode = mode; };
  // checklist of one post for «Heute» (same checkboxes as in the list, action soc-todo-check)
  function todoChecklist(id) {
    const p = posts().find((x) => x.id === id);
    return p ? todoBox(p.todo, PLATFORM[account(p.account_id)?.platform] ?? "Instagram", p.id) : "";
  }
  // small still phone for the «Heute» list: which post is it? (cover or first frame, handle, start of the text)
  function miniPhone(id) {
    const p = posts().find((x) => x.id === id);
    if (!p) return "";
    const a = account(p.account_id);
    const yt = isYoutube(p.account_id);
    const first = p.media?.[0];
    const vertical = p.kind === "story" || p.kind === "reel" || yt;
    let media = `<span class="phone-img empty">kein Bild</span>`;
    if (p.media_deleted_at) media = `<span class="phone-img empty">Datei entfernt</span>`;
    else if (p.cover_path) media = `<img class="phone-img" src="${esc(data.mediaUrl(p.cover_path))}" alt="" loading="lazy" decoding="async">`;
    else if (first && /^video\//.test(first.type)) media = `<video class="phone-img" src="${esc(data.mediaUrl(first.path))}#t=0.5" muted playsinline preload="metadata"></video>`;
    else if (first) media = `<img class="phone-img" src="${esc(data.mediaUrl(first.path))}" alt="${esc(first.alt ?? "")}" loading="lazy" decoding="async">`;
    const ratio = vertical ? "9 / 16" : first?.width ? `${first.width} / ${first.height}` : "4 / 5";
    const text = yt ? p.title || p.caption : p.caption;
    return `<div class="phone mini${vertical ? " vertical" : ""}" aria-label="Vorschau des Beitrags">
      <div class="phone-head"><span class="avatar"></span><b>${esc(a?.handle ?? "konto")}</b></div>
      <div class="phone-media" style="aspect-ratio:${ratio}">${media}${p.kind === "reel" || yt ? `<span class="mini-play" aria-hidden="true">▶</span>` : ""}</div>
      ${text?.trim() ? `<div class="phone-caption">${esc(firstLines(text, 2).slice(0, 70))}</div>` : ""}
    </div>`;
  }
  const todoProgress = (t) => { const l = todoLines(t); return { done: l.filter((x) => x.done).length, total: l.length }; };
  return { todoChecklist, miniPhone, todoProgress, todoFirstOpen, onScroll, afterRender, todoOpen, load, view, overviewCard, badge, onClick, onInput, onChange, onDrop, onDragOver, onDragStart, setMode,
    commentCount: () => inbox.count(), outreachCount: () => outreach.count(), onKeydown: (e) => outreach.onKeydown(e) };
}
