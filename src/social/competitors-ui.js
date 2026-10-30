// Social → «Konkurrenz»: YouTube channels of other creators and what stands out in their latest videos
// (Christoph 30.10.2026 «von unseren competitors lernen»). Only public numbers from the YouTube Data API, once a day
// (social-publish op stats) or on «Jetzt holen». We learn patterns (titles, thumbnails, length), never copy pictures,
// sound or text. Claude looks at single videos in the browser when Christoph asks.
import { esc, num, relTime } from "../format.js";
import * as data from "./data.js";
import { channelSummary, channelUrl, fmtDuration, fmtViews, parseChannel, standouts, videoUrl } from "./competitors.js";

export function createCompetitors({ S, render, toast, errorText }) {
  S.social.comp = { value: undefined, loading: false, input: "", note: "", running: false, kind: "long" };
  const st = () => S.social.comp;

  async function load(force = false) {
    const s = st();
    if (s.loading || (s.value !== undefined && !force)) return;
    s.loading = true;
    try { s.value = await data.loadCompetitors(); } catch (err) { s.value = null; toast(errorText(err)); }
    s.loading = false;
    render();
  }

  function view() {
    const s = st();
    if (s.value === undefined) { load(); return `<p class="muted">Lade Konkurrenz …</p>`; }
    if (!s.value) {
      return `<section class="card"><h2>Konkurrenz</h2>
        <p class="note">Noch nicht eingerichtet: Migration <code>20261030100000_competitors.sql</code> einspielen und die Funktion <code>social-publish</code> neu veröffentlichen.</p>
        ${data.competitorsError ? `<p class="note small">Antwort der Datenbank: <code>${esc(data.competitorsError)}</code></p>` : ""}</section>`;
    }
    const { channels, videos, days } = s.value;
    const names = new Map(channels.map((c) => [c.id, c.title || c.handle]));
    const last = channels.map((c) => c.last_checked_at).filter(Boolean).sort().at(-1);
    const top = standouts(videos, days, { shorts: s.kind === "short" });
    const kinds = [["long", "Lange Videos"], ["short", "Shorts"]].map(([v, l]) =>
      `<button class="seg-btn${s.kind === v ? " on" : ""}" data-action="soc-kon-kind" data-value="${v}" aria-pressed="${s.kind === v}">${l}</button>`).join("");
    return `<section class="card kon-head">
        <div class="kon-head-row"><div><h2>Konkurrenz auf YouTube</h2>
          <p class="muted small">Öffentliche Zahlen der letzten 50 Videos pro Kanal, einmal pro Tag${last ? `, zuletzt ${esc(relTime(last))}` : ""}. Wir lernen Muster, kopieren nichts.</p></div>
          <button class="btn ghost" data-action="soc-kon-run"${s.running ? " disabled" : ""}>${s.running ? "Hole …" : "Jetzt holen"}</button></div>
      </section>
      <section class="card">
        <div class="kon-head-row"><h3>Auffällig in den letzten 60 Tagen</h3><div class="seg" role="group" aria-label="Art">${kinds}</div></div>
        <p class="muted small">Mehr Aufrufe als sonst auf diesem Kanal (gleiche Art, letzte 50 Videos). «3×» heisst: dreimal so viele wie üblich.</p>
        ${top.length ? `<ol class="kon-list">${top.map((v) => videoRow(v, names.get(v.competitor_id))).join("")}</ol>`
          : `<p class="note small">${videos.length ? "Gerade sticht nichts heraus." : "Noch keine Zahlen. Sie kommen mit dem nächsten Tageslauf oder mit «Jetzt holen»."}</p>`}
      </section>
      ${channelsCard(channels, videos, days)}`;
  }

  function videoRow(v, channel) {
    const img = v.thumbnail_url ? `<img src="${esc(v.thumbnail_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="kon-noimg"></span>`;
    return `<li class="kon-video${v.is_short ? " short" : ""}"><a href="${esc(videoUrl(v))}" target="_blank" rel="noopener noreferrer" class="kon-thumb">${img}</a>
      <div><a href="${esc(videoUrl(v))}" target="_blank" rel="noopener noreferrer"><b>${esc(v.title)}</b></a>
        <span class="muted small">${esc(channel ?? "")} · vor ${Math.round(v.age)} ${Math.round(v.age) === 1 ? "Tag" : "Tagen"} · ${esc(fmtDuration(v.duration_s))}</span>
        <span class="small"><b class="kon-factor">${v.factor.toLocaleString("de-CH", { maximumFractionDigits: v.factor >= 10 ? 0 : 1 })}×</b> üblich · ${esc(fmtViews(v.views))} Aufrufe${v.week != null ? ` · +${esc(fmtViews(v.week))} in 7 Tagen` : ""}</span></div></li>`;
  }

  function channelsCard(channels, videos, days) {
    const s = st();
    const rows = channelSummary(channels, videos, days).map((c) => `<tr class="${c.active ? "" : "muted"}">
        <td><a href="${esc(channelUrl(c))}" target="_blank" rel="noopener noreferrer"><b>${esc(c.title || c.handle)}</b></a><br><span class="muted small">${esc(c.handle)}${c.note ? ` · ${esc(c.note)}` : ""}</span>
          ${c.last_error ? `<br><span class="error small">${esc(c.last_error)}</span>` : ""}</td>
        <td class="num">${c.subscribers != null ? esc(fmtViews(c.subscribers)) : "–"}</td>
        <td class="num">${c.long30} / ${c.shorts30}</td>
        <td class="num">${c.longViews != null ? esc(fmtViews(c.longViews)) : "–"}</td>
        <td class="num">${c.longLength != null ? esc(fmtDuration(c.longLength)) : "–"}</td>
        <td class="kon-acts"><button class="link" data-action="soc-kon-active" data-id="${esc(c.id)}" data-value="${c.active ? "0" : "1"}">${c.active ? "Pause" : "Wieder an"}</button>
          <button class="link" data-action="soc-kon-remove" data-id="${esc(c.id)}">Entfernen</button></td></tr>`).join("");
    return `<section class="card"><h3>Kanäle (${num(channels.length)})</h3>
      <div class="table-wrap"><table class="kon-table"><thead><tr><th>Kanal</th><th class="num">Abos</th><th class="num" title="lange Videos / Shorts in den letzten 30 Tagen">30 Tage</th><th class="num" title="Median der Aufrufe der langen Videos">übliche Aufrufe</th><th class="num" title="Median der Länge der langen Videos">Länge</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <form class="kon-add" data-form="soc-kon-add">
        <input name="soc-kon-handle" placeholder="@Kanal oder YouTube-Link" value="${esc(s.input)}" autocomplete="off" aria-label="Kanal">
        <input name="soc-kon-note" placeholder="Warum? (optional)" value="${esc(s.note)}" autocomplete="off" aria-label="Notiz">
        <button class="btn">Hinzufügen</button></form>
      <p class="muted small">Neue Kanäle erscheinen mit dem nächsten «Jetzt holen».</p></section>`;
  }

  async function onClick(action, el) {
    const s = st();
    switch (action) {
      case "soc-kon-kind": s.kind = el.dataset.value; render(); return true;
      case "soc-kon-run": {
        s.running = true; render();
        try {
          const r = await data.runCompetitors();
          const failed = (r.results ?? []).filter((x) => x.status === "failed").length;
          toast(failed ? `Geholt, ${failed} ${failed === 1 ? "Kanal" : "Kanäle"} mit Fehler.` : "Geholt.");
        } catch (err) { toast(errorText(err)); }
        s.running = false;
        await load(true);
        return true;
      }
      case "soc-kon-active":
        try { await data.setCompetitorActive(el.dataset.id, el.dataset.value === "1"); } catch (err) { toast(errorText(err)); }
        await load(true); return true;
      case "soc-kon-remove":
        if (!confirm("Diesen Kanal entfernen? Seine Zahlen werden gelöscht.")) return true;
        try { await data.removeCompetitor(el.dataset.id); } catch (err) { toast(errorText(err)); }
        await load(true); return true;
    }
    return false;
  }

  async function onSubmit(form) {
    if (form.dataset.form !== "soc-kon-add") return false;
    const s = st();
    const handle = parseChannel(s.input);
    if (!handle) { toast("Bitte @Kanalname oder einen YouTube-Link eingeben."); return true; }
    try {
      await data.addCompetitor(handle, s.note.trim().slice(0, 300));
      s.input = ""; s.note = "";
    } catch (err) { toast(/duplicate|unique/i.test(String(err.message)) ? "Steht schon auf der Liste." : errorText(err)); }
    await load(true);
    return true;
  }

  function onInput(e) {
    if (e.target.name === "soc-kon-handle") { st().input = e.target.value; return true; }
    if (e.target.name === "soc-kon-note") { st().note = e.target.value; return true; }
    return false;
  }

  return { view, onClick, onSubmit, onInput };
}
