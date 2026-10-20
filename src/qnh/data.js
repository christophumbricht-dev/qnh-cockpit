// Roadmap items and Hangar links in the QNH Core project (admins only, enforced by the database).
import { DEMO, client } from "../api.js";
import { QNH } from "../apps.js";
import * as demo from "./demo.js";

const sb = () => client(QNH);
const must = (r) => { if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.data; };

export const qnhReady = () => DEMO || Boolean(QNH.url && QNH.anonKey);

// repeat / snoozed_until / last_done_at exist after migration 20261021100000_finance.sql (only sent when used)
const ITEM_FIELDS = ["scope", "title", "body", "status", "due", "sort", "repeat", "snoozed_until", "last_done_at"];
const LINK_FIELDS = ["grp", "title", "url", "note", "sort"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k] === "" && ["due", "repeat", "snoozed_until"].includes(k) ? null : o[k]]));

export async function loadRoadmap() {
  if (DEMO) return demo.roadmap();
  return must(await sb().from("roadmap_items").select("*").order("sort").order("created_at"));
}
export async function addItem(item) {
  if (DEMO) return demo.addItem(pick(item, ITEM_FIELDS));
  return must(await sb().from("roadmap_items").insert(pick(item, ITEM_FIELDS)).select().single());
}
export async function updateItem(id, patch) {
  if (DEMO) return demo.updateItem(id, pick(patch, ITEM_FIELDS));
  return must(await sb().from("roadmap_items").update(pick(patch, ITEM_FIELDS)).eq("id", id).select().single());
}
export async function deleteItem(id) {
  if (DEMO) return demo.deleteItem(id);
  must(await sb().from("roadmap_items").delete().eq("id", id));
}
export function subscribeRoadmap(onChange) {
  if (DEMO) return () => {};
  const ch = sb().channel("roadmap").on("postgres_changes", { event: "*", schema: "public", table: "roadmap_items" }, onChange).subscribe();
  return () => sb().removeChannel(ch);
}

export async function loadLinks() {
  if (DEMO) return demo.links();
  return must(await sb().from("hangar_links").select("*").order("grp").order("sort").order("title"));
}
export async function saveLink(link) {
  if (DEMO) return demo.saveLink(link);
  const row = pick(link, LINK_FIELDS);
  return link.id
    ? must(await sb().from("hangar_links").update(row).eq("id", link.id).select().single())
    : must(await sb().from("hangar_links").insert(row).select().single());
}
export async function deleteLink(id) {
  if (DEMO) return demo.deleteLink(id);
  must(await sb().from("hangar_links").delete().eq("id", id));
}
