// Cockpit page «Finanzen»: costs & subscriptions, bills to pay (QR-bill from a PDF or photo), overview, CSV.
// Paying happens in e-banking – here Christoph keeps track and marks «Bezahlt».
import { esc } from "../format.js";
import * as data from "./data.js";
import { INTERVALS, addDays, daysBetween, financeDue, monthly, monthlyTotals, money, moneyList, nextRenewal, parseAmount, sumBy, toCsv, upcoming, zurichToday } from "./calc.js";
import { formatIban, formatReference, ibanValid, parseSwissQr } from "./qrbill.js";

const CURRENCIES = ["CHF", "EUR", "USD"];
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
const SEEN_KEY = "qnh-fin-seen"; // renewal reminders Christoph dismissed («Behalten»), per browser
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
  S.fin = { value: undefined, loading: false, error: null, scope: "all", form: null, showPaid: false, pay: new Set(), reading: false };
  let unsubscribe = null, timer;
  const st = () => S.fin;
  const scopeName = (id) => scopes().find((s) => s.id === id)?.name ?? id;
  const costs = () => st().value?.costs ?? [];
  const bills = () => st().value?.bills ?? [];
  const inScope = (r) => st().scope === "all" || r.scope === st().scope;
  const seen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]")); } catch { return new Set(); } };

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
    const hide = seen();
    const out = [];
    for (const d of financeDue(costs(), bills(), today)) {
      if (d.kind === "bill") {
        const b = d.row;
        const lane = d.days == null ? "week" : d.days < 0 ? "now" : d.days <= 2 ? "today" : d.days <= 7 ? "week" : null;
        if (!lane) continue;
        out.push({
          key: `bill:${b.id}`, lane, date: b.due_date, tone: lane === "now" ? "alert" : "info", where: "Finanzen", scope: b.scope,
          title: `Rechnung ${b.payee}${b.amount != null ? ` · ${money(b.amount, b.currency)}` : ""}`, sub: dueText(d.days), href: "#finanzen",
          actions: [{ action: "fin-paid", id: b.id, label: "Bezahlt ✓" }],
        });
      } else {
        const c = d.row;
        if (hide.has(`${c.id}:${d.date}`)) continue;
        out.push({
          key: `renewal:${c.id}:${d.date}`, lane: d.days <= 3 ? "today" : "week", date: addDays(d.date, -c.notice_days), tone: "info", where: "Finanzen", scope: c.scope,
          title: `${c.name} verlängert sich am ${shortDate(d.date)} (${money(c.amount, c.currency)})`, sub: "behalten oder rechtzeitig kündigen", href: web(c.url) ?? "#finanzen",
          actions: [{ action: "fin-keep", value: `${c.id}:${d.date}`, label: "Behalten" }],
        });
      }
    }
    return out;
  }
  // nav badge: overdue or due within 2 days
  const badge = () => financeDue(costs(), bills(), zurichToday()).filter((d) => d.kind === "bill" && d.days != null && d.days <= 2).length;

  // ---------- page ----------
  function view() {
    if (!data.financeConfigured()) return `<p class="note">QNH Core ist noch nicht eingerichtet.</p>`;
    if (st().value === undefined) return st().error ? `<p class="error">${esc(errorText(st().error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    if (st().value === null) return `<section class="card"><h2>Finanzen einrichten</h2><p class="note">Einmal im Supabase SQL-Editor <code>supabase/migrations/20261021100000_finance.sql</code> ausführen – danach sind Kosten, Abos und Rechnungen hier.</p></section>`;
    if (st().form) return st().form.kind === "bill" ? billForm(st().form) : costForm(st().form);
    const today = zurichToday();
    const cs = costs().filter(inScope), bs = bills().filter(inScope);
    const open = bs.filter((b) => b.status === "open").sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
    const late = open.filter((b) => b.due_date && b.due_date < today);
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
      </div>
      <section class="block"><h2 class="section-title">Rechnungen${open.length ? ` <span class="count-chip${late.length ? "" : " calm"}">${open.length}</span>` : ""}</h2>
        ${open.length ? open.map((b) => billItem(b, today)).join("") : `<div class="card calm-card"><div><h3>Keine offenen Rechnungen</h3><p class="muted">PDF oder Foto einer QR-Rechnung hierher ziehen oder «Rechnung erfassen».</p></div></div>`}
        <div class="dropzone fin-drop" data-drop="fin-bill" data-action="fin-pick-bill" role="button" tabindex="0"><b>Rechnung hierher ziehen</b> oder klicken <span class="small muted">PDF oder Foto · die QR-Rechnung wird gelesen (auf deinem Gerät)</span></div>
        ${paidList(bs)}
      </section>
      <section class="block"><h2 class="section-title">Kosten &amp; Abos</h2>${costList(cs, today)}</section>
      <section class="block"><h2 class="section-title">Nächste 30 Tage</h2>${next30.length ? `<ul class="fin-timeline">${next30.map((u) => `<li><span class="fin-when">${esc(shortDate(u.date))}</span><span>${esc(u.name)} ${u.kind === "bill" ? `<span class="pill">Rechnung</span>` : `<span class="pill draft">Abo</span>`}</span><span class="fin-amount">${esc(money(u.amount, u.currency))}</span></li>`).join("")}</ul>` : `<p class="muted">Nichts in den nächsten 30 Tagen.</p>`}</section>
      ${scopeBars(cs)}
      <p class="hint">Bezahlt wird im E-Banking (QR-Rechnung dort scannen oder die Zahlungsdaten kopieren). Abo-Erinnerungen kommen so viele Tage vor der Verlängerung auf «Heute», wie beim Abo eingestellt. Export für den Treuhänder:
        <button class="link" data-action="fin-csv" data-value="bills">Rechnungen als CSV</button> · <button class="link" data-action="fin-csv" data-value="costs">Kosten als CSV</button></p>`;
  }

  function billItem(b, today) {
    const days = b.due_date ? daysBetween(today, b.due_date) : null;
    const tone = days == null ? "" : days < 0 ? " late" : days <= 2 ? " soon" : "";
    const payOpen = st().pay.has(b.id);
    // IBAN and reference are copied without the display spaces (e-banking fields take them either way)
    const copy = (label, value) => `<span class="fin-copy"><span class="muted small">${label}</span><b>${esc(value)}</b><button class="link" data-action="fin-copy" data-value="${esc(["IBAN", "Referenz"].includes(label) ? value.replace(/\s+/g, "") : value)}">kopieren</button></span>`;
    return `<article class="item fin-bill${b.status !== "open" ? " done" : ""}">
      <div class="fin-date${tone}"><b>${b.due_date ? esc(new Date(`${b.due_date}T12:00:00`).getDate()) : "–"}</b><span>${b.due_date ? esc(new Date(`${b.due_date}T12:00:00`).toLocaleDateString("de-CH", { month: "short" })) : "offen"}</span></div>
      <div class="fin-main">
        <div class="meta"><b>${esc(b.payee)}</b>${scopeBadge(b.scope)}<span>${esc(scopeName(b.scope))}</span>${b.category ? `<span>${esc(b.category)}</span>` : ""}${b.invoice_no ? `<span>Nr. ${esc(b.invoice_no)}</span>` : ""}</div>
        <p class="fin-line"><span class="fin-amount">${esc(money(b.amount, b.currency))}</span> <span class="${days != null && days < 0 ? "error" : "muted"} small">${b.status === "open" ? esc(dueText(days)) : `bezahlt ${esc(fmtDate(String(b.paid_at ?? "").slice(0, 10)))}`}</span></p>
        ${b.message ? `<p class="small muted">${esc(b.message)}</p>` : ""}
        ${payOpen ? `<div class="fin-pay">${b.iban ? copy("IBAN", formatIban(b.iban)) : ""}${b.reference ? copy("Referenz", formatReference(b.reference)) : ""}${b.amount != null ? copy("Betrag", Number(b.amount).toFixed(2)) : ""}${b.message ? copy("Mitteilung", b.message) : ""}${!b.iban ? `<span class="muted small">Keine Zahlungsdaten erfasst.</span>` : ""}</div>` : ""}
        <div class="actions">
          ${b.status === "open" ? `<button class="btn" data-action="fin-paid" data-id="${b.id}">Bezahlt ✓</button>` : `<button class="btn ghost" data-action="fin-reopen" data-id="${b.id}">Wieder offen</button>`}
          ${b.iban || b.reference ? `<button class="btn ghost" data-action="fin-pay" data-id="${b.id}">${payOpen ? "Zahlungsdaten ausblenden" : "Zahlungsdaten"}</button>` : ""}
          ${b.file_path ? `<button class="btn ghost" data-action="fin-file" data-id="${b.id}">Rechnung ansehen ↗</button>` : ""}
          <button class="btn ghost" data-action="fin-edit-bill" data-id="${b.id}">Bearbeiten</button>
        </div>
      </div>
    </article>`;
  }

  function paidList(bs) {
    const paid = bs.filter((b) => b.status === "paid").sort((a, b) => String(b.paid_at ?? "").localeCompare(String(a.paid_at ?? "")));
    if (!paid.length) return "";
    if (!st().showPaid) return `<button class="link" data-action="fin-show-paid">${paid.length} bezahlte anzeigen</button>`;
    return `<h3 class="group">Bezahlt <span class="muted">${paid.length}</span></h3>${paid.slice(0, 50).map((b) => billItem(b, zurichToday())).join("")}`;
  }

  function costList(cs, today) {
    const rows = [...cs].sort((a, b) => (b.active !== false) - (a.active !== false) || monthly(b) - monthly(a) || a.name.localeCompare(b.name));
    const tpl = TEMPLATES.filter((t) => !costs().some((c) => c.name.toLowerCase() === t.name.toLowerCase()))
      .map((t, i) => `<button class="chip" data-action="fin-template" data-value="${TEMPLATES.indexOf(t)}">+ ${esc(t.name)}</button>`).join("");
    const table = rows.length ? `<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>Abo / Kosten</th><th>App/Marke</th><th>Betrag</th><th>pro Monat</th><th>Nächste Verlängerung</th><th></th></tr></thead><tbody>
      ${rows.map((c) => {
        const next = nextRenewal(c, today);
        const soon = next && c.notice_days && daysBetween(today, next) <= c.notice_days;
        return `<tr class="${c.active === false ? "off" : ""}"><td><b>${esc(c.name)}</b>${c.provider ? `<br><span class="muted small">${esc(c.provider)}${c.payment ? ` · ${esc(c.payment)}` : ""}</span>` : ""}</td>
          <td>${scopeBadge(c.scope)} <span class="small">${esc(scopeName(c.scope))}</span></td>
          <td>${esc(money(c.amount, c.currency))}<br><span class="muted small">${esc(INTERVALS[c.interval])}</span></td>
          <td>${c.interval === "once" ? "–" : esc(money(monthly(c), c.currency))}</td>
          <td class="${soon ? "warn" : ""}">${next ? esc(fmtDate(next)) : "–"}${c.notice_days ? `<br><span class="muted small">Erinnerung ${c.notice_days} Tage vorher</span>` : ""}</td>
          <td class="fin-row-actions">${web(c.url) ? `<a class="link" href="${esc(c.url)}" target="_blank" rel="noopener">Verwalten ↗</a>` : ""}<button class="link" data-action="fin-edit-cost" data-id="${c.id}">Bearbeiten</button></td></tr>`;
      }).join("")}</tbody>
      <tfoot><tr><td colspan="3"><b>Total aktiv</b></td><td colspan="3"><b>${esc(moneyList(monthlyTotals(rows)))}</b> pro Monat</td></tr></tfoot></table></div>`
      : `<p class="muted">Noch keine Kosten erfasst. Tipp: eine Vorlage antippen und den Betrag ergänzen.</p>`;
    return `${table}${tpl ? `<div class="chips fin-templates"><span class="muted small">Vorlagen:</span>${tpl}</div>` : ""}`;
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
    return `<div class="toolbar"><button class="link" data-action="fin-close">← Zurück zu den Finanzen</button><span class="muted">${v.id ? "Rechnung bearbeiten" : "Neue Rechnung"}</span></div>
      <form class="card fin-form" data-form="fin-bill">
        <div class="dropzone" data-drop="fin-bill" data-action="fin-pick-bill" role="button" tabindex="0">
          <b>${f.file ? `📎 ${esc(f.file.name)}` : v.file_path ? "📎 Datei gespeichert" : "PDF oder Foto der Rechnung"}</b> ${st().reading ? "– lese QR-Rechnung …" : f.file || v.file_path ? "– andere Datei wählen" : "hierher ziehen oder klicken"}
          <span class="small muted">Die QR-Rechnung wird direkt auf deinem Gerät gelesen; die Datei wird privat gespeichert (nur für dich sichtbar).</span></div>
        ${f.note ? `<p class="${f.noteOk ? "ok" : "warn"} small">${esc(f.note)}</p>` : ""}
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

  // file → QR-bill → fields (only empty ones are filled when Christoph already typed something)
  async function takeFile(file) {
    const f = st().form?.kind === "bill" ? st().form : (st().form = { kind: "bill", row: { currency: "CHF", scope: st().scope === "all" ? "qnh" : st().scope } });
    if (file.size > 10 * 1024 * 1024) { f.note = "Die Datei ist grösser als 10 MB."; f.noteOk = false; return render(); }
    f.file = file;
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
        // a known subscription with the same payee → link it
        const match = costs().find((c) => c.provider && q.payee.toLowerCase().includes(c.provider.toLowerCase()));
        if (match && !v.cost_id) { v.cost_id = match.id; v.scope = match.scope; v.category = v.category || match.category; }
        f.note = `QR-Rechnung gelesen: ${q.payee}${q.amount != null ? `, ${money(q.amount, q.currency)}` : " (Betrag offen)"}. Fälligkeit ${q.invoiceDate ? "aus den Zahlungsbedingungen" : "angenommen: 30 Tage"} – bitte prüfen.`;
        f.noteOk = true;
      }
    } catch (err) {
      f.note = `QR-Rechnung nicht lesbar: ${errorText(err)}`;
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
      return {
        payee: val("fin-payee"), amount, currency: val("fin-currency"), due_date: val("fin-due") || null, scope: val("fin-scope"), iban: iban || null,
        reference: val("fin-reference").replace(/\s+/g, ""), invoice_no: val("fin-invoice"), message: val("fin-message"), category: val("fin-category"),
        cost_id: val("fin-cost") || null, note: e["fin-note"].value,
      };
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

  async function onSubmit(form) {
    const f = st().form;
    if (!f || f.busy) return;
    let row;
    try { row = { ...readForm(form), ...(f.row.id ? { id: f.row.id } : {}) }; } catch (err) { toast(err.message); return; }
    f.busy = true;
    render();
    try {
      if (f.kind === "bill") {
        if (f.file) row.file_path = await data.uploadBillFile(f.file);
        if (f.row.source && !f.row.id) row.source = f.row.source;
        await data.saveBill(row);
      } else await data.saveCost(row);
      toast("Gespeichert");
      st().form = null;
      await load(true);
    } catch (err) {
      toast(errorText(err));
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
      const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/pdf,image/*", hidden: true });
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
      case "fin-close": st().form = null; break;
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
      case "fin-keep": {
        const s = seen();
        s.add(el.dataset.value);
        try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200))); } catch { /* private mode: shows again next time */ }
        toast("Behalten – Erinnerung ausgeblendet");
        break;
      }
      case "fin-pay": if (st().pay.has(id)) st().pay.delete(id); else st().pay.add(id); break;
      case "fin-copy":
        try { await navigator.clipboard.writeText(el.dataset.value); toast("Kopiert"); } catch { prompt("Kopieren:", el.dataset.value); }
        return true;
      case "fin-file":
        try { window.open(await data.fileUrl(bill.file_path), "_blank", "noopener"); } catch (err) { toast(errorText(err)); }
        return true;
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
          download(`rechnungen-${today}.csv`, toCsv(["Empfänger", "Betrag", "Währung", "Fällig", "Status", "Bezahlt am", "App/Marke", "Kategorie", "Rechnungsnr.", "IBAN", "Referenz", "Mitteilung", "Notiz"],
            bills().map((b) => [b.payee, b.amount, b.currency, b.due_date, b.status === "paid" ? "bezahlt" : b.status === "open" ? "offen" : "storniert", String(b.paid_at ?? "").slice(0, 10), scopeName(b.scope), b.category, b.invoice_no, b.iban, b.reference, b.message, b.note])));
        } else {
          download(`kosten-${today}.csv`, toCsv(["Name", "Anbieter", "App/Marke", "Kategorie", "Betrag", "Währung", "Intervall", "pro Monat", "Nächste Verlängerung", "Zahlungsart", "aktiv"],
            costs().map((c) => [c.name, c.provider, scopeName(c.scope), c.category, c.amount, c.currency, INTERVALS[c.interval], monthly(c).toFixed(2), nextRenewal(c, today), c.payment, c.active === false ? "nein" : "ja"])));
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
    "fin-reference": "reference", "fin-invoice": "invoice_no", "fin-message": "message", "fin-category": "category", "fin-cost": "cost_id", "fin-note": "note",
    "fin-name": "name", "fin-provider": "provider", "fin-interval": "interval", "fin-next": "next_due", "fin-notice": "notice_days", "fin-payment": "payment", "fin-url": "url", "fin-active": "active",
  };
  function onInput(e) {
    const f = st().form;
    const k = FIELD_KEYS[e.target.name];
    if (!f || !k) return false;
    (f.typed ??= new Set()).add(k);
    f.row[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    return true;
  }

  return { load, view, agenda, badge, onClick, onSubmit, onDrop, onDragOver, onInput };
}
