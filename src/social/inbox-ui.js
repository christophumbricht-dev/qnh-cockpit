// Social → «Kommentare»: comments on our own Instagram posts and YouTube videos, answered from the cockpit.
// Every answer is Christoph's click («Auf Instagram antworten»); drafts (e.g. from Claude) only fill the box.
import { DEMO } from "../api.js";
import { esc, num, relTime } from "../format.js";
import * as data from "./data.js";
import { FILTERS, REPLY_MAX, commentUrl, groupComments, heldCount, isOpen, openCount, replyPrefill, replyTarget } from "./inbox.js";
import { formatZurich } from "./validate.js";

const PLATFORM = { instagram: "Instagram", youtube: "YouTube", facebook: "Facebook" };
const YT_STATE = "qnh-yt-state", YT_RESULT = "qnh-yt-result";

export function createInbox({ S, render, toast, errorText, appName, appBadge, brands, reload }) {
  S.social.inbox = { filter: "open", texts: {}, target: {}, busy: null, fetching: false };
  const ib = () => S.social.inbox;
  const accounts = () => S.social.value?.accounts ?? [];
  const account = (id) => accounts().find((a) => a.id === id);
  const rows = () => S.social.value?.comments;
  const appOk = (accountId) => S.social.filter === "all" || account(accountId)?.app_id === S.social.filter;
  const ready = () => Array.isArray(rows());
  // open comments (all apps – for the badge and «Heute»; the chip follows the app filter)
  const count = (all = true) => openCount((rows() ?? []).filter((c) => all || appOk(c.account_id)));

  let unsubscribe = null, timer;
  function watch() {
    if (unsubscribe || !ready()) return;
    unsubscribe = data.subscribeComments(() => { clearTimeout(timer); timer = setTimeout(refresh, 400); });
  }
  async function refresh() {
    const fresh = await data.loadComments().catch(() => null);
    if (fresh && S.social.value) S.social.value.comments = fresh;
    // do not re-render under Christoph's fingers while he types an answer
    if (!document.activeElement?.closest?.(".cmt-reply")) render();
  }

  // ---------- view ----------
  function view() {
    if (!ready()) {
      return `<p class="note">Die Kommentar-Inbox ist noch nicht eingerichtet: Migration <code>20261020100000_social_comments.sql</code> im SQL-Editor ausführen und <code>social-publish</code> neu hochladen (docs/social-setup.md, «Kommentare»).</p>`;
    }
    const all = (rows() ?? []).filter((c) => appOk(c.account_id));
    const posts = groupComments(all, { filter: ib().filter });
    const n = { open: openCount(all), held: heldCount(all) };
    const chips = FILTERS.filter(([v]) => v !== "held" || n.held || ib().filter === "held")
      .map(([v, l]) => `<button class="chip${ib().filter === v ? " on" : ""}" data-action="soc-cmt-filter" data-value="${v}">${l}${n[v] ? ` (${n[v]})` : ""}</button>`).join("");
    const head = `<div class="cal-head"><div class="chips">${chips}</div>
      <button class="btn ghost" data-action="soc-cmt-fetch"${ib().fetching ? " disabled" : ""}>${ib().fetching ? "Holt Kommentare …" : "Jetzt abholen"}</button></div>`;
    const empty = { open: "Alles beantwortet – keine offenen Kommentare.", held: "YouTube hält nichts zurück.", done: "Noch nichts erledigt.", hidden: "Keine ausgeblendeten Kommentare.", all: "Noch keine Kommentare." }[ib().filter];
    return `${head}${posts.length ? posts.map(postHtml).join("") : `<p class="muted cmt-empty">${empty}</p>`}
      <p class="hint">Neue Kommentare kommen alle 15 Minuten von selbst. «Erledigt» legt einen Kommentar ab, ohne zu antworten. «Ausblenden» versteckt ihn für alle anderen (Spam, Beleidigungen) – rückgängig mit «Einblenden». «Zurückgehalten» sind Kommentare, die YouTube für Spam hält: niemand sieht sie, bis du sie freigibst.</p>`;
  }

  function postHtml(p) {
    const acc = account(p.account_id);
    const plat = PLATFORM[acc?.platform] ?? acc?.platform ?? "";
    return `<section class="card cmt-post">
      <header class="cmt-post-head">${acc ? appBadge(acc.app_id) : ""}
        <div><b>${esc(p.title || "(ohne Titel)")}</b><span class="muted small">${esc(plat)} · @${esc(acc?.handle ?? "?")}${p.open ? ` · <span class="cmt-open">${p.open} offen</span>` : ""}</span></div>
        ${p.permalink ? `<a class="btn ghost small-btn" href="${esc(p.permalink)}" target="_blank" rel="noopener">Auf ${esc(plat)} ↗</a>` : ""}
      </header>
      ${p.threads.map((th) => threadHtml(th, acc)).join("")}
    </section>`;
  }

  function threadHtml(th, acc) {
    return `<div class="cmt-thread${th.open ? " open" : ""}">
      ${th.top ? commentHtml(th.top, acc) : `<p class="muted small">(ursprünglicher Kommentar nicht mehr da)</p>`}
      ${th.replies.length ? `<div class="cmt-replies">${th.replies.map((r) => commentHtml(r, acc)).join("")}</div>` : ""}
      ${replyBox(th, acc)}
    </div>`;
  }

  function commentHtml(c, acc) {
    const busy = ib().busy === c.id ? " disabled" : "";
    const link = (action, label, cls = "") => `<button class="link${cls}" data-action="${action}" data-id="${c.id}"${busy}>${label}</button>`;
    const acts = [];
    if (!c.own && c.status !== "hidden" && !c.held) acts.push(link("soc-cmt-target", "Antworten"));
    if (isOpen(c)) acts.push(link("soc-cmt-done", "Erledigt ✓"));
    else if (!c.own && c.status === "done") acts.push(link("soc-cmt-reopen", "Wieder offen"));
    if (c.held) acts.push(link("soc-cmt-approve", "Freigeben"));
    if (c.own) acts.push(link("soc-cmt-delete", "Löschen", " danger-link"));
    else acts.push(c.status === "hidden" ? link("soc-cmt-show", "Einblenden") : link("soc-cmt-hide", "Ausblenden"));
    const url = commentUrl(c, acc?.platform);
    if (url) acts.push(`<a class="link" href="${esc(url)}" target="_blank" rel="noopener">Öffnen ↗</a>`);
    const who = c.own ? "Du" : esc(c.author || "Unbekannt");
    return `<div class="cmt${c.own ? " own" : ""}${isOpen(c) ? " new" : ""}${c.status === "hidden" ? " is-hidden" : ""}">
      <div class="cmt-head">${!c.own && c.author_url ? `<a href="${esc(c.author_url)}" target="_blank" rel="noopener"><b>${who}</b></a>` : `<b>${who}</b>`}
        <span class="muted small" title="${esc(formatZurich(c.posted_at))}">${esc(relTime(c.posted_at))}</span>
        ${c.like_count ? `<span class="muted small">♥ ${num(c.like_count)}</span>` : ""}
        ${isOpen(c) ? `<span class="pill">neu</span>` : ""}
        ${c.held ? `<span class="pill held">von YouTube zurückgehalten</span>` : ""}
        ${c.status === "hidden" ? `<span class="pill draft">ausgeblendet</span>` : ""}</div>
      <p class="cmt-body">${esc(c.body)}</p>
      <div class="cmt-actions">${acts.join("")}</div>
    </div>`;
  }

  function replyBox(th, acc) {
    const chosen = ib().target[th.key];
    if (!th.open && !chosen) return "";
    const all = [th.top, ...th.replies].filter(Boolean);
    const target = all.find((c) => c.id === chosen) ?? replyTarget(th);
    if (!target || target.own || target.status === "hidden" || target.held) return "";
    const text = ib().texts[target.id] ?? replyPrefill(target);
    const busy = ib().busy === target.id ? " disabled" : "";
    const plat = PLATFORM[acc?.platform] ?? "";
    return `<div class="cmt-reply">
      <textarea name="soc-cmt-text-${target.id}" rows="2" maxlength="${REPLY_MAX}" placeholder="Antwort an ${esc(target.author || "…")} …" aria-label="Antwort an ${esc(target.author)}"${busy}>${esc(text)}</textarea>
      ${target.draft?.trim() && ib().texts[target.id] === undefined ? `<span class="small muted">Antwortvorschlag – vor dem Senden lesen und anpassen.</span>` : ""}
      <div class="actions"><button class="btn" data-action="soc-cmt-reply" data-id="${target.id}"${busy}>${ib().busy === target.id ? "Sendet …" : `Auf ${esc(plat)} antworten`}</button>
        ${chosen ? `<button class="btn ghost" data-action="soc-cmt-untarget" data-value="${esc(th.key)}">Abbrechen</button>` : ""}</div>
    </div>`;
  }

  // ---------- YouTube channel: connect (Google sign-in) ----------
  function connectRow() {
    if (!ready()) return "";
    const taken = new Set(accounts().filter((a) => a.platform === "youtube").map((a) => a.app_id));
    const free = brands().filter((b) => !taken.has(b.id));
    if (!free.length) return "";
    return `<li class="acc-connect"><select name="soc-yt-app" aria-label="Für welche App oder Marke">${free.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select>
      <button class="btn ghost small-btn" data-action="soc-yt-connect">YouTube-Kanal verbinden</button></li>`;
  }

  async function startConnect() {
    if (DEMO) return toast("Im Demo-Modus nicht verfügbar.");
    const appId = document.querySelector('select[name="soc-yt-app"]')?.value;
    if (!appId) return;
    const state = crypto.randomUUID();
    const redirect = new URL("youtube-callback.html", location.origin + location.pathname).href;
    try {
      sessionStorage.setItem(YT_STATE, JSON.stringify({ state, appId, redirect }));
      const { url } = await data.youtubeAuthUrl(appId, redirect, state);
      location.assign(url);
    } catch (err) {
      toast(`YouTube: ${errorText(err)}`);
    }
  }

  // back from Google (public/youtube-callback.html put the answer into sessionStorage)
  async function finishConnect() {
    let raw = null, saved = null;
    try {
      raw = sessionStorage.getItem(YT_RESULT);
      saved = JSON.parse(sessionStorage.getItem(YT_STATE) ?? "null");
      if (raw !== null) { sessionStorage.removeItem(YT_RESULT); sessionStorage.removeItem(YT_STATE); }
    } catch { return; }
    if (raw === null) return;
    const p = new URLSearchParams(raw);
    if (!saved || p.get("state") !== saved.state) return toast("YouTube nicht verbunden: Die Antwort von Google passt nicht zu dieser Anmeldung. Bitte nochmals «YouTube-Kanal verbinden».");
    if (p.get("error")) return toast(p.get("error") === "access_denied" ? "Bei Google abgebrochen – nichts verbunden." : `YouTube nicht verbunden: Google meldet «${p.get("error")}».`);
    toast("Verbinde den YouTube-Kanal …");
    try {
      const r = await data.youtubeConnect(saved.appId, p.get("code") ?? "", saved.redirect);
      toast(`YouTube-Kanal «${r.title || r.handle}» für ${appName(saved.appId)} verbunden – Kommentare kommen gleich.`);
      S.social.mode = "comments";
      await reload();
      fetchNow(true);
    } catch (err) {
      toast(`YouTube nicht verbunden: ${errorText(err)}`);
    }
  }

  async function fetchNow(quiet = false) {
    if (ib().fetching) return;
    ib().fetching = true;
    render();
    try {
      const res = await data.fetchComments();
      const bad = res.find((r) => r.status !== "ok");
      const fresh = res.reduce((s, r) => s + (r.new ?? 0), 0);
      if (bad) toast(`@${bad.account} (${PLATFORM[bad.platform] ?? bad.platform}): ${bad.error}`);
      else if (!quiet) toast(fresh ? `${fresh} neue${fresh === 1 ? "r" : ""} Kommentar${fresh === 1 ? "" : "e"}` : "Keine neuen Kommentare");
    } catch (err) { toast(errorText(err)); }
    ib().fetching = false;
    await refresh();
  }

  // ---------- events ----------
  const byId = (id) => (rows() ?? []).find((c) => c.id === id);
  async function act(id, fn, done) {
    ib().busy = id;
    render();
    try { await fn(); if (done) toast(done); } catch (err) { toast(errorText(err)); }
    ib().busy = null;
    await refresh();
  }

  async function onClick(action, el) {
    const id = el.dataset.id;
    const c = id ? byId(id) : null;
    switch (action) {
      case "soc-cmt-filter": ib().filter = el.dataset.value; render(); return true;
      case "soc-cmt-fetch": await fetchNow(); return true;
      case "soc-cmt-target": {
        if (!c) return true;
        const th = groupComments(rows(), { filter: "all" }).flatMap((p) => p.threads).find((t) => t.top?.id === id || t.replies.some((r) => r.id === id));
        if (th) ib().target[th.key] = id;
        render();
        setTimeout(() => { const ta = document.querySelector(`textarea[name="soc-cmt-text-${id}"]`); ta?.focus(); ta?.setSelectionRange(ta.value.length, ta.value.length); }, 0);
        return true;
      }
      case "soc-cmt-untarget": delete ib().target[el.dataset.value]; render(); return true;
      case "soc-cmt-reply": {
        if (!c) return true;
        const text = (ib().texts[id] ?? replyPrefill(c)).trim();
        if (!text) { toast("Zuerst eine Antwort schreiben."); return true; }
        if (text.length > REPLY_MAX) { toast(`Höchstens ${REPLY_MAX} Zeichen.`); return true; }
        await act(id, async () => {
          await data.replyComment(id, text);
          delete ib().texts[id];
          for (const [k, v] of Object.entries(ib().target)) if (v === id) delete ib().target[k];
        }, "Antwort gesendet");
        return true;
      }
      case "soc-cmt-done": case "soc-cmt-reopen":
        if (c) {
          c.status = action === "soc-cmt-done" ? "done" : "new"; // at once on screen, the database follows
          await act(id, () => data.setCommentStatus(id, c.status));
        }
        return true;
      case "soc-cmt-hide":
        if (c && confirm(`Kommentar von ${c.author || "Unbekannt"} ausblenden? Andere sehen ihn dann nicht mehr (rückgängig mit «Einblenden»).`)) await act(id, () => data.moderateComment(id, "hide"), "Ausgeblendet");
        return true;
      case "soc-cmt-show": if (c) await act(id, () => data.moderateComment(id, "show"), "Wieder sichtbar"); return true;
      case "soc-cmt-approve": if (c) await act(id, () => data.moderateComment(id, "approve"), "Freigegeben – jetzt für alle sichtbar"); return true;
      case "soc-cmt-delete":
        if (c && confirm("Deine Antwort löschen? Sie verschwindet auch auf der Plattform.")) await act(id, () => data.moderateComment(id, "delete"), "Gelöscht");
        return true;
      case "soc-yt-connect": await startConnect(); return true;
    }
    return false;
  }

  function onInput(e) {
    const name = e.target.name ?? "";
    if (!name.startsWith("soc-cmt-text-")) return false;
    ib().texts[name.slice("soc-cmt-text-".length)] = e.target.value;
    return true;
  }

  return { view, count, connectRow, watch, finishConnect, onClick, onInput };
}
