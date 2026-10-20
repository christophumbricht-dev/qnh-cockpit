// Roadmap (board per app + QNH) and Hangar (quick links). Rendered inside main.js.
import { esc } from "../format.js";
import * as data from "./data.js";
import { addDays, dayOfMonth, recurringDone, zurichToday } from "../finance/calc.js";
import { dueLabel, laneForDate } from "../today.js";

export const REPEAT = { weekly: "wöchentlich", monthly: "monatlich", quarterly: "vierteljährlich", yearly: "jährlich" };

export const COLUMNS = [["idea", "Ideen"], ["next", "Als Nächstes"], ["doing", "In Arbeit"], ["done", "Erledigt"]];
const STATUS = Object.fromEntries(COLUMNS);
const ORDER = COLUMNS.map(([k]) => k);

export function createQnh({ S, render, toast, errorText, scopes }) {
  S.qnh = { items: null, links: null, error: null, loading: false, editing: null, linkEdit: false, editLink: null, scopeFilter: "all", showDone: false, focus: null };
  let unsubscribe = null;
  const scopeOf = (id) => scopes.find((s) => s.id === id) ?? { id, name: id, color: "#627d98" };

  async function load(force = false) {
    const st = S.qnh;
    if (!data.qnhReady() || st.loading || (st.items && !force)) return;
    st.loading = true;
    try {
      [st.items, st.links] = await Promise.all([data.loadRoadmap(), data.loadLinks()]);
      st.error = null;
      if (!unsubscribe) unsubscribe = data.subscribeRoadmap(() => reloadSoon());
    } catch (err) {
      st.error = err;
    }
    st.loading = false;
    if (!st.editing) render();
  }
  let t;
  const reloadSoon = () => { clearTimeout(t); t = setTimeout(() => load(true), 300); };

  // recurring tasks and «Später» need the columns from migration 20261021100000_finance.sql
  const repeatSupported = () => (S.qnh.items ?? []).some((i) => "repeat" in i);
  const snoozed = (i, today) => i.snoozed_until && i.snoozed_until > today;

  // items with a due date in the next 7 days (or overdue), unless put off with «Später»
  function dueSoon() {
    const today = zurichToday();
    const soon = Date.now() + 7 * 864e5;
    return (S.qnh.items ?? []).filter((i) => i.status !== "done" && i.due && !snoozed(i, today) && new Date(`${i.due}T23:59:59`).getTime() <= soon);
  }

  // «Heute»: overdue → Jetzt, due today → Heute, within 7 days → Diese Woche; one tap «Erledigt» / «Morgen»
  function agenda(today = zurichToday()) {
    return dueSoon().map((i) => {
      const sc = scopeOf(i.scope);
      const lane = laneForDate(i.due, today);
      const actions = [{ action: "rm-done", id: i.id, label: i.repeat ? "Erledigt ↻" : "Erledigt ✓" }];
      if (repeatSupported()) actions.push({ action: "rm-snooze", id: i.id, label: "Morgen" });
      return {
        key: `rm:${i.id}`, lane, tone: lane === "now" ? "alert" : "info", date: i.due, title: i.title,
        sub: `${dueLabel(i.due, today)}${i.repeat ? ` · ↻ ${REPEAT[i.repeat]}` : ""}`,
        where: sc.name, scope: i.scope, href: i.scope === "qnh" ? "#roadmap" : `#${i.scope}/roadmap`, actions,
      };
    }).filter((x) => x.lane);
  }

  // ---------- focus: one open task at a time ----------
  // open = "In Arbeit" or "Als Nächstes"; order: due date (overdue first), in progress before next, board order
  function focusQueue(scope = null) {
    return (S.qnh.items ?? [])
      .filter((i) => (i.status === "doing" || i.status === "next") && (!scope || scope === "all" || i.scope === scope) && !(i.snoozed_until && i.snoozed_until > zurichToday()))
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.status === "doing" ? 0 : 1) - (b.status === "doing" ? 0 : 1)
        || a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at)));
  }
  const nextTask = (scope = null) => focusQueue(scope)[0] ?? null;

  // skipped = «Später»; handled = done in this round (a recurring task stays open with its next date – not again)
  function startFocus(scope) {
    S.qnh.focus = { scope, skipped: new Set(), handled: new Set(), done: 0, id: null };
    advanceFocus();
  }
  const inRound = (f) => (i) => !f.skipped.has(i.id) && !f.handled.has(i.id);
  // `said`: a toast just shown (e.g. «nächstes Mal am …») – kept in the end-of-round message instead of replaced
  function advanceFocus(said = "") {
    const f = S.qnh.focus;
    const next = focusQueue(f.scope).find(inRound(f));
    if (next) { f.id = next.id; return; }
    toast(`${said ? `${said} · ` : ""}Fokus-Runde fertig: ${f.done} erledigt${f.skipped.size ? `, ${f.skipped.size} auf später` : ""}.`);
    S.qnh.focus = null;
  }

  // body text: links clickable, lines starting with "-", "•" or "[ ]" become a checklist
  function richBody(text) {
    const link = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    const out = [];
    let list = [];
    const flush = () => { if (list.length) out.push(`<ul class="focus-list">${list.join("")}</ul>`); list = []; };
    for (const line of String(text ?? "").split("\n")) {
      const m = line.match(/^\s*(?:[-•*]|\[[ x]?\])\s+(.*)$/i);
      if (m) list.push(`<li>${link(m[1])}</li>`);
      else { flush(); if (line.trim()) out.push(`<p>${link(line)}</p>`); }
    }
    flush();
    return out.join("");
  }

  function focusView() {
    const f = S.qnh.focus;
    const i = (S.qnh.items ?? []).find((x) => x.id === f.id);
    if (!i) { advanceFocus(); return f && S.qnh.focus ? focusView() : roadmapView(f?.scope === "all" ? null : f?.scope); }
    const sc = scopeOf(i.scope);
    const left = focusQueue(f.scope).filter(inRound(f)).length;
    const overdue = i.due && new Date(`${i.due}T23:59:59`) < new Date();
    return `<div class="review-bar"><b>Fokus</b><span class="muted">${f.done} erledigt · noch ${left} offen</span>
        <span class="row-right"><button class="link" data-action="rm-focus-close">Schliessen</button></span></div>
      <article class="card focus-card" style="--app:${esc(sc.color)}">
        <div class="focus-meta"><span class="rm-scope">${esc(sc.name)}</span><span class="pill">${STATUS[i.status]}</span>
          ${i.due ? `<span class="rm-due${overdue ? " late" : ""}">${overdue ? "überfällig seit " : "fällig "}${esc(new Date(`${i.due}T12:00:00`).toLocaleDateString("de-CH"))}</span>` : ""}
          ${i.source === "claude" ? `<span class="rm-src">von Claude</span>` : ""}</div>
        <h2 class="focus-title">${esc(i.title)}</h2>
        <div class="focus-body">${i.body ? richBody(i.body) : `<p class="muted">Keine Details. Mit «Bearbeiten» Schritte oder Links ergänzen.</p>`}</div>
        <div class="actions">
          <button class="btn" data-action="rm-focus-done" data-id="${i.id}">${i.repeat ? "Erledigt ↻" : "Erledigt ✓"}</button>
          ${i.status === "next" ? `<button class="btn ghost" data-action="rm-focus-doing" data-id="${i.id}">Ich fange an</button>` : ""}
          <button class="btn ghost" data-action="rm-focus-skip" data-id="${i.id}">Später ›</button>
          <button class="btn ghost" data-action="rm-focus-edit" data-id="${i.id}">Bearbeiten</button>
        </div>
      </article>`;
  }

  // ---------- roadmap ----------
  function roadmapView(scope = null) {
    const st = S.qnh;
    if (!data.qnhReady()) return `<p class="note">QNH Core ist noch nicht eingerichtet.</p>`;
    if (!st.items) return st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    if (st.focus) return focusView();
    const filter = scope ?? st.scopeFilter;
    const open = focusQueue(filter).length;
    const focusBtn = open ? `<button class="btn focus-btn" data-action="rm-focus" data-value="${esc(filter)}">Fokus: nächster Task <span class="count-chip">${open} offen</span></button>` : "";
    const items = st.items.filter((i) => filter === "all" || i.scope === filter);
    const scopeSelect = (name, value) => `<select name="${name}">${scopes.map((s) => `<option value="${s.id}"${s.id === value ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>`;
    const chips = scope ? "" : `<div class="chips">${[["all", "Alle"], ...scopes.map((s) => [s.id, s.name])].map(([v, l]) =>
      `<button class="chip${filter === v ? " on" : ""}" data-action="rm-filter" data-value="${v}">${esc(l)}</button>`).join("")}</div>`;
    return `${focusBtn}<form class="rm-add card" data-form="rm-add">
        <input name="rm-title" placeholder="Neue Idee oder Aufgabe …" maxlength="200" required autocomplete="off">
        ${scope ? `<input type="hidden" name="rm-scope" value="${esc(scope)}">` : scopeSelect("rm-scope", filter === "all" ? "qnh" : filter)}
        <select name="rm-status">${COLUMNS.slice(0, 3).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <button class="btn">Hinzufügen</button>
      </form>
      ${chips}
      <div class="board">${COLUMNS.map(([k, label]) => {
        let col = items.filter((i) => i.status === k).sort((a, b) => k === "done"
          ? String(b.done_at ?? "").localeCompare(String(a.done_at ?? ""))
          : (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at)));
        const hidden = k === "done" && !st.showDone ? Math.max(0, col.length - 5) : 0;
        if (hidden) col = col.slice(0, 5);
        return `<section class="rm-col" data-rm-col="${k}">
          <h3>${label} <span class="muted">${items.filter((i) => i.status === k).length}</span></h3>
          ${col.map((i) => card(i, !scope, scopeSelect)).join("") || `<p class="rm-empty">${k === "doing" ? "Nichts in Arbeit." : "–"}</p>`}
          ${hidden ? `<button class="link" data-action="rm-show-done">${hidden} ältere anzeigen</button>` : ""}
        </section>`;
      }).join("")}</div>
      <p class="hint">Karten ziehen oder mit ‹ › verschieben. Was wir im Chat besprechen, trägt Claude hier ein («von Claude»); deine Einträge holt Claude bei jeder Sitzung ab.</p>`;
  }

  function card(i, showScope, scopeSelect) {
    const sc = scopeOf(i.scope);
    if (S.qnh.editing === i.id) {
      return `<form class="rm-card editing" data-form="rm-edit" data-id="${i.id}">
        <input name="rm-title" value="${esc(i.title)}" maxlength="200" required>
        <textarea name="rm-body" rows="4" maxlength="4000" placeholder="Details, Links, nächste Schritte …">${esc(i.body)}</textarea>
        <div class="row">${scopeSelect("rm-scope", i.scope)}
          <select name="rm-status">${COLUMNS.map(([k, l]) => `<option value="${k}"${k === i.status ? " selected" : ""}>${l}</option>`).join("")}</select>
          <input type="date" name="rm-due" value="${esc(i.due ?? "")}" aria-label="Fällig am">
          ${repeatSupported() ? `<select name="rm-repeat" aria-label="Wiederholen"><option value="">einmalig</option>${Object.entries(REPEAT).map(([k, l]) => `<option value="${k}"${k === i.repeat ? " selected" : ""}>↻ ${l}</option>`).join("")}</select>` : ""}</div>
        <div class="actions"><button class="btn">Speichern</button><button type="button" class="btn ghost" data-action="rm-cancel">Abbrechen</button>
          <button type="button" class="link danger" data-action="rm-delete" data-id="${i.id}">Löschen</button></div>
      </form>`;
    }
    const idx = ORDER.indexOf(i.status);
    const overdue = i.due && i.status !== "done" && new Date(`${i.due}T23:59:59`) < new Date();
    return `<article class="rm-card${i.status === "done" ? " done" : ""}" draggable="true" data-rm-id="${i.id}" style="--app:${esc(sc.color)}">
      ${showScope ? `<span class="rm-scope">${esc(sc.name)}</span>` : ""}
      <b class="rm-title">${esc(i.title)}</b>
      ${i.body ? `<p class="rm-body">${esc(i.body.length > 160 ? `${i.body.slice(0, 160)}…` : i.body)}</p>` : ""}
      <div class="rm-meta">
        ${i.due ? `<span class="rm-due${overdue ? " late" : ""}">${overdue ? "überfällig · " : "bis "}${esc(new Date(`${i.due}T12:00:00`).toLocaleDateString("de-CH"))}</span>` : ""}
        ${i.repeat ? `<span class="rm-src" title="wiederkehrend">↻ ${esc(REPEAT[i.repeat] ?? i.repeat)}${i.repeat !== "weekly" && i.repeat_day === 31 ? ", Monatsende" : ""}</span>` : ""}
        ${i.source === "claude" ? `<span class="rm-src">von Claude</span>` : ""}
        <span class="rm-tools">
          <button class="icon-mini" data-action="rm-move" data-id="${i.id}" data-value="${idx - 1}" aria-label="nach links"${idx === 0 ? " disabled" : ""}>‹</button>
          <button class="icon-mini" data-action="rm-edit" data-id="${i.id}" aria-label="bearbeiten">✎</button>
          <button class="icon-mini" data-action="rm-move" data-id="${i.id}" data-value="${idx + 1}" aria-label="nach rechts"${idx === ORDER.length - 1 ? " disabled" : ""}>›</button>
        </span>
      </div>
    </article>`;
  }

  // → { ok, said } – said = the toast shown when a recurring task rolled forward
  async function update(id, patch) {
    const item = S.qnh.items.find((x) => x.id === id);
    // a recurring task is never «done»: it moves on to its next date (unless this edit makes it «einmalig»)
    const rolled = recurringDone(item, patch, zurichToday());
    let said = "";
    if (rolled) {
      patch = rolled;
      said = `Erledigt ✓ – nächstes Mal am ${new Date(`${rolled.due}T12:00:00`).toLocaleDateString("de-CH")}`;
      toast(said);
    }
    const before = { ...item };
    Object.assign(item, patch);
    render();
    try {
      Object.assign(item, await data.updateItem(id, patch));
    } catch (err) {
      Object.assign(item, before);
      toast(errorText(err));
      render();
      return { ok: false };
    }
    render();
    return { ok: true, said };
  }

  // the editor's due date sets the day a monthly/quarterly/yearly task stays on (31 = Monatsende); unchanged
  // date and rhythm keep the stored day (e.g. 30.6. of a task that is due at every month end)
  function repeatDay(item, due, repeat) {
    if (!repeat || repeat === "weekly" || !due) return null;
    return due === item.due && repeat === item.repeat && item.repeat_day ? item.repeat_day : dayOfMonth(due);
  }

  // ---------- hangar ----------
  function hangarView() {
    const st = S.qnh;
    if (!data.qnhReady()) return `<p class="note">QNH Core ist noch nicht eingerichtet.</p>`;
    if (!st.links) return st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    const groups = [...new Set(st.links.map((l) => l.grp))];
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
    const linkForm = (l = {}) => `<form class="hg-form card" data-form="hg-save" data-id="${esc(l.id ?? "")}">
      <input name="hg-title" placeholder="Name" value="${esc(l.title ?? "")}" maxlength="80" required>
      <input name="hg-url" type="url" placeholder="https://…" value="${esc(l.url ?? "")}" maxlength="500" required>
      <input name="hg-grp" placeholder="Gruppe (z. B. Ablage)" value="${esc(l.grp ?? "")}" maxlength="40" list="hg-groups" required>
      <input name="hg-note" placeholder="Notiz (optional)" value="${esc(l.note ?? "")}" maxlength="200">
      <datalist id="hg-groups">${groups.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
      <div class="actions"><button class="btn">${l.id ? "Speichern" : "Link hinzufügen"}</button>
        ${l.id ? `<button type="button" class="btn ghost" data-action="hg-cancel">Abbrechen</button><button type="button" class="link danger" data-action="hg-delete" data-id="${l.id}">Löschen</button>` : ""}</div>
    </form>`;
    return `<div class="toolbar"><p class="muted small">Alle Werkzeuge an einem Ort – öffnen sich in einem neuen Tab.</p>
        <button class="btn ghost" data-action="hg-toggle">${st.linkEdit ? "Fertig" : "Bearbeiten"}</button></div>
      ${st.linkEdit && !st.editLink ? linkForm() : ""}
      ${groups.map((g) => `<section class="block"><h2 class="section-title">${esc(g)}</h2><div class="hangar">${st.links.filter((l) => l.grp === g).map((l) =>
        st.editLink === l.id ? linkForm(l) : `<div class="hg-wrap"><a class="hg-link" href="${esc(l.url)}" target="_blank" rel="noopener">
          <span class="hg-badge">${esc(l.title[0] ?? "?")}</span><span class="hg-text"><b>${esc(l.title)}</b><span class="muted small">${esc(l.note || host(l.url))}</span></span>
        </a>${st.linkEdit ? `<button class="icon-mini hg-edit" data-action="hg-edit" data-id="${l.id}" aria-label="bearbeiten">✎</button>` : ""}</div>`).join("")}</div></section>`).join("")}`;
  }

  // ---------- events ----------
  async function onSubmit(form) {
    const f = form.elements;
    const kind = form.dataset.form;
    try {
      if (kind === "rm-add") {
        const item = await data.addItem({ scope: f["rm-scope"].value, title: f["rm-title"].value.trim(), status: f["rm-status"].value });
        S.qnh.items.push(item);
        toast("Hinzugefügt");
      } else if (kind === "rm-edit") {
        S.qnh.editing = null;
        const item = S.qnh.items.find((x) => x.id === form.dataset.id);
        const due = f["rm-due"].value || null;
        const repeat = f["rm-repeat"] ? f["rm-repeat"].value || null : undefined;
        await update(form.dataset.id, { title: f["rm-title"].value.trim(), body: f["rm-body"].value, scope: f["rm-scope"].value, status: f["rm-status"].value, due,
          ...(repeat !== undefined ? { repeat, repeat_day: repeatDay(item, due, repeat) } : {}) });
      } else if (kind === "hg-save") {
        const saved = await data.saveLink({ id: form.dataset.id || undefined, title: f["hg-title"].value.trim(), url: f["hg-url"].value.trim(), grp: f["hg-grp"].value.trim(), note: f["hg-note"].value.trim() });
        const list = S.qnh.links;
        const i = list.findIndex((x) => x.id === saved.id);
        if (i >= 0) list[i] = saved; else list.push(saved);
        S.qnh.editLink = null;
        toast("Gespeichert");
      }
    } catch (err) {
      toast(errorText(err));
    }
    render();
  }

  async function onClick(action, el) {
    const st = S.qnh;
    const id = el.dataset.id;
    switch (action) {
      case "rm-filter": st.scopeFilter = el.dataset.value; break;
      case "rm-focus": startFocus(el.dataset.value || "all"); break;
      case "rm-focus-close": st.focus = null; break;
      case "rm-focus-skip": st.focus.skipped.add(id); advanceFocus(); break;
      case "rm-focus-doing": await update(id, { status: "doing" }); return true;
      // from «Heute»
      case "rm-done": {
        const r = await update(id, { status: "done" });
        if (r.ok && !r.said) toast("Erledigt ✓");
        return true;
      }
      case "rm-snooze": await update(id, { snoozed_until: addDays(zurichToday(), 1) }); toast("Auf morgen verschoben"); return true;
      case "rm-focus-done": {
        const r = await update(id, { status: "done" }); // a recurring task shows «nächstes Mal am …» itself
        if (r.ok && st.focus) {
          st.focus.done++;
          st.focus.handled.add(id); // still open when recurring: the round moves on anyway
          if (!r.said) toast("Erledigt ✓");
          advanceFocus(r.said);
        }
        break;
      }
      case "rm-focus-edit": st.focus = null; st.editing = id; break;
      case "rm-show-done": st.showDone = true; break;
      case "rm-edit": st.editing = id; break;
      case "rm-cancel": st.editing = null; break;
      case "rm-move": {
        const to = ORDER[Number(el.dataset.value)];
        if (to) return update(id, { status: to });
        break;
      }
      case "rm-delete":
        if (!confirm("Diesen Eintrag löschen?")) return;
        try { await data.deleteItem(id); st.items = st.items.filter((x) => x.id !== id); st.editing = null; toast("Gelöscht"); } catch (err) { toast(errorText(err)); }
        break;
      case "hg-toggle": st.linkEdit = !st.linkEdit; st.editLink = null; break;
      case "hg-edit": st.editLink = id; break;
      case "hg-cancel": st.editLink = null; break;
      case "hg-delete":
        if (!confirm("Diesen Link löschen?")) return;
        try { await data.deleteLink(id); st.links = st.links.filter((x) => x.id !== id); st.editLink = null; } catch (err) { toast(errorText(err)); }
        break;
      default: return false;
    }
    render();
    return true;
  }

  // drag & drop between columns (desktop)
  function onDragStart(e) {
    const c = e.target.closest?.("[data-rm-id]");
    if (!c) return false;
    e.dataTransfer.setData("text/x-roadmap", c.dataset.rmId);
    e.dataTransfer.effectAllowed = "move";
    return true;
  }
  function onDragOver(e) {
    const col = e.target.closest?.("[data-rm-col]");
    if (!col || ![...e.dataTransfer.types].includes("text/x-roadmap")) return false;
    e.preventDefault();
    col.classList.add("over");
    return true;
  }
  function onDrop(e) {
    const col = e.target.closest?.("[data-rm-col]");
    const id = e.dataTransfer.getData("text/x-roadmap");
    if (!col || !id) return false;
    e.preventDefault();
    col.classList.remove("over");
    const item = S.qnh.items.find((x) => x.id === id);
    if (item && item.status !== col.dataset.rmCol) update(id, { status: col.dataset.rmCol });
    return true;
  }

  return { nextTask, repeatSupported, startFocus, load, roadmapView, hangarView, dueSoon, agenda, onSubmit, onClick, onDragStart, onDragOver, onDrop, scopeOf, STATUS };
}
