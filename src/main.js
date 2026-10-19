import "./style.css";
import { APPS, QNH, appById } from "./apps.js";
import * as api from "./api.js";
import { esc, relTime, shortDate, num, sourceLabel, errorText } from "./format.js";
import { bucket, chartSvg, periodLabel, sparkSvg } from "./charts.js";
import { search, greeting, firstName } from "./search.js";
import { createSocial } from "./social/ui.js";
import { socialConfigured } from "./social/data.js";
import { formatZurich } from "./social/validate.js";
import { createQnh } from "./qnh/ui.js";
import { qnhReady } from "./qnh/data.js";
import { createStore } from "./store/ui.js";

const TREND_RANGES = [[30, "30 Tage"], [91, "3 Monate"], [182, "6 Monate"], [365, "1 Jahr"]];
const TAB_LABELS = { overview: "Übersicht", store: "Store & Builds", roadmap: "Roadmap", trend: "Verlauf", feedback: "Feedback", errors: "Fehler", beta: "Beta", verify: "Verifizierung", reports: "Meldungen" };
const ERROR_DAYS = [1, 7, 30];

// Photos by Jürg Umbricht (@exploring_the_skies), retouched and published on flydownwind.ch with his OK.
// Loaded from there (not copied into this public repo); credit on every use.
const PHOTO_BASE = "https://flydownwind.ch/assets/photos/";
// [file, vertical focus] – the banner is a thin strip, so each photo gets the part that reads at that size
const PHOTOS = [["band", "38%"], ["hero-wide", "72%"], ["map", "45%"]];
const photoOfDay = () => {
  const d = new Date();
  const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
  const [file, pos] = PHOTOS[day % PHOTOS.length];
  return { url: PHOTO_BASE + file + ".webp", pos };
};
const photoCredit = () => `<a class="credit" href="https://www.instagram.com/exploring_the_skies" target="_blank" rel="noopener">Foto: Jürg Umbricht · @exploring_the_skies</a>`;

const S = {
  tab: "today", // today | social | overview | <app tab>
  appId: APPS.find((a) => a.tabs?.length)?.id,
  users: {}, // appId -> user | null
  login: {}, // appId -> { step, email, busy, error }
  data: {}, // "<appId>:<kind>" -> { loading, error, value }
  shots: {}, // feedback id -> signed screenshot URL
  docs: {}, // verification id -> signed licence photo URL
  feedbackFilter: "new",
  verifyFilter: "pending",
  reportsFilter: "open",
  errorDays: 7,
  trendDays: 91,
  betaFilter: "new",
  toast: "",
  lastLoad: 0,
  search: { open: false, q: "", sel: 0 },
  theme: readTheme(), // "light" | "dark" | null (= follow the system)
};

const root = document.getElementById("app");
const SCOPES = [{ id: "qnh", name: "QNH", color: "#0B7285" }, ...APPS.map((a) => ({ id: a.id, name: a.name, color: a.color }))];
const qnh = createQnh({ S, render: () => render(), toast: (t) => toast(t), errorText, scopes: SCOPES });
const store = createStore({ S, render: () => render(), toast: (t) => toast(t), errorText });
const social = createSocial({ S, render: () => render(), toast: (t) => toast(t), errorText, appName: (id) => appById(id)?.name ?? id,
  appBadge: (id) => appBadge(appById(id) ?? { name: id, color: "#0B7285" }) });
const app = () => appById(S.appId);
const live = (a) => !a.offline && api.configured(a);
const GLOBAL_TABS = ["today", "social", "roadmap-all", "hangar"];
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
  if (prev && (prev.loading || (!force && !prev.error))) return;
  S.data[key] = { ...prev, loading: true, error: null };
  render();
  try {
    S.data[key] = { value: await fn(), loading: false };
  } catch (error) {
    S.data[key] = { value: prev?.value, error, loading: false };
  }
  render();
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
    store.load(APPS, force);
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
  if (first === "social") S.tab = "social";
  else if (first === "roadmap") S.tab = "roadmap-all";
  else if (first === "hangar") S.tab = "hangar";
  else if (a) {
    S.appId = a.id;
    S.tab = appTabs(a).includes(second) ? second : "overview";
  } else S.tab = "today";
  closeSearch(false);
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

function render() {
  const focused = document.activeElement?.name;
  const gate = gateApp();
  root.innerHTML = gate && !S.users[gate.id]
    ? `<main class="gate" style="--photo:url('${PHOTO_BASE}band.webp')"><section class="gate-card">${logo()}<h1>QNH Cockpit</h1><p class="muted">intern</p>${loginForm(gate, true)}</section>${photoCredit()}</main>`
    : shell();
  if (focused) root.querySelector(`[name="${focused}"]`)?.focus();
  social.afterRender();
}

function shell() {
  const todoCount = allTodos().length;
  const navItem = (href, on, iconHtml, label, n, extra = "") =>
    `<a href="${href}" class="nav-item${on ? " on" : ""}"${extra}>${iconHtml}<span class="nav-label">${esc(label)}</span>${n ? `<span class="badge">${n}</span>` : ""}</a>`;
  const appItems = APPS.map((a) => navItem(`#${a.id}`, isAppPage() && S.appId === a.id, appBadge(a), a.name, todos(a).length, ` style="--app:${esc(a.color)}"`)).join("");
  return `<div class="shell">
    <aside class="side" aria-label="Navigation">
      <a href="#" class="brand" aria-label="QNH Cockpit – Heute">${logo()}<span>QNH <b>Cockpit</b></span></a>
      <button class="search-btn" data-action="search-open">${icon("search")}<span>Suchen</span><kbd>Ctrl K</kbd></button>
      <nav class="side-nav">
        ${navItem("#", S.tab === "today", icon("home"), "Heute", todoCount)}
        <p class="side-label">Apps</p>
        ${appItems}
        ${qnhReady() ? `<p class="side-label">QNH</p>
          ${socialConfigured() ? navItem("#social", S.tab === "social", icon("social"), "Social", social.badge()) : ""}
          ${navItem("#roadmap", S.tab === "roadmap-all", icon("flag"), "Roadmap", 0)}
          ${navItem("#hangar", S.tab === "hangar", icon("grid"), "Hangar", 0)}` : ""}
        <button class="nav-item nav-search" data-action="search-open">${icon("search")}<span class="nav-label">Suchen</span></button>
      </nav>
      <div class="side-foot">
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
        <button class="icon-btn" data-action="theme" aria-label="Farbschema wechseln">${icon(darkNow() ? "sun" : "moon")}</button>
        <button class="icon-btn" data-action="refresh" aria-label="Aktualisieren">${icon("refresh")}</button>
      </div>
      ${pageHead()}
      <main class="page">${view()}</main>
    </div>
  </div>
  ${S.search.open ? palette() : ""}
  ${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ""}`;
}

function pageHead() {
  if (S.tab === "today") {
    const user = S.users[QNH.id] ?? Object.values(S.users).find(Boolean) ?? (api.DEMO ? { email: "christoph@setqnh.ch" } : null);
    const name = firstName(user?.email);
    const date = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", weekday: "long", day: "numeric", month: "long" }).format(new Date());
    const n = allTodos().length;
    const photo = photoOfDay();
    return `<header class="page-head hello">
      <div class="hero" style="--photo:url('${photo.url}');--photo-pos:center ${photo.pos}">
        <p class="eyebrow">${esc(date)}</p>
        <h1>${esc(greeting())}${name ? `, ${esc(name)}` : ""}.</h1>
        <p class="lead">${n ? `${n} ${n === 1 ? "Sache braucht" : "Dinge brauchen"} dich heute.` : "CAVOK – alles ruhig, nichts wartet auf dich."}</p>
        ${photoCredit()}
      </div>
    </header>`;
  }
  if (S.tab === "roadmap-all") {
    return `<header class="page-head"><div class="ph-title">${icon("flag", "ph-icon")}<div><h1>Roadmap</h1><p class="muted">Ideen und nächste Schritte – für QNH und alle Apps.</p></div></div></header>`;
  }
  if (S.tab === "hangar") {
    return `<header class="page-head"><div class="ph-title">${icon("grid", "ph-icon")}<div><h1>Hangar</h1><p class="muted">Alle Werkzeuge und deine Ablage – ein Klick entfernt.</p></div></div></header>`;
  }
  if (S.tab === "social") {
    return `<header class="page-head"><div class="ph-title">${icon("social", "ph-icon")}<div><h1>Social</h1><p class="muted">Instagram-Beiträge aller Apps – du gibst jeden frei.</p></div></div></header>`;
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
  if (S.tab === "roadmap-all") return qnh.roadmapView(null);
  if (S.tab === "hangar") return qnh.hangarView();
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

function todos(a) {
  if (!live(a)) return [];
  if (!S.users[a.id]) return [{ app: a, tone: "info", label: `Bei ${a.name} anmelden`, href: `#${a.id}` }];
  const s = S.data[`${a.id}:stats`]?.value;
  const out = [];
  const add = (n, one, many, tab, tone = "alert") => { if (n > 0) out.push({ app: a, tone, n, label: `${n} ${n === 1 ? one : many}`, href: `#${a.id}/${tab}` }); };
  if (s) {
    add(s.feedback_new, "neues Feedback", "neue Feedbacks", "feedback");
    add(s.errors_24h, "Fehler in den letzten 24 h", "Fehler in den letzten 24 h", "errors");
    add(s.beta_new, "neue Beta-Anmeldung", "neue Beta-Anmeldungen", "beta", "info");
  }
  for (const t of a.stats ?? []) {
    if (!t.list) continue;
    const v = tileValue(a, t, s);
    if (v > 0) out.push({ app: a, tone: "alert", n: v, label: `${v} ${v === 1 && t.one ? t.one : t.label}`, href: `#${a.id}/${t.tab}` });
  }
  return out;
}

function socialTodos() {
  const v = S.social?.value;
  if (!v) return [];
  const out = [];
  const failed = v.posts.filter((p) => p.status === "failed").length;
  const drafts = v.posts.filter((p) => p.status === "draft").length;
  if (failed) out.push({ tone: "alert", label: `${failed} Beitrag${failed === 1 ? "" : "e"} mit Fehler`, href: "#social", where: "Social" });
  if (drafts) out.push({ tone: "info", label: `${drafts} Entw${drafts === 1 ? "urf wartet" : "ürfe warten"} auf Freigabe`, href: "#social", where: "Social" });
  const soon = Date.now() + 2 * 864e5;
  for (const p of v.posts) {
    if (!["draft", "approved"].includes(p.status) || !p.scheduled_at || !social.todoOpen(p.todo) || new Date(p.scheduled_at) > soon) continue;
    out.push({ tone: "info", label: `Von Hand auf Instagram (${formatZurich(p.scheduled_at)}): ${p.todo.trim().split("\n")[0].slice(0, 90)}`, href: "#social", where: "Social" });
  }
  for (const acc of v.accounts) {
    const days = acc.token_expires_at ? Math.floor((new Date(acc.token_expires_at) - Date.now()) / 864e5) : null;
    if (acc.active && days !== null && days < 14) out.push({ tone: "alert", label: `Instagram-Token @${acc.handle} läuft in ${Math.max(days, 0)} Tagen ab`, href: "#social", where: "Social" });
  }
  return out;
}

function roadmapTodos() {
  return qnh.dueSoon().map((i) => {
    const sc = qnh.scopeOf(i.scope);
    const late = new Date(`${i.due}T23:59:59`) < new Date();
    return { tone: late ? "alert" : "info", label: `${late ? "Überfällig" : "Bald fällig"}: ${i.title}`, href: i.scope === "qnh" ? "#roadmap" : `#${i.scope}/roadmap`, where: sc.name, app: i.scope === "qnh" ? null : appById(i.scope) };
  });
}

const allTodos = () => [...APPS.flatMap(todos), ...store.todos(APPS), ...socialTodos(), ...roadmapTodos()];

// "Als Nächstes": the first task of the focus order, one click into focus mode
function nextCard() {
  const t = qnh.nextTask();
  if (!t) return "";
  const sc = qnh.scopeOf(t.scope);
  const late = t.due && new Date(`${t.due}T23:59:59`) < new Date();
  return `<section class="block"><h2 class="section-title">Als Nächstes</h2>
    <div class="card next-card" style="--app:${esc(sc.color)}"><span class="rm-scope">${esc(sc.name)}</span>
      <span class="next-title">${esc(t.title)}${t.due ? ` <span class="rm-due${late ? " late" : ""}">${late ? "überfällig" : "bis " + esc(new Date(`${t.due}T12:00:00`).toLocaleDateString("de-CH"))}</span>` : ""}</span>
      <button class="btn" data-action="go-focus">Fokus starten</button></div></section>`;
}

function todayView() {
  const items = allTodos();
  const todoList = items.length
    ? `<ul class="todo">${items.map((t) => `<li><a class="todo-item ${t.tone}" href="${t.href}">
        <span class="todo-dot"></span><span class="todo-label">${esc(t.label)}</span>
        <span class="todo-where"${t.app ? ` style="--app:${esc(t.app.color)}"` : ""}>${esc(t.app?.name ?? t.where ?? "")}</span>${icon("arrow", "todo-arrow")}</a></li>`).join("")}</ul>`
    : `<div class="card calm-card">${icon("plane", "calm-icon")}<div><h2>Ruhiger Flug</h2><p class="muted">Kein neues Feedback, keine Fehler, nichts offen. Zeit zum Fliegen.</p></div></div>`;
  return `<section class="block"><h2 class="section-title">Braucht dich${items.length ? ` <span class="count-chip">${items.length}</span>` : ""}</h2>${todoList}</section>
    ${nextCard()}
    <section class="block"><h2 class="section-title">Apps</h2><div class="app-cards">${APPS.map(appCard).join("")}</div></section>
    ${socialConfigured() ? `<section class="block"><h2 class="section-title">Social</h2>${socialSnapshot()}</section>` : ""}`;
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

function socialSnapshot() {
  const v = S.social?.value;
  if (!v) return `<div class="card"><p class="muted loading">${S.social?.error ? esc(errorText(S.social.error)) : "Lädt …"}</p></div>`;
  const handle = (id) => v.accounts.find((x) => x.id === id)?.handle ?? "";
  const planned = v.posts.filter((p) => p.status === "approved").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 3);
  const count = (st) => v.posts.filter((p) => p.status === st).length;
  return `<div class="card social-snap">
    <div class="snap-stats">
      <a href="#social"><b>${count("approved")}</b><span>geplant</span></a>
      <a href="#social"><b>${count("draft")}</b><span>Entwürfe</span></a>
      <a href="#social"><b>${count("published")}</b><span>veröffentlicht</span></a>
      <button class="btn" data-action="go-new-post">${icon("plus")} Neuer Beitrag</button>
    </div>
    ${planned.length ? `<ul class="snap-list">${planned.map((p) => `<li><a href="#social">${icon("clock")}<span class="snap-when">${esc(formatZurich(p.scheduled_at))}</span><span class="snap-what">@${esc(handle(p.account_id))} · ${esc(String(p.caption || "Story").split("\n")[0].slice(0, 70))}</span></a></li>`).join("")}</ul>`
      : `<p class="muted small">Nichts geplant. Ein Paket aus dem Chat «Corporate Identity» oder ein neuer Beitrag füllt den Kalender.</p>`}
  </div>`;
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
    pages.push({ label: "Roadmap", sub: "QNH und alle Apps", href: "#roadmap" });
    pages.push({ label: "Hangar", sub: "Links und Ablage", href: "#hangar" });
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

function feedbackItem(r) {
  const shot = S.shots[r.id];
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
      ${r.status !== "new" ? `<span class="pill ${r.status}">${BETA_STATUS[r.status]}${r.handled_at ? ` · ${shortDate(r.handled_at)}` : ""}</span>` : ""}</div>
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
  const doc = S.docs[r.id];
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
      ${r.status !== "open" ? `<span class="pill">${REPORT_STATUS[r.status] ?? r.status}${r.status === "actioned" && r.action ? `: ${ACTION[r.action] ?? r.action}` : ""}</span>` : ""}
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
  social: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  plane: '<path d="M2 13l8-2 4-7h2l-2 7 6 1 2-2h1l-1 4 1 4h-1l-2-2-6 1 2 7h-2l-4-7-8-2z"/>',
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
  social.onInput(e);
});
// scroll does not bubble: listen in the capture phase (carousel preview swipe)
root.addEventListener("scroll", (e) => social.onScroll(e), true);
root.addEventListener("dragstart", (e) => qnh.onDragStart(e) || social.onDragStart(e));
root.addEventListener("dragover", (e) => qnh.onDragOver(e) || social.onDragOver(e));
root.addEventListener("dragleave", (e) => e.target.closest?.("[data-drop], [data-rm-col], [data-cal-day]")?.classList.remove("over"));
root.addEventListener("drop", (e) => qnh.onDrop(e) || social.onDrop(e));

root.addEventListener("change", async (e) => {
  await social.onChange(e);
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return S.search.open ? closeSearch() : openSearch();
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
  if (action === "go-focus") { qnh.startFocus("all"); if (location.hash === "#roadmap") render(); else location.hash = "#roadmap"; return; }
  if (/^(rm|hg)-/.test(action)) return qnh.onClick(action, el);
  if (action.startsWith("store-")) return store.onClick(el, APPS);
  if (action === "search-open") return openSearch();
  if (action === "search-close") return closeSearch();
  if (action === "pal-go") return activate(paletteResults[Number(el.dataset.i)]);
  if (action === "theme") return toggleTheme();
  if (action === "go-new-post") return goNewPost();
  const a = el.dataset.app ? appById(el.dataset.app) : app();

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
      S.users[a.id] = null;
      for (const k of Object.keys(S.data)) if (k.startsWith(`${a.id}:`)) delete S.data[k];
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
      try {
        S.docs[id] = await api.verificationDocUrl(a, row.doc_path);
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
      try {
        S.shots[id] = await api.screenshotUrl(a, row.screenshot_path);
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
