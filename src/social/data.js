// Social posts in the QNH Core project. All rules (admins only, nothing approves itself) are enforced by
// the database (supabase/migrations/…_social.sql); this file only talks to it.
import { DEMO, client } from "../api.js";
import { QNH } from "../apps.js";
import * as demo from "./demo.js";

const BUCKET = "social-media";
const sb = () => client(QNH);
const must = (r, what) => { if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code, what }); return r.data; };

export const socialConfigured = () => DEMO || Boolean(QNH.url && QNH.anonKey);

export async function loadSocial() {
  if (DEMO) return demo.load();
  const [accounts, posts] = await Promise.all([
    sb().from("social_accounts").select("id, app_id, platform, handle, active, token_expires_at").order("app_id"),
    sb().from("social_posts").select("*").neq("status", "cancelled").order("created_at", { ascending: false }).limit(300),
  ]);
  const rows = must(posts, "posts");
  if (rows.length) { hasTodo = "todo" in rows[0]; hasLocation = "location" in rows[0]; }
  const places = hasLocation ? await sb().from("social_locations").select("id, page_id, name").order("name") : { data: [] };
  return { accounts: must(accounts, "accounts"), posts: rows, locations: places.data ?? [] };
}

// story images named in a to-do ("Bild s1-beta") – uploaded by `npm run social -- import` to assets/<name>.jpg
export const assetUrl = (name) => mediaUrl(`assets/${name}.jpg`);
export const mediaUrl = (path) => (DEMO ? demo.url(path) : sb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl);

const ext = (type) => (type === "image/jpeg" ? "jpg" : type === "video/quicktime" ? "mov" : "mp4");
const newPath = (postId, type, i) => `${postId}/${Date.now().toString(36)}-${i}.${ext(type)}`;

export async function uploadFile(postId, file, i) {
  const path = newPath(postId, file.type, i);
  if (DEMO) return demo.upload(path, file);
  must(await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }), "upload");
  return path;
}

// duplicates get their own copy: files of published posts are deleted after 14 days
export async function copyFile(fromPath, postId, type, i) {
  const path = newPath(postId, type, i);
  if (DEMO) return demo.copy(fromPath, path);
  must(await sb().storage.from(BUCKET).copy(fromPath, path), "copy");
  return path;
}

const FIELDS = ["account_id", "kind", "caption", "first_comment", "media", "cover_path", "scheduled_at", "source", "todo", "location"];
// "todo" exists after migration 20261014120000_social_todo.sql; until then it is left out
let hasTodo = DEMO;
// "location" + table social_locations exist after migration 20261019100000_social_location.sql
let hasLocation = DEMO;
export const locationSupported = () => hasLocation;
export const todoSupported = () => hasTodo;
const pick = (post) => Object.fromEntries(FIELDS.filter((k) => k in post && (k !== "todo" || hasTodo) && (k !== "location" || hasLocation)).map((k) => [k, post[k]]));

export async function insertPost(id, post) {
  if (DEMO) return demo.insert({ id, ...pick(post) });
  return must(await sb().from("social_posts").insert({ id, ...pick(post) }).select().single(), "insert");
}

export async function updatePost(id, post) {
  if (DEMO) return demo.update(id, pick(post));
  return must(await sb().from("social_posts").update(pick(post)).eq("id", id).select().single(), "update");
}

export async function setStatus(id, status, scheduledAt) {
  const patch = scheduledAt === undefined ? { status } : { status, scheduled_at: scheduledAt };
  if (DEMO) return demo.update(id, patch);
  return must(await sb().from("social_posts").update(patch).eq("id", id).select().single(), "status");
}

// the to-do note may change in every status (also approved/published)
export async function setTodo(id, todo) {
  if (DEMO) return demo.update(id, { todo });
  return must(await sb().from("social_posts").update({ todo }).eq("id", id).select().single(), "todo");
}

// saved places for the location picker (Facebook Page ID of a real place)
export async function addLocation(page_id, name) {
  if (DEMO) return demo.addLocation({ page_id, name });
  return must(await sb().from("social_locations").insert({ page_id, name }).select("id, page_id, name").single(), "location");
}

export async function deletePost(id) {
  if (DEMO) return demo.remove(id);
  must(await sb().from("social_posts").delete().eq("id", id), "delete");
}

// The Edge Function publishes approved, due posts; with post_id only that one.
export async function publishNow(id) {
  if (DEMO) return demo.publish(id);
  const { data, error } = await sb().functions.invoke("social-publish", { body: { op: "publish", post_id: id } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data?.results ?? [];
}

export function subscribe(onChange) {
  if (DEMO) return demo.subscribe(onChange);
  const channel = sb().channel("social-posts")
    .on("postgres_changes", { event: "*", schema: "public", table: "social_posts" }, onChange)
    .subscribe();
  return () => sb().removeChannel(channel);
}
