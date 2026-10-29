// Cockpit page «An Claude» (#claude, #claude/<project>): Christoph writes instructions to Claude, general or for one
// project; the background run on the gaming PC works through them and answers here (docs/studio-worker.md).
import { esc } from "../format.js";
import * as data from "./data.js";
import { startRun } from "../studio/data.js";
import { createQueue } from "../queue/ui.js";

const WHEN = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

export function createInbox({ S, render, toast, errorText }) {
  S.inbox = { value: undefined, loading: false, error: null, scope: "all", draftScope: "general", now: true };
  const st = () => S.inbox;
  let unsubscribe = null, timer, busy = false;
  // «Warteschlange» on top of the page: GPU queue of the gaming PC, background runs, these instructions (src/queue/)
  const queue = createQueue({ S, render, errorText });

  async function load(force = false) {
    queue.load(force);
    if (st().loading || (st().value !== undefined && !force)) return;
    st().loading = true;
    try {
      st().value = await data.loadInbox();
      st().error = null;
      if (st().value && !unsubscribe) unsubscribe = data.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => load(true), 500); });
    } catch (err) { st().error = err; }
    st().loading = false;
    if (!document.activeElement?.closest?.(".ib-form")) render();
  }
  const rows = () => st().value ?? [];
  const openCount = () => rows().filter((r) => r.status === "open" || r.status === "doing").length;

  // «Heute»: an answer of the last day, and an instruction Claude could not do
  function agenda() {
    const day = Date.now() - 864e5;
    return [...queue.agenda(), ...rows().filter((r) => (r.status === "done" || r.status === "failed") && Date.parse(r.updated_at) > day).slice(0, 3).map((r) => ({
      key: `inbox:${r.id}`, lane: r.status === "failed" ? "now" : "today", tone: r.status === "failed" ? "alert" : "info",
      title: `Claude: ${String(r.reply ?? data.STATUS[r.status]).slice(0, 110)}`, sub: `zu «${String(r.body).slice(0, 60)}»`, where: data.projectName(r.scope), href: "#claude",
    }))];
  }

  function setScopeFromRoute(scope) {
    st().scope = scope && data.PROJECTS.some(([k]) => k === scope) ? scope : "all";
    if (st().scope !== "all") st().draftScope = st().scope;
  }

  function view() {
    const s = st();
    if (s.value === null) return `<section class="card"><h2>«An Claude» einrichten</h2><p class="note">Einmal die Migration <code>supabase/migrations/20261028210000_claude_inbox.sql</code> einspielen.</p></section>`;
    if (s.value === undefined) return s.error ? `<p class="error">${esc(errorText(s.error))}</p>` : `<p class="muted loading">Lädt …</p>`;
    const counts = new Map();
    for (const r of rows()) if (r.status === "open" || r.status === "doing") counts.set(r.scope, (counts.get(r.scope) ?? 0) + 1);
    const chips = [["all", "Alle"], ...data.PROJECTS].map(([k, l]) => `<a class="chip${s.scope === k ? " on" : ""}" href="#claude${k === "all" ? "" : `/${k}`}">${esc(l)}${counts.get(k) ? ` · ${counts.get(k)}` : ""}</a>`).join("");
    const shown = rows().filter((r) => s.scope === "all" || r.scope === s.scope);
    const options = data.PROJECTS.map(([k, l]) => `<option value="${k}"${s.draftScope === k ? " selected" : ""}>${esc(l)}</option>`).join("");
    const item = (r) => `<li class="ib-item ib-${r.status}">
        <div class="ib-meta"><span class="pill">${esc(data.projectName(r.scope))}</span><span class="muted small">${esc(WHEN.format(new Date(r.created_at)))}</span><span class="small ib-state">${esc(data.STATUS[r.status])}</span>
          ${r.status === "open" ? `<button class="link small" data-action="ib-cancel" data-id="${esc(r.id)}">zurückziehen</button>` : ""}</div>
        <p class="ib-body">${esc(r.body)}</p>
        ${r.reply ? `<p class="st-note ib-reply"><b>Claude:</b> ${esc(r.reply)}</p>` : ""}
      </li>`;
    return `${queue.view(rows())}
      <form class="card ib-form" data-form="ib-new">
        <label class="small" for="ib-scope">Für</label>
        <select id="ib-scope" name="ib-scope">${options}</select>
        <textarea name="ib-body" rows="4" maxlength="4000" required placeholder="Was soll Claude machen? Zum Beispiel: «Mach im Dezember eine Serie über Nebel» oder «Prüf die Rechnungen im Cockpit»."></textarea>
        <label class="small ib-now"><input type="checkbox" name="ib-now"${s.now ? " checked" : ""}> sofort einen Lauf am Gaming-PC starten (sonst beim Tageslauf um 08:00)</label>
        <div class="row-right"><button class="btn">An Claude schicken</button></div>
      </form>
      <div class="chips">${chips}</div>
      ${shown.length ? `<ul class="ib-list">${shown.map(item).join("")}</ul>` : `<p class="muted">Noch keine Anweisungen${s.scope === "all" ? "" : ` für ${esc(data.projectName(s.scope))}`}.</p>`}
      <p class="muted small">Claude im Hintergrund erledigt offene Anweisungen zuerst, vor der Arbeit im Studio, und antwortet hier. Fragen, die du entscheiden musst, kommen ins Studio unter «Fragen von Claude».</p>`;
  }

  async function onSubmit(form) {
    if (form.dataset.form !== "ib-new") return false;
    const scope = form.elements["ib-scope"].value;
    const body = form.elements["ib-body"].value.trim();
    const now = form.elements["ib-now"].checked;
    if (!body || busy) return true;
    busy = true;
    try {
      await data.addInstruction(scope, body);
      st().draftScope = scope;
      st().now = now;
      let started = false;
      if (now) started = await startRun(`Anweisung (${data.projectName(scope)}): ${body.slice(0, 300)}`).catch(() => false);
      toast(now ? (started ? "Geschickt. Claude startet in den nächsten 5 Minuten." : "Geschickt. Ein Lauf wartet schon, Claude nimmt es dort mit.") : "Geschickt. Claude macht es beim nächsten Lauf.");
      form.reset();
      await load(true);
    } catch (err) { toast(errorText(err)); }
    busy = false;
    render();
    return true;
  }

  async function onClick(action, el) {
    if (action !== "ib-cancel") return false;
    try { await data.cancelInstruction(el.dataset.id); await load(true); } catch (err) { toast(errorText(err)); }
    return true;
  }

  return { load, view, agenda, onSubmit, onClick, openCount, setScopeFromRoute };
}
