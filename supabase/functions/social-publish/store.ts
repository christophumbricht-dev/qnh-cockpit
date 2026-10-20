// Store implementation on Supabase (service_role client inside the Edge Function only).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Account, Post, Store } from "./publish.ts";
import type { MediaRow, StatsStore } from "./stats.ts";
import type { CommentsStore, StoredComment } from "./comments.ts";
import type { FollowUpStore } from "./youtube.ts";

const BUCKET = "social-media";
const ACCOUNT_COLS = "id, app_id, platform, remote_id, handle, active, token_expires_at";
const COMMENT_COLS = "id, account_id, remote_id, parent_remote_id, media_id, media_title, media_permalink, author, author_url, body, posted_at, like_count, own, held, status, draft, replied_at, deleted_at, fetched_at";

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

export function supabaseStore(db: SupabaseClient): Store & StatsStore & CommentsStore & FollowUpStore {
  return {
    async claim(postId) {
      return must(await db.rpc("social_claim", { p_post_id: postId ?? null, p_limit: 5 }), "claim") as Post[];
    },
    async account(id) {
      return must(await db.from("social_accounts").select(ACCOUNT_COLS).eq("id", id).single(), "account") as Account;
    },
    async accounts() {
      return must(await db.from("social_accounts").select(ACCOUNT_COLS), "accounts") as Account[];
    },
    async token(accountId) {
      const token = must(await db.rpc("social_token", { p_account_id: accountId }), "token") as string | null;
      if (!token) throw new Error("Für dieses Konto ist kein Token in Vault hinterlegt (docs/social-setup.md).");
      return token;
    },
    async storeToken(accountId, token, expiresAt) {
      must(await db.rpc("social_store_token", { p_account_id: accountId, p_token: token, p_expires_at: expiresAt ? expiresAt.toISOString() : null }), "store token");
    },
    async update(postId, patch) {
      must(await db.from("social_posts").update(patch).eq("id", postId), "update post");
    },
    publicUrl(path) {
      return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    },
    async publishedWithFiles(before) {
      return must(await db.from("social_posts").select("*").eq("status", "published").is("media_deleted_at", null)
        .lt("published_at", before.toISOString()).limit(50), "published posts") as Post[];
    },
    async saveAccountDay(accountId: string, day: string, metrics: Record<string, number>) {
      must(await db.from("social_account_stats").upsert({ account_id: accountId, day, metrics }, { onConflict: "account_id,day" }), "account stats");
    },
    async saveMediaDays(rows: MediaRow[]) {
      if (rows.length) must(await db.from("social_media_stats").upsert(rows, { onConflict: "media_id,day" }), "media stats");
    },
    async youtubeWithoutComment(since: Date) {
      const rows = must(await db.from("social_posts").select("*, social_accounts!inner(platform)").eq("social_accounts.platform", "youtube")
        .eq("status", "published").is("remote_comment_id", null).not("remote_media_id", "is", null).neq("first_comment", "")
        .gte("published_at", since.toISOString()).limit(20), "youtube follow-up") as Array<Post & { social_accounts?: unknown }>;
      return rows.map(({ social_accounts: _a, ...p }) => p as Post);
    },
    async removeFiles(paths) {
      if (paths.length) must(await db.storage.from(BUCKET).remove(paths), "remove files");
    },

    // ---------- comments ----------
    async comments(accountId) {
      const out: StoredComment[] = [];
      for (let from = 0; ; from += 1000) { // the API returns at most 1000 rows per request
        const rows = must(await db.from("social_comments").select(COMMENT_COLS).eq("account_id", accountId).order("created_at").range(from, from + 999), "comments") as StoredComment[];
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    },
    async comment(id) {
      return must(await db.from("social_comments").select(COMMENT_COLS).eq("id", id).maybeSingle(), "comment") as StoredComment | null;
    },
    async insertComments(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        must(await db.from("social_comments").upsert(rows.slice(i, i + 500), { onConflict: "account_id,remote_id", ignoreDuplicates: true }), "insert comments");
      }
    },
    async updateComments(rows) {
      // existing rows only, so the upsert is an update of exactly these columns (status and draft are not among them)
      for (let i = 0; i < rows.length; i += 500) {
        must(await db.from("social_comments").upsert(rows.slice(i, i + 500), { onConflict: "account_id,remote_id" }), "update comments");
      }
    },
    async updateComment(id, patch) {
      must(await db.from("social_comments").update(patch).eq("id", id), "update comment");
    },
    async claimReply(id, at) {
      const minuteAgo = new Date(Date.parse(at) - 60_000).toISOString();
      const rows = must(await db.from("social_comments").update({ replied_at: at }).eq("id", id)
        .or(`replied_at.is.null,replied_at.lt.${minuteAgo}`).select("id"), "claim reply") as Array<{ id: string }>;
      return rows.length === 1;
    },
    async markDeleted(ids, at) {
      for (let i = 0; i < ids.length; i += 200) must(await db.from("social_comments").update({ deleted_at: at }).in("id", ids.slice(i, i + 200)), "delete comments");
    },
    async upsertAccount(row) {
      return must(await db.from("social_accounts").upsert({ ...row, active: true }, { onConflict: "app_id,platform" }).select(ACCOUNT_COLS).single(), "account") as Account;
    },
  };
}
