// Roadmap (board per app + QNH) and Hangar (quick links). Rendered inside main.js.
import { esc } from "../format.js";
import * as data from "./data.js";

export const COLUMNS = [["idea", "Ideen"], ["next", "Als Nächstes"], ["doing", "In Arbeit"], ["done", "Erledigt"]];
const STATUS = Object.fromEntries(COLUMNS);
const ORDER = COLUMNS.map(([k]) => k);

export function createQnh({ S, render, toast, errorText, scopes }) {
  S.qnh = { items: null, links: null, error: null, loading: false, editing: null, linkEdit: false, editLink: null, scopeFilter: "all", showDone: false };
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

  // items with a due date in the next 7 days (or overdue) – shown on "Heute"
  function dueSoon() {
    const soon = Date.now() + 7 * 864e5;
    return (S.qnh.items ?? []).filter((i) => i.status !== "done" && i.due && new Date(`${i.due}T23:59:59`).getTime() <= soon);
  }

  // ---------- roadmap ----------
  function roadmapView(scope = null) {
    const st = S.qnh;
    if (!data.qnhReady()) return `<p class="note">QNH Core ist noch nicht eingerichtet.</p>`;
    if (!st.items) return st.error ? `<p class="error">${esc(errorText(st.error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    const filter = scope ?? st.scopeFilter;
    const items = st.items.filter((i) => filter === "all" || i.scope === filter);
    const scopeSelect = (name, value) => `<select name="${name}">${scopes.map((s) => `<option value="${s.id}"${s.id === value ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>`;
    const chips = scope ? "" : `<div class="chips">${[["all", "Alle"], ...scopes.map((s) => [s.id, s.name])].map(([v, l]) =>
      `<button class="chip${filter === v ? " on" : ""}" data-action="rm-filter" data-value="${v}">${esc(l)}</button>`).join("")}</div>`;
    return `<form class="rm-add card" data-form="rm-add">
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
          <input type="date" name="rm-due" value="${esc(i.due ?? "")}" aria-label="Fällig am"></div>
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
        ${i.source === "claude" ? `<span class="rm-src">von Claude</span>` : ""}
        <span class="rm-tools">
          <button class="icon-mini" data-action="rm-move" data-id="${i.id}" data-value="${idx - 1}" aria-label="nach links"${idx === 0 ? " disabled" : ""}>‹</button>
          <button class="icon-mini" data-action="rm-edit" data-id="${i.id}" aria-label="bearbeiten">✎</button>
          <button class="icon-mini" data-action="rm-move" data-id="${i.id}" data-value="${idx + 1}" aria-label="nach rechts"${idx === ORDER.length - 1 ? " disabled" : ""}>›</button>
        </span>
      </div>
    </article>`;
  }

  async function update(id, patch) {
    const item = S.qnh.items.find((x) => x.id === id);
    const before = { ...item };
    Object.assign(item, patch);
    render();
    try {
      Object.assign(item, await data.updateItem(id, patch));
    } catch (err) {
      Object.assign(item, before);
      toast(errorText(err));
    }
    render();
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
        await update(form.dataset.id, { title: f["rm-title"].value.trim(), body: f["rm-body"].value, scope: f["rm-scope"].value, status: f["rm-status"].value, due: f["rm-due"].value || null });
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

  return { load, roadmapView, hangarView, dueSoon, onSubmit, onClick, onDragStart, onDragOver, onDrop, scopeOf, STATUS };
}
