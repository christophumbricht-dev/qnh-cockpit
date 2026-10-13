// Store implementation on Supabase (service_role client inside the Edge Function only).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Account, Post, Store } from "./publish.ts";

const BUCKET = "social-media";

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

export function supabaseStore(db: SupabaseClient): Store {
  return {
    async claim(postId) {
      return must(await db.rpc("social_claim", { p_post_id: postId ?? null, p_limit: 5 }), "claim") as Post[];
    },
    async account(id) {
      return must(await db.from("social_accounts").select("id, platform, remote_id, handle, active, token_expires_at").eq("id", id).single(), "account") as Account;
    },
    async accounts() {
      return must(await db.from("social_accounts").select("id, platform, remote_id, handle, active, token_expires_at"), "accounts") as Account[];
    },
    async token(accountId) {
      const token = must(await db.rpc("social_token", { p_account_id: accountId }), "token") as string | null;
      if (!token) throw new Error("Für dieses Konto ist kein Token in Vault hinterlegt (docs/social-setup.md).");
      return token;
    },
    async storeToken(accountId, token, expiresAt) {
      must(await db.rpc("social_store_token", { p_account_id: accountId, p_token: token, p_expires_at: expiresAt.toISOString() }), "store token");
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
    async removeFiles(paths) {
      if (paths.length) must(await db.storage.from(BUCKET).remove(paths), "remove files");
    },
  };
}
