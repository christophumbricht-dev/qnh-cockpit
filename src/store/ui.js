// Tab "Store & Builds" per app: App Store version, TestFlight builds, reviews, Codemagic builds.
import { esc, relTime, num } from "../format.js";
import { DEMO } from "../api.js";
import { loadStoreStatus } from "./data.js";

// [label, tone]  tone: ok | info | alert | muted
const VERSION_STATE = {
  PREPARE_FOR_SUBMISSION: ["In Vorbereitung", "muted"],
  READY_FOR_REVIEW: ["Bereit zur Einreichung", "info"],
  WAITING_FOR_REVIEW: ["Wartet auf Review", "info"],
  IN_REVIEW: ["Im Review bei Apple", "info"],
  PENDING_DEVELOPER_RELEASE: ["Genehmigt – wartet auf deine Freigabe", "ok"],
  PENDING_APPLE_RELEASE: ["Genehmigt – Apple gibt frei", "ok"],
  PROCESSING_FOR_DISTRIBUTION: ["Wird veröffentlicht", "info"],
  READY_FOR_DISTRIBUTION: ["Im App Store", "ok"],
  READY_FOR_SALE: ["Im App Store", "ok"],
  ACCEPTED: ["Akzeptiert", "ok"],
  REJECTED: ["Abgelehnt", "alert"],
  METADATA_REJECTED: ["Metadaten abgelehnt", "alert"],
  INVALID_BINARY: ["Build ungültig", "alert"],
  DEVELOPER_REJECTED: ["Zurückgezogen", "muted"],
  WAITING_FOR_EXPORT_COMPLIANCE: ["Exportangaben fehlen", "alert"],
  REPLACED_WITH_NEW_VERSION: ["Ersetzt", "muted"],
};
const BETA_STATE = {
  PROCESSING: ["Wird verarbeitet", "info"],
  PROCESSING_EXCEPTION: ["Verarbeitungsfehler", "alert"],
  MISSING_EXPORT_COMPLIANCE: ["Exportangaben fehlen", "alert"],
  READY_FOR_BETA_TESTING: ["Bereit zum Testen", "ok"],
  IN_BETA_TESTING: ["In TestFlight", "ok"],
  READY_FOR_BETA_SUBMISSION: ["Bereit für Beta-Review", "info"],
  IN_EXPORT_COMPLIANCE_REVIEW: ["Export-Prüfung", "info"],
  WAITING_FOR_BETA_REVIEW: ["Wartet auf Beta-Review", "info"],
  IN_BETA_REVIEW: ["Im Beta-Review", "info"],
  BETA_REJECTED: ["Beta abgelehnt", "alert"],
  BETA_APPROVED: ["Extern freigegeben", "ok"],
  EXPIRED: ["Abgelaufen", "muted"],
};
const CM_STATE = {
  queued: ["Wartet", "info"], preparing: ["Startet", "info"], fetching: ["Lädt Code", "info"], building: ["Baut", "info"], testing: ["Testet", "info"],
  publishing: ["Lädt hoch", "info"], finishing: ["Schliesst ab", "info"], finished: ["Erfolgreich", "ok"], warning: ["Mit Warnungen", "info"],
  failed: ["Fehlgeschlagen", "alert"], timeout: ["Zeitüberschreitung", "alert"], canceled: ["Abgebrochen", "muted"], skipped: ["Übersprungen", "muted"],
};
const state = (map, s) => map[s] ?? [String(s ?? "–").replaceAll("_", " ").toLowerCase(), "muted"];
const pill = ([label, tone]) => `<span class="st-pill ${tone}">${esc(label)}</span>`;
const stars = (n) => `<span class="stars" aria-label="${n} von 5 Sternen">${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}</span>`;
const WEEK = 7 * 864e5;

export function createStore({ S, render, toast, errorText }) {
  S.store = { value: null, loading: false, error: null };

  const appsWithStore = (apps) => apps.filter((a) => a.store?.bundleId);

  async function load(apps, force = false) {
    const st = S.store;
    const ids = appsWithStore(apps).map((a) => a.store.bundleId);
    if (!ids.length || st.loading || (st.value && !force && Date.now() - new Date(st.value.fetched_at) < 10 * 60e3)) return;
    if (st.error && !force) return;
    st.loading = true;
    render();
    try {
      st.value = await loadStoreStatus(ids);
      st.error = null;
    } catch (err) {
      st.error = err;
      if (force) toast(errorText(err));
    }
    st.loading = false;
    render();
  }

  const forApp = (a) => S.store.value?.apps?.[a.store?.bundleId];
  const cmBuilds = (a) => (S.store.value?.codemagic?.builds ?? []).filter((b) => !a.store?.codemagic || (b.app ?? "").toLowerCase().includes(a.store.codemagic.toLowerCase()));

  // things that need Christoph, for "Heute"
  function todos(apps) {
    const out = [];
    for (const a of appsWithStore(apps)) {
      const s = forApp(a);
      const href = `#${a.id}/store`;
      if (!s) continue;
      const v = s.versions?.[0];
      const [vLabel, vTone] = v ? state(VERSION_STATE, v.state) : [];
      if (v && vTone === "alert") out.push({ app: a, tone: "alert", label: `App Store ${v.version}: ${vLabel}`, href });
      if (v?.state === "PENDING_DEVELOPER_RELEASE") out.push({ app: a, tone: "info", label: `Version ${v.version} ist genehmigt – jetzt freigeben`, href });
      const b = s.builds?.[0];
      if (b && (["FAILED", "INVALID"].includes(b.processing) || state(BETA_STATE, b.external)[1] === "alert")) {
        out.push({ app: a, tone: "alert", label: `TestFlight-Build ${b.build}: ${b.processing === "VALID" ? state(BETA_STATE, b.external)[0] : "Verarbeitung fehlgeschlagen"}`, href });
      }
      const fresh = (s.reviews ?? []).filter((r) => Date.now() - new Date(r.date) < WEEK).length;
      if (fresh) out.push({ app: a, tone: "info", label: `${fresh} neue App-Store-Bewertung${fresh === 1 ? "" : "en"}`, href });
      // newest build of each workflow failed?
      const seen = new Set();
      for (const c of cmBuilds(a)) {
        if (seen.has(c.workflow)) continue;
        seen.add(c.workflow);
        if (["failed", "timeout"].includes(c.status)) out.push({ app: a, tone: "alert", label: `Codemagic ${c.workflow ?? ""} #${c.index ?? ""} fehlgeschlagen`, href });
      }
    }
    return out;
  }

  function view(a) {
    const st = S.store;
    if (!st.value) {
      if (st.error) return `<section class="card"><p class="error">${esc(errorText(st.error))}</p><button class="btn" data-action="store-refresh">Nochmals versuchen</button></section>`;
      return `<p class="muted loading">Fragt Apple und Codemagic …</p>`;
    }
    const s = forApp(a) ?? { errors: [] };
    const conf = st.value.configured ?? {};
    const head = `<div class="toolbar"><span class="muted small">Stand ${esc(relTime(st.value.fetched_at))}${DEMO ? " · Demo-Daten" : ""}</span>
      <button class="btn ghost" data-action="store-refresh"${st.loading ? " disabled" : ""}>${st.loading ? "Lädt …" : "Aktualisieren"}</button></div>`;
    const setup = !conf.asc || !conf.codemagic
      ? `<p class="note">${!conf.asc ? "App Store Connect" : ""}${!conf.asc && !conf.codemagic ? " und " : ""}${!conf.codemagic ? "Codemagic" : ""} noch nicht verbunden – Anleitung: <code>docs/store-setup.md</code>.</p>` : "";
    const errors = (s.errors ?? []).length ? `<ul class="store-errors">${s.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "";

    const v = s.versions?.[0];
    const storeCard = `<section class="card store-card"><h3>App Store</h3>
      ${v ? `<p class="store-big">Version ${esc(v.version)}</p>${pill(state(VERSION_STATE, v.state))}` : `<p class="muted">${conf.asc ? "Noch keine App-Store-Version angelegt." : "Ohne Schlüssel unbekannt."}</p>`}
      <dl class="store-facts">
        <div><dt>Bewertung</dt><dd>${s.store?.rating ? `${stars(s.store.rating)} ${num(Math.round(s.store.rating * 10) / 10)} · ${num(s.store.ratings)}` : "noch nicht im App Store"}</dd></div>
        ${s.testers != null ? `<div><dt>TestFlight-Tester</dt><dd>${num(s.testers)}</dd></div>` : ""}
        ${s.store?.version ? `<div><dt>Live-Version</dt><dd>${esc(s.store.version)}</dd></div>` : ""}
      </dl>
      ${s.store?.url ? `<a class="link" href="${esc(s.store.url)}" target="_blank" rel="noopener">Im App Store ansehen</a>` : ""}
    </section>`;

    const builds = s.builds ?? [];
    const tfCard = `<section class="card store-card"><h3>TestFlight</h3>
      ${builds.length ? `<ul class="store-list">${builds.map((b) => {
        const st2 = b.processing === "VALID" ? state(BETA_STATE, b.external ?? b.internal) : b.processing === "PROCESSING" ? BETA_STATE.PROCESSING : ["Verarbeitung fehlgeschlagen", "alert"];
        return `<li${b.expired ? ' class="faded"' : ""}><div><b>${esc(b.version ?? "")}</b> <span class="muted">(${esc(b.build)})</span><br><span class="muted small">hochgeladen ${esc(relTime(b.uploaded))}</span></div>${pill(b.expired ? BETA_STATE.EXPIRED : st2)}</li>`;
      }).join("")}</ul>` : `<p class="muted">${conf.asc ? "Keine Builds." : "Ohne Schlüssel unbekannt."}</p>`}
    </section>`;

    const cm = st.value.codemagic;
    const cmList = cmBuilds(a);
    const cmCard = `<section class="card store-card"><h3>Codemagic</h3>
      ${cm?.error ? `<p class="error">${esc(cm.error)}</p>` : !cm ? `<p class="muted">Nicht verbunden.</p>` : cmList.length
        ? `<ul class="store-list">${cmList.slice(0, 6).map((c) => `<li><div><a href="${esc(c.url)}" target="_blank" rel="noopener"><b>#${esc(c.index ?? "")}</b> ${esc(c.workflow ?? "")}</a>
            <br><span class="muted small">${esc(c.branch ?? "")}${c.message ? ` · ${esc(c.message)}` : ""}${c.started ? ` · ${esc(relTime(c.started))}` : ""}</span></div>${pill(state(CM_STATE, c.status))}</li>`).join("")}</ul>`
        : `<p class="muted">Keine Builds gefunden.</p>`}
    </section>`;

    const reviews = s.reviews;
    const revCard = reviews === undefined ? "" : `<section class="card"><h3>Bewertungen mit Text</h3>
      ${reviews.length ? `<ul class="store-reviews">${reviews.map((r) => `<li>${stars(r.rating)} <b>${esc(r.title)}</b>
        <p>${esc(r.body)}</p><span class="muted small">${esc(r.nick)} · ${esc(r.territory)} · ${esc(relTime(r.date))}</span></li>`).join("")}</ul>`
        : `<p class="muted">Noch keine – sie erscheinen hier, sobald die App im App Store ist.</p>`}
    </section>`;

    return `${head}${setup}${errors}<div class="store-grid">${storeCard}${tfCard}${cmCard}</div>${revCard}
      <p class="hint">Nur lesen – Einreichen und Freigeben machst du weiterhin in App Store Connect. Download-Zahlen folgen später.</p>`;
  }

  function onClick(el, apps) {
    if (el.dataset.action !== "store-refresh") return false;
    S.store.error = null;
    load(apps, true);
    return true;
  }

  return { load, view, todos, onClick };
}
