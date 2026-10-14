// QNH Core – Edge Function store-status (read-only)
//
// POST { bundle_ids: ["ch.umbricht.downwind", …] }  → TestFlight builds, App Store versions, reviews,
// tester count and public rating per app, plus the latest Codemagic builds.
//
// Allowed callers: a signed-in QNH admin (cockpit; checked with is_qnh_admin()).
//
// Secrets (Supabase → Edge Functions → Secrets), all optional – missing parts are simply left out:
//   ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY (content of the .p8 file)   App Store Connect API key
//   CODEMAGIC_TOKEN                                                        Codemagic API token

import { createClient } from "npm:@supabase/supabase-js@2";
import { BUNDLE_ID, storeStatus } from "./status.ts";

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
  const ids = Array.isArray(body.bundle_ids) ? body.bundle_ids : [];
  if (ids.length > 10 || !ids.every((b: unknown) => typeof b === "string" && BUNDLE_ID.test(b))) return json({ error: "bad_bundle_ids" }, 400);

  const env = (k: string) => Deno.env.get(k)?.trim() || null;
  const issuer = env("ASC_ISSUER_ID"), keyId = env("ASC_KEY_ID"), privateKey = env("ASC_PRIVATE_KEY");
  try {
    return json(await storeStatus({
      fetch,
      now: () => new Date(),
      asc: issuer && keyId && privateKey ? { issuer, keyId, privateKey } : null,
      codemagicToken: env("CODEMAGIC_TOKEN"),
    }, ids));
  } catch (err) {
    console.error("store-status", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
