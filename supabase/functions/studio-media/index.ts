// QNH Core – Edge Function studio-media: short-lived links to the Digital Studio videos in Cloudflare R2.
//
// POST { key: "studio/<slug>/v<n>/<file>", method?: "GET" | "PUT" }  → { url, expires_in }
//   GET: the cockpit plays a long video (link valid 1 h). PUT: `npm run studio -- upload` puts a file there (15 min).
//   Only keys below studio/ (STUDIO_KEY), nothing else in the bucket.
//
// Allowed callers: a signed-in QNH admin (checked with is_qnh_admin()).
// Secrets (Supabase → Edge Functions → Secrets, entered by Christoph):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (R2 API token «Object Read & Write» for this bucket only), R2_BUCKET
// Without them the function answers { error: "not_configured" } and the studio falls back to a file from the PC.

import { createClient } from "npm:@supabase/supabase-js@2";
import { STUDIO_KEY, r2Presign } from "../_shared/sigv4.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

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
  if (!(await isAdmin(req))) return json({ error: "not_allowed" }, 401);

  const body = await req.json().catch(() => ({}));
  const key = String(body.key ?? "");
  const method = body.method === "PUT" ? "PUT" : "GET";
  if (!STUDIO_KEY.test(key)) return json({ error: "bad_key" }, 400);

  const env = (k: string) => Deno.env.get(k)?.trim() || null;
  const accountId = env("R2_ACCOUNT_ID"), accessKeyId = env("R2_ACCESS_KEY_ID"), secretAccessKey = env("R2_SECRET_ACCESS_KEY"), bucket = env("R2_BUCKET");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return json({ error: "not_configured" }, 200);
  const expires = method === "PUT" ? 900 : 3600;
  const url = await r2Presign({ accountId, bucket, key, method, accessKeyId, secretAccessKey, expires });
  return json({ url, expires_in: expires });
});
