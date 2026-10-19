// QNH Core – Edge Function social-publish
//
// POST { op: "publish", post_id? }   publish due approved posts (post_id: only this one, cockpit button)
// POST { op: "refresh-tokens" }      refresh Instagram tokens that expire within 20 days (weekly cron)
// POST { op: "cleanup" }             delete files of posts published > 14 days ago (daily cron)
// POST { op: "stats" }               Instagram statistics per account and media item (daily cron, or the CLI)
//
// Allowed callers: pg_cron with header x-cron-secret = SOCIAL_CRON_SECRET, or a signed-in QNH admin
// (cockpit; checked with is_qnh_admin()). verify_jwt is off in config.toml because cron has no JWT.
//
// Secrets (supabase secrets set …): SOCIAL_CRON_SECRET; optional FACEBOOK_ENABLED=true.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanup, publishDue, refreshTokens, type Deps } from "./publish.ts";
import { supabaseStore } from "./store.ts";
import { collectStats } from "./stats.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data } = await user.rpc("is_qnh_admin");
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const fromCron = sameSecret(req.headers.get("x-cron-secret") ?? "", Deno.env.get("SOCIAL_CRON_SECRET") ?? "");
  if (!fromCron && !(await isAdmin(req))) return json({ error: "not_allowed" }, 401);

  const body = await req.json().catch(() => ({}));
  const op = String(body.op ?? "publish");
  const deps: Deps = {
    store: supabaseStore(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })),
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
    facebookEnabled: Deno.env.get("FACEBOOK_ENABLED") === "true",
  };

  try {
    if (op === "publish") {
      const postId = !fromCron && typeof body.post_id === "string" ? body.post_id : undefined;
      return json({ results: await publishDue(deps, postId) });
    }
    if (op === "refresh-tokens") return json({ results: await refreshTokens(deps) });
    if (op === "cleanup") return json({ results: await cleanup(deps) });
    if (op === "stats") return json({ results: await collectStats({ store: deps.store as ReturnType<typeof supabaseStore>, fetch, now: deps.now }) });
    return json({ error: "unknown_op" }, 400);
  } catch (err) {
    console.error("social-publish", op, err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
