// «Warteschlange» data: the GPU queue of the gaming PC (render_jobs, migration 20261029100000_render_jobs.sql) and
// the background runs of Claude (studio_jobs). The instructions «An Claude» come from src/inbox/data.js.
import { DEMO, client } from "../api.js";
import { QNH } from "../apps.js";

const sb = () => client(QNH);
const must = (r) => { if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.data; };
const missing = (r) => r.error && /does not exist|could not find/i.test(r.error.message);

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
function demo() {
  return {
    ready: true,
    jobs: [
      { name: "43b_hz_resume.ps1", title: "Horizont-Reel weiterrendern", status: "running", started_at: ago(52), frames: 1040, frames_10min: 18, last_frame_at: ago(1), seen_at: ago(1) },
      { name: "43v_voices_vogesen.ps1", title: "Unfall-Reel Vogesen: 4 Sätze neu vertonen", status: "queued", position: 0, seen_at: ago(1) },
      { name: "44_asi_reel_v3.ps1", title: "Fahrtmesser-Reel Fassung 3", status: "queued", position: 1, seen_at: ago(1) },
      { name: "45_pitotstatic_long.ps1", title: "Langes YouTube-Video «Two Holes, Three Instruments»", status: "queued", position: 2, seen_at: ago(1) },
      { name: "43_hz_reel.ps1", title: "Instrument-Reel künstlicher Horizont", status: "failed", started_at: ago(560), finished_at: ago(53), result: "HZ REEL FAILED (pack)", seen_at: ago(1) },
      { name: "42v_voices.ps1", title: "Stimmen mit Daniel", status: "done", started_at: ago(600), finished_at: ago(598), result: "VOICES 1028 DONE", seen_at: ago(1) },
    ],
    runs: [
      { id: "r1", trigger: "daily", status: "done", requested_at: ago(1500), started_at: ago(1490), finished_at: ago(1380), machine: "gaming", summary: "3 Ideen für Dezember im Studio, Entwurf «Nebel» hochgeladen." },
    ],
  };
}

// → { ready, jobs, runs }; ready false = migration render_jobs not there yet
export async function loadQueue() {
  if (DEMO) return demo();
  const [jobs, runs] = await Promise.all([
    sb().from("render_jobs").select("*").order("position", { ascending: true, nullsFirst: false }).limit(200),
    sb().from("studio_jobs").select("*").order("requested_at", { ascending: false }).limit(20),
  ]);
  return { ready: !missing(jobs), jobs: missing(jobs) ? [] : must(jobs), runs: missing(runs) ? [] : must(runs) };
}

export function subscribe(onChange) {
  if (DEMO) return () => {};
  const ch = sb().channel("claude-queue")
    .on("postgres_changes", { event: "*", schema: "public", table: "render_jobs" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "studio_jobs" }, onChange).subscribe();
  return () => sb().removeChannel(ch);
}
