// Social → «Bei anderen»: comment suggestions for posts of other creators.
// Claude writes them (social-publish, op outreach), Christoph posts them HIMSELF in the Instagram app:
// «Kopieren & öffnen» copies the text and opens the post – the cockpit never comments, likes or follows.
// The switch turns the whole thing off: then the job does nothing and nothing costs.
import { DEMO } from "../api.js";
import { esc, num, relTime } from "../format.js";
import * as data from "./data.js";
import { BUDGET_MAX, DAILY_MAX, FILTERS, MODELS, byFilter, costSummary, isGerman, monthName, openCount, parseWatch, settingsPatch, tokenDays, usd, watchLabel, web } from "./outreach.js";

export function createOutreach({ S, render, toast, errorText }) {
  S.social.out = { filter: "proposed", texts: {}, de: {}, copied: {}, orig: {}, busy: new Set(), running: false, saving: false, watchInput: "" };
  const st = () => S.social.out;
  const value = () => S.social.value?.outreach;   // null = not set up (migration missing)
  const items = () => value()?.items ?? [];
  const count = () => (value()?.settings?.enabled ? openCount(items()) : 0);

  let unsubscribe = null, timer;
  function watch() {
    if (unsubscribe || !value()) return;
    unsubscribe = data.subscribeOutreach(() => { clearTimeout(timer); timer = setTimeout(() => refresh(false), 400); });
  }
  // after Christoph's own action always re-render; on a live update not while he is typing in a field here
  async function refresh(force = true) {
    const fresh = await data.loadOutreach().catch(() => null);
    if (fresh && S.social.value) S.social.value.outreach = fresh;
    const el = document.activeElement;
    const typing = el?.matches?.("textarea, input, select") && el.closest?.(".out-item, .out-settings, .out-watch");
    if (force || !typing) render();
  }

  // ---------- view ----------
  function view() {
    const v = value();
    if (!v) {
      return `<section class="card"><h2>Bei anderen kommentieren</h2>
        <p class="note">Noch nicht eingerichtet: Anleitung <code>docs/social-outreach.md</code> (Migration <code>20261021140000_social_outreach.sql</code>, Facebook-Token, Anthropic-Schlüssel).</p>
        ${data.outreachError ? `<p class="note small">Antwort der Datenbank: <code>${esc(data.outreachError)}</code></p>` : ""}</section>`;
    }
    return `${headCard(v)}${watchCard(v)}${listView(v)}`;
  }

  function headCard(v) {
    const s = v.settings;
    const cost = costSummary(v.months, s.monthly_budget_usd);
    const days = tokenDays(s.token_expires_at);
    const status = s.enabled
      ? `Ein · sucht zweimal täglich${s.ig_username ? ` als @${esc(s.ig_username)}` : ""}${s.last_run_at ? ` · letzter Lauf ${esc(relTime(s.last_run_at))}` : " · noch kein Lauf"}`
      : "Aus – es wird nichts gesucht und es entstehen keine Kosten.";
    const pct = Math.round(cost.share * 100);
    return `<section class="card out-head">
      <div class="out-switch-row">
        <div><h2>Kommentar-Vorschläge</h2><p class="muted small">Claude schlägt Kommentare unter Posts anderer Accounts vor. Posten tust du selbst in der Instagram-App.</p></div>
        <button class="switch${s.enabled ? " on" : ""}" role="switch" aria-checked="${s.enabled}" aria-label="Kommentar-Vorschläge ein- oder ausschalten" data-action="soc-out-toggle"${st().saving ? " disabled" : ""}><span class="switch-track"><span class="switch-knob"></span></span><span class="switch-text">${s.enabled ? "Ein" : "Aus"}</span></button>
      </div>
      <p class="small ${s.enabled ? "" : "muted"}">${status}</p>
      <div class="out-budget" title="${esc(`${usd(cost.thisMonth.usd)} von ${usd(cost.budget)}`)}">
        <div class="out-budget-line"><span>${esc(monthName(cost.thisMonth.month))}: <b class="mono-num">${esc(usd(cost.thisMonth.usd))}</b> von ${esc(usd(cost.budget))} Budget</span><span class="muted small">${num(cost.thisMonth.suggestions)} Vorschläge</span></div>
        <div class="goal-track"><span class="out-budget-fill${pct >= 90 ? " hot" : ""}" style="width:${pct}%"></span></div>
      </div>
      ${days !== null && days < 14 ? `<p class="error small">Facebook-Token läuft ${days < 0 ? "nicht mehr" : `in ${days} ${days === 1 ? "Tag" : "Tagen"} ab`} – neuen Token eintragen (docs/social-outreach.md, Schritt 5).</p>` : ""}
      ${s.last_error ? `<p class="${/Budget/.test(s.last_error) ? "note" : "error"} small">Letzter Lauf: ${esc(s.last_error)}</p>` : ""}
      ${settingsBlock(s)}
    </section>`;
  }

  function settingsBlock(s) {
    const opts = MODELS.map(([m, l]) => `<option value="${m}"${s.model === m ? " selected" : ""}>${esc(l)}</option>`).join("");
    return `<details class="out-settings"><summary>Einstellungen</summary>
      <div class="out-grid">
        <label class="field">Vorschläge pro Tag<input type="number" name="out-limit" min="1" max="${DAILY_MAX}" step="1" value="${esc(s.daily_limit)}" inputmode="numeric"></label>
        <label class="field">Budget pro Monat (USD)<input type="text" name="out-budget" value="${esc(Number(s.monthly_budget_usd))}" inputmode="decimal" autocomplete="off"></label>
        <label class="field">Modell<select name="out-model">${opts}</select></label>
      </div>
      <label class="field">Zusatzregeln für Claude <span class="muted small">(optional, z. B. «Keine Emojis», «Nie über Segelflug-Wettbewerbe»)</span>
        <textarea name="out-rules" rows="3" maxlength="2000">${esc(s.rules ?? "")}</textarea></label>
      <div class="actions"><button class="btn" data-action="soc-out-save"${st().saving ? " disabled" : ""}>Speichern</button></div>
      <p class="muted small">Ist das Budget erreicht, gibt es bis zum Monatsende keine neuen Vorschläge. Grundregeln immer: in der Sprache des Posts (unklar → Englisch), 1–2 Sätze, im Stil deiner bisher geposteten Kommentare, erklären statt bewerten (kein Go/No-Go), keine Links, keine Eigenwerbung, nichts über dich.</p>
    </details>`;
  }

  function watchCard(v) {
    const chip = (w) => `<span class="out-chip${w.active ? "" : " off"}${w.last_error ? " bad" : ""}" title="${esc(w.last_error ?? (w.last_checked_at ? `zuletzt geprüft ${relTime(w.last_checked_at)}` : "noch nicht geprüft"))}">
        <button class="out-chip-name" data-action="soc-out-watch-active" data-id="${esc(w.id)}" aria-pressed="${w.active}">${esc(watchLabel(w))}</button>
        <button class="out-chip-x" data-action="soc-out-watch-remove" data-id="${esc(w.id)}" aria-label="${esc(watchLabel(w))} entfernen">×</button></span>`;
    const errors = v.watch.filter((w) => w.last_error);
    return `<section class="card out-watch"><h3 class="out-h">Beobachtet</h3>
      ${v.watch.length ? `<div class="out-chips">${v.watch.map(chip).join("")}</div>` : `<p class="muted small">Noch leer. Füge Accounts (@name) und Hashtags (#wort) hinzu, unter deren Posts du kommentieren möchtest.</p>`}
      ${errors.map((w) => `<p class="error small">${esc(watchLabel(w))}: ${esc(w.last_error)}</p>`).join("")}
      <div class="out-add"><input type="text" name="out-watch" placeholder="@account oder #hashtag" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(st().watchInput)}" aria-label="Account oder Hashtag hinzufügen">
        <button class="btn ghost" data-action="soc-out-watch-add">Hinzufügen</button></div>
      <p class="muted small">Antippen pausiert einen Eintrag. Accounts müssen Business- oder Creator-Konten sein. Hashtags liefern die beliebtesten Posts der letzten 24 Stunden (höchstens 30 verschiedene Hashtags pro Woche).</p>
    </section>`;
  }

  function listView(v) {
    const counts = Object.fromEntries(FILTERS.map(([f]) => [f, byFilter(items(), f).length]));
    const chips = FILTERS.map(([f, l]) => `<button class="chip${st().filter === f ? " on" : ""}" data-action="soc-out-filter" data-value="${f}">${l}${counts[f] ? ` (${counts[f]})` : ""}</button>`).join("");
    const list = byFilter(items(), st().filter);
    const empty = { proposed: v.settings.enabled ? "Keine offenen Vorschläge. Neue kommen zweimal am Tag." : "Ausgeschaltet – keine neuen Vorschläge.", done: "Noch nichts kommentiert.", dismissed: "Nichts verworfen." }[st().filter];
    return `<div class="cal-head"><div class="chips">${chips}</div>
        ${v.settings.enabled ? `<button class="btn ghost" data-action="soc-out-run"${st().running ? " disabled" : ""}>${st().running ? "Sucht …" : "Jetzt suchen"}</button>` : ""}</div>
      ${list.length ? list.map(itemCard).join("") : `<p class="muted cmt-empty">${empty}</p>`}
      <p class="hint">Variante wählen → «Kopieren &amp; öffnen» kopiert sie und öffnet den Post. In Instagram aufs Kommentarfeld tippen, einfügen, posten – zurück hier «Gepostet ✓». Was du postest (auch deine Änderungen), nimmt Claude als Vorbild für die nächsten Vorschläge. Kommentiere nicht alles: ein guter Kommentar schlägt fünf schnelle.</p>`;
  }

  // «Mo 19.10., 14:32» in Swiss time
  const postedWhen = (iso) => new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(",", "");

  function itemCard(it) {
    const busy = st().busy.has(it.id) ? " disabled" : "";
    const text = st().texts[it.id] ?? it.draft;
    const link = web(it.permalink);
    const img = web(it.image_url);
    const who = it.username ? `@${it.username}` : "via Hashtag";
    const caption = String(it.caption ?? "").split("\n").filter(Boolean).slice(0, 3).join("\n");
    const open = it.status === "proposed";
    return `<article class="card out-item${open ? "" : " closed"}">
      ${img ? `<a class="out-thumb" href="${esc(link ?? img)}" target="_blank" rel="noopener"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : ""}
      <div class="out-main">
        <div class="cmt-head"><b>${esc(who)}</b>
          ${it.posted_at ? `<span class="muted small" title="${esc(new Date(it.posted_at).toLocaleString("de-CH"))}">gepostet ${esc(postedWhen(it.posted_at))} · ${esc(relTime(it.posted_at))}</span>` : ""}
          ${it.like_count != null ? `<span class="muted small">♥ ${num(it.like_count)}</span>` : ""}
          ${it.comments_count != null ? `<span class="muted small">💬 ${num(it.comments_count)}</span>` : ""}
          ${it.status === "done" ? `<span class="pill published">kommentiert${it.done_at ? ` ${esc(relTime(it.done_at))}` : ""}</span>` : it.status === "dismissed" ? `<span class="pill draft">verworfen</span>` : ""}</div>
        ${caption ? `<p class="out-caption">${esc(caption)}</p>` : ""}
        ${it.reason ? `<p class="muted small out-reason">${esc(it.reason)}</p>` : ""}
        ${open ? `<textarea name="out-text-${esc(it.id)}" rows="3" maxlength="2200" aria-label="Kommentar für ${esc(who)}"${busy}>${esc(text)}</textarea>
          <div class="out-tools">
            ${copyBtn(it, link, "main")}
            ${isGerman(text) ? "" : `<button class="link" data-action="soc-out-de" data-id="${esc(it.id)}"${st().de[it.id]?.busy ? " disabled" : ""}>${st().de[it.id]?.busy ? "Übersetzt …" : "Auf Deutsch"}</button>`}
          </div>
          ${st().de[it.id]?.text && !isGerman(text) ? `<p class="out-de"><span class="muted small">Auf Deutsch${st().de[it.id].of !== text ? " (vom vorherigen Text)" : ""}:</span> ${esc(st().de[it.id].text)}</p>` : ""}
          ${other(it) ? `<div class="out-variant"><span class="muted small">Andere Variante</span><p>${esc(other(it))}</p>
            <div class="out-tools">${copyBtn(it, link, "alt")}<button class="link" data-action="soc-out-alt" data-id="${esc(it.id)}">Ins Textfeld (zum Ändern)</button></div></div>` : ""}
          <div class="actions">
            <button class="btn${st().copied[it.id] ? "" : " ghost"}" data-action="soc-out-done" data-id="${esc(it.id)}"${busy}>Gepostet ✓</button>
            <button class="link" data-action="soc-out-dismiss" data-id="${esc(it.id)}"${busy}>Verwerfen</button>
          </div>
          ${st().copied[it.id] ? `<p class="muted small">Kopiert – in Instagram einfügen und posten, dann hier «Gepostet ✓».</p>` : ""}`
        : `<p class="cmt-body">${esc(it.draft)}</p>
          <div class="cmt-actions"><button class="link" data-action="soc-out-reopen" data-id="${esc(it.id)}"${busy}>Wieder offen</button>${link ? `<a class="link" href="${esc(link)}" target="_blank" rel="noopener">Post öffnen ↗</a>` : ""}</div>`}
      </div>
    </article>`;
  }

  // the variant not in the text field: Claude's alternative – or, once that is in the field, the first suggestion
  function other(it) {
    const text = (st().texts[it.id] ?? it.draft).trim();
    // st().orig: the first suggestion, kept here because copying another variant saves it over «draft»
    return [st().orig[it.id], it.draft, it.alt_draft].map((x) => String(x ?? "").trim()).find((x) => x && x !== text) ?? "";
  }

  // «Kopieren & öffnen» for one variant: a link (opens the post itself, also in the Instagram app on the phone)
  function copyBtn(it, link, variant) {
    const label = variant === "alt" ? "Diese kopieren &amp; öffnen" : "Kopieren &amp; öffnen";
    const attrs = `data-action="soc-out-copy" data-id="${esc(it.id)}" data-value="${variant}"`;
    return link ? `<a class="btn${variant === "alt" ? " ghost" : ""} small" href="${esc(link)}" target="_blank" rel="noopener" ${attrs}>${label}</a>`
      : `<button class="btn${variant === "alt" ? " ghost" : ""} small" ${attrs}>${variant === "alt" ? "Diese kopieren" : "Kopieren"}</button>`;
  }

  // ---------- events ----------
  const byId = (id) => items().find((i) => i.id === id);
  async function act(id, fn, done) {
    if (st().busy.has(id)) return;
    st().busy.add(id);
    render();
    try { await fn(); if (done) toast(done); } catch (err) { toast(errorText(err)); }
    st().busy.delete(id);
    await refresh();
  }
  // the edited text (if any) is saved together with the status
  const edited = (it) => { const t = st().texts[it.id]; return t !== undefined && t.trim() !== it.draft ? t.trim() : undefined; };

  function copy(text) {
    // inside the tap, before anything is awaited – iOS only allows the clipboard (and the new tab) there
    try {
      if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).catch(() => fallbackCopy(text)); return true; }
    } catch { /* fall through */ }
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  async function onClick(action, el) {
    const id = el.dataset.id;
    const it = id ? byId(id) : null;
    const v = value();
    switch (action) {
      case "soc-out-filter": st().filter = el.dataset.value; render(); return true;
      case "soc-out-copy": {
        if (!it) return true;
        const alt = el.dataset.value === "alt";
        const text = (alt ? other(it) : st().texts[id] ?? it.draft).trim();
        if (!text) { toast("Der Kommentar ist leer."); return true; }
        copy(text);   // the link opens the post by itself (no preventDefault)
        toast("Kopiert – in Instagram einfügen und posten, dann hier «Gepostet ✓».");
        // the copied variant becomes the text: «Gepostet ✓» stores it, and Claude learns from it
        if (alt) { st().orig[id] ??= it.draft; st().texts[id] = text; }
        st().copied[id] = true;
        const t = edited(it);
        if (t !== undefined) data.saveOutreachDraft(id, t).catch(() => {});
        setTimeout(render, 400);   // after the browser has followed the link
        return true;
      }
      case "soc-out-de": {
        if (!it) return true;
        const text = (st().texts[id] ?? it.draft).trim();
        if (!text) return true;
        st().de[id] = { ...(st().de[id] ?? {}), busy: true };
        render();
        try { st().de[id] = { text: await data.translateOutreach(id, text), of: text }; }
        catch (err) { delete st().de[id]; toast(errorText(err)); }
        render();
        return true;
      }
      case "soc-out-alt":
        if (it && other(it)) { st().orig[id] ??= it.draft; st().texts[id] = other(it); render(); }
        return true;
      case "soc-out-done": case "soc-out-dismiss": case "soc-out-reopen": {
        if (!it) return true;
        const status = action === "soc-out-done" ? "done" : action === "soc-out-dismiss" ? "dismissed" : "proposed";
        const t = status === "proposed" ? undefined : edited(it);
        it.status = status;   // at once on screen, the database follows
        if (t !== undefined) it.draft = t;
        delete st().texts[id];
        delete st().copied[id];
        await act(id, () => data.setOutreachStatus(id, status, t), status === "done" ? "Gepostet – gemerkt als Vorbild für die nächsten Vorschläge." : status === "dismissed" ? "Verworfen" : "");
        return true;
      }
      case "soc-out-toggle": {
        if (!v || st().saving) return true;
        const enabled = !v.settings.enabled;
        if (enabled && !v.watch.some((w) => w.active)) toast("Eingeschaltet. Füge noch Accounts oder Hashtags hinzu, sonst findet es nichts.");
        st().saving = true;
        v.settings.enabled = enabled;
        render();
        try { await data.saveOutreachSettings({ enabled }); if (v.watch.some((w) => w.active)) toast(enabled ? "Kommentar-Vorschläge eingeschaltet – neue kommen beim nächsten Lauf." : "Ausgeschaltet – keine Suche, keine Kosten."); }
        catch (err) { v.settings.enabled = !enabled; toast(errorText(err)); }
        st().saving = false;
        await refresh();
        return true;
      }
      case "soc-out-save": {
        if (!v) return true;
        const val = (n) => document.querySelector(`[name="${n}"]`)?.value;
        let patch;
        try { patch = settingsPatch({ daily_limit: val("out-limit"), monthly_budget_usd: val("out-budget"), model: val("out-model"), rules: val("out-rules") }); }
        catch (err) { toast(err.message); return true; }
        st().saving = true;
        render();
        try { await data.saveOutreachSettings(patch); Object.assign(v.settings, patch); toast("Gespeichert"); } catch (err) { toast(errorText(err)); }
        st().saving = false;
        await refresh();
        return true;
      }
      case "soc-out-watch-add": {
        if (!v) return true;
        const input = document.querySelector('[name="out-watch"]')?.value ?? st().watchInput;
        let w;
        try { w = parseWatch(input); } catch (err) { toast(err.message); return true; }
        if (v.watch.some((x) => x.kind === w.kind && x.value === w.value)) { toast(`${watchLabel(w)} steht schon auf der Liste.`); return true; }
        try { await data.addWatch(w.kind, w.value); st().watchInput = ""; toast(`${watchLabel(w)} hinzugefügt`); }
        catch (err) { toast(/duplicate|unique/i.test(err.message) ? `${watchLabel(w)} steht schon auf der Liste.` : errorText(err)); }
        await refresh();
        return true;
      }
      case "soc-out-watch-remove": {
        const w = v?.watch.find((x) => x.id === id);
        if (w && confirm(`${watchLabel(w)} von der Liste nehmen? Bisherige Vorschläge bleiben.`)) {
          try { await data.removeWatch(id); } catch (err) { toast(errorText(err)); }
          await refresh();
        }
        return true;
      }
      case "soc-out-watch-active": {
        const w = v?.watch.find((x) => x.id === id);
        if (w) {
          try { await data.setWatchActive(id, !w.active); toast(w.active ? `${watchLabel(w)} pausiert` : `${watchLabel(w)} wieder aktiv`); } catch (err) { toast(errorText(err)); }
          await refresh();
        }
        return true;
      }
      case "soc-out-run": {
        if (st().running) return true;
        if (DEMO) toast("Demo: es wird nichts gesucht.");
        st().running = true;
        render();
        try {
          const r = await data.runOutreach();
          if (r?.status === "failed" || r?.status === "busy") toast(r.error ?? "Fehler");
          else if (r?.status === "off") toast("Ausgeschaltet.");
          else if (r?.status === "ok") toast(r.suggested ? `${r.suggested} neue${r.suggested === 1 ? "r" : ""} Vorschlag${r.suggested === 1 ? "" : "e"}` : r.errors?.length ? r.errors[0] : "Nichts Neues gefunden");
        } catch (err) { toast(errorText(err)); }
        st().running = false;
        await refresh();
        return true;
      }
    }
    return false;
  }

  function onInput(e) {
    const name = e.target.name ?? "";
    if (name.startsWith("out-text-")) { st().texts[name.slice("out-text-".length)] = e.target.value; return true; }
    if (name === "out-watch") { st().watchInput = e.target.value; return true; }
    return name.startsWith("out-");
  }
  function onKeydown(e) {
    if (e.key === "Enter" && e.target.name === "out-watch") { e.preventDefault(); onClick("soc-out-watch-add", e.target); return true; }
    return false;
  }

  return { view, count, watch, onClick, onInput, onKeydown };
}
