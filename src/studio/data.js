// Digital Studio data in QNH Core (migration 20261028100000_studio.sql). Admins only – the database decides.
// Media: Social bucket (reels, carousels), Cloudflare R2 through the function studio-media (long videos), or a
// file Christoph opens from the PC (fallback, nothing stored).
import { DEMO, client } from "../api.js";
import { QNH } from "../apps.js";
import { mediaUrl as socialUrl } from "../social/data.js";
import * as demo from "./demo.js";
import { afterReview } from "./pipeline.js";

const sb = () => client(QNH);
const must = (r) => { if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.data; };
// how far back the studio loads: the 4-week block may start a week back, the overview a month back
export const LOAD_DAYS_BACK = 45;
const swissToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());

// null = not set up yet (migration missing). One request: the items of the window (and those without a day) with
// their versions and markers embedded, so the request never grows with a list of ids.
export async function loadStudio() {
  if (DEMO) return demo.load();
  const from = new Date(Date.parse(`${swissToday()}T12:00:00Z`) - LOAD_DAYS_BACK * 864e5).toISOString().slice(0, 10);
  const [r, runs] = await Promise.all([
    sb().from("studio_items").select("*, studio_versions(*), studio_markers(*)")
      .or(`day.gte.${from},day.is.null`).order("day", { ascending: true, nullsFirst: false }).limit(1000),
    loadRuns(),
  ]);
  if (r.error && /does not exist|could not find/i.test(r.error.message)) return null;
  const rows = must(r);
  const versions = [], markers = [];
  const items = rows.map(({ studio_versions: v = [], studio_markers: m = [], ...item }) => { versions.push(...v); markers.push(...m); return item; });
  markers.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return { items, versions, markers, ...runs };
}

// Claude in the background (migration 20261028200000_studio_jobs.sql): the last runs and the open questions.
// runsReady false = migration not there yet (the card then explains it).
async function loadRuns() {
  const [jobs, requests] = await Promise.all([
    sb().from("studio_jobs").select("*").order("requested_at", { ascending: false }).limit(5),
    sb().from("studio_requests").select("*").in("status", ["pending", "approved"]).order("created_at").limit(50),
  ]);
  if ((jobs.error || requests.error) && /does not exist|could not find/i.test((jobs.error ?? requests.error).message)) return { jobs: [], requests: [], runsReady: false };
  return { jobs: must(jobs), requests: must(requests), runsReady: true };
}
// «Claude jetzt starten»: one waiting run at most (the database refuses a second one)
export async function startRun(note = "") {
  if (DEMO) return demo.startRun(note);
  const r = await sb().from("studio_jobs").insert({ trigger: "button", note: note || null });
  if (r.error && /duplicate|unique/i.test(r.error.message)) return false;
  must(r);
  return true;
}
// Christoph's answer to a question (voicing): approved | declined
export async function answerRequest(id, status, answer = "") {
  if (DEMO) return demo.answerRequest(id, status, answer);
  must(await sb().from("studio_requests").update({ status, answer: answer || null, decided_at: new Date().toISOString() }).eq("id", id).eq("status", "pending"));
}

const r2Cache = new Map();   // key → { url, until }
export const forgetMedia = (source) => { if (source?.key) r2Cache.delete(source.key); };
// → playable URL or null (null: open the file from the PC)
export async function mediaUrl(source) {
  if (!source) return null;
  if (DEMO) return demo.url(source);
  if (source.kind === "storage" && source.path) return socialUrl(source.path);
  if (source.kind === "r2" && source.key) {
    const hit = r2Cache.get(source.key);
    if (hit && hit.until > Date.now()) return hit.url;
    try {
      const { data, error } = await sb().functions.invoke("studio-media", { body: { key: source.key } });
      if (error || !data?.url) return null;
      r2Cache.set(source.key, { url: data.url, until: Date.now() + (data.expires_in - 120) * 1000 });
      return data.url;
    } catch { return null; }
  }
  return null;
}
// carousel pages / pictures → URLs
export const pageUrls = (source) => (source?.pages ?? []).map((p) => (DEMO ? demo.url({ path: p }) : socialUrl(p)));

const MARKER_FIELDS = ["item_id", "version", "at", "page", "scene_id", "offset_s", "x", "y", "target", "category", "body", "status"];
export async function saveMarker(m) {
  if (DEMO) return demo.saveMarker(m);
  const row = Object.fromEntries(MARKER_FIELDS.filter((k) => k in m).map((k) => [k, m[k]]));
  return m.id ? must(await sb().from("studio_markers").update(row).eq("id", m.id).select().single())
    : must(await sb().from("studio_markers").insert(row).select().single());
}
export async function deleteMarker(id) {
  if (DEMO) return demo.deleteMarker(id);
  must(await sb().from("studio_markers").delete().eq("id", id));
}
// Christoph's verdict in Sichtung 2: ok | not_yet
export async function judgeMarker(id, status) {
  if (DEMO) return demo.judgeMarker(id, status);
  must(await sb().from("studio_markers").update({ status }).eq("id", id));
}
// «Sichtung abschliessen»: the item moves on first (only from the status Christoph was looking at, so a second
// click or another device does nothing), then his drafts become open for Claude
export async function finishReview(item) {
  if (DEMO) return demo.finishReview(item.id, afterReview(item.status));
  const moved = must(await sb().from("studio_items").update({ status: afterReview(item.status) }).eq("id", item.id).eq("status", item.status).select("id"));
  if (!moved.length) return;
  must(await sb().from("studio_markers").update({ status: "open" }).eq("item_id", item.id).eq("status", "draft"));
}
// the idea: ok (Claude makes the draft) or dropped with a note (Claude proposes another one)
export async function judgeIdea(item, ok, note = "") {
  const patch = { status: ok ? "idea_ok" : "dropped", idea_note: note || null };
  if (DEMO) return demo.setItem(item.id, patch);
  must(await sb().from("studio_items").update(patch).eq("id", item.id).eq("status", "idea"));
}
export async function setItem(id, patch) {
  if (DEMO) return demo.setItem(id, patch);
  must(await sb().from("studio_items").update(patch).eq("id", id));
}
// Christoph's choice of title / thumbnail (chosen_title, chosen_thumbnail) lives in the version's meta
export async function setVersionMeta(id, meta) {
  if (DEMO) return demo.setVersionMeta(id, meta);
  must(await sb().from("studio_versions").update({ meta }).eq("id", id));
}

export function subscribe(onChange) {
  if (DEMO) return demo.subscribe(onChange);
  const ch = sb().channel("studio").on("postgres_changes", { event: "*", schema: "public", table: "studio_markers" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "studio_items" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "studio_versions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "studio_jobs" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "studio_requests" }, onChange).subscribe();
  return () => sb().removeChannel(ch);
}
