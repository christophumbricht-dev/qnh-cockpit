// Cockpit page «Finanzen»: costs & subscriptions, bills to pay (QR-bill from a PDF or photo), overview, CSV.
// Paying happens in e-banking – here Christoph keeps track and marks «Bezahlt».
import { esc } from "../format.js";
import * as data from "./data.js";
import { BILL_FILE_ACCEPT, INTERVALS, addDays, amountText, billDue, billFileType, bookingDay, daysBetween, exportPeriod, financeDue, financeLane, monthly, monthlyTotals, money, moneyList, nextRenewal, owedPrivately, parseAmount, sumBy, toCsv, upcoming, zurichDay, zurichToday } from "./calc.js";
import { QrBillError, formatIban, formatReference, ibanValid, parseSwissQr } from "./qrbill.js";
import { MODELS, costSummary, monthName, usd } from "../social/outreach.js";
import * as M from "./machines.js";

const CURRENCIES = ["CHF", "EUR", "USD"];
const QR_ICON = `<svg class="ico fin-qr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/></svg>`;
const CATEGORIES = ["Software", "Server", "Entwicklung", "Web", "Büro", "Telefon", "Versicherung", "Treuhand", "Gründung", "Werbung", "Merchandise", "Reisen", "Diverses"];
// quick start for subscriptions Christoph uses – amounts stay empty until he fills them in
const TEMPLATES = [
  { name: "Apple Developer Program", provider: "Apple", category: "Entwicklung", interval: "yearly", notice_days: 30, url: "https://developer.apple.com/account" },
  { name: "Google Play Console", provider: "Google", category: "Entwicklung", interval: "once", url: "https://play.google.com/console" },
  { name: "Supabase", provider: "Supabase", category: "Server", interval: "monthly", url: "https://supabase.com/dashboard" },
  { name: "Infomaniak kSuite / kDrive", provider: "Infomaniak", category: "Büro", interval: "yearly", notice_days: 30, url: "https://manager.infomaniak.com" },
  { name: "Domain", provider: "Infomaniak", category: "Web", interval: "yearly", notice_days: 14 },
  { name: "GitHub", provider: "GitHub", category: "Entwicklung", interval: "monthly", url: "https://github.com/settings/billing" },
  { name: "Codemagic", provider: "Codemagic", category: "Entwicklung", interval: "monthly", url: "https://codemagic.io" },
  { name: "Claude", provider: "Anthropic", category: "Software", interval: "monthly" },
  { name: "Betriebshaftpflicht", provider: "", category: "Versicherung", interval: "yearly", notice_days: 60 },
  { name: "Treuhand / Buchhaltung", provider: "", category: "Treuhand", interval: "yearly" },
];
const fmtDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "numeric", year: "numeric" }) : "");
const shortDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("de-CH", { day: "numeric", month: "short" }) : "");
const web = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? u : null);

export function dueText(days) {
  if (days == null) return "ohne Fälligkeit";
  if (days < -1) return `seit ${-days} Tagen überfällig`;
  if (days === -1) return "seit gestern überfällig";
  if (days === 0) return "heute fällig";
  if (days === 1) return "morgen fällig";
  return `fällig in ${days} Tagen`;
}

export function createFinance({ S, render, toast, errorText, scopes, scopeBadge }) {
  S.fin = { value: undefined, loading: false, error: null, scope: "all", form: null, showPaid: false, pay: new Set(), reading: false, csvPeriod: "year", exporting: false };
  let unsubscribe = null, timer;
  const st = () => S.fin;
  const scopeName = (id) => scopes().find((s) => s.id === id)?.name ?? id;
  const costs = () => st().value?.costs ?? [];
  const bills = () => st().value?.bills ?? [];
  const inScope = (r) => st().scope === "all" || r.scope === st().scope;

  async function load(force = false) {
    if (!data.financeConfigured() || st().loading || (st().value !== undefined && !force)) return;
    st().loading = true;
    try {
      st().value = await data.loadFinance();
      st().error = null;
      if (st().value && !unsubscribe) unsubscribe = data.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => load(true), 400); });
    } catch (err) {
      st().error = err;
    }
    st().loading = false;
    if (!document.activeElement?.closest?.(".fin-form")) render();
  }

  // ---------- for «Heute» ----------
  function agenda(today = zurichToday()) {
    if (!st().value) return [];
    const out = [];
    for (const d of financeDue(costs(), bills(), today)) {
      const lane = financeLane(d, today);
      if (!lane) continue;
      if (d.kind === "bill") {
        const b = d.row;
        out.push({
          key: `bill:${b.id}`, lane, date: d.date, tone: lane === "now" ? "alert" : "info", where: "Finanzen", scope: b.scope,
          title: `Rechnung ${b.payee}${b.amount != null ? ` · ${money(b.amount, b.currency)}` : ""}`, sub: `${dueText(d.days)}${d.estimated ? " · Fälligkeit geschätzt" : ""}`, href: "#finanzen",
          actions: [{ action: "fin-paid", id: b.id, label: "Bezahlt ✓" }],
        });
      } else {
        // once its notice period has started it is for today (until «Behalten»)
        const c = d.row;
        out.push({
          key: `renewal:${c.id}:${d.date}`, lane, date: d.remindFrom, tone: "info", where: "Finanzen", scope: c.scope,
          title: `${c.name} verlängert sich am ${shortDate(d.date)} (${money(c.amount, c.currency)})`,
          sub: lane === "today" ? "behalten oder rechtzeitig kündigen" : `Erinnerung ab ${shortDate(d.remindFrom)} · behalten oder rechtzeitig kündigen`, href: web(c.url) ?? "#finanzen",
          actions: [{ action: "fin-keep", value: `${c.id}:${d.date}`, label: "Behalten" }],
        });
      }
    }
    return out;
  }
  // nav badge: what is for now or today (overdue bills, bills due within 2 days, renewal reminders that started)
  const badge = () => agenda().filter((i) => i.lane === "now" || i.lane === "today").length;

  // ---------- page ----------
  function view() {
    if (!data.financeConfigured()) return `<p class="note">QNH Core ist noch nicht eingerichtet.</p>`;
    if (st().value === undefined) return st().error ? `<p class="error">${esc(errorText(st().error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    if (st().value === null) return `<section class="card"><h2>Finanzen einrichten</h2><p class="note">Einmal im Supabase SQL-Editor <code>supabase/migrations/20261021100000_finance.sql</code> ausführen – danach sind Kosten, Abos und Rechnungen hier.</p></section>`;
    if (st().form) return st().form.kind === "bill" ? billForm(st().form) : costForm(st().form);
    const today = zurichToday();
    const cs = costs().filter(inScope), bs = bills().filter(inScope);
    const due = (b) => billDue(b, today).date;
    const open = bs.filter((b) => b.status === "open").sort((a, b) => due(a).localeCompare(due(b)));
    const late = open.filter((b) => due(b) < today);
    const owed = bs.filter(owedPrivately);
    const next30 = upcoming(cs, bs, today, 30);
    const perMonth = monthlyTotals(cs);
    const tile = (label, value, sub, alert = false) => `<div class="tile${alert ? " alert" : ""}"><span class="tile-label">${label}</span><span class="tile-num fin-num">${value}</span>${sub ? `<span class="tile-sub">${sub}</span>` : ""}</div>`;
    const chips = [["all", "Alle"], ...scopes().map((s) => [s.id, s.name])]
      .map(([v, l]) => `<button class="chip${st().scope === v ? " on" : ""}" data-action="fin-scope" data-value="${esc(v)}">${esc(l)}</button>`).join("");
    const yearly = Object.fromEntries(Object.entries(perMonth).map(([k, v]) => [k, v * 12]));
    return `<div class="toolbar"><div class="chips">${chips}</div>
        <div class="row-right">
          <button class="btn" data-action="fin-new-bill">Rechnung erfassen</button>
          <button class="btn ghost" data-action="fin-new-cost">Abo / Kosten erfassen</button>
        </div></div>
      <div class="tiles fin-tiles">
        ${tile("Fixkosten pro Monat", esc(moneyList(perMonth)), `≈ ${esc(moneyList(yearly))} pro Jahr`)}
        ${tile("Offene Rechnungen", String(open.length), esc(moneyList(sumBy(open))))}
        ${tile("Nächste 30 Tage", String(next30.length), esc(moneyList(sumBy(next30))))}
        ${late.length ? tile("Überfällig", String(late.length), esc(moneyList(sumBy(late))), true) : ""}
        ${owed.length ? tile("Offen an Christoph", esc(moneyList(sumBy(owed))), owed.length === 1 ? "1 privat bezahlter Beleg" : `${owed.length} privat bezahlte Belege`) : ""}
      </div>
      ${timeline(next30, today)}
      <div class="fin-cols">
        <div class="fin-col-main">
          <section class="block"><h2 class="section-title">Rechnungen${open.length ? ` <span class="count-chip${late.length ? "" : " calm"}">${open.length}</span>` : ""}</h2>
            <div class="dropzone fin-drop" data-drop="fin-bill" data-action="fin-pick-bill" role="button" tabindex="0">${QR_ICON}<span><b>QR-Rechnung hierher ziehen – PDF oder Foto</b><span class="small muted">oder tippen zum Auswählen · gelesen wird direkt auf deinem Gerät</span></span></div>
            ${open.length ? open.map((b) => billItem(b, today)).join("") : `<div class="card calm-card"><div><h3>Keine offenen Rechnungen</h3><p class="muted">Neue Rechnungen hier ablegen oder «Rechnung erfassen».</p></div></div>`}
            ${paidList(bs)}
          </section>
          ${owedBlock(owed)}
        </div>
        <div class="fin-col-side">
          <section class="block"><h2 class="section-title">Kosten &amp; Abos</h2>${costList(cs, today)}</section>
          ${apiBlock()}
          ${machinesBlock()}
          ${scopeBars(cs)}
          <section class="block"><h2 class="section-title">Export für den Treuhänder</h2>${exportBox(today)}</section>
        </div>
      </div>
      <p class="hint">Bezahlt wird im E-Banking (QR-Rechnung dort scannen oder die Zahlungsdaten kopieren). Abo-Erinnerungen kommen so viele Tage vor der Verlängerung auf «Heute», wie beim Abo eingestellt.</p>`;
  }

  // the next 30 days on one line: dots by day (filled = bill, ring = subscription), the payments below
  function timeline(list, today) {
    if (!list.length) return `<section class="block fin-next"><h2 class="section-title">Nächste 30 Tage</h2><p class="muted">Nichts in den nächsten 30 Tagen.</p></section>`;
    const end = addDays(today, 30);
    const dots = list.map((u) => `<span class="tl-dot${u.kind === "bill" ? " bill" : ""}" style="left:${Math.min(100, Math.max(0, (daysBetween(today, u.date) / 30) * 100)).toFixed(1)}%"></span>`).join("");
    return `<section class="block fin-next" aria-labelledby="fin-next-title"><div class="card">
      <div class="fin-next-head"><h2 id="fin-next-title">Was in den nächsten 30 Tagen kommt</h2><span class="mono-num small">${esc(shortDate(today))} – ${esc(shortDate(end))} · ${esc(moneyList(sumBy(list)))}</span></div>
      <div class="tl-track" aria-hidden="true"><span class="tl-now"></span>${dots}</div>
      <ul class="tl-chips">${list.map((u) => `<li class="${u.kind === "bill" ? "bill" : ""}"><span class="tl-when">${esc(shortDate(u.date))} · ${u.kind === "bill" ? "Rechnung" : "Abo"}</span><b>${esc(u.name)}</b><span class="mono-num">${esc(money(u.amount, u.currency))}</span></li>`).join("")}</ul>
    </div></section>`;
  }

  // CSV: every bill of the chosen period (loaded completely for the export), costs as they are now
  function exportBox(today) {
    const y = Number(today.slice(0, 4));
    const opts = [["year", `Dieses Jahr (${y})`], ["last-year", `Letztes Jahr (${y - 1})`], ["all", "Alles"]]
      .map(([v, l]) => `<option value="${v}"${st().csvPeriod === v ? " selected" : ""}>${l}</option>`).join("");
    return `<div class="card fin-export">
        <label class="field">Zeitraum<select name="fin-csv-period">${opts}</select></label>
        <button class="btn ghost" data-action="fin-csv" data-value="bills"${st().exporting ? " disabled" : ""}>${st().exporting ? "Exportiert …" : "Rechnungen als CSV"}</button>
        <button class="btn ghost" data-action="fin-csv" data-value="costs">Kosten als CSV</button>
        <p class="muted small">Alle Rechnungen des Zeitraums: bezahlte nach Zahlungstag, offene nach Fälligkeit. Excel-tauglich (Semikolon).</p>
      </div>`;
  }

  const paidText = (b) => {
    const when = esc(fmtDate(zurichDay(b.paid_at)));
    if (b.paid_by !== "privat") return `bezahlt ${when}${b.paid_with ? ` (${esc(b.paid_with)})` : ""}`;
    return `privat bezahlt ${when}${b.paid_with ? ` (${esc(b.paid_with)})` : ""} · ${b.reimbursed_at ? `zurückbezahlt ${esc(fmtDate(zurichDay(b.reimbursed_at)))}` : "Rückzahlung offen"}`;
  };

  function billItem(b, today) {
    // open bills without a due date: 30 days after they were entered («geschätzt»)
    const due = b.status === "open" ? billDue(b, today) : { date: b.due_date, estimated: false };
    const days = due.date ? daysBetween(today, due.date) : null;
    const late = b.status === "open" && days != null && days < 0;
    const tone = b.status !== "open" || days == null ? "" : late ? " late" : days <= 2 ? " soon" : "";
    const payOpen = st().pay.has(b.id);
    // IBAN and reference are copied without the display spaces (e-banking fields take them either way)
    const copy = (label, value) => `<span class="fin-copy"><span class="muted small">${label}</span><b>${esc(value)}</b><button class="link" data-action="fin-copy" data-value="${esc(["IBAN", "Referenz"].includes(label) ? value.replace(/\s+/g, "") : value)}">kopieren</button></span>`;
    return `<article class="item fin-bill${b.status !== "open" ? " done" : ""}">
      <div class="fin-date${tone}${due.estimated ? " est" : ""}"${due.estimated ? ' title="Fälligkeit geschätzt"' : ""}><b>${due.date ? esc(new Date(`${due.date}T12:00:00`).getDate()) : "–"}</b><span>${due.date ? esc(new Date(`${due.date}T12:00:00`).toLocaleDateString("de-CH", { month: "short" })) : "offen"}</span></div>
      <div class="fin-main">
        <div class="meta"><b>${esc(b.payee)}</b>${scopeBadge(b.scope)}<span>${esc(scopeName(b.scope))}</span>${b.category ? `<span>${esc(b.category)}</span>` : ""}${b.invoice_no ? `<span>Nr. ${esc(b.invoice_no)}</span>` : ""}</div>
        <p class="fin-line"><span class="fin-amount">${esc(money(b.amount, b.currency))}</span>${b.vat != null ? ` <span class="muted small">inkl. MWST ${esc(amountText(b.vat))}</span>` : ""} <span class="${late ? "error" : "muted"} small">${b.status === "open" ? `${esc(dueText(days))}${due.estimated ? " · Fälligkeit geschätzt" : ""}` : b.status === "paid" ? paidText(b) : "storniert"}</span></p>
        ${b.message ? `<p class="small muted">${esc(b.message)}</p>` : ""}
        ${payOpen ? `<div class="fin-pay">${b.iban ? copy("IBAN", formatIban(b.iban)) : ""}${b.reference ? copy("Referenz", formatReference(b.reference)) : ""}${b.amount != null ? copy("Betrag", Number(b.amount).toFixed(2)) : ""}${b.message ? copy("Mitteilung", b.message) : ""}${!b.iban ? `<span class="muted small">Keine Zahlungsdaten erfasst.</span>` : ""}</div>` : ""}
        <div class="actions">
          ${b.status === "open" ? `<button class="btn" data-action="fin-paid" data-id="${b.id}">Bezahlt ✓</button>`
            : b.paid_by === "privat" && b.status === "paid" ? (b.reimbursed_at ? `<button class="btn ghost" data-action="fin-unreimburse" data-id="${b.id}">Rückzahlung wieder offen</button>` : `<button class="btn" data-action="fin-reimbursed" data-id="${b.id}">Zurückbezahlt ✓</button>`)
            : `<button class="btn ghost" data-action="fin-reopen" data-id="${b.id}">Wieder offen</button>`}
          ${b.iban || b.reference ? `<button class="btn ghost" data-action="fin-pay" data-id="${b.id}">${payOpen ? "Zahlungsdaten ausblenden" : "Zahlungsdaten"}</button>` : ""}
          ${b.file_path ? `<button class="btn ghost" data-action="fin-file" data-id="${b.id}">Rechnung ansehen ↗</button>` : ""}
          <button class="btn ghost" data-action="fin-edit-bill" data-id="${b.id}">Bearbeiten</button>
        </div>
      </div>
    </article>`;
  }

  // receipts Christoph paid himself: the company pays them back (per currency, never converted)
  function owedBlock(list) {
    if (!list.length) return "";
    const rows = [...list].sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")) || String(a.payee).localeCompare(String(b.payee)));
    return `<section class="block"><h2 class="section-title">Privat bezahlt – offen an Christoph <span class="count-chip calm">${list.length}</span></h2>
      <div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>Datum</th><th>Beleg</th><th>App/Marke</th><th>Betrag</th><th></th></tr></thead><tbody>
      ${rows.map((b) => `<tr><td>${esc(b.due_date ? new Date(`${b.due_date}T12:00:00`).toLocaleDateString("de-CH") : "–")}</td>
        <td><b>${esc(b.payee)}</b>${b.message ? `<br><span class="muted small">${esc(b.message)}</span>` : ""}${b.invoice_no ? `<br><span class="muted small">Nr. ${esc(b.invoice_no)}${b.paid_with ? ` · ${esc(b.paid_with)}` : ""}</span>` : ""}</td>
        <td>${scopeBadge(b.scope)} <span class="small">${esc(scopeName(b.scope))}</span></td>
        <td class="fin-amount">${esc(money(b.amount, b.currency))}${b.vat != null ? `<br><span class="muted small">inkl. MWST ${esc(amountText(b.vat))}</span>` : ""}</td>
        <td class="fin-row-actions">${b.file_path ? `<button class="link" data-action="fin-file" data-id="${b.id}">Beleg ↗</button>` : ""}<button class="link" data-action="fin-reimbursed" data-id="${b.id}">Zurückbezahlt ✓</button><button class="link" data-action="fin-edit-bill" data-id="${b.id}">Bearbeiten</button></td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="3"><b>Total offen</b></td><td colspan="2"><b>${esc(moneyList(sumBy(list)))}</b></td></tr></tfoot></table></div>
      <div class="actions"><button class="btn ghost" data-action="fin-reimbursed-all">Alle ${list.length} als zurückbezahlt markieren</button></div>
      <p class="hint">Belege, die du privat bezahlt hast (auch vor der Gründung). Überweist dir die GmbH den Betrag: «Zurückbezahlt». Beträge pro Währung, ohne Umrechnung.</p></section>`;
  }

  function paidList(bs) {
    const paid = bs.filter((b) => b.status === "paid" && !owedPrivately(b)).sort((a, b) => String(b.paid_at ?? "").localeCompare(String(a.paid_at ?? "")));
    if (!paid.length) return "";
    if (!st().showPaid) return `<button class="link" data-action="fin-show-paid">${paid.length} bezahlte anzeigen</button>`;
    return `<h3 class="group">Bezahlt <span class="muted">${paid.length}</span></h3>${paid.slice(0, 50).map((b) => billItem(b, zurichToday())).join("")}`;
  }

  function costList(cs, today) {
    const rows = [...cs].sort((a, b) => (b.active !== false) - (a.active !== false) || monthly(b) - monthly(a) || a.name.localeCompare(b.name));
    const tpl = TEMPLATES.filter((t) => !costs().some((c) => c.name.toLowerCase() === t.name.toLowerCase()))
      .map((t) => `<button class="chip" data-action="fin-template" data-value="${TEMPLATES.indexOf(t)}">+ ${esc(t.name)}</button>`).join("");
    const list = rows.length ? `<div class="card fin-costs"><ul>${rows.map((c) => {
        const next = nextRenewal(c, today);
        const soon = next && c.notice_days && daysBetween(today, next) <= c.notice_days;
        const bits = [c.provider, INTERVALS[c.interval], c.payment, next ? `nächste ${shortDate(next)}` : "", c.notice_days ? `Erinnerung ${c.notice_days} Tage vorher` : ""].filter(Boolean);
        return `<li class="${c.active === false ? "off" : ""}">
          <div class="fc-main"><span class="fc-name"><b>${esc(c.name)}</b>${soon ? ` <span class="pill warn-pill">verlängert am ${esc(shortDate(next))}</span>` : ""}</span>
            <span class="muted small">${scopeBadge(c.scope)} ${esc(scopeName(c.scope))} · ${esc(bits.join(" · "))}</span>
            <span class="fc-actions">${web(c.url) ? `<a class="link" href="${esc(c.url)}" target="_blank" rel="noopener">Verwalten ↗</a>` : ""}<button class="link" data-action="fin-edit-cost" data-id="${c.id}">Bearbeiten</button></span></div>
          <div class="fc-amount"><span class="mono-num">${esc(money(c.amount, c.currency))}</span>${c.interval !== "once" && c.interval !== "monthly" ? `<span class="muted small">≈ ${esc(money(monthly(c), c.currency))} / Mt.</span>` : ""}</div></li>`;
      }).join("")}</ul>
      <p class="fc-total"><span>Total aktiv pro Monat</span><b class="mono-num">${esc(moneyList(monthlyTotals(rows)))}</b></p>
      <button class="btn ghost" data-action="fin-new-cost">+ Abo / Kosten</button></div>`
      : `<p class="muted">Noch keine Kosten erfasst. Tipp: eine Vorlage antippen und den Betrag ergänzen.</p>`;
    return `${list}${tpl ? `<div class="chips fin-templates"><span class="muted small">Vorlagen:</span>${tpl}</div>` : ""}`;
  }

  // ElevenLabs credits (voice for the reels): used / left this month, live from ElevenLabs
  function voiceCard() {
    const v = st().value?.voice;
    if (!v) return "";
    if (!v.configured) return `<div class="card fin-api"><div class="fin-api-head"><span><b>Stimme für Reels</b><span class="muted small"> · ElevenLabs</span></span></div>
      <p class="muted small">Noch nicht verbunden. Anleitung: docs/finanzen.md, Abschnitt «ElevenLabs-Guthaben».</p></div>`;
    if (v.error) return `<div class="card fin-api"><div class="fin-api-head"><span><b>Stimme für Reels</b><span class="muted small"> · ElevenLabs</span></span></div><p class="error small">${esc(v.error)}</p></div>`;
    const left = Math.max(0, v.limit - v.used), pct = v.limit ? Math.round((v.used / v.limit) * 100) : 0;
    const fmt = (n) => n.toLocaleString("de-CH");
    const reset = v.reset_at ? new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "long", timeZone: "Europe/Zurich" }).format(new Date(v.reset_at)) : null;
    return `<div class="card fin-api"><div class="fin-api-head"><span><b>Stimme für Reels</b><span class="muted small"> · ElevenLabs${v.tier ? `, ${esc(v.tier.charAt(0).toUpperCase() + v.tier.slice(1))}` : ""}</span></span></div>
      <div class="fin-api-now"><span class="muted small">noch übrig</span><b class="mono-num">${fmt(left)}</b><span class="muted small">von ${fmt(v.limit)} Credits · ${fmt(v.used)} verbraucht${reset ? ` · neu am ${esc(reset)}` : ""}</span></div>
      <div class="goal-track"><span class="out-budget-fill${pct >= 90 ? " hot" : ""}" style="width:${pct}%"></span></div>
      <p class="muted small">1 Credit ≈ 1 Zeichen Text. Eine Reel-Serie (3 Teile) braucht etwa 600.</p></div>`;
  }

  // usage-based API costs: the comment suggestions of Social → «Bei anderen» (computed from the tokens of each one)
  function apiBlock() {
    const api = st().value?.api;
    if (st().scope !== "all" && st().scope !== "leesidelab") return "";
    if (!api) { const vc = voiceCard(); return vc ? `<section class="block"><h2 class="section-title">API-Verbrauch</h2>${vc}</section>` : ""; }
    const c = costSummary(api.months, api.budget);
    const pct = Math.round(c.share * 100);
    const model = MODELS.find(([m]) => m === api.model)?.[1].replace(/ \(.*\)$/, "") ?? api.model;
    const older = c.months.filter((m) => m.month !== c.thisMonth.month).slice(0, 5);
    return `<section class="block"><h2 class="section-title">API-Verbrauch</h2><div class="card fin-api">
      <div class="fin-api-head"><span><b>Kommentar-Vorschläge</b><span class="muted small"> · Anthropic, ${esc(model)}</span></span><span class="pill${api.enabled ? " published" : " draft"}">${api.enabled ? "ein" : "aus"}</span></div>
      <div class="fin-api-now"><span class="muted small">${esc(monthName(c.thisMonth.month))}</span><b class="mono-num">${esc(usd(c.thisMonth.usd))}</b><span class="muted small">von ${esc(usd(c.budget))} Budget · ${c.thisMonth.suggestions} Vorschläge</span></div>
      <div class="goal-track"><span class="out-budget-fill${pct >= 90 ? " hot" : ""}" style="width:${pct}%"></span></div>
      ${older.length ? `<ul class="fin-api-months">${older.map((m) => `<li><span>${esc(monthName(m.month))}</span><span class="mono-num">${esc(usd(m.usd))}</span></li>`).join("")}</ul>` : ""}
      <p class="fc-total"><span>Dieses Jahr</span><b class="mono-num">${esc(usd(c.year))}</b></p>
      <p class="muted small">Verbrauch nach Token, gerechnet mit den Preisen von Anthropic. Die Aufladungen bei Anthropic (Kreditkarte) erfasst du wie gewohnt als Beleg. Ein/Aus und Budget: Social → «Bei anderen».</p>
      <a class="link" href="#social/bei-anderen">Zu den Vorschlägen</a>
    </div>${voiceCard()}</section>`;
  }

  // Rechner: how busy the gaming PC and the laptop are, electricity in kWh and CHF (estimate, see machines.js)
  function machinesBlock() {
    const mv = st().value?.machines;
    if (st().scope !== "all" && st().scope !== "qnh") return "";
    if (!mv) return "";
    const today = zurichToday();
    const from7 = new Date(Date.now() - 7 * 864e5).toISOString(), from30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const price = mv.price ?? null, shown = price ?? { ht: M.EXAMPLE_PRICE, nt: null, windows: [] };
    let sum30 = 0, chf30 = 0;
    const cards = mv.machines.map((m) => {
      const s7 = M.summarize(m, mv.hours, from7), s30 = M.summarize(m, mv.hours, from30);
      sum30 += s30.kwh;
      const cost = M.cost(m, mv.hours, from30, shown);
      chf30 += cost;
      const last = mv.last[m.id], stt = M.status(last);
      const ago = stt.since ? new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" }).format(new Date(stt.since)) : null;
      const now = stt.online && last
        ? [last.cpu != null ? `CPU ${Math.round(last.cpu)} %` : "", last.gpu != null ? `GPU ${Math.round(last.gpu)} %${last.gpu_watts != null ? ` (${Math.round(last.gpu_watts)} W)` : ""}` : "",
          last.on_battery ? "Akku" : "", last.jobs?.length ? `rechnet: ${last.jobs.join(", ")}` : "ruhig"].filter(Boolean).join(" · ")
        : ago ? `zuletzt gemeldet ${ago}` : "noch keine Messung";
      const strip = M.lastDays(s30.days, 14, today);
      const bars = strip.map((d) => `<span class="mach-day" title="${esc(shortDate(d.day))}: ${esc(M.hoursText(d.busy))} gerechnet, ${esc(M.hoursText(d.on))} an"><span style="height:${Math.min(100, (d.busy / 24) * 100).toFixed(0)}%"></span></span>`).join("");
      return `<div class="card fin-api mach">
        <div class="fin-api-head"><span><b>${esc(m.name)}</b></span><span class="pill${stt.online ? " published" : " draft"}">${stt.online ? "läuft" : "aus"}</span></div>
        <p class="muted small">${esc(now)}</p>
        <div class="fin-api-now"><span class="muted small">7 Tage ausgelastet</span><b class="mono-num">${Math.round(s7.share * 100)} %</b><span class="muted small">${esc(M.hoursText(s7.busy))} gerechnet von ${esc(M.hoursText(s7.on))} an</span></div>
        <div class="mach-strip" aria-label="Stunden gerechnet pro Tag, letzte 14 Tage">${bars}</div>
        <p class="fc-total"><span>Strom 30 Tage</span><b class="mono-num">${esc(M.kwhText(s30.kwh))} · ${esc(M.chfText(cost))}${price == null ? "*" : ""}</b></p>
      </div>`;
    }).join("");
    return `<section class="block"><h2 class="section-title">Rechner</h2><div class="mach-list">${cards}
      <div class="card fin-api">
        <p class="fc-total"><span>Beide Rechner, 30 Tage</span><b class="mono-num">${esc(M.kwhText(sum30))} · ${esc(M.chfText(chf30))}${price == null ? "*" : ""}</b></p>
        <div class="mach-price">
          <label class="small">Hochtarif <input name="fin-power-ht" inputmode="decimal" value="${price?.ht == null ? "" : esc((price?.ht * 100).toFixed(2))}" placeholder="z. B. 30.00"> Rp./kWh</label>
          <label class="small">Niedertarif <input name="fin-power-nt" inputmode="decimal" value="${price?.nt == null ? "" : esc((price?.nt * 100).toFixed(2))}" placeholder="z. B. 22.00"> Rp./kWh</label>
          <label class="small mach-windows">Niedertarif-Zeiten <input name="fin-power-win" value="${esc(price?.windowsText ?? "")}" placeholder="z. B. 22:00-06:00, 12:30-17:00 ab 1.1.2027"></label>
          <button class="btn ghost" data-action="fin-power-save" type="button">Speichern</button></div>
        <p class="muted small">${price == null ? `* Beispielpreis ${(M.EXAMPLE_PRICE * 100).toFixed(0)} Rp./kWh, bis du deinen Strompreis einträgst. ` : "Jede Stunde zählt mit dem Tarif, der gerade gilt (Preise inkl. MWST). "}Verbrauch geschätzt aus der Auslastung (alle 5 Minuten gemessen), die Grafikkarte im Gaming-PC misst ihre Watt selbst. Ausgelastet heisst: Rendern, Vertonen oder viel Rechenarbeit.</p>
      </div></div></section>`;
  }

  // monthly fixed costs per app/brand (each currency its own bar)
  function scopeBars(cs) {
    const per = new Map();
    for (const c of cs) {
      if (c.active === false || c.interval === "once") continue;
      const k = `${c.scope}|${c.currency}`;
      per.set(k, (per.get(k) ?? 0) + monthly(c));
    }
    if (per.size < 2) return "";
    const rows = [...per.entries()].map(([k, v]) => ({ scope: k.split("|")[0], currency: k.split("|")[1], v })).sort((a, b) => b.v - a.v);
    // bars compare only within one currency (no invented exchange rates)
    const max = (cur) => Math.max(...rows.filter((r) => r.currency === cur).map((r) => r.v), 1);
    const groups = [...new Set(rows.map((r) => r.currency))];
    return `<section class="block"><h2 class="section-title">Fixkosten pro App / Marke</h2><div class="card fin-bars">${groups.map((cur) => `${groups.length > 1 ? `<span class="muted small fin-cur">${esc(cur)}</span>` : ""}${rows.filter((r) => r.currency === cur).map((r) => {
      const color = scopes().find((s) => s.id === r.scope)?.color ?? "#1098AD";
      return `<div class="fin-bar"><span class="fin-bar-label">${scopeBadge(r.scope)} ${esc(scopeName(r.scope))}</span><span class="fin-bar-track"><span style="width:${Math.max(2, (r.v / max(cur)) * 100).toFixed(1)}%;--bar:${esc(color)}"></span></span><span class="fin-amount">${esc(money(r.v, r.currency))}</span></div>`;
    }).join("")}`).join("")}<p class="muted small">pro Monat, ohne einmalige Kosten</p></div></section>`;
  }

  // ---------- forms ----------
  const scopeOptions = (value) => scopes().map((s) => `<option value="${esc(s.id)}"${s.id === value ? " selected" : ""}>${esc(s.name)}</option>`).join("");
  const currencyOptions = (value) => CURRENCIES.map((c) => `<option${c === value ? " selected" : ""}>${c}</option>`).join("");
  const field = (label, html, wide = false) => `<label class="field${wide ? " wide" : ""}">${label}${html}</label>`;

  function billForm(f) {
    const v = f.row;
    const hasFile = Boolean(v.file_path) && !f.removeFile;
    return `<div class="toolbar"><button class="link" data-action="fin-close">← Zurück zu den Finanzen</button><span class="muted">${v.id ? "Rechnung bearbeiten" : "Neue Rechnung"}</span></div>
      <form class="card fin-form" data-form="fin-bill">
        <div class="dropzone" data-drop="fin-bill" data-action="fin-pick-bill" role="button" tabindex="0">
          <b>${f.file ? `📎 ${esc(f.file.name)}` : hasFile ? "📎 Datei gespeichert" : "PDF oder Foto der Rechnung"}</b> ${st().reading ? "– lese QR-Rechnung …" : f.file || hasFile ? "– andere Datei wählen" : "hierher ziehen oder klicken"}
          <span class="small muted">PDF, JPG, PNG, HEIC oder WebP. Die QR-Rechnung wird direkt auf deinem Gerät gelesen; die Datei wird privat gespeichert (nur für dich sichtbar).</span></div>
        ${f.file || hasFile ? `<p class="small"><button type="button" class="link danger" data-action="fin-remove-file">Datei entfernen</button></p>` : ""}
        ${f.removeFile && !f.file ? `<p class="warn small">Die gespeicherte Datei wird beim Speichern gelöscht.</p>` : ""}
        ${f.note ? `<p class="${f.noteOk ? "ok" : "warn"} small">${esc(f.note)}</p>` : ""}
        ${(f.warnings ?? []).map((w) => `<p class="warn small">⚠ ${esc(w)}</p>`).join("")}
        <div class="fin-grid">
          ${field("Empfänger", `<input name="fin-payee" value="${esc(v.payee ?? "")}" maxlength="120" required>`, true)}
          ${field("Betrag", `<input name="fin-amount" value="${esc(v.amount ?? "")}" inputmode="decimal" placeholder="z. B. 59.40">`)}
          ${field("Währung", `<select name="fin-currency">${currencyOptions(v.currency ?? "CHF")}</select>`)}
          ${field("Fällig am", `<input type="date" name="fin-due" value="${esc(v.due_date ?? "")}">`)}
          ${field("App / Marke", `<select name="fin-scope">${scopeOptions(v.scope ?? "qnh")}</select>`)}
          ${field("IBAN", `<input name="fin-iban" value="${esc(v.iban ? formatIban(v.iban) : "")}" maxlength="42" placeholder="CH.. .... ....">`, true)}
          ${field("Referenz", `<input name="fin-reference" value="${esc(v.reference ? formatReference(v.reference) : "")}" maxlength="48">`)}
          ${field("Rechnungsnummer", `<input name="fin-invoice" value="${esc(v.invoice_no ?? "")}" maxlength="40">`)}
          ${field("Mitteilung", `<input name="fin-message" value="${esc(v.message ?? "")}" maxlength="140">`, true)}
          ${field("Kategorie", `<input name="fin-category" value="${esc(v.category ?? "")}" maxlength="40" list="fin-categories">`)}
          ${st().value?.privateOk ? `${field("Bezahlt von", `<select name="fin-paid-by"><option value="firma"${v.paid_by !== "privat" ? " selected" : ""}>der Firma</option><option value="privat"${v.paid_by === "privat" ? " selected" : ""}>Christoph privat (Rückzahlung)</option></select>`)}
          ${field("davon MWST", `<input name="fin-vat" value="${esc(v.vat ?? "")}" inputmode="decimal" placeholder="z. B. 8.20">`)}
          ${field("Bezahlt mit", `<input name="fin-paid-with" value="${esc(v.paid_with ?? "")}" maxlength="60" placeholder="Kreditkarte, Twint …">`)}` : ""}
          ${field("Gehört zum Abo", `<select name="fin-cost"><option value="">–</option>${costs().map((c) => `<option value="${c.id}"${c.id === v.cost_id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`)}
          ${field("Notiz", `<textarea name="fin-note" rows="2" maxlength="1000">${esc(v.note ?? "")}</textarea>`, true)}
        </div>
        <datalist id="fin-categories">${CATEGORIES.map((c) => `<option value="${c}">`).join("")}</datalist>
        <div class="actions"><button class="btn"${f.busy ? " disabled" : ""}>${f.busy ? "Speichert …" : "Speichern"}</button>
          <button type="button" class="btn ghost" data-action="fin-close">Abbrechen</button>
          ${v.id ? `<button type="button" class="link danger" data-action="fin-delete-bill" data-id="${v.id}">Löschen</button>` : ""}</div>
      </form>`;
  }

  function costForm(f) {
    const v = f.row;
    return `<div class="toolbar"><button class="link" data-action="fin-close">← Zurück zu den Finanzen</button><span class="muted">${v.id ? "Abo / Kosten bearbeiten" : "Neues Abo / neue Kosten"}</span></div>
      <form class="card fin-form" data-form="fin-cost">
        <div class="fin-grid">
          ${field("Name", `<input name="fin-name" value="${esc(v.name ?? "")}" maxlength="80" required placeholder="z. B. Apple Developer Program">`, true)}
          ${field("Anbieter", `<input name="fin-provider" value="${esc(v.provider ?? "")}" maxlength="80">`)}
          ${field("App / Marke", `<select name="fin-scope">${scopeOptions(v.scope ?? "qnh")}</select>`)}
          ${field("Betrag", `<input name="fin-amount" value="${esc(v.amount ?? "")}" inputmode="decimal" required placeholder="z. B. 99.00">`)}
          ${field("Währung", `<select name="fin-currency">${currencyOptions(v.currency ?? "CHF")}</select>`)}
          ${field("Intervall", `<select name="fin-interval">${Object.entries(INTERVALS).map(([k, l]) => `<option value="${k}"${k === (v.interval ?? "monthly") ? " selected" : ""}>${l}</option>`).join("")}</select>`)}
          ${field("Nächste Verlängerung / Belastung", `<input type="date" name="fin-next" value="${esc(v.next_due ?? "")}">`)}
          ${field("Erinnerung (Tage vorher)", `<input type="number" name="fin-notice" min="0" max="365" value="${esc(v.notice_days ?? 0)}">`)}
          ${field("Kategorie", `<input name="fin-category" value="${esc(v.category ?? "Software")}" maxlength="40" list="fin-categories">`)}
          ${field("Zahlungsart", `<input name="fin-payment" value="${esc(v.payment ?? "")}" maxlength="60" placeholder="Kreditkarte, Rechnung, LSV …">`)}
          ${field("Link zum Verwalten / Kündigen", `<input type="url" name="fin-url" value="${esc(v.url ?? "")}" maxlength="500" placeholder="https://…">`, true)}
          ${field("Notiz", `<textarea name="fin-note" rows="2" maxlength="1000">${esc(v.note ?? "")}</textarea>`, true)}
          <label class="check"><input type="checkbox" name="fin-active"${v.active === false ? "" : " checked"}> aktiv (läuft noch)</label>
        </div>
        <datalist id="fin-categories">${CATEGORIES.map((c) => `<option value="${c}">`).join("")}</datalist>
        <div class="actions"><button class="btn"${f.busy ? " disabled" : ""}>${f.busy ? "Speichert …" : "Speichern"}</button>
          <button type="button" class="btn ghost" data-action="fin-close">Abbrechen</button>
          ${v.id ? `<button type="button" class="link danger" data-action="fin-delete-cost" data-id="${v.id}">Löschen</button>` : ""}</div>
      </form>`;
  }

  // pdf.js / image errors → a short German sentence (never the sign-in text of errorText)
  function readError(err) {
    if (err instanceof QrBillError) return err.message;
    if (/Failed to fetch|dynamically imported|Load failed|NetworkError/i.test(err?.message ?? "")) return "Der Leser liess sich nicht laden – Verbindung prüfen und nochmals versuchen.";
    if (/password/i.test(err?.name ?? "")) return "Das PDF ist mit einem Passwort geschützt.";
    if (/InvalidPDF|MissingPDF/i.test(err?.name ?? "")) return "Die Datei ist kein lesbares PDF.";
    if (/decode|InvalidState|EncodingError/i.test(`${err?.name} ${err?.message}`)) return "Das Bild lässt sich auf diesem Gerät nicht öffnen (HEIC? Dann als JPG senden).";
    return "Die Datei liess sich nicht lesen.";
  }

  const DUE_NOTE = { terms: "aus den Zahlungsbedingungen", "terms-today": "Zahlungsfrist ab heute gerechnet (Rechnungsdatum fehlt)", "invoice-date": "angenommen: Rechnungsdatum + 30 Tage", assumed: "angenommen: heute + 30 Tage" };
  const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

  // file → QR-bill → fields (only empty ones are filled when Christoph already typed something)
  async function takeFile(file) {
    const f = st().form?.kind === "bill" ? st().form : (st().form = { kind: "bill", row: { currency: "CHF", scope: st().scope === "all" ? "qnh" : st().scope } });
    f.warnings = [];
    if (!billFileType(file)) { f.note = `«${file.name}» geht nicht – nur PDF, JPG, PNG, HEIC oder WebP.`; f.noteOk = false; return render(); }
    if (file.size > 10 * 1024 * 1024) { f.note = "Die Datei ist grösser als 10 MB."; f.noteOk = false; return render(); }
    f.file = file;
    f.removeFile = false;
    st().reading = true;
    render();
    try {
      const { readQrBill } = await import("./reader.js");
      const text = await readQrBill(file);
      if (!text) { f.note = "Keine QR-Rechnung gefunden – bitte die Felder von Hand ausfüllen."; f.noteOk = false; }
      else {
        const q = parseSwissQr(text, { today: zurichToday() });
        const v = f.row;
        const set = (k, val) => { if (val != null && val !== "" && (v[k] == null || v[k] === "" || !f.typed?.has(k))) v[k] = val; };
        set("payee", q.payee); set("amount", q.amount); set("currency", q.currency); set("iban", q.iban); set("reference", q.reference);
        set("message", q.message); set("invoice_no", q.invoiceNo); set("due_date", q.dueDate);
        v.source = "qr";
        // a known subscription: only when the payee is exactly its provider or name (no guessing)
        const match = costs().find((c) => (c.provider && same(c.provider, q.payee)) || same(c.name, q.payee));
        if (match && !v.cost_id) {
          v.cost_id = match.id;
          if (!f.typed?.has("scope")) v.scope = match.scope; // never over a scope Christoph chose
          v.category = v.category || match.category;
        }
        f.note = `QR-Rechnung gelesen: ${q.payee}${q.amount != null ? `, ${money(q.amount, q.currency)}` : " (Betrag offen)"}. Fälligkeit ${DUE_NOTE[q.dueSource]} – bitte prüfen.`;
        f.noteOk = !q.warnings.length;
        f.warnings = q.warnings;
      }
    } catch (err) {
      f.note = `QR-Rechnung nicht lesbar: ${readError(err)}`;
      f.noteOk = false;
    }
    st().reading = false;
    render();
  }

  function readForm(form) {
    const e = form.elements;
    const val = (n) => e[n]?.value?.trim() ?? "";
    if (form.dataset.form === "fin-bill") {
      const amount = parseAmount(val("fin-amount"));
      const iban = val("fin-iban").replace(/\s+/g, "").toUpperCase();
      if (Number.isNaN(amount)) throw new Error("Der Betrag ist keine Zahl (z. B. 59.40).");
      if (iban && !ibanValid(iban)) throw new Error("Die IBAN stimmt nicht (Prüfziffer) – bitte kontrollieren.");
      if (val("fin-reference").replace(/\s+/g, "").length > 40) throw new Error("Die Referenz ist zu lang (höchstens 40 Zeichen).");
      const row = {
        payee: val("fin-payee"), amount, currency: val("fin-currency"), due_date: val("fin-due") || null, scope: val("fin-scope"), iban: iban || null,
        reference: val("fin-reference").replace(/\s+/g, ""), invoice_no: val("fin-invoice"), message: val("fin-message"), category: val("fin-category"),
        cost_id: val("fin-cost") || null, note: e["fin-note"].value,
      };
      if (e["fin-paid-by"]) {
        const vat = parseAmount(val("fin-vat"));
        if (Number.isNaN(vat)) throw new Error("Die MWST ist keine Zahl (z. B. 8.20).");
        if (vat != null && amount != null && vat > amount) throw new Error("Die MWST ist grösser als der Betrag.");
        Object.assign(row, { paid_by: e["fin-paid-by"].value, vat, net: vat != null && amount != null ? Math.round((amount - vat) * 100) / 100 : null, paid_with: val("fin-paid-with") });
        // paid by Christoph himself: the bill is paid (the company only owes it to him)
        const was = st().form?.row?.status;
        if (row.paid_by === "privat" && (!was || was === "open")) row.status = "paid";
      }
      return row;
    }
    const amount = parseAmount(val("fin-amount"));
    if (amount == null || Number.isNaN(amount)) throw new Error("Bitte einen Betrag eingeben (z. B. 99.00, gratis = 0).");
    const url = val("fin-url");
    if (url && !/^https?:\/\//i.test(url)) throw new Error("Der Link muss mit https:// beginnen.");
    return {
      name: val("fin-name"), provider: val("fin-provider"), scope: val("fin-scope"), amount, currency: val("fin-currency"), interval: val("fin-interval"),
      next_due: val("fin-next") || null, notice_days: Math.max(0, Math.min(365, Number(val("fin-notice")) || 0)), category: val("fin-category") || "Software",
      payment: val("fin-payment"), url: url || null, note: e["fin-note"].value, active: e["fin-active"].checked,
    };
  }

  // bill: save the row first, then upload the file and link it – a failed save leaves no file behind, and a
  // retry updates the same bill (and links an already uploaded file instead of uploading it again)
  async function saveBillForm(f, row) {
    if (f.row.source && !f.row.id) row.source = f.row.source;
    const dropOld = f.removeFile && !f.file && f.row.file_path;
    if (dropOld) row.file_path = null;
    const saved = await data.saveBill(row);
    f.row.id = saved.id;
    if (dropOld) { data.removeBillFile(f.row.file_path).catch(() => {}); f.row.file_path = null; f.removeFile = false; }
    if (!f.file) return;
    let path;
    try {
      path = f.uploaded ?? (f.uploaded = await data.uploadBillFile(f.file));
      await data.saveBill({ id: saved.id, file_path: path });
    } catch (err) {
      // not linked: take the upload back (if that fails too, the retry links it)
      if (f.uploaded) await data.removeBillFile(f.uploaded).then(() => { f.uploaded = null; }, () => {});
      throw Object.assign(err, { savedWithoutFile: true });
    }
    const old = f.row.file_path;
    Object.assign(f, { file: null, uploaded: null });
    f.row.file_path = path;
    if (old && old !== path) data.removeBillFile(old).catch(() => {}); // replaced: the old file goes
  }

  async function onSubmit(form) {
    const f = st().form;
    if (!f || f.busy) return;
    let row;
    try { row = { ...readForm(form), ...(f.row.id ? { id: f.row.id } : {}) }; } catch (err) { toast(err.message); return; }
    f.busy = true;
    render();
    try {
      if (f.kind === "bill") await saveBillForm(f, row);
      else {
        // a new renewal date or interval: an earlier «Behalten» no longer applies
        const was = costs().find((c) => c.id === row.id);
        if (was && (was.next_due !== row.next_due || was.interval !== row.interval)) row.ack_until = null;
        await data.saveCost(row);
      }
      toast("Gespeichert");
      st().form = null;
      await load(true);
    } catch (err) {
      toast(err.savedWithoutFile ? `Rechnung gespeichert, die Datei aber nicht (${errorText(err)}). «Speichern» versucht es nochmals.` : errorText(err));
      f.busy = false;
    }
    render();
  }

  function download(name, text) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function pickFile() {
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement("input"), { type: "file", accept: BILL_FILE_ACCEPT, hidden: true }); // = the bucket's types
      const done = (file) => { input.remove(); resolve(file); };
      input.addEventListener("change", () => done(input.files[0]), { once: true });
      input.addEventListener("cancel", () => done(null), { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function onClick(action, el) {
    const id = el.dataset.id;
    const bill = id ? bills().find((b) => b.id === id) : null;
    switch (action) {
      case "fin-scope": st().scope = el.dataset.value; break;
      case "fin-new-bill": st().form = { kind: "bill", row: { currency: "CHF", scope: st().scope === "all" ? "qnh" : st().scope } }; break;
      case "fin-new-cost": st().form = { kind: "cost", row: { currency: "CHF", interval: "monthly", scope: st().scope === "all" ? "qnh" : st().scope, notice_days: 0 } }; break;
      case "fin-template": {
        const t = TEMPLATES[Number(el.dataset.value)];
        st().form = { kind: "cost", row: { currency: t.provider === "Apple" || ["Supabase", "GitHub", "Codemagic", "Anthropic"].includes(t.provider) ? "USD" : "CHF", scope: "qnh", notice_days: 0, ...t } };
        break;
      }
      case "fin-edit-bill": st().form = { kind: "bill", row: { ...bill } }; break;
      case "fin-edit-cost": st().form = { kind: "cost", row: { ...costs().find((c) => c.id === id) } }; break;
      case "fin-close":
        if (st().form?.uploaded) data.removeBillFile(st().form.uploaded).catch(() => {}); // uploaded, never linked
        st().form = null;
        break;
      case "fin-remove-file": {
        const f = st().form;
        if (!f) return true;
        if (f.uploaded) { data.removeBillFile(f.uploaded).catch(() => {}); f.uploaded = null; }
        f.file = null;
        f.removeFile = Boolean(f.row.file_path);
        break;
      }
      case "fin-pick-bill": { const file = await pickFile(); if (file) await takeFile(file); return true; }
      case "fin-paid": case "fin-reopen":
        if (!bill) return true;
        try {
          bill.status = action === "fin-paid" ? "paid" : "open"; // at once on screen
          render();
          await data.setBillStatus(id, bill.status);
          toast(action === "fin-paid" ? `${bill.payee}: bezahlt ✓` : "Wieder offen");
          await load(true);
        } catch (err) { toast(errorText(err)); await load(true); }
        return true;
      case "fin-reimbursed": case "fin-unreimburse": {
        if (!bill) return true;
        const before = bill.reimbursed_at ?? null;
        bill.reimbursed_at = action === "fin-reimbursed" ? new Date().toISOString() : null; // at once on screen
        render();
        try {
          await data.setReimbursed([id], bill.reimbursed_at);
          toast(bill.reimbursed_at ? `${bill.payee}: zurückbezahlt ✓` : "Rückzahlung wieder offen");
          await load(true);
        } catch (err) { bill.reimbursed_at = before; toast(errorText(err)); render(); }
        return true;
      }
      case "fin-reimbursed-all": {
        const list = bills().filter(inScope).filter(owedPrivately);
        if (!list.length || !confirm(`Alle ${list.length} Belege als zurückbezahlt markieren (${moneyList(sumBy(list))})?`)) return true;
        try {
          await data.setReimbursed(list.map((b) => b.id), new Date().toISOString());
          toast(`${list.length} Belege zurückbezahlt ✓`);
          await load(true);
        } catch (err) { toast(errorText(err)); }
        return true;
      }
      case "fin-keep": {
        // stored with the cost (fin_costs.ack_until): gone on every device, back for the next renewal
        const [cid, date] = el.dataset.value.split(":");
        const c = costs().find((x) => x.id === cid);
        if (!c) return true;
        const before = c.ack_until ?? null;
        c.ack_until = date;
        render();
        try {
          await data.saveCost({ id: cid, ack_until: date });
          toast(`Behalten ✓ – ${c.name} erinnert erst vor der nächsten Verlängerung wieder`);
        } catch (err) { c.ack_until = before; toast(errorText(err)); }
        return true;
      }
      case "fin-power-save": {
        // typed in Rp./kWh, stored in CHF/kWh
        const rappen = (name) => { const v = document.querySelector(`[name="${name}"]`)?.value.trim().replace(",", ".") ?? ""; return v === "" ? null : Number(v) / 100; };
        const ht = rappen("fin-power-ht"), nt = rappen("fin-power-nt");
        const windowsText = document.querySelector('[name="fin-power-win"]')?.value.trim() ?? "";
        if ([ht, nt].some((v) => v != null && !(v >= 0 && v <= 5))) { toast("Preise in Rappen pro kWh, zum Beispiel 33.67"); return true; }
        if (ht == null && nt != null) { toast("Bitte zuerst den Hochtarif eintragen"); return true; }
        try { M.ntWindows(windowsText); } catch (err) { toast(err.message); return true; }
        const p = ht == null ? null : { ht, nt, windowsText };
        try {
          await data.savePowerPrice(p);
          if (st().value?.machines) st().value.machines.price = data.powerPrice(p && { price_chf_kwh: ht, price_nt_chf_kwh: nt, nt_windows: windowsText || null });
          toast(p == null ? "Strompreis gelöscht" : "Strompreis gespeichert ✓");
        } catch (err) { toast(errorText(err)); }
        break;
      }
      case "fin-pay": if (st().pay.has(id)) st().pay.delete(id); else st().pay.add(id); break;
      case "fin-copy":
        try { await navigator.clipboard.writeText(el.dataset.value); toast("Kopiert"); } catch { prompt("Kopieren:", el.dataset.value); }
        return true;
      case "fin-file": {
        // open the tab right in the tap (Safari/iPhone blocks window.open after an await), then point it to the file
        const win = window.open("about:blank", "_blank");
        try {
          const url = await data.fileUrl(bill.file_path);
          if (win) { win.opener = null; win.location.href = url; } else location.assign(url);
        } catch (err) { win?.close(); toast(errorText(err)); }
        return true;
      }
      case "fin-show-paid": st().showPaid = true; break;
      case "fin-delete-bill":
        if (!confirm("Diese Rechnung löschen (mit der gespeicherten Datei)?")) return true;
        try { await data.deleteBill(bill ?? st().form.row); st().form = null; toast("Gelöscht"); await load(true); } catch (err) { toast(errorText(err)); }
        break;
      case "fin-delete-cost":
        if (!confirm("Dieses Abo löschen? Tipp: «aktiv» ausschalten behält es in der Übersicht.")) return true;
        try { await data.deleteCost(id); st().form = null; toast("Gelöscht"); await load(true); } catch (err) { toast(errorText(err)); }
        break;
      case "fin-csv": {
        const today = zurichToday();
        if (el.dataset.value === "bills") {
          if (st().exporting) return true;
          const period = exportPeriod(st().csvPeriod, today);
          st().exporting = true;
          render();
          try {
            const rows = (await data.exportBills(period)).sort((a, b) => bookingDay(a).localeCompare(bookingDay(b)) || String(a.payee).localeCompare(String(b.payee)));
            download(`rechnungen-${period.label}${period.from ? "" : `-${today}`}.csv`, toCsv(["Empfänger", "Betrag", "Währung", "Netto", "MWST", "Fällig", "Status", "Bezahlt am", "Bezahlt von", "Bezahlt mit", "Zurückbezahlt am", "App/Marke", "Kategorie", "Rechnungsnr.", "IBAN", "Referenz", "Mitteilung", "Notiz"],
              rows.map((b) => [b.payee, b.amount, b.currency, b.net, b.vat, b.due_date, b.status === "paid" ? "bezahlt" : b.status === "open" ? "offen" : "storniert", zurichDay(b.paid_at),
                b.paid_by === "privat" ? "Christoph privat" : "Firma", b.paid_with, zurichDay(b.reimbursed_at), scopeName(b.scope), b.category, b.invoice_no, b.iban, b.reference, b.message, b.note])));
            toast(`${rows.length} ${rows.length === 1 ? "Rechnung" : "Rechnungen"} exportiert (${period.from ? period.label : "alle"})`);
          } catch (err) { toast(errorText(err)); }
          st().exporting = false;
          render();
        } else {
          download(`kosten-${today}.csv`, toCsv(["Name", "Anbieter", "App/Marke", "Kategorie", "Betrag", "Währung", "Intervall", "pro Monat", "Nächste Verlängerung", "Zahlungsart", "aktiv"],
            costs().map((c) => [c.name, c.provider, scopeName(c.scope), c.category, c.amount, c.currency, INTERVALS[c.interval], Number(monthly(c).toFixed(2)), nextRenewal(c, today), c.payment, c.active === false ? "nein" : "ja"])));
        }
        return true;
      }
      default: return false;
    }
    render();
    return true;
  }

  function onDragOver(e) {
    const z = e.target.closest?.('[data-drop="fin-bill"]');
    if (!z) return false;
    e.preventDefault();
    z.classList.add("over");
    return true;
  }
  function onDrop(e) {
    const z = e.target.closest?.('[data-drop="fin-bill"]');
    if (!z) return false;
    e.preventDefault();
    z.classList.remove("over");
    const file = e.dataTransfer?.files?.[0];
    if (file) takeFile(file);
    return true;
  }
  // remember which fields Christoph typed himself (a QR read later does not overwrite them)
  // every field goes into the form state (a re-render, e.g. after reading a QR-bill, keeps what was typed)
  const FIELD_KEYS = {
    "fin-payee": "payee", "fin-amount": "amount", "fin-currency": "currency", "fin-due": "due_date", "fin-scope": "scope", "fin-iban": "iban",
    "fin-reference": "reference", "fin-invoice": "invoice_no", "fin-message": "message", "fin-category": "category", "fin-cost": "cost_id", "fin-note": "note", "fin-paid-by": "paid_by", "fin-vat": "vat", "fin-paid-with": "paid_with",
    "fin-name": "name", "fin-provider": "provider", "fin-interval": "interval", "fin-next": "next_due", "fin-notice": "notice_days", "fin-payment": "payment", "fin-url": "url", "fin-active": "active",
  };
  function onInput(e) {
    if (e.target.name === "fin-csv-period") { st().csvPeriod = e.target.value; return true; }
    const f = st().form;
    const k = FIELD_KEYS[e.target.name];
    if (!f || !k) return false;
    (f.typed ??= new Set()).add(k);
    f.row[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    return true;
  }

  return { load, view, agenda, badge, onClick, onSubmit, onDrop, onDragOver, onInput };
}
