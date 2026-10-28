import "./style.css";
import { APPS, BRANDS, QNH, appById } from "./apps.js";
import * as api from "./api.js";
import { esc, relTime, shortDate, num, sourceLabel, errorText } from "./format.js";
import { bucket, chartSvg, periodLabel, sparkSvg } from "./charts.js";
import { search, greeting, firstName } from "./search.js";
import { createSocial } from "./social/ui.js";
import { socialConfigured } from "./social/data.js";
import { formatZurich, isPlaceholder } from "./social/validate.js";
import { createQnh } from "./qnh/ui.js";
import { qnhReady } from "./qnh/data.js";
import { createStore } from "./store/ui.js";
import { createStudio } from "./studio/ui.js";
import { createFinance } from "./finance/ui.js";
import { financeConfigured } from "./finance/data.js";
import { billDue, money, moneyList, monthlyTotals, owedPrivately, sumBy, upcoming, zurichToday } from "./finance/calc.js";
import { isOpen } from "./social/inbox.js";
import { LANES, buildAgenda, isoWeek, laneForDate, needsYou } from "./today.js";

const TREND_RANGES = [[30, "30 Tage"], [91, "3 Monate"], [182, "6 Monate"], [365, "1 Jahr"]];
const TAB_LABELS = { overview: "Übersicht", store: "Store & Builds", roadmap: "Roadmap", trend: "Verlauf", feedback: "Feedback", errors: "Fehler", beta: "Beta", verify: "Verifizierung", reports: "Meldungen" };
const ERROR_DAYS = [1, 7, 30];

// Photos by Jürg Umbricht (@exploring_the_skies), retouched and published on flydownwind.ch with his OK.
// Loaded from there (not copied into this public repo); credit on every use.
const PHOTO_BASE = "https://flydownwind.ch/assets/photos/";
const photoCredit = () => `<a class="credit" href="https://www.instagram.com/exploring_the_skies" target="_blank" rel="noopener">Foto: Jürg Umbricht · @exploring_the_skies</a>`;

const S = {
  agOpen: new Set(), // «Heute» rows with a checklist that are folded out
  tab: "today", // today | social | overview | <app tab>
  appId: APPS.find((a) => a.tabs?.length)?.id,
  users: {}, // appId -> user | null
  login: {}, // appId -> { step, email, busy, error }
  data: {}, // "<appId>:<kind>" -> { loading, error, value }
  shots: {}, // feedback id -> { url, exp } signed screenshot URL (expires, see fresh())
  docs: {}, // verification id -> { url, exp } signed licence photo URL
  feedbackFilter: "new",
  verifyFilter: "pending",
  reportsFilter: "open",
  errorDays: 7,
  trendDays: 91,
  betaFilter: "new",
  toast: "",
  lastLoad: 0,
  search: { open: false, q: "", sel: 0 },
  sheet: null, // "menu" (phone: Hangar, search, theme …) | "new" (quick add) | null
  theme: readTheme(), // "light" | "dark" | null (= follow the system)
};

const root = document.getElementById("app");
const SCOPES = [{ id: "qnh", name: "QNH", color: "#0B7285" }, ...[...APPS, ...BRANDS].map((a) => ({ id: a.id, name: a.name, color: a.color }))];
const qnh = createQnh({ S, render: () => render(), toast: (t) => toast(t), errorText, scopes: SCOPES });
const store = createStore({ S, render: () => render(), toast: (t) => toast(t), errorText });
const social = createSocial({ S, render: (force) => render(force), toast: (t) => toast(t), errorText, appName: (id) => appById(id)?.name ?? id,
  appBadge: (id) => appBadge(appById(id) ?? { name: id, color: "#0B7285" }), brands: () => [...APPS, ...BRANDS].map(({ id, name }) => ({ id, name })), studioFor: (id) => studio.itemForPost(id) });
const studio = createStudio({ S, render: (force) => render(force), toast: (t) => toast(t), errorText, approvePost: (id) => social.approvePost(id) });
const scopeBadge = (id) => appBadge(id === "qnh" ? { name: "QNH", color: "#0B7285" } : appById(id) ?? { name: id, color: "#627d98" });
const finance = createFinance({ S, render: () => render(), toast: (t) => toast(t), errorText, scopes: () => SCOPES, scopeBadge });
const app = () => appById(S.appId);
const live = (a) => !a.offline && api.configured(a);
const GLOBAL_TABS = ["today", "social", "studio", "roadmap-all", "hangar", "finance", "apps"];
const isAppPage = () => !GLOBAL_TABS.includes(S.tab);
const appTabs = (a) => ["overview", ...(a.offline ? [] : a.tabs ?? []), ...(a.store ? ["store"] : []), "roadmap"];

// ---------------------------------------------------------------------------
// Theme (per browser; a convenience only)
// ---------------------------------------------------------------------------

function readTheme() {
  try { return localStorage.getItem("qnh-theme"); } catch { return null; }
}
function applyTheme() {
  if (S.theme) document.documentElement.dataset.theme = S.theme;
  else delete document.documentElement.dataset.theme;
}
const darkNow = () => S.theme === "dark" || (!S.theme && matchMedia("(prefers-color-scheme: dark)").matches);
applyTheme();

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function load(a, kind, fn, force = false) {
  const key = `${a.id}:${kind}`;
  const prev = S.data[key];
  // a forced reload during a running load runs once more afterwards (else the older answer would win)
  if (prev?.loading) { if (force) prev.again = true; return; }
  if (prev && !force && !prev.error) return;
  S.data[key] = { ...prev, loading: true, error: null, again: false };
  render();
  let next;
  try {
    next = { value: await fn(), loading: false };
  } catch (error) {
    next = { value: prev?.value, error, loading: false };
  }
  const again = S.data[key]?.again;
  if (!S.data[key]) return render();   // signed out meanwhile: drop the answer
  S.data[key] = next;
  render();
  if (again) load(a, kind, fn, true);
}

function ensureData(force = false) {
  S.lastLoad = Date.now();
  for (const a of APPS) {
    if (!live(a) || !S.users[a.id]) continue;
    // small and cheap: feed the sidebar badges and "Heute" on every page
    load(a, "stats", () => api.stats(a), force);
    if (a.tabs.includes("verify")) load(a, "verify", () => api.verificationQueue(a), force);
    if (a.tabs.includes("reports")) load(a, "reports", () => api.reports(a), force);
    if (S.tab === "today" || (S.tab === "overview" && a.id === S.appId)) load(a, "trend30", () => api.timeseries(a, 30), force);
  }
  if (socialConfigured() && (api.DEMO || S.users[QNH.id])) social.load(force);
  if (qnhReady() && (api.DEMO || S.users[QNH.id])) {
    qnh.load(force);
    studio.load(force);
    store.load(APPS, force);
    if (financeConfigured()) finance.load(force);
  }
  const a = app();
  if (!isAppPage() || !a || !S.users[a.id]) return;
  if (S.tab === "trend") load(a, `trend${S.trendDays}`, () => api.timeseries(a, S.trendDays), force);
  if (S.tab === "feedback") load(a, "feedback", () => api.feedback(a), force);
  if (S.tab === "errors") load(a, `errors${S.errorDays}`, () => api.errors(a, S.errorDays), force);
  if (S.tab === "beta") load(a, "beta", () => api.betaSignups(a), force);
}

// #  #social  #downwind  #downwind/feedback
function route() {
  const [first, second] = location.hash.replace(/^#\/?/, "").split("/");
  const a = first && first !== QNH.id ? appById(first) : null;
  if (first === "social") {
    S.tab = "social";
    S.social.byTopic = second === "themen"; // Social → Themen: same posts, grouped by topic
    if (second === "kommentare") social.setMode("comments");
    else if (second === "bei-anderen") social.setMode("outreach");
    else if (second === "wochenplan") { S.social.filter = "all"; social.setMode("week"); }
    else if (second === "themen") { S.social.filter = "all"; social.setMode("list"); }
    else S.social.filter = second && [...APPS, ...BRANDS].some((b) => b.id === second) ? second : "all"; // a channel from the sidebar, else all
  }
  else if (first === "studio") { S.tab = "studio"; studio.setItemFromRoute(second || null); }
  else if (first === "apps") S.tab = "apps";
  else if (first === "roadmap") S.tab = "roadmap-all";
  else if (first === "hangar") S.tab = "hangar";
  else if (first === "finanzen") S.tab = "finance";
  else if (a) {
    S.appId = a.id;
    S.tab = appTabs(a).includes(second) ? second : "overview";
  } else S.tab = "today";
  closeSearch(false);
  S.sheet = null;
  ensureData();
  render();
  document.querySelector(".main-col")?.scrollTo?.(0, 0);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// The first login: QNH Core if it is set up, otherwise the first app. Until then the page shows
// nothing but "QNH Cockpit – intern" (no app names). The data itself is protected by the admin
// functions in each database, not by this screen.
function gateApp() {
  if (api.DEMO) return null;
  return QNH.url && QNH.anonKey ? QNH : APPS.find(live) ?? null;
}

let lastHtml = "";
function render(force = false) {
  const focused = document.activeElement?.name;
  const gate = gateApp();
  const html = gate && !S.users[gate.id]
    ? `<main class="gate" style="--photo:url('${PHOTO_BASE}band.webp')"><section class="gate-card">${logo()}<h1>QNH Cockpit</h1><p class="muted">intern</p>${loginForm(gate, true)}</section>${photoCredit()}</main>`
    : shell();
  // many state changes (loading flags, realtime echoes) produce the same page: skip the costly rebuild
  if (!force && html === lastHtml && root.childElementCount) return;
  lastHtml = html;
  root.innerHTML = html;
  if (focused) root.querySelector(`[name="${focused}"]`)?.focus();
  sheetFocus();
  social.afterRender();
  if (S.tab === "studio") studio.afterRender();
}

// initials for the account button on the phone («christoph.umbricht@…» → «CU»)
function initials() {
  const user = S.users[QNH.id] ?? Object.values(S.users).find(Boolean) ?? (api.DEMO ? { email: "christoph.umbricht@setqnh.ch" } : null);
  const parts = String(user?.email ?? "").split("@")[0].split(/[._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "Q").toUpperCase();
}

// Desktop: dark sidebar (work · apps · social channels · Hangar). Phone: the same items as a bottom bar with five
// slots (Heute, Aufgaben, Apps, Social, Finanzen); Hangar, search and settings sit behind the initials up top.
function shell() {
  const lanes = agenda();
  const todoCount = needsYou(lanes);
  const navItem = (href, on, iconHtml, label, n, cls = "", extra = "") =>
    `<a href="${href}" class="nav-item${cls ? ` ${cls}` : ""}${on ? " on" : ""}"${on ? ' aria-current="page"' : ""}${extra}>${iconHtml}<span class="nav-label">${Array.isArray(label) ? `<span class="desk-text">${esc(label[0])}</span><span class="phone-text">${esc(label[1])}</span>` : esc(label)}</span>${n ? `<span class="badge${cls.includes("hot") ? " hot" : ""}">${n}</span>` : ""}</a>`;
  const appItems = APPS.map((a) => {
    const n = todos(a).length;
    return navItem(`#${a.id}`, isAppPage() && S.appId === a.id, appBadge(a), a.name, n, "desk-only", ` style="--app:${esc(a.color)}"`);
  }).join("");
  const appsBadge = APPS.reduce((n, a) => n + todos(a).length, 0);
  const channels = socialConfigured() ? (S.social?.value?.accounts ?? []).filter((x) => x.active !== false) : [];
  const channelItems = channels.map((c) => `<a class="nav-sub desk-only${S.tab === "social" && !S.social.byTopic && S.social.filter === c.app_id ? " on" : ""}" href="#social/${esc(c.app_id)}">${icon(c.platform === "youtube" ? "play" : "camera")}<span class="nav-label">${esc(c.platform === "youtube" ? c.handle || appById(c.app_id)?.name || "YouTube" : `@${c.handle}`)}</span></a>`).join("");
  const finBadge = financeConfigured() ? finance.badge() : 0;
  return `<div class="shell"${S.sheet ? " inert" : ""}>
    <aside class="side" aria-label="Navigation">
      <a href="#" class="brand" aria-label="QNH Cockpit – Heute">${logo()}<span>QNH <b>Cockpit</b></span></a>
      <button class="search-btn" data-action="search-open">${icon("search")}<span>Suchen</span><kbd>Ctrl K</kbd></button>
      <nav class="side-nav">
        ${navItem("#", S.tab === "today", icon("home"), "Heute", todoCount, lanes.now.length ? "hot" : "")}
        ${qnhReady() ? navItem("#roadmap", S.tab === "roadmap-all", icon("tasks"), "Aufgaben", 0) : ""}
        ${qnhReady() && financeConfigured() ? navItem("#finanzen", S.tab === "finance", icon("wallet"), "Finanzen", finBadge, "desk-only hot") : ""}
        <p class="side-label">Apps</p>
        ${appItems}
        ${navItem("#apps", S.tab === "apps" || isAppPage(), icon("grid"), "Apps", appsBadge, "phone-only")}
        ${qnhReady() && socialConfigured() ? `<p class="side-label">Social</p>
          ${navItem("#social", S.tab === "social" && !S.social.byTopic && (!channels.length || S.social.filter === "all"), icon("chat"), [channels.length ? "Alle Kanäle" : "Social", "Social"], social.badge())}
          ${navItem("#social/themen", S.tab === "social" && !!S.social.byTopic, icon("grid"), "Themen", 0, "desk-only")}
          ${navItem("#studio", S.tab === "studio", icon("play"), "Studio", studio.badge(), "desk-only")}
          ${channelItems}` : ""}
        ${qnhReady() && financeConfigured() ? navItem("#finanzen", S.tab === "finance", icon("wallet"), "Finanzen", finBadge, "phone-only hot") : ""}
        ${qnhReady() ? navItem("#hangar", S.tab === "hangar", icon("folder"), "Hangar", 0, "desk-only nav-bottom") : ""}
      </nav>
      <div class="side-foot">
        <span class="avatar-chip" aria-hidden="true">${esc(initials())}</span>
        ${api.DEMO ? `<span class="demo">Demo-Daten</span>` : ""}
        <button class="icon-btn" data-action="theme" title="${darkNow() ? "Hell" : "Dunkel"}" aria-label="Farbschema wechseln">${icon(darkNow() ? "sun" : "moon")}</button>
        <button class="icon-btn" data-action="refresh" title="Aktualisieren" aria-label="Aktualisieren">${icon("refresh")}</button>
        ${!api.DEMO && S.users[QNH.id] ? `<button class="icon-btn" data-action="sign-out" data-app="${QNH.id}" title="Abmelden" aria-label="Abmelden">${icon("logout")}</button>` : ""}
      </div>
    </aside>
    <div class="main-col">
      <div class="mobile-top">
        <a href="#" class="brand">${logo()}<span>QNH <b>Cockpit</b></span></a>
        ${api.DEMO ? `<span class="demo">Demo</span>` : ""}
        <button class="top-btn" data-action="search-open" aria-label="Suchen">${icon("search")}</button>
        <button class="top-btn avatar-btn" data-action="sheet" data-value="menu" aria-label="Menü: Hangar, Suchen, Einstellungen" aria-expanded="${S.sheet === "menu"}">${esc(initials())}</button>
      </div>
      ${pageHead()}
      <main class="page">${view()}</main>
    </div>
    ${qnhReady() && !(S.tab === "finance" && S.fin?.form) && !(S.tab === "social" && S.social?.editor) ? `<button class="fab" data-action="sheet" data-value="new" aria-label="Neu: Aufgabe, Rechnung oder Beitrag" aria-expanded="${S.sheet === "new"}">${icon("plus")}</button>` : ""}
  </div>
  ${S.sheet ? sheet() : ""}
  ${S.search.open ? palette() : ""}
  ${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ""}`;
}

// an open sheet takes the focus (the page behind is inert); when it closes, focus goes back to the button that opened it
let sheetWas = null;
function sheetFocus() {
  if (S.sheet && !root.querySelector(".sheet")?.contains(document.activeElement)) root.querySelector(".sheet .sheet-item")?.focus();
  if (!S.sheet && sheetWas) {
    const back = [...root.querySelectorAll(`[data-action="sheet"][data-value="${sheetWas}"]`)].find((b) => b.offsetParent !== null);
    back?.focus();
  }
  sheetWas = S.sheet;
}

// small menus: «Neu» (quick add from anywhere) and, on the phone, what does not fit in the bottom bar
function sheet() {
  const item = (attrs, ico, label, sub = "") => `<button class="sheet-item" ${attrs}>${icon(ico)}<span><b>${esc(label)}</b>${sub ? `<span class="muted small">${esc(sub)}</span>` : ""}</span></button>`;
  const body = S.sheet === "new"
    ? `<h2>Neu</h2>
      ${item('data-action="quick-task"', "tasks", "Aufgabe", "in die Roadmap")}
      ${financeConfigured() ? item('data-action="quick-bill"', "wallet", "Rechnung erfassen", "PDF oder Foto, QR-Rechnung wird gelesen") : ""}
      ${socialConfigured() && S.social?.value?.accounts?.length ? item('data-action="go-new-post"', "chat", "Beitrag", "Instagram oder YouTube") : ""}
      ${socialConfigured() ? item('data-action="quick-package"', "folder", "Paket importieren", "Ordner oder ZIP mit post.json") : ""}`
    : `<h2>Menü</h2>
      ${qnhReady() ? item('data-action="go" data-value="#studio"', "play", "Digital Studio", studio.badge() ? `${studio.badge()} warten auf Sichtung` : "Beiträge sichten") : ""}
      ${item('data-action="go" data-value="#hangar"', "folder", "Hangar", "Links und Ablage")}
      ${item('data-action="search-open"', "search", "Suchen")}
      ${item('data-action="theme"', darkNow() ? "sun" : "moon", darkNow() ? "Helles Farbschema" : "Dunkles Farbschema")}
      ${item('data-action="refresh"', "refresh", "Aktualisieren")}
      ${!api.DEMO && S.users[QNH.id] ? item(`data-action="sign-out" data-app="${QNH.id}"`, "logout", "Abmelden") : ""}`;
  return `<div class="sheet-backdrop" data-action="sheet-close"><div class="sheet sheet-${S.sheet}" role="dialog" aria-modal="true" aria-label="${S.sheet === "new" ? "Neu" : "Menü"}">${body}
    <button class="sheet-close btn ghost" data-action="sheet-close">Schliessen</button></div></div>`;
}

function pageHead() {
  if (S.tab === "today") {
    const user = S.users[QNH.id] ?? Object.values(S.users).find(Boolean) ?? (api.DEMO ? { email: "christoph@setqnh.ch" } : null);
    const name = firstName(user?.email);
    const day = zurichToday();
    const d = new Date(`${day}T12:00:00`);
    const eyebrow = `${d.toLocaleDateString("de-CH", { weekday: "short" }).replace(".", "").toUpperCase()} ${d.toLocaleDateString("de-CH")} · KW ${isoWeek(day)}`;
    return `<header class="page-head hello">
      <div class="hello-row">
        <div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(greeting())}${name ? `, ${esc(name)}` : ""}</h1><p class="lead">${esc(leadLine(agenda()))}</p></div>
        <div class="hello-actions">
          <button class="btn ghost" data-action="search-open">${icon("search")} Suchen <kbd>Ctrl K</kbd></button>
          ${qnhReady() ? `<button class="btn" data-action="sheet" data-value="new">${icon("plus")} Neu</button>` : ""}
        </div>
      </div>
    </header>`;
  }
  if (S.tab === "roadmap-all") {
    return `<header class="page-head"><div class="ph-title">${icon("tasks", "ph-icon")}<div><h1>Aufgaben</h1><p class="muted">Roadmap: Ideen und nächste Schritte – für QNH und alle Apps.</p></div></div></header>`;
  }
  if (S.tab === "apps") {
    return `<header class="page-head"><div class="ph-title">${icon("grid", "ph-icon")}<div><h1>Apps</h1><p class="muted">Deine Apps – Zahlen, Store und Roadmap.</p></div></div></header>`;
  }
  if (S.tab === "hangar") {
    return `<header class="page-head"><div class="ph-title">${icon("folder", "ph-icon")}<div><h1>Hangar</h1><p class="muted">Alle Werkzeuge und deine Ablage – ein Klick entfernt.</p></div></div></header>`;
  }
  if (S.tab === "finance") {
    return `<header class="page-head"><div class="ph-title">${icon("wallet", "ph-icon")}<div><h1>Finanzen</h1><p class="muted">Kosten, Abos und Rechnungen – bezahlt wird im E-Banking, hier behältst du den Überblick.</p></div></div></header>`;
  }
  if (S.tab === "studio") {
    return `<header class="page-head"><div class="ph-title">${icon("play", "ph-icon")}<div><h1>Digital Studio</h1><p class="muted">Jeder Beitrag höchstens zweimal ansehen: Marker setzen, dann freigeben.</p></div></div></header>`;
  }
  if (S.tab === "social") {
    const v = S.social?.value;
    const now = Date.now();
    const week = v ? v.posts.filter((p) => ["approved", "draft"].includes(p.status) && p.scheduled_at && new Date(p.scheduled_at).getTime() > now && new Date(p.scheduled_at).getTime() < now + 7 * 864e5).length : 0;
    const channels = v ? v.accounts.filter((x) => x.active !== false).length : 0;
    const open = social.commentCount();
    const line = v ? `${channels} ${channels === 1 ? "Kanal" : "Kanäle"} · ${week} ${week === 1 ? "Beitrag" : "Beiträge"} in den nächsten 7 Tagen · ${open} ${open === 1 ? "Kommentar" : "Kommentare"} offen`
      : "Instagram und YouTube aller Apps – du gibst jeden Beitrag frei und beantwortest Kommentare hier.";
    return `<header class="page-head"><div class="ph-title">${icon("chat", "ph-icon")}<div><h1>Social</h1><p class="muted">${esc(line)}</p></div></div></header>`;
  }
  const a = app();
  const stats = S.data[`${a.id}:stats`]?.value;
  const user = S.users[a.id];
  const tabs = appTabs(a);
  return `<header class="page-head" style="--app:${esc(a.color)}">
    <div class="ph-title">${appBadge(a, "lg")}<div><h1>${esc(a.name)}</h1><p class="muted">${esc(a.tagline ?? "")}</p></div>
      ${user ? `<div class="who"><span class="muted">${esc(user.email ?? "")}</span><button class="link" data-action="sign-out" data-app="${a.id}">Abmelden</button></div>` : ""}</div>
    ${`<nav class="subtabs">${tabs.map((t) => {
      const n = t === "overview" ? 0 : badge(a, t, stats);
      return `<a href="#${a.id}${t === "overview" ? "" : `/${t}`}" class="subtab${S.tab === t ? " on" : ""}">${TAB_LABELS[t]}${n ? `<span class="badge">${n}</span>` : ""}</a>`;
    }).join("")}</nav>`}
  </header>`;
}

function badge(a, tab, stats) {
  const t = a.stats?.find((s) => s.tab === tab);
  return (t && tileValue(a, t, stats)) || 0;
}

// Number for a tile: an admin_stats() key, or a count over a loaded list (null while unknown).
function tileValue(a, t, stats) {
  if (t.list) {
    const rows = S.data[`${a.id}:${t.list}`]?.value;
    return rows ? t.count(rows) : null;
  }
  return stats ? stats[t.key] : null;
}

function view() {
  if (S.tab === "today") return todayView();
  if (S.tab === "social") return social.view();
  if (S.tab === "studio") return api.DEMO || S.users[QNH.id] ? studio.view() : `<p class="note">Für das Studio bei QNH Core anmelden (Seite «Heute»).</p>`;
  if (S.tab === "roadmap-all") return qnh.roadmapView(null);
  if (S.tab === "hangar") return qnh.hangarView();
  if (S.tab === "apps") return `<div class="app-cards apps-page">${APPS.map(appCard).join("")}</div>`;
  if (S.tab === "finance") return api.DEMO || S.users[QNH.id] ? finance.view() : `<p class="note">Für die Finanzen bei QNH Core anmelden (Seite «Heute»).</p>`;
  const a = app();
  if (S.tab === "roadmap") return qnh.roadmapView(a.id);
  if (S.tab === "store") return api.DEMO || S.users[QNH.id] ? store.view(a) : `<p class="note">Für Store & Builds bei QNH Core anmelden (Seite «Heute»).</p>`;
  if (a.offline) return `<section class="card calm-card">${icon("plane", "calm-icon")}<div><h2>Offline-App</h2><p class="muted">${esc(a.note)}</p></div></section>`;
  if (!api.configured(a)) return `<p class="note">Supabase-Adresse und Schlüssel fehlen in <code>.env</code>.</p>`;
  if (!S.users[a.id]) return `<section class="card">${loginForm(a)}</section>`;
  if (S.tab === "overview") return appOverview(a);
  if (S.tab === "trend") return trendView(a);
  if (S.tab === "feedback") return feedbackView(a);
  if (S.tab === "errors") return errorsView(a);
  if (S.tab === "beta") return betaView(a);
  if (S.tab === "verify") return verifyView(a);
  if (S.tab === "reports") return reportsView(a);
  return "";
}

// ---- "Heute": what needs you, then the numbers ---------------------------------

// «2 Dinge brauchen dich jetzt, 4 sind für heute. Der Rest kann warten.»
function leadLine(lanes) {
  const now = lanes.now.length, today = lanes.today.length, week = lanes.week.length;
  const things = (n, verb) => `${n} ${n === 1 ? `Sache ${verb[0]}` : `Dinge ${verb[1]}`}`;
  if (!now && !today) return week ? `Heute ist alles erledigt. ${things(week, ["kommt", "kommen"])} diese Woche.` : "CAVOK – alles ruhig, nichts wartet auf dich.";
  const parts = [];
  if (now) parts.push(`${things(now, ["braucht", "brauchen"])} dich jetzt`);
  if (today) parts.push(now ? `${today} ${today === 1 ? "ist" : "sind"} für heute` : `${things(today, ["ist", "sind"])} für heute`);
  return `${parts.join(", ")}.${week ? " Der Rest kann warten." : ""}`;
}

function todos(a) {
  if (!live(a)) return [];
  if (!S.users[a.id]) return [{ app: a, tone: "info", lane: "now", label: `Bei ${a.name} anmelden`, href: `#${a.id}` }];
  const s = S.data[`${a.id}:stats`]?.value;
  const out = [];
  const add = (n, one, many, tab, tone = "alert", lane = "today") => { if (n > 0) out.push({ app: a, tone, lane, n, label: `${n} ${n === 1 ? one : many}`, href: `#${a.id}/${tab}` }); };
  if (s) {
    add(s.feedback_new, "neues Feedback", "neue Feedbacks", "feedback");
    add(s.errors_24h, "Fehler in den letzten 24 h", "Fehler in den letzten 24 h", "errors", "alert", "now");
    add(s.beta_new, "neue Beta-Anmeldung", "neue Beta-Anmeldungen", "beta", "info");
  }
  for (const t of a.stats ?? []) {
    if (!t.list) continue;
    const v = tileValue(a, t, s);
    if (v > 0) out.push({ app: a, tone: "alert", lane: "today", n: v, label: `${v} ${v === 1 && t.one ? t.one : t.label}`, href: `#${a.id}/${t.tab}` });
  }
  return out;
}

// Social on «Heute»: broken posts and drafts that would miss their time first, the rest by date
function socialItems(today) {
  const v = S.social?.value;
  if (!v) return [];
  const out = [];
  const now = Date.now();
  const first = (p) => String(p.title || p.caption || "Story").split("\n").find(Boolean)?.slice(0, 70) ?? "";
  const acc = (p) => v.accounts.find((x) => x.id === p.account_id);
  const where = (p) => (acc(p)?.platform === "youtube" ? "YouTube" : "Instagram");
  for (const p of v.posts.filter((x) => x.status === "failed")) {
    out.push({ key: `post:${p.id}`, lane: "now", tone: "alert", title: `Beitrag mit Fehler: «${first(p)}»`, sub: p.last_error?.slice(0, 120), where: where(p), scope: acc(p)?.app_id, href: "#social" });
  }
  // placeholders hold a day until the video exists: a reminder 3 days ahead, not part of «Freigabe»
  for (const p of v.posts.filter((x) => x.status === "draft" && isPlaceholder(x) && x.scheduled_at && new Date(x.scheduled_at).getTime() < now + 3 * 864e5)) {
    out.push({ key: `ph:${p.id}`, lane: "now", tone: "alert", title: `Video fehlt noch: «${first(p).replace(/^PLATZHALTER · /, "")}»`, sub: `geplant ${formatZurich(p.scheduled_at)}`, where: where(p), scope: acc(p)?.app_id, href: "#social" });
  }
  const drafts = v.posts.filter((p) => p.status === "draft" && !isPlaceholder(p));
  const urgent = drafts.filter((p) => p.scheduled_at && new Date(p.scheduled_at).getTime() < now + 864e5);
  for (const p of urgent) {
    out.push({ key: `draft:${p.id}`, lane: "now", tone: "alert", title: `Noch nicht freigegeben: «${first(p)}»`, sub: `geplant ${formatZurich(p.scheduled_at)}`, where: where(p), scope: acc(p)?.app_id, href: "#social" });
  }
  const rest = drafts.length - urgent.length;
  if (rest) out.push({ key: "drafts", lane: "week", tone: "info", title: `${rest} Entw${rest === 1 ? "urf wartet" : "ürfe warten"} auf Freigabe`, sub: "Social → Freigabe-Runde", where: "Social", href: "#social" });
  const comments = social.commentCount();
  if (comments) out.push({ key: "comments", lane: "today", tone: "info", title: `${comments} Kommentar${comments === 1 ? " wartet" : "e warten"} auf Antwort`, where: "Social", href: "#social/kommentare" });
  const outreach = social.outreachCount();
  if (outreach) out.push({ key: "outreach", lane: "today", tone: "info", title: `${outreach} Kommentar-Vorschl${outreach === 1 ? "ag" : "äge"} für andere Accounts`, sub: "kopieren, in Instagram posten, abhaken", where: "Social", href: "#social/bei-anderen" });
  for (const p of v.posts) {
    if (!social.todoOpen(p.todo)) continue;
    const task = social.todoFirstOpen(p.todo).slice(0, 90);
    if (p.status === "published" && p.published_at) {
      // published in the last 3 days and not everything ticked off
      if (now - new Date(p.published_at).getTime() > 3 * 864e5) continue;
      out.push({ key: `hand:${p.id}`, lane: "now", tone: "alert", title: `Nach dem Posten: ${task}`, sub: `${where(p)} · veröffentlicht ${formatZurich(p.published_at)}`, where: where(p), scope: acc(p)?.app_id, href: "#social", checklist: p.id, progress: social.todoProgress(p.todo) });
      continue;
    }
    if (!["draft", "approved"].includes(p.status) || !p.scheduled_at) continue;
    const day = zurichToday(new Date(p.scheduled_at));
    const lane = laneForDate(day, today, { weekDays: 2 });
    if (!lane) continue;
    out.push({ key: `hand:${p.id}`, lane, tone: "info", date: day, title: `Von Hand: ${task}`, sub: `${where(p)} · ${formatZurich(p.scheduled_at)}`, where: where(p), scope: acc(p)?.app_id, href: "#social", checklist: p.id, progress: social.todoProgress(p.todo) });
  }
  for (const a of v.accounts) {
    const days = a.token_expires_at ? Math.floor((new Date(a.token_expires_at) - now) / 864e5) : null;
    if (!a.active || days === null || days >= 14) continue;
    out.push({ key: `token:${a.id}`, lane: days < 3 ? "now" : "week", tone: "alert", title: `Instagram-Token @${a.handle} läuft in ${Math.max(days, 0)} Tagen ab`, sub: "neuen Token eintragen (docs/social-setup.md)", where: "Social", href: "#social" });
  }
  return out;
}

// everything for «Heute», in lanes (src/today.js)
function agenda() {
  const today = zurichToday();
  const items = [];
  for (const a of APPS) for (const t of todos(a)) items.push({ key: `app:${a.id}:${t.href}:${t.label}`, lane: t.lane ?? "today", tone: t.tone, title: t.label, where: a.name, scope: a.id, href: t.href });
  for (const t of store.todos(APPS)) items.push({ key: `store:${t.app.id}:${t.label}`, lane: t.tone === "alert" ? "now" : "today", tone: t.tone, title: t.label, where: t.app.name, scope: t.app.id, href: t.href });
  items.push(...socialItems(today), ...qnh.agenda(today));
  if (qnhReady()) items.push(...studio.agenda());
  if (financeConfigured()) items.push(...finance.agenda(today));
  return buildAgenda(items);
}

// "Als Nächstes": the first task of the focus order – done, tomorrow, or into focus mode
function nextCard() {
  const t = qnh.nextTask();
  if (!t) return "";
  const sc = qnh.scopeOf(t.scope);
  const late = t.due && t.due < zurichToday();
  const steps = String(t.body ?? "").split("\n").map((l) => l.match(/^\s*([-•*]|\[[ x]?\])\s+(.*)$/i)).filter(Boolean).map((m) => ({ text: m[2], done: /^\[x\]$/i.test(m[1]) }));
  return `<section class="next-card" style="--app:${esc(sc.color)}" aria-labelledby="next-title">
    <span class="next-eyebrow">Als Nächstes · ${esc(sc.name)}</span>
    <h2 id="next-title">${esc(t.title)}</h2>
    ${t.due ? `<span class="next-due${late ? " late" : ""}">${late ? "überfällig" : `bis ${esc(new Date(`${t.due}T12:00:00`).toLocaleDateString("de-CH"))}`}</span>` : ""}
    ${steps.length ? `<ul class="next-steps">${steps.slice(0, 4).map((x) => `<li${x.done ? ' class="done"' : ""}>${esc(x.text)}</li>`).join("")}</ul>${steps.length > 4 ? `<span class="next-more">+ ${steps.length - 4} weitere</span>` : ""}` : ""}
    <div class="next-actions">
      <button class="btn" data-action="rm-done" data-id="${esc(t.id)}">${icon("check")} Erledigt</button>
      ${qnh.repeatSupported() ? `<button class="btn ghost" data-action="rm-snooze" data-id="${esc(t.id)}">Morgen</button>` : ""}
      <button class="link" data-action="go-focus">Fokus-Runde</button>
    </div></section>`;
}

// the badge in front of a row: the app/brand, else an icon for where it comes from
function rowBadge(t) {
  if (t.scope) return scopeBadge(t.scope);
  const ico = /social|instagram|youtube/i.test(t.where ?? "") ? "chat" : /finanz/i.test(t.where ?? "") ? "wallet" : "tasks";
  return `<span class="row-icon" aria-hidden="true">${icon(ico)}</span>`;
}

function agendaItem(t, lane) {
  const sc = t.scope ? SCOPES.find((x) => x.id === t.scope) : null;
  const label = !sc || t.where === sc.name ? t.where : `${t.where} · ${sc.name}`;
  const external = /^https?:/.test(t.href ?? "");
  const acts = (t.actions ?? []).map((a, i) => `<button class="btn${i === 0 && lane !== "week" ? "" : " ghost"} small-btn" data-action="${esc(a.action)}"${a.id ? ` data-id="${esc(a.id)}"` : ""}${a.value ? ` data-value="${esc(a.value)}"` : ""}>${esc(a.label)}</button>`).join("");
  const where = (label ? label.split(" · ") : []).filter((x) => !String(t.sub ?? "").includes(x)); // no «Social · Social → …»
  const sub = [...where, t.sub].filter(Boolean).join(" · ");
  if (t.checklist) {
    // fold out, tick off right here; when everything is ticked the row disappears (socialItems skips it)
    const open = S.agOpen.has(t.key);
    return `<li class="ag-item ${t.tone === "alert" ? "alert" : "info"}"><details class="ag-details" data-ag-key="${esc(t.key)}"${open ? " open" : ""}>
      <summary class="ag-link">
        ${rowBadge(t)}
        <span class="ag-text"><span class="ag-title">${esc(t.title)}</span><span class="ag-sub">${esc([sub, t.progress ? `${t.progress.done}/${t.progress.total} erledigt` : ""].filter(Boolean).join(" · "))}</span></span>
        <span class="ag-chevron" aria-hidden="true">▾</span>
      </summary>
      <div class="ag-body"><div class="ag-main">${social.todoChecklist(t.checklist)}<a class="link" href="${esc(t.href ?? "#social")}">Beitrag öffnen</a></div>${social.miniPhone(t.checklist)}</div>
    </details></li>`;
  }
  return `<li class="ag-item ${t.tone === "alert" ? "alert" : "info"}">
    <a class="ag-link" href="${esc(t.href ?? "#")}"${external ? ' target="_blank" rel="noopener"' : ""}>
      ${rowBadge(t)}
      <span class="ag-text"><span class="ag-title">${esc(t.title)}</span>${sub ? `<span class="ag-sub">${esc(sub)}</span>` : ""}</span>
    </a>${acts ? `<span class="ag-actions">${acts}</span>` : ""}</li>`;
}

// «heute 18:00», «Do 12:00», «24.10. 18:00» (Swiss time)
function shortWhen(iso) {
  const d = new Date(iso);
  const day = zurichToday(d), today = zurichToday();
  const time = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(d);
  const days = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5);
  if (days === 0) return `heute ${time}`;
  if (days === 1) return `morgen ${time}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", weekday: "short" }).format(d).replace(".", "")} ${time}`;
  return `${new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", day: "numeric", month: "numeric" }).format(d)} ${time}`;
}

// four instruments on top: where something burns
function statusTiles(lanes) {
  const all = [...lanes.now, ...lanes.today, ...lanes.week];
  const tile = (href, label, value, sub, alert) => `<a class="instr${alert ? " alert" : ""}" href="${href}"><span class="instr-label"><span class="instr-dot"></span>${esc(label)}</span><span class="instr-value">${esc(value)}</span><span class="instr-sub">${esc(sub)}</span></a>`;
  const out = [];
  const appRows = all.filter((i) => /^(app|store):/.test(i.key));
  const appNow = appRows.filter((i) => i.lane === "now" && i.tone === "alert"); // «Bei X anmelden» is not a fault
  out.push(tile("#apps", "Apps", appNow.length ? `${appNow.length} ${appNow.length === 1 ? "Störung" : "Störungen"}` : appRows.length ? `${appRows.length} offen` : "Alles grün",
    (appNow[0] ?? appRows[0])?.title ?? APPS.map((a) => a.name).join(" · "), appNow.length > 0));
  const v = S.social?.value;
  if (socialConfigured() && !v && S.social?.error) out.push(tile("#social", "Social", "nicht geladen", errorText(S.social.error), true));
  if (socialConfigured() && v) {
    const now = Date.now();
    const failed = v.posts.filter((p) => p.status === "failed");
    const planned = v.posts.filter((p) => p.status === "approved" && p.scheduled_at && new Date(p.scheduled_at).getTime() > now).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const acc = (p) => v.accounts.find((x) => x.id === p.account_id);
    out.push(tile("#social", "Social", failed.length ? `${failed.length} Fehler` : `${planned.length} geplant`,
      planned[0] ? `nächster ${shortWhen(planned[0].scheduled_at)} · ${acc(planned[0])?.platform === "youtube" ? "YouTube" : "Instagram"}` : "nichts geplant", failed.length > 0));
    const comments = (v.comments ?? []).filter(isOpen);
    const ready = comments.filter((c) => String(c.draft ?? "").trim()).length;
    out.push(tile("#social/kommentare", "Kommentare", comments.length ? `${comments.length} offen` : "keine offen",
      ready ? `${ready} ${ready === 1 ? "Antwortvorschlag" : "Antwortvorschläge"} bereit` : comments.length ? "warten auf Antwort" : "alles beantwortet", false));
  }
  const f = financeConfigured() ? S.fin?.value : null;
  if (financeConfigured() && !f && S.fin?.error) out.push(tile("#finanzen", "Finanzen", "nicht geladen", errorText(S.fin.error), true));
  if (f) {
    const today = zurichToday();
    const open = f.bills.filter((b) => b.status === "open");
    const late = open.filter((b) => billDue(b, today).date < today).sort((a, b) => billDue(a, today).date.localeCompare(billDue(b, today).date));
    out.push(tile("#finanzen", "Finanzen", late.length ? `${late.length} überfällig` : open.length ? `${open.length} offen` : "alles bezahlt",
      late.length ? `${late[0].payee} · ${money(late[0].amount, late[0].currency)}` : open.length ? moneyList(sumBy(open)) : `Fixkosten ${moneyList(monthlyTotals(f.costs))} / Monat`, late.length > 0));
  }
  return `<div class="instruments">${out.join("")}</div>`;
}

// the posts of the next 7 days
function airCard() {
  const v = S.social?.value;
  if (!socialConfigured()) return "";
  if (!v) return S.social?.error ? `<section class="side-card"><h2 class="side-title">Diese Woche auf Sendung</h2><p class="error small">${esc(errorText(S.social.error))}</p></section>` : "";
  const now = Date.now();
  const posts = v.posts.filter((p) => ["approved", "draft"].includes(p.status) && p.scheduled_at && new Date(p.scheduled_at).getTime() > now && new Date(p.scheduled_at).getTime() < now + 7 * 864e5)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 5);
  const acc = (p) => v.accounts.find((x) => x.id === p.account_id);
  const today = zurichToday();
  const dayLabel = (iso) => {
    const day = zurichToday(new Date(iso));
    if (day === today) return "Heute";
    return new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", weekday: "short" }).format(new Date(iso)).replace(".", "");
  };
  const time = (iso) => new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const first = (p) => String(p.title || p.caption || "Story").split("\n").find(Boolean)?.slice(0, 60) ?? "";
  return `<section class="side-card" aria-labelledby="air-title"><div class="side-card-head"><h2 id="air-title">Diese Woche auf Sendung</h2><a href="#social">Alle Beiträge</a></div>
    ${posts.length ? `<ul class="air-list">${posts.map((p) => {
      const a = acc(p);
      return `<li><span class="air-when"><span>${esc(dayLabel(p.scheduled_at))}</span><b>${esc(time(p.scheduled_at))}</b></span>
        <span class="air-what"><b>${esc(first(p))}</b><span class="muted small">${icon(a?.platform === "youtube" ? "play" : "camera")} ${esc(a?.platform === "youtube" ? `YouTube · ${a?.handle ?? ""}` : `Instagram · @${a?.handle ?? ""}`)}</span></span>
        <span class="pill ${p.status === "approved" ? "approved" : "draft"}">${p.status === "approved" ? "freigegeben" : "Entwurf"}</span></li>`;
    }).join("")}</ul>` : `<p class="muted small">Nichts geplant in den nächsten 7 Tagen.</p>`}
  </section>`;
}

// money at a glance
function moneyCard() {
  const v = financeConfigured() ? S.fin?.value : null;
  if (!v) return financeConfigured() && S.fin?.error ? `<section class="side-card"><h2 class="side-title">Geld</h2><p class="error small">${esc(errorText(S.fin.error))}</p></section>` : "";
  const today = zurichToday();
  const open = v.bills.filter((b) => b.status === "open");
  const next = upcoming(v.costs, v.bills, today, 30)[0];
  const owed = v.bills.filter(owedPrivately);
  const row = (label, value, sub = "") => `<div class="money-row"><span class="muted small">${esc(label)}</span><b class="mono-num">${esc(value)}</b>${sub ? `<span class="small">${esc(sub)}</span>` : ""}</div>`;
  return `<section class="side-card" aria-labelledby="money-title"><div class="side-card-head"><h2 id="money-title">Geld</h2><a href="#finanzen">Finanzen</a></div>
    ${row("Fixkosten pro Monat", moneyList(monthlyTotals(v.costs)))}
    ${row(`Offen · ${open.length} ${open.length === 1 ? "Rechnung" : "Rechnungen"}`, moneyList(sumBy(open)))}
    ${owed.length ? row("Offen an Christoph", moneyList(sumBy(owed)), `${owed.length} privat bezahlt`) : ""}
    ${next ? row(`Nächste Zahlung · ${new Date(`${next.date}T12:00:00`).toLocaleDateString("de-CH", { day: "numeric", month: "short" })}`, money(next.amount, next.currency), next.name) : ""}
  </section>`;
}

function todayView() {
  const lanes = agenda();
  const total = lanes.now.length + lanes.today.length + lanes.week.length;
  const laneHtml = LANES.map(([k, title, hint]) => {
    const list = lanes[k];
    if (!list.length && k !== "today") return "";
    const head = `<h2 class="lane-title"><span class="lane-dot"></span>${title}${list.length ? ` <span class="lane-count">${list.length}</span>` : ""}<span class="lane-hint">${hint}</span></h2>`;
    if (!list.length) return `<section class="lane lane-today">${head}<p class="muted small lane-empty">Für heute ist alles erledigt ✓</p></section>`;
    return `<section class="lane lane-${k}">${head}<ul class="ag-list">${list.map((t) => agendaItem(t, k)).join("")}</ul></section>`;
  }).join("");
  const calm = `<div class="card calm-card">${icon("plane", "calm-icon")}<div><h2>Ruhiger Flug</h2><p class="muted">Nichts überfällig, nichts für heute, nichts diese Woche. Zeit zum Fliegen.</p></div></div>`;
  return `${statusTiles(lanes)}
    <div class="today-grid">
      <div class="today-main agenda">${total ? laneHtml : calm}</div>
      <aside class="today-side">${nextCard()}${airCard()}${moneyCard()}</aside>
      <section class="today-apps"><h2 class="section-title">Apps</h2><div class="app-cards">${APPS.map(appCard).join("")}</div></section>
    </div>`;
}

function sparkFor(a, key, kind) {
  const rows = S.data[`${a.id}:trend30`]?.value;
  return rows?.length ? sparkSvg(rows.map((r) => r[key]), kind) : "";
}

function goalBar(a, s, big = false) {
  const g = a.goal;
  if (!g || !s) return "";
  const v = Number(s[g.key]) || 0;
  const pct = Math.min(100, Math.round((v / g.target) * 100));
  const done = v >= g.target;
  return `<div class="goal${big ? " big" : ""}${done ? " done" : ""}">
    <div class="goal-top"><span class="goal-label">${esc(g.label)}</span><span class="goal-num"><b>${num(v)}</b> / ${num(g.target)} ${esc(g.unit)}</span></div>
    <div class="goal-track" role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="${g.target}" aria-label="${esc(g.label)}"><span style="width:${pct}%"></span></div>
    <p class="goal-sub">${done ? "Ziel erreicht – Zeit für ein neues. 🎉" : `${pct} % · noch ${num(g.target - v)} bis zum Ziel`}</p>
  </div>`;
}

function appCard(a) {
  const style = ` style="--app:${esc(a.color)}"`;
  const head = `<div class="ac-head">${appBadge(a)}<div><b>${esc(a.name)}</b><span class="muted">${esc(a.tagline ?? "")}</span></div>${icon("arrow", "ac-arrow")}</div>`;
  if (a.offline) return `<a class="app-card quiet" href="#${a.id}"${style}>${head}<p class="muted small">${esc(a.note)}</p></a>`;
  if (!S.users[a.id]) return `<a class="app-card quiet" href="#${a.id}"${style}>${head}<p class="muted small">Noch nicht angemeldet.</p></a>`;
  const s = S.data[`${a.id}:stats`]?.value;
  const kpi = (label, value, sub, spark) => `<div class="kpi"><span class="kpi-label">${esc(label)}</span><span class="kpi-num">${num(value)}</span>${spark}${sub ? `<span class="kpi-sub">${esc(sub)}</span>` : ""}</div>`;
  return `<a class="app-card" href="#${a.id}"${style}>${head}
    ${s ? `<div class="kpis">
      ${kpi("Piloten", s.pilots, `+${s.pilots_7d ?? 0} in 7 Tagen`, sparkFor(a, "pilots_total", "line"))}
      ${kpi("Flüge (7 Tage)", s.flights_7d, `${num(s.flights)} total`, sparkFor(a, "flights", "bar"))}
    </div>${goalBar(a, s)}` : `<p class="muted loading">Lädt …</p>`}
  </a>`;
}

// ---- app page ------------------------------------------------------------------

function appOverview(a) {
  return block(`${a.id}:stats`, (s) => `${goalBar(a, s, true)}
    <div class="tiles">${a.stats.map((t) => tile(a, t, s)).join("")}</div>
    <p class="hint">Kurven: letzte 30 Tage. Mehr im Reiter <a href="#${a.id}/trend">Verlauf</a>.</p>`);
}

function tile(a, t, s) {
  const value = tileValue(a, t, s);
  const inner = `<span class="tile-label">${esc(t.label)}</span>
    <span class="tile-row"><span class="tile-num">${num(value)}</span>${t.spark ? sparkFor(a, ...t.spark) : ""}</span>
    ${t.sub ? `<span class="tile-sub">${esc(t.sub(s))}</span>` : ""}`;
  const alert = t.list ? value > 0 : t.alert?.(s);
  const cls = `tile${alert ? " alert" : ""}`;
  return t.tab ? `<a class="${cls}" href="#${a.id}/${t.tab}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
}

// ---- search palette (Ctrl+K) -----------------------------------------------------

let paletteResults = [];

function searchGroups() {
  const pages = [{ label: "Heute", sub: "Start", href: "#" }];
  for (const a of APPS) {
    pages.push({ label: a.name, sub: "Übersicht", href: `#${a.id}` });
    for (const t of appTabs(a).slice(1)) pages.push({ label: `${a.name} · ${TAB_LABELS[t]}`, href: `#${a.id}/${t}` });
  }
  if (socialConfigured()) {
    pages.push({ label: "Social", sub: "Beiträge", href: "#social" });
    pages.push({ label: "Neuer Beitrag", sub: "Social", action: "go-new-post" });
  }
  if (qnhReady()) {
    pages.push({ label: "Aufgaben", sub: "Roadmap von QNH und allen Apps", href: "#roadmap" });
    pages.push({ label: "Hangar", sub: "Links und Ablage", href: "#hangar" });
    if (financeConfigured()) pages.push({ label: "Finanzen", sub: "Kosten, Abos, Rechnungen", href: "#finanzen" });
    for (const l of S.qnh?.links ?? []) pages.push({ label: l.title, sub: `Hangar · ${l.grp}`, text: l.note + " " + l.url, external: l.url });
  }
  pages.push({ label: darkNow() ? "Helles Farbschema" : "Dunkles Farbschema", sub: "Darstellung", action: "theme" });
  const groups = [{ title: "Springen zu", items: pages }];
  for (const a of APPS) {
    const beta = S.data[`${a.id}:beta`]?.value ?? [];
    if (beta.length) groups.push({ title: `${a.name} · Beta`, items: beta.map((r) => ({ label: `${r.first_name} ${r.last_name}`, sub: `${r.email} · ${r.status === "new" ? "neu" : r.status === "invited" ? "eingeladen" : "abgelehnt"}`, text: r.note, href: `#${a.id}/beta` })) });
    const fb = S.data[`${a.id}:feedback`]?.value ?? [];
    if (fb.length) groups.push({ title: `${a.name} · Feedback`, items: fb.map((r) => ({ label: r.text.slice(0, 90), sub: `${r.pilot} · ${relTime(r.created_at)}`, text: r.text, href: `#${a.id}/feedback` })) });
    const errs = S.data[`${a.id}:errors7`]?.value ?? [];
    if (errs.length) groups.push({ title: `${a.name} · Fehler`, items: errs.map((r) => ({ label: r.message.slice(0, 90), sub: `${r.n}× · zuletzt ${relTime(r.last_at)}`, href: `#${a.id}/errors` })) });
  }
  const rm = S.qnh?.items ?? [];
  if (rm.length) groups.push({ title: "Roadmap", items: rm.map((i) => ({ label: i.title, sub: `${qnh.scopeOf(i.scope).name} · ${qnh.STATUS[i.status]}`, text: i.body, href: i.scope === "qnh" ? "#roadmap" : `#${i.scope}/roadmap` })) });
  const sv = S.social?.value;
  if (sv?.posts.length) {
    const handle = (id) => sv.accounts.find((x) => x.id === id)?.handle ?? "";
    groups.push({ title: "Social-Beiträge", items: sv.posts.map((p) => ({ label: String(p.caption || "Story ohne Text").split("\n")[0].slice(0, 90), sub: `@${handle(p.account_id)} · ${p.status}`, text: p.caption, href: "#social", post: p.id })) });
  }
  return groups;
}

function paletteResultsHtml() {
  const groups = search(S.search.q, searchGroups());
  paletteResults = groups.flatMap((g) => g.items);
  S.search.sel = Math.min(S.search.sel, Math.max(0, paletteResults.length - 1));
  if (!paletteResults.length) return `<p class="pal-empty">Nichts gefunden für «${esc(S.search.q)}».</p>`;
  let i = 0;
  return groups.map((g) => `<p class="pal-group">${esc(g.title)}</p>${g.items.map((it) => {
    const idx = i++;
    return `<button class="pal-item${idx === S.search.sel ? " on" : ""}" data-action="pal-go" data-i="${idx}"><span class="pal-label">${esc(it.label)}</span>${it.sub ? `<span class="pal-sub">${esc(it.sub)}</span>` : ""}</button>`;
  }).join("")}`).join("");
}

function palette() {
  return `<div class="pal-backdrop" data-action="search-close">
    <div class="palette" role="dialog" aria-modal="true" aria-label="Suchen" data-action="noop">
      <div class="pal-input">${icon("search")}<input name="search-q" placeholder="Seiten, Beta, Feedback, Fehler, Beiträge …" value="${esc(S.search.q)}" autocomplete="off" spellcheck="false"></div>
      <div class="pal-results" id="pal-results">${paletteResultsHtml()}</div>
      <p class="pal-foot"><kbd>↑</kbd><kbd>↓</kbd> wählen · <kbd>Enter</kbd> öffnen · <kbd>Esc</kbd> schliessen</p>
    </div>
  </div>`;
}

function openSearch() {
  S.sheet = null;
  S.search = { open: true, q: "", sel: 0 };
  // load what the search can find (each loads only once)
  for (const a of APPS) {
    if (!live(a) || !S.users[a.id]) continue;
    load(a, "beta", () => api.betaSignups(a));
    load(a, "feedback", () => api.feedback(a));
    load(a, "errors7", () => api.errors(a, 7));
  }
  render();
  root.querySelector('[name="search-q"]')?.focus();
}

function closeSearch(rerender = true) {
  if (!S.search.open) return;
  S.search.open = false;
  if (rerender) render();
}

function refreshPalette() {
  const el = document.getElementById("pal-results");
  if (el) el.innerHTML = paletteResultsHtml();
  el?.querySelector(".pal-item.on")?.scrollIntoView({ block: "nearest" });
}

function activate(item) {
  if (!item) return;
  closeSearch(false);
  if (item.action === "theme") return toggleTheme();
  if (item.action === "go-new-post") return goNewPost();
  if (item.external) return window.open(item.external, "_blank", "noopener");
  if (location.hash === item.href || (item.href === "#" && !location.hash)) route();
  else location.hash = item.href;
  if (item.post) setTimeout(() => social.onClick("soc-open", { dataset: { id: item.post } }), 50);
}

function toggleTheme() {
  S.theme = darkNow() ? "light" : "dark";
  try { localStorage.setItem("qnh-theme", S.theme); } catch { /* private mode */ }
  applyTheme();
  render();
}

// «Neu → Aufgabe»: the roadmap with the cursor in the title field
function quickTask() {
  S.sheet = null;
  if (location.hash !== "#roadmap") location.hash = "#roadmap"; else render();
  setTimeout(() => root.querySelector('[name="rm-title"]')?.focus(), 80);
}
// «Neu → Rechnung erfassen»: the bill form on Finanzen
function quickBill() {
  S.sheet = null;
  if (location.hash !== "#finanzen") location.hash = "#finanzen";
  setTimeout(() => finance.onClick("fin-new-bill", { dataset: {} }), 50);
}

function goNewPost() {
  if (location.hash !== "#social") location.hash = "#social";
  setTimeout(() => social.onClick("soc-new", { dataset: {} }), 50);
}

function loginForm(a, neutral = false) {
  const l = S.login[a.id] ?? { step: "email", email: "" };
  const err = l.error ? `<p class="error">${esc(l.error)}</p>` : "";
  if (l.step === "code") {
    return `<form class="login" data-form="verify-code" data-app="${a.id}">
      <p>E-Mail an <b>${esc(l.email)}</b> gesendet. ${a.id === QNH.id ? "Klick auf den Link in der E-Mail – am besten in diesem Browser. Steht ein Code drin, kannst du ihn auch hier eingeben." : `Gib den Code aus der Anmelde-E-Mail${neutral ? "" : ` von ${esc(a.name)}`} ein.`}</p>
      <div class="row">
        <input name="code-${a.id}" inputmode="numeric" autocomplete="one-time-code" placeholder="6-stelliger Code" required maxlength="10" />
        <button class="btn" ${l.busy ? "disabled" : ""}>Anmelden</button>
      </div>
      <button type="button" class="link" data-action="change-email" data-app="${a.id}">Andere E-Mail</button>
      ${err}
    </form>`;
  }
  return `<form class="login" data-form="send-code" data-app="${a.id}">
    ${neutral ? "" : `<p>Mit deinem Admin-Konto von ${esc(a.name)} anmelden.</p>`}
    <div class="row">
      <input name="email-${a.id}" type="email" autocomplete="email" placeholder="E-Mail" value="${esc(l.email)}" required />
      <button class="btn" ${l.busy ? "disabled" : ""}>Code senden</button>
    </div>
    ${err}
  </form>`;
}

// ---- trend ------------------------------------------------------------------

function trendView(a) {
  const range = TREND_RANGES.find(([d]) => d === S.trendDays)?.[1] ?? "";
  const head = chips("trend-days", TREND_RANGES.map(([d, l]) => [String(d), l]), String(S.trendDays));
  return head + block(`${a.id}:trend${S.trendDays}`, (rows) => {
    if (!rows.length) return empty("Noch keine Daten.");
    const sum = a.trend.filter((c) => c.kind === "bar").map((c) => c.key);
    const last = a.trend.filter((c) => c.kind === "line").map((c) => c.key);
    const { weekly, periods } = bucket(rows, { sum, last });
    const unit = weekly ? "pro Woche" : "pro Tag";
    return `<p class="hint">Zeitraum ${esc(range)}, ${unit}. Fahre über ein Diagramm für die genauen Werte.</p>
      <div class="charts">${a.trend.map((c) => {
        const headline = c.kind === "line" ? periods.at(-1)[c.key] : periods.reduce((s, p) => s + p[c.key], 0);
        const sub = c.kind === "line" ? "aktuell" : `in ${range}`;
        return `<figure class="chart-card">
          <figcaption><span class="chart-title">${esc(c.label)}</span><span class="chart-num">${num(headline)}</span><span class="chart-sub">${esc(sub)}</span></figcaption>
          ${chartSvg({ periods, weekly, key: c.key, kind: c.kind, label: `${c.label} ${unit}` })}
          <details><summary>Als Tabelle</summary><table>
            ${periods.map((p) => `<tr><td>${esc(periodLabel(p, weekly))}</td><td>${num(p[c.key])}</td></tr>`).join("")}
          </table></details>
        </figure>`;
      }).join("")}</div>`;
  });
}

// hover layer: crosshair (+ dot on lines) and a tooltip that follows the pointer
const tip = document.body.appendChild(Object.assign(document.createElement("div"), { className: "tip", role: "tooltip" }));
root.addEventListener("pointermove", (e) => {
  const hit = e.target.closest?.(".hit");
  if (!hit) return hideTip();
  const svg = hit.ownerSVGElement;
  const cross = svg.querySelector(".cross"), dot = svg.querySelector(".dot");
  cross.setAttribute("x1", hit.dataset.cx);
  cross.setAttribute("x2", hit.dataset.cx);
  cross.setAttribute("visibility", "visible");
  if (svg.querySelector(".line")) {
    dot.setAttribute("cx", hit.dataset.cx);
    dot.setAttribute("cy", hit.dataset.cy);
    dot.setAttribute("visibility", "visible");
  }
  tip.textContent = hit.dataset.tip;
  tip.style.display = "block";
  const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
  tip.style.transform = `translate(${x}px, ${e.clientY - tip.offsetHeight - 10}px)`;
});
root.addEventListener("pointerleave", hideTip);
function hideTip() {
  tip.style.display = "none";
  for (const el of root.querySelectorAll(".cross, .dot")) el.setAttribute("visibility", "hidden");
}

// ---- feedback ---------------------------------------------------------------

function feedbackView(a) {
  return block(`${a.id}:feedback`, (rows) => {
    const open = rows.filter((r) => r.status === "new");
    const list = S.feedbackFilter === "new" ? open : rows;
    return `${chips("feedback-filter", [["new", `Neu (${open.length})`], ["all", `Alle (${rows.length})`]], S.feedbackFilter)}
      ${list.length ? list.map((r) => feedbackItem(r)).join("") : empty(S.feedbackFilter === "new" ? "Kein neues Feedback. 👍" : "Noch kein Feedback.")}`;
  });
}

// a cached signed link while it is still valid (else the «anzeigen» button comes back)
const fresh = (c) => (c && c.exp > Date.now() ? c.url : null);

function feedbackItem(r) {
  const shot = fresh(S.shots[r.id]);
  return `<article class="item${r.status === "done" ? " done" : ""}">
    <div class="meta"><b>${esc(r.pilot)}</b><span>${relTime(r.created_at)}</span><span>${esc(r.app_version)}</span><span>${esc(r.device)}</span></div>
    <p class="text">${esc(r.text)}</p>
    ${shot ? `<a href="${esc(shot)}" target="_blank" rel="noopener"><img class="shot" src="${esc(shot)}" alt="Screenshot" /></a>` : ""}
    <div class="actions">
      ${r.screenshot_path && !shot ? `<button class="btn ghost" data-action="fb-shot" data-id="${r.id}">Screenshot anzeigen</button>` : ""}
      ${r.status === "new"
        ? `<button class="btn" data-action="fb-status" data-id="${r.id}" data-status="done">Erledigt</button>`
        : `<button class="btn ghost" data-action="fb-status" data-id="${r.id}" data-status="new">Wieder öffnen</button>`}
    </div>
  </article>`;
}

// ---- errors -----------------------------------------------------------------

function errorsView(a) {
  const head = chips("error-days", ERROR_DAYS.map((d) => [String(d), d === 1 ? "24 Stunden" : `${d} Tage`]), String(S.errorDays));
  return head + block(`${a.id}:errors${S.errorDays}`, (rows) => rows.length
    ? rows.map((r) => `<article class="item">
        <div class="meta"><b class="count">${num(r.n)}×</b><span>${num(r.users)} ${r.users === 1 ? "Person" : "Personen"}</span><span>zuletzt ${relTime(r.last_at)}</span>
          <span>${esc((r.versions ?? []).join(", "))}</span><span>${esc((r.platforms ?? []).join(", "))}</span></div>
        <p class="text mono">${esc(r.message)}</p>
        ${r.stack ? `<details><summary>Details (Stack)</summary><pre>${esc(r.stack)}</pre></details>` : ""}
      </article>`).join("")
    : empty("Keine Fehler in diesem Zeitraum. ✈️"));
}

// ---- beta -------------------------------------------------------------------

const BETA_STATUS = { new: "Neu", invited: "Eingeladen", declined: "Abgelehnt" };

function betaView(a) {
  return block(`${a.id}:beta`, (rows) => {
    const count = (s) => rows.filter((r) => r.status === s).length;
    const list = S.betaFilter === "all" ? rows : rows.filter((r) => r.status === S.betaFilter);
    const filters = [...Object.entries(BETA_STATUS).map(([k, v]) => [k, `${v} (${count(k)})`]), ["all", `Alle (${rows.length})`]];
    const copy = list.length
      ? `<button class="btn ghost" data-action="copy-emails">${list.length} E-Mail${list.length === 1 ? "" : "s"} kopieren</button>`
      : "";
    return `<div class="toolbar">${chips("beta-filter", filters, S.betaFilter)}${copy}</div>
      ${list.length ? list.map(betaItem).join("") : empty("Keine Anmeldungen in dieser Liste.")}`;
  });
}

function betaItem(r) {
  const btn = (status, label, ghost) =>
    `<button class="btn${ghost ? " ghost" : ""}" data-action="beta-status" data-id="${r.id}" data-status="${status}">${label}</button>`;
  return `<article class="item">
    <div class="meta"><b>${esc(r.first_name)} ${esc(r.last_name)}</b><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>
      <span>${esc(sourceLabel(r.source))}</span><span>${esc(r.lang?.toUpperCase())}</span><span>${relTime(r.created_at)}</span>
      ${r.status !== "new" ? `<span class="pill ${esc(r.status)}">${esc(BETA_STATUS[r.status] ?? r.status)}${r.handled_at ? ` · ${shortDate(r.handled_at)}` : ""}</span>` : ""}</div>
    ${r.note ? `<p class="text">${esc(r.note)}</p>` : ""}
    <div class="actions">${r.status === "new" ? btn("invited", "Eingeladen") + btn("declined", "Ablehnen", true) : btn("new", "Zurück auf neu", true)}</div>
  </article>`;
}

// ---- verification -------------------------------------------------------------

const KIND = { airfield: "Flugplatz-Konto", club: "Club- / Schul-Konto", instructor: "Fluglehrer/in" };
const VERIFY_STATUS = { pending: "Offen", approved: "Bestätigt", rejected: "Abgelehnt" };

function verifyView(a) {
  return block(`${a.id}:verify`, (rows) => {
    const open = rows.filter((r) => r.status === "pending");
    const list = S.verifyFilter === "all" ? rows : open;
    return `${chips("verify-filter", [["pending", `Offen (${open.length})`], ["all", `Alle (${rows.length})`]], S.verifyFilter)}
      <p class="hint">Bestätigte Rollen erscheinen in Downwind als Abzeichen. Nach dem Entscheid wird ein hochgeladener Ausweis gelöscht und der Pilot per Push informiert.</p>
      ${list.length ? list.map(verifyItem).join("") : empty("Keine offenen Anfragen.")}`;
  });
}

function verifyItem(r) {
  const doc = fresh(S.docs[r.id]);
  const target = r.kind === "airfield" ? r.target : r.kind === "club" ? r.target_name ?? "Club" : "";
  return `<article class="item${r.status !== "pending" ? " done" : ""}">
    <div class="meta"><b>${esc(r.name)}</b><span class="pill">${esc(KIND[r.kind] ?? r.kind)}${target ? ` · ${esc(target)}` : ""}</span>
      <span>${relTime(r.created_at)}</span>
      ${r.expires_on ? `<span>gültig bis ${shortDate(r.expires_on)}</span>` : ""}
      ${r.contact_email ? `<a href="mailto:${esc(r.contact_email)}">${esc(r.contact_email)}</a>` : ""}
      ${r.status !== "pending" ? `<span class="pill ${r.status === "rejected" ? "declined" : ""}">${VERIFY_STATUS[r.status]}${r.reviewed_at ? ` · ${shortDate(r.reviewed_at)}` : ""}</span>` : ""}</div>
    ${r.message ? `<p class="text">${esc(r.message)}</p>` : ""}
    ${r.reason ? `<p class="text muted">Grund: ${esc(r.reason)}</p>` : ""}
    ${doc ? `<a href="${esc(doc)}" target="_blank" rel="noopener"><img class="shot" src="${esc(doc)}" alt="Ausweis" /></a>` : ""}
    ${r.status === "pending" ? `<div class="actions">
      ${r.doc_path && !doc ? `<button class="btn ghost" data-action="ver-doc" data-id="${r.id}">Ausweis anzeigen</button>` : ""}
      <button class="btn" data-action="ver-review" data-id="${r.id}" data-value="approve">Bestätigen</button>
      <button class="btn ghost" data-action="ver-review" data-id="${r.id}" data-value="reject">Ablehnen …</button>
    </div>` : ""}
  </article>`;
}

// ---- reports / moderation --------------------------------------------------------

const TARGET = { flight: "Flug", comment: "Kommentar", review: "Flugplatz-Bewertung", message: "Nachricht", aircraft: "Flugzeug-Eintrag", note: "Passagier-Notiz", pilot: "Pilot" };
const REPORT_STATUS = { open: "Offen", actioned: "Massnahme", dismissed: "Verworfen" };
const ACTION = { hide: "ausgeblendet", unhide: "wieder sichtbar", ban: "gesperrt", unban: "entsperrt", dismiss: "verworfen" };

function reportsView(a) {
  return block(`${a.id}:reports`, (rows) => {
    const open = rows.filter((r) => r.status === "open");
    const list = S.reportsFilter === "all" ? rows : open;
    return `${chips("reports-filter", [["open", `Offen (${open.length})`], ["all", `Letzte 30 Tage (${rows.length})`]], S.reportsFilter)}
      ${list.length ? list.map(reportItem).join("") : empty("Keine offenen Meldungen. 👍")}`;
  });
}

function reportItem(r) {
  const t = r.target;
  const btn = (action, label, ghost) =>
    `<button class="btn${ghost ? " ghost" : ""}" data-action="mod-act" data-id="${r.id}" data-value="${action}">${label}</button>`;
  const actions = [];
  if (t && t.kind !== "pilot") actions.push(t.hidden ? btn("unhide", "Wieder einblenden", true) : btn("hide", "Ausblenden"));
  if (r.author) actions.push(r.author.banned ? btn("unban", `${esc(r.author.name)} entsperren`, true) : btn("ban", `${esc(r.author.name)} sperren`, true));
  if (r.status === "open") actions.push(btn("dismiss", "Verwerfen", true));
  return `<article class="item${r.status !== "open" ? " done" : ""}">
    <div class="meta"><b>${esc(TARGET[t?.kind] ?? "Gelöschter Inhalt")}</b>
      ${r.author ? `<span>von ${esc(r.author.name)}${r.author.banned ? " (gesperrt)" : ""}</span>` : ""}
      <span>gemeldet von ${esc(r.reporter ?? "?")}</span><span>${relTime(r.created_at)}</span>
      ${r.status !== "open" ? `<span class="pill">${esc(REPORT_STATUS[r.status] ?? r.status)}${r.status === "actioned" && r.action ? `: ${esc(ACTION[r.action] ?? r.action)}` : ""}</span>` : ""}
      ${t?.hidden && r.action !== "hide" ? `<span class="pill declined">ausgeblendet</span>` : ""}</div>
    ${r.reason ? `<p class="text"><span class="muted">Grund:</span> ${esc(r.reason)}</p>` : ""}
    ${t?.preview ? `<blockquote>${esc(t.preview)}</blockquote>` : ""}
    <div class="actions">${actions.join("")}</div>
  </article>`;
}

// ---- shared bits --------------------------------------------------------------

function block(key, fn) {
  const d = S.data[key];
  if (!d || (d.loading && d.value === undefined)) return `<p class="muted loading">Lädt …</p>`;
  const err = d.error ? `<p class="error">${esc(errorText(d.error))}</p>` : "";
  return err + (d.value !== undefined ? fn(d.value) : "");
}

function chips(action, options, current) {
  return `<div class="chips">${options.map(([v, label]) =>
    `<button class="chip${v === current ? " on" : ""}" data-action="${action}" data-value="${v}">${esc(label)}</button>`).join("")}</div>`;
}

const empty = (text) => `<p class="empty">${esc(text)}</p>`;

function logo() {
  return `<svg class="logo" viewBox="40 44 90 122" aria-hidden="true"><g fill="none" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="50,155 85,120 120,155" stroke="#99E9F2"/><polyline points="50,122 85,87 120,122" stroke="#22B8CF"/>
    <polyline points="50,89 85,54 120,89" stroke="#0B7285"/></g></svg>`;
}

// app icon if there is one (public/logos), else the first letter on the app colour
const appBadge = (a, size = "") => (a.logo
  ? `<img class="app-badge logo${size ? ` ${size}` : ""}" src="${esc(a.logo)}" alt="" aria-hidden="true">`
  : `<span class="app-badge${size ? ` ${size}` : ""}" style="--app:${esc(a.color ?? "#0B7285")}" aria-hidden="true">${esc(a.name[0].toUpperCase())}</span>`);

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7z"/><path d="M4 7l11-3v3"/><circle cx="16" cy="13.5" r="1.2" fill="currentColor"/>',
  plane: '<path d="M2 13l8-2 4-7h2l-2 7 6 1 2-2h1l-1 4 1 4h-1l-2-2-6 1 2 7h-2l-4-7-8-2z"/>',
  tasks: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="m10 8.8 5 3.2-5 3.2z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  folder: '<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H12L10 5H4.5A1.5 1.5 0 0 0 3 6.5z"/>',
};
const icon = (name, cls = "") => `<svg class="ico${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

let toastTimer;
function toast(text) {
  S.toast = text;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = ""; render(); }, 2500);
}


// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

root.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  if (/^(rm|hg)-/.test(form.dataset.form)) return qnh.onSubmit(form);
  if (form.dataset.form.startsWith("fin-")) return finance.onSubmit(form);
  if (form.dataset.form.startsWith("st-")) return studio.onSubmit(form);
  const a = appById(form.dataset.app);
  const l = (S.login[a.id] ??= { step: "email", email: "" });
  l.busy = true;
  l.error = "";
  try {
    if (form.dataset.form === "send-code") {
      l.email = form.elements[`email-${a.id}`].value.trim();
      render();
      await api.sendCode(a, l.email);
      l.step = "code";
    } else {
      const code = form.elements[`code-${a.id}`].value.replace(/\s/g, "");
      render();
      await api.verifyCode(a, l.email, code);
      S.users[a.id] = await api.currentUser(a);
      delete S.login[a.id];
      ensureData(true);
    }
  } catch (err) {
    l.error = errorText(err);
  }
  l.busy = false;
  render();
});

root.addEventListener("input", (e) => {
  if (e.target.name === "search-q") {
    S.search.q = e.target.value;
    S.search.sel = 0;
    return refreshPalette();
  }
  if (finance.onInput(e)) return;
  if (studio.onInput(e)) return;
  social.onInput(e);
});
// «Heute»: remember folded-out checklist rows, so ticking (which re-renders) keeps them open
root.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.agKey) return;
  if (d.open) S.agOpen.add(d.dataset.agKey); else S.agOpen.delete(d.dataset.agKey);
}, true);
// scroll does not bubble: listen in the capture phase (carousel preview swipe)
root.addEventListener("scroll", (e) => social.onScroll(e), true);
root.addEventListener("dragstart", (e) => qnh.onDragStart(e) || social.onDragStart(e));
root.addEventListener("dragover", (e) => qnh.onDragOver(e) || finance.onDragOver(e) || social.onDragOver(e));
root.addEventListener("dragleave", (e) => e.target.closest?.("[data-drop], [data-rm-col], [data-cal-day]")?.classList.remove("over"));
root.addEventListener("drop", (e) => qnh.onDrop(e) || finance.onDrop(e) || social.onDrop(e));

root.addEventListener("change", async (e) => {
  if (finance.onInput(e)) return;
  await social.onChange(e);
});

document.addEventListener("keydown", (e) => {
  if (studio.onKeydown(e)) return;
  if (social.onKeydown(e)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return S.search.open ? closeSearch() : openSearch();
  }
  if (S.sheet && e.key === "Escape" && !S.search.open) { S.sheet = null; return render(); }
  if (S.sheet && e.key === "Tab" && !S.search.open) {
    // keep Tab inside the open sheet (the page behind is inert)
    const items = [...root.querySelectorAll(".sheet button")];
    const i = items.indexOf(document.activeElement);
    if (items.length && (i === -1 || (e.shiftKey ? i === 0 : i === items.length - 1))) {
      e.preventDefault();
      items[e.shiftKey ? items.length - 1 : 0].focus();
    }
    return;
  }
  if (!S.search.open) return;
  if (e.key === "Escape") return closeSearch();
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = paletteResults.length;
    if (!n) return;
    S.search.sel = (S.search.sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    return refreshPalette();
  }
  if (e.key === "Enter") {
    e.preventDefault();
    activate(paletteResults[S.search.sel]);
  }
});

root.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT") return;
  const { action, id, status, value } = el.dataset;
  if (action === "noop") return;
  if (action.startsWith("soc-")) return social.onClick(action, el);
  if (action === "st-spot" || action === "st-scrub") return studio.onPointer(e);
  if (action.startsWith("st-")) return studio.onClick(action, el);
  if (action === "go-focus") { qnh.startFocus("all"); if (location.hash === "#roadmap") render(); else location.hash = "#roadmap"; return; }
  if (/^(rm|hg)-/.test(action)) return qnh.onClick(action, el);
  if (action.startsWith("store-")) return store.onClick(el, APPS);
  if (action.startsWith("fin-")) return finance.onClick(action, el);
  if (action === "search-open") { S.sheet = null; return openSearch(); }
  if (action === "search-close") return closeSearch();
  if (action === "pal-go") return activate(paletteResults[Number(el.dataset.i)]);
  if (action === "theme") { S.sheet = null; return toggleTheme(); }
  if (action === "go-new-post") { S.sheet = null; return goNewPost(); }
  if (action === "sheet") { S.sheet = S.sheet === value ? null : value; return render(); }
  if (action === "sheet-close") { if (el.classList.contains("sheet-backdrop") && e.target !== el) return; S.sheet = null; return render(); }
  if (action === "go") { S.sheet = null; if (location.hash === value) render(); else location.hash = value; return; }
  if (action === "quick-task") return quickTask();
  if (action === "quick-bill") return quickBill();
  if (action === "quick-package") { S.sheet = null; social.onClick("soc-pick-package", el); return render(); } // the file picker opens inside the tap (iOS)
  const a = el.dataset.app ? appById(el.dataset.app) : app();
  if (S.sheet && (action === "refresh" || action === "sign-out")) S.sheet = null;

  switch (action) {
    case "refresh":
      ensureData(true);
      break;
    case "change-email":
      S.login[a.id] = { step: "email", email: S.login[a.id]?.email ?? "" };
      render();
      break;
    case "sign-out":
      await api.signOut(a);
      // QNH Core holds social, roadmap, finance and store with live subscriptions: start clean
      if (a.id === QNH.id) { location.reload(); return; }
      S.users[a.id] = null;
      for (const k of Object.keys(S.data)) if (k.startsWith(`${a.id}:`)) delete S.data[k];
      S.shots = {};
      S.docs = {};
      render();
      break;
    case "feedback-filter":
      S.feedbackFilter = value;
      render();
      break;
    case "error-days":
      S.errorDays = Number(value);
      ensureData();
      render();
      break;
    case "beta-filter":
      S.betaFilter = value;
      render();
      break;
    case "trend-days":
      S.trendDays = Number(value);
      ensureData();
      render();
      break;
    case "verify-filter":
      S.verifyFilter = value;
      render();
      break;
    case "reports-filter":
      S.reportsFilter = value;
      render();
      break;
    case "ver-doc": {
      const row = S.data[`${a.id}:verify`]?.value?.find((r) => r.id === id);
      if (!row) break;
      try {
        S.docs[id] = { url: await api.verificationDocUrl(a, row.doc_path), exp: Date.now() + 270e3 };   // the link lives 300 s
        render();
      } catch (err) {
        toast(errorText(err));
      }
      break;
    }
    case "ver-review": {
      const row = S.data[`${a.id}:verify`]?.value?.find((r) => r.id === id);
      if (!row) break;
      const approve = value === "approve";
      let reason = "";
      if (!approve) {
        reason = prompt("Grund für die Ablehnung (der Pilot sieht ihn):", "");
        if (reason === null) break;
      } else if (!confirm(`${row.name} als ${KIND[row.kind] ?? row.kind} bestätigen?`)) break;
      el.disabled = true;
      try {
        await api.reviewVerification(a, row, approve, reason.trim());
        delete S.docs[id];
        toast(approve ? "Bestätigt" : "Abgelehnt");
        load(a, "verify", () => api.verificationQueue(a), true);
      } catch (err) {
        el.disabled = false;
        toast(errorText(err));
      }
      break;
    }
    case "mod-act": {
      const row = S.data[`${a.id}:reports`]?.value?.find((r) => r.id === id);
      if (!row) break;
      if (value === "ban" && !confirm(`${row.author?.name ?? "Diesen Piloten"} sperren? Das Konto kann sich danach nicht mehr anmelden.`)) break;
      el.disabled = true;
      try {
        await api.moderate(a, id, value);
        toast(`Erledigt: ${ACTION[value]}`);
        load(a, "reports", () => api.reports(a), true);
      } catch (err) {
        el.disabled = false;
        toast(errorText(err));
      }
      break;
    }
    case "fb-status":
      await updateRow(a, "feedback", id, { status }, () => api.setFeedbackStatus(a, id, status));
      break;
    case "beta-status":
      await updateRow(a, "beta", id, { status, handled_at: status === "new" ? null : new Date().toISOString() },
        () => api.setBetaStatus(a, id, status));
      break;
    case "fb-shot": {
      const row = S.data[`${a.id}:feedback`]?.value?.find((r) => r.id === id);
      if (!row) break;
      try {
        S.shots[id] = { url: await api.screenshotUrl(a, row.screenshot_path), exp: Date.now() + 570e3 };   // the link lives 600 s
        render();
      } catch (err) {
        toast(errorText(err));
      }
      break;
    }
    case "copy-emails": {
      const rows = S.data[`${a.id}:beta`]?.value ?? [];
      const list = S.betaFilter === "all" ? rows : rows.filter((r) => r.status === S.betaFilter);
      try {
        await navigator.clipboard.writeText(list.map((r) => r.email).join(", "));
        toast(`${list.length} E-Mail${list.length === 1 ? "" : "s"} kopiert`);
      } catch {
        toast("Kopieren nicht möglich");
      }
      break;
    }
  }
});

// Optimistic update of one row, rolled back if the server refuses.
async function updateRow(a, kind, id, patch, save) {
  const rows = S.data[`${a.id}:${kind}`]?.value;
  const row = rows?.find((r) => r.id === id);
  if (!row) return;
  const before = { ...row };
  Object.assign(row, patch);
  render();
  try {
    await save();
    load(a, "stats", () => api.stats(a), true);
  } catch (err) {
    Object.assign(row, before);
    toast(errorText(err));
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("focus", () => {
  if (Date.now() - S.lastLoad > 60_000) ensureData(true);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (!S.theme) render(); });

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

(async () => {
  root.innerHTML = `<p class="muted loading">Lädt …</p>`;
  const linkError = new URLSearchParams(location.hash.slice(1)).get("error_description");
  for (const a of [QNH, ...APPS]) if (live(a)) S.users[a.id] = await api.currentUser(a);
  // a sign-in link leaves tokens or an error in the URL hash – remove them before routing
  if (/access_token|error_description|refresh_token/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  if (linkError && QNH.url) S.login[QNH.id] = { step: "email", email: "", error: `Der Anmeldelink ist ungültig oder abgelaufen (${linkError}). Bitte neu anfordern.` };
  route();
})();
