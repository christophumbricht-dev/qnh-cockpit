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
  // what is already on Instagram (from the daily statistics; empty until that is set up)
  const seen = await sb().from("social_media_stats").select("media_id, account_id, caption, posted_at, permalink").order("day", { ascending: false }).limit(500);
  const published = [...new Map((seen.data ?? []).map((m) => [m.media_id, m])).values()];
  return { accounts: must(accounts, "accounts"), posts: rows, locations: places.data ?? [], published, comments: await loadComments() };
}

// ---------- comment inbox (table from migration 20261020100000_social_comments.sql) ----------
const COMMENT_COLS = "id, account_id, remote_id, parent_remote_id, media_id, media_title, media_permalink, author, author_url, body, posted_at, like_count, own, held, status, draft, replied_at, deleted_at";
// null = not set up yet (the migration is missing); the rest of Social keeps working
export async function loadComments() {
  if (DEMO) return demo.comments();
  const since = new Date(Date.now() - 120 * 864e5).toISOString(); // last 4 months are plenty for an inbox
  const r = await sb().from("social_comments").select(COMMENT_COLS).is("deleted_at", null).gte("posted_at", since).order("posted_at", { ascending: false }).limit(1000);
  if (r.error) return null;
  return r.data;
}
export async function setCommentStatus(id, status) {
  if (DEMO) return demo.commentPatch(id, { status });
  must(await sb().from("social_comments").update({ status }).eq("id", id), "comment");
}
export async function saveDraft(id, draft) {
  if (DEMO) return demo.commentPatch(id, { draft });
  must(await sb().from("social_comments").update({ draft }).eq("id", id), "comment");
}

// social-publish ops; a German error message from the function becomes the Error's text
async function op(body) {
  const { data, error } = await sb().functions.invoke("social-publish", { body });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export const fetchComments = async () => (DEMO ? demo.fetchComments() : (await op({ op: "comments" })).results ?? []);
export const replyComment = (id, text) => (DEMO ? demo.reply(id, text) : op({ op: "reply", comment_id: id, text }));
export const moderateComment = (id, action) => (DEMO ? demo.moderate(id, action) : op({ op: "moderate", comment_id: id, action }));
export const youtubeAuthUrl = (appId, redirectUri, state) => op({ op: "youtube-auth", app_id: appId, redirect_uri: redirectUri, state });
export const youtubeConnect = (appId, code, redirectUri) => op({ op: "youtube-connect", app_id: appId, code, redirect_uri: redirectUri });

export function subscribeComments(onChange) {
  if (DEMO) return demo.subscribe(onChange);
  const channel = sb().channel("social-comments")
    .on("postgres_changes", { event: "*", schema: "public", table: "social_comments" }, onChange)
    .subscribe();
  return () => sb().removeChannel(channel);
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

// Instagram statistics (daily snapshots written by social-publish, op "stats")
export async function loadStats(days) {
  if (DEMO) return demo.stats(days);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const [acc, media] = await Promise.all([
    sb().from("social_account_stats").select("account_id, day, metrics").gte("day", since).order("day"),
    sb().from("social_media_stats").select("media_id, account_id, day, kind, permalink, caption, posted_at, metrics").gte("day", since).order("day"),
  ]);
  return { accountDays: must(acc, "stats"), mediaDays: must(media, "stats") };
}
export async function refreshStats() {
  if (DEMO) return [];
  const { data, error } = await sb().functions.invoke("social-publish", { body: { op: "stats" } });
  if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message);
  return data?.results ?? [];
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
