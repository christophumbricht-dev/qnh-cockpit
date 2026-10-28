// Digital Studio data in QNH Core (migration 20261028100000_studio.sql). Admins only – the database decides.
// Media: Social bucket (reels, carousels), Cloudflare R2 through the function studio-media (long videos), or a
// file Christoph opens from the PC (fallback, nothing stored).
import { DEMO, client } from "../api.js";
import { QNH } from "../apps.js";
import { mediaUrl as socialUrl } from "../social/data.js";
import * as demo from "./demo.js";

const sb = () => client(QNH);
const must = (r) => { if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.data; };

// null = not set up yet (migration missing)
export async function loadStudio() {
  if (DEMO) return demo.load();
  const items = await sb().from("studio_items").select("*").order("day", { ascending: true, nullsFirst: false }).limit(500);
  if (items.error && /does not exist|could not find/i.test(items.error.message)) return null;
  const ids = must(items).map((i) => i.id);
  if (!ids.length) return { items: [], versions: [], markers: [] };
  const [versions, markers] = await Promise.all([
    sb().from("studio_versions").select("*").in("item_id", ids).order("version"),
    sb().from("studio_markers").select("*").in("item_id", ids).order("created_at"),
  ]);
  return { items: items.data, versions: must(versions), markers: must(markers) };
}

const r2Cache = new Map();   // key → { url, until }
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
// «Sichtung abschliessen»: his drafts become open for Claude, the item goes to «in Arbeit»
export async function finishReview(item) {
  if (DEMO) return demo.finishReview(item.id);
  must(await sb().from("studio_markers").update({ status: "open" }).eq("item_id", item.id).eq("status", "draft"));
  must(await sb().from("studio_items").update({ status: "work" }).eq("id", item.id));
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
    .on("postgres_changes", { event: "*", schema: "public", table: "studio_items" }, onChange).subscribe();
  return () => sb().removeChannel(ch);
}
