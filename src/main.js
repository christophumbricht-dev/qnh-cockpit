import "./style.css";
import { APPS, QNH, appById } from "./apps.js";
import * as api from "./api.js";
import { esc, relTime, shortDate, num, sourceLabel, errorText } from "./format.js";
import { bucket, chartSvg, periodLabel } from "./charts.js";
import { createSocial } from "./social/ui.js";
import { socialConfigured } from "./social/data.js";

const TREND_RANGES = [[30, "30 Tage"], [91, "3 Monate"], [182, "6 Monate"], [365, "1 Jahr"]];
const TAB_LABELS = { overview: "Übersicht", social: "Social", trend: "Verlauf", feedback: "Feedback", errors: "Fehler", beta: "Beta", verify: "Verifizierung", reports: "Meldungen" };
const ERROR_DAYS = [1, 7, 30];

const S = {
  tab: "overview",
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
};

const root = document.getElementById("app");
const social = createSocial({ S, render: () => render(), toast: (t) => toast(t), errorText, appName: (id) => appById(id)?.name ?? id });
const app = () => appById(S.appId);
const live = (a) => !a.offline && api.configured(a);

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
    if (!live(a) || !S.users[a.id] || (S.tab !== "overview" && a.id !== S.appId)) continue;
    load(a, "stats", () => api.stats(a), force);
    // small lists that feed overview tiles and tab badges
    if (a.tabs.includes("verify")) load(a, "verify", () => api.verificationQueue(a), force);
    if (a.tabs.includes("reports")) load(a, "reports", () => api.reports(a), force);
  }
  if (socialConfigured() && (S.tab === "overview" || S.tab === "social") && (api.DEMO || S.users[QNH.id])) social.load(force);
  const a = app();
  if (!a || !S.users[a.id]) return;
  if (S.tab === "trend") load(a, `trend${S.trendDays}`, () => api.timeseries(a, S.trendDays), force);
  if (S.tab === "feedback") load(a, "feedback", () => api.feedback(a), force);
  if (S.tab === "errors") load(a, `errors${S.errorDays}`, () => api.errors(a, S.errorDays), force);
  if (S.tab === "beta") load(a, "beta", () => api.betaSignups(a), force);
}

function route() {
  const [appId, tab] = location.hash.replace(/^#\/?/, "").split("/");
  const a = appById(appId);
  if (appId === "social") {
    S.tab = "social";
  } else if (a?.tabs?.includes(tab)) {
    S.appId = a.id;
    S.tab = tab;
  } else {
    S.tab = "overview";
  }
  ensureData();
  render();
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
    ? `<main class="gate"><section class="card gate-card">${logo()}<h1>QNH Cockpit – intern</h1>${loginForm(gate, true)}</section></main>`
    : `${header()}<main>${view()}</main>${S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : ""}`;
  if (focused) root.querySelector(`[name="${focused}"]`)?.focus();
}

function header() {
  const a = app();
  const tabs = ["overview", ...(socialConfigured() ? ["social"] : []), ...(a?.tabs ?? [])];
  const stats = a && S.data[`${a.id}:stats`]?.value;
  const nav = tabs.map((t) => {
    const href = t === "overview" ? "#" : t === "social" ? "#social" : `#${a.id}/${t}`;
    const n = t === "overview" ? 0 : t === "social" ? social.badge() : badge(a, t, stats);
    return `<a href="${href}" class="tab${S.tab === t ? " on" : ""}">${TAB_LABELS[t]}${n ? `<span class="badge">${n}</span>` : ""}</a>`;
  }).join("");
  const appsWithTabs = APPS.filter((x) => x.tabs?.length);
  const picker = appsWithTabs.length > 1
    ? `<select class="app-pick" data-action="pick-app">${appsWithTabs.map((x) => `<option value="${x.id}"${x.id === S.appId ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`
    : "";
  return `<header>
    <div class="bar">
      <a href="#" class="brand" aria-label="QNH Cockpit">${logo()}<span>QNH <b>Cockpit</b></span></a>
      ${api.DEMO ? `<span class="demo">Demo-Daten</span>` : ""}
      <button class="icon-btn" data-action="refresh" title="Aktualisieren" aria-label="Aktualisieren">${refreshIcon()}</button>
      ${!api.DEMO && S.users[QNH.id] ? `<button class="link head-out" data-action="sign-out" data-app="${QNH.id}">Abmelden</button>` : ""}
    </div>
    <nav>${picker}${nav}</nav>
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
  if (S.tab === "overview") return overview();
  if (S.tab === "social") return social.view();
  const a = app();
  if (!S.users[a.id]) return `<section class="card">${cardHead(a)}${loginForm(a)}</section>`;
  if (S.tab === "trend") return trendView(a);
  if (S.tab === "feedback") return feedbackView(a);
  if (S.tab === "errors") return errorsView(a);
  if (S.tab === "beta") return betaView(a);
  if (S.tab === "verify") return verifyView(a);
  if (S.tab === "reports") return reportsView(a);
  return "";
}

// ---- overview ---------------------------------------------------------------

function overview() {
  return `<div class="cards">${APPS.map((a) => `<section class="card">${cardHead(a)}${cardBody(a)}</section>`).join("")}${social.overviewCard()}</div>`;
}

function cardHead(a) {
  const user = S.users[a.id];
  return `<div class="card-head">
    <span class="dot" style="background:${esc(a.color)}"></span>
    <div><h2>${esc(a.name)}</h2><p class="muted">${esc(a.tagline ?? "")}</p></div>
    ${user ? `<div class="who"><span class="muted">${esc(user.email ?? "")}</span><button class="link" data-action="sign-out" data-app="${a.id}">Abmelden</button></div>` : ""}
  </div>`;
}

function cardBody(a) {
  if (a.offline) return `<p class="note">${esc(a.note)}</p>`;
  if (!api.configured(a)) return `<p class="note">Supabase-Adresse und Schlüssel fehlen in <code>.env</code>.</p>`;
  if (!S.users[a.id]) return loginForm(a);
  return block(`${a.id}:stats`, (s) => `<div class="tiles">${a.stats.map((t) => tile(a, t, s)).join("")}</div>`);
}

function tile(a, t, s) {
  const value = tileValue(a, t, s);
  const inner = `<span class="tile-label">${esc(t.label)}</span>
    <span class="tile-num">${num(value)}</span>
    ${t.sub ? `<span class="tile-sub">${esc(t.sub(s))}</span>` : ""}`;
  const alert = t.list ? value > 0 : t.alert?.(s);
  const cls = `tile${alert ? " alert" : ""}`;
  return t.tab ? `<a class="${cls}" href="#${a.id}/${t.tab}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
}

function loginForm(a, neutral = false) {
  const l = S.login[a.id] ?? { step: "email", email: "" };
  const err = l.error ? `<p class="error">${esc(l.error)}</p>` : "";
  if (l.step === "code") {
    return `<form class="login" data-form="verify-code" data-app="${a.id}">
      <p>Code an <b>${esc(l.email)}</b> gesendet.${neutral ? "" : ` Er steht in der Anmelde-E-Mail von ${esc(a.name)}.`}</p>
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
  return `<svg viewBox="40 44 90 122" aria-hidden="true"><g fill="none" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="50,155 85,120 120,155" stroke="#99E9F2"/><polyline points="50,122 85,87 120,122" stroke="#22B8CF"/>
    <polyline points="50,89 85,54 120,89" stroke="#0B7285"/></g></svg>`;
}

function refreshIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

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

root.addEventListener("input", (e) => social.onInput(e));
root.addEventListener("dragover", (e) => social.onDragOver(e));
root.addEventListener("dragleave", (e) => e.target.closest?.("[data-drop]")?.classList.remove("over"));
root.addEventListener("drop", (e) => social.onDrop(e));

root.addEventListener("change", async (e) => {
  if (await social.onChange(e)) return;
  if (e.target.dataset.action === "pick-app") location.hash = `#${e.target.value}/${appById(e.target.value).tabs[0]}`;
});

root.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT") return;
  const { action, id, status, value } = el.dataset;
  if (action.startsWith("soc-")) return social.onClick(action, el);
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

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

(async () => {
  root.innerHTML = `<p class="muted loading">Lädt …</p>`;
  for (const a of [QNH, ...APPS]) if (live(a)) S.users[a.id] = await api.currentUser(a);
  route();
})();
