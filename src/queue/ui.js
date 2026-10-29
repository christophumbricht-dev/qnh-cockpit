// «Warteschlange» block on the page «An Claude» (#claude): Läuft gerade · Geplant · Erledigt (24 h), across the GPU
// queue of the gaming PC, the background runs of Claude and the instructions «An Claude». Logic in ./logic.js.
import { esc } from "../format.js";
import * as data from "./data.js";
import { agendaItems, lanes, when } from "./logic.js";

export function createQueue({ S, render, errorText }) {
  S.queue = { value: undefined, loading: false, error: null };
  const st = () => S.queue;
  let unsubscribe = null, timer, tick = null;

  async function load(force = false) {
    if (st().loading || (st().value !== undefined && !force)) return;
    st().loading = true;
    try {
      st().value = await data.loadQueue();
      st().error = null;
      if (!unsubscribe) unsubscribe = data.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => load(true), 700); });
      // «seit …» and the 24 h window move on even without changes
      tick ??= setInterval(() => { if (S.tab === "claude" && !document.hidden) render(); }, 60000);
    } catch (err) { st().error = err; }
    st().loading = false;
    if (!document.activeElement?.closest?.(".ib-form")) render();
  }

  const jobs = () => st().value?.jobs ?? [];
  const agenda = () => agendaItems({ jobs: jobs() });

  function col(title, items, empty) {
    const li = (x) => `<li class="q-item q-${x.tone}">
        <span class="q-where">${esc(x.where)}</span>
        <span class="q-title">${esc(x.title)}</span>
        ${x.sub ? `<span class="q-sub">${esc(x.sub)}</span>` : ""}
      </li>`;
    return `<div class="q-col"><h3>${esc(title)}${items.length ? ` <span class="q-n">${items.length}</span>` : ""}</h3>
      ${items.length ? `<ul class="q-list">${items.map(li).join("")}</ul>` : `<p class="muted small">${esc(empty)}</p>`}</div>`;
  }

  function view(inboxRows = []) {
    const s = st();
    if (s.value === undefined) return s.error ? `<p class="error">${esc(errorText(s.error))}</p>` : "";
    const l = lanes({ jobs: s.value.jobs, runs: s.value.runs, inbox: inboxRows });
    const head = `<div class="q-head"><h2>Warteschlange</h2><span class="muted small">${l.seenAt ? `Gaming-PC zuletzt ${esc(when(l.seenAt))}` : ""}</span></div>`;
    const setup = s.value.ready ? "" : `<p class="note small">Für die Render-Aufträge des Gaming-PCs fehlt noch die Migration <code>supabase/migrations/20261029100000_render_jobs.sql</code>.</p>`;
    const stale = l.stale ? `<p class="q-stale">Der Gaming-PC meldet sich seit ${esc(l.stale)} nicht. Läuft der Render-Helfer (<code>C:\\QNH\\render\\start_helfer.cmd</code>), oder schläft der PC?</p>` : "";
    const halted = l.halted ? `<p class="q-stale">Aufträge warten, aber keiner läuft. Die Warteschlange startest du mit <code>C:\\QNH\\render\\start_render.cmd</code> (oder sie wartet, bis ein von Hand geöffnetes Blender zu ist).</p>` : "";
    return `<section class="card q-card">${head}${setup}${stale}${halted}
      <div class="q-cols">
        ${col("Läuft gerade", l.running, "Nichts läuft gerade.")}
        ${col("Geplant", l.planned, "Nichts wartet.")}
        ${col("Erledigt · 24 Std.", l.done, "In den letzten 24 Stunden nichts fertig geworden.")}
      </div></section>`;
  }

  return { load, view, agenda };
}
