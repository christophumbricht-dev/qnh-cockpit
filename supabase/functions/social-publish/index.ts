// QNH Core – Edge Function social-publish
//
// POST { op: "publish", post_id? }   publish due approved posts (post_id: only this one, cockpit button);
//                                    Instagram and YouTube (videos upload in pieces, a long upload continues next run;
//                                    long YouTube videos go up privately up to a day ahead and go public on time)
// POST { op: "refresh-tokens" }      refresh Instagram tokens that expire within 20 days (weekly cron)
// POST { op: "cleanup" }             delete files of posts published > 14 days ago (daily cron)
// POST { op: "stats" }               Instagram statistics per account and media item (daily cron, or the CLI)
//                                    + prepared answers below our own first comments that are due (sendDueReplies)
// POST { op: "comments" }            fetch new comments on our Instagram posts and YouTube videos (cron every 15 min),
//                                    then answer correct quiz solutions with Christoph's prepared texts (answerQuizzes)
// POST { op: "reply", comment_id, text }                     admin only: answer a comment (Christoph's click)
// POST { op: "moderate", comment_id, action }                admin only: hide | show | approve | delete (own)
// POST { op: "youtube-auth", app_id, redirect_uri, state }   admin only: Google sign-in URL («YouTube verbinden»)
// POST { op: "youtube-connect", app_id, code, redirect_uri } admin only: store the channel's refresh token in Vault
// POST { op: "competitors", competitor_id? }  «Konkurrenz»: public numbers of the latest videos of watched YouTube
//                                    channels (also daily with op stats); read only, nothing is downloaded
// POST { op: "outreach" }            «Bei anderen»: read posts of watched accounts/hashtags, ask Claude for comment
//                                    suggestions (cron twice a day, or «Jetzt suchen»). Off in the cockpit = does nothing.
//                                    Never posts, likes or follows anything.
//
// Allowed callers: pg_cron with header x-cron-secret = SOCIAL_CRON_SECRET, or a signed-in QNH admin
// (cockpit; checked with is_qnh_admin()). verify_jwt is off in config.toml because cron has no JWT.
//
// Secrets (supabase secrets set …): SOCIAL_CRON_SECRET; optional FACEBOOK_ENABLED=true;
// for YouTube GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (and optionally GOOGLE_REDIRECT_URIS, comma-separated);
// for long studio videos in Cloudflare R2 the same R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// (optional R2_JURISDICTION) as studio-media (Supabase secrets are shared by all functions of the project);
// for «Bei anderen» ANTHROPIC_API_KEY, optionally META_APP_ID + META_APP_SECRET (renews the Facebook token).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanup, FinalError, publishDue, refreshTokens, type Deps } from "./publish.ts";
import { supabaseStore } from "./store.ts";
import { followUpYoutube, preuploadYoutube } from "./youtube.ts";
import { collectStats } from "./stats.ts";
import { collectCompetitors } from "./competitors.ts";
import { runOutreach, translateGerman } from "./outreach.ts";
import { elevenlabsCredits } from "./elevenlabs.ts";
import { answerQuizzes, fetchComments, moderate, REDIRECTS_DEFAULT, replyTo, sendDueReplies, youtubeAuth, youtubeConnect, type ModerateAction } from "./comments.ts";

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

// ops that act in Christoph's name: only from the cockpit, never from cron
const ADMIN_ONLY = new Set(["reply", "moderate", "youtube-auth", "youtube-connect", "outreach-translate", "elevenlabs"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const fromCron = sameSecret(req.headers.get("x-cron-secret") ?? "", Deno.env.get("SOCIAL_CRON_SECRET") ?? "");
  const body = await req.json().catch(() => ({}));
  const op = String(body.op ?? "publish");
  const admin = ADMIN_ONLY.has(op) || !fromCron ? await isAdmin(req) : false;
  if (ADMIN_ONLY.has(op) ? !admin : !fromCron && !admin) return json({ error: "not_allowed" }, 401);

  const store = supabaseStore(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } }));
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "", clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const google = clientId && clientSecret ? { clientId, clientSecret } : null;
  const env = (k: string) => Deno.env.get(k)?.trim() || "";
  const jurisdiction = env("R2_JURISDICTION").toLowerCase();
  const r2 = env("R2_ACCOUNT_ID") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && env("R2_BUCKET") && /^([a-z]{2,10})?$/.test(jurisdiction)
    ? { accountId: env("R2_ACCOUNT_ID"), jurisdiction, bucket: env("R2_BUCKET"), accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") }
    : null;
  const deps: Deps = {
    store,
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
    facebookEnabled: Deno.env.get("FACEBOOK_ENABLED") === "true",
    google,
    r2,
    // pg_net waits 150 s; stop uploading well before (the free plan also ends a run after 150 s)
    deadline: Date.now() + 100_000,
  };
  const redirects = (Deno.env.get("GOOGLE_REDIRECT_URIS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = redirects.length ? redirects : REDIRECTS_DEFAULT;
  const cdeps = { store, fetch, now: deps.now, google };
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  try {
    if (op === "publish") {
      const postId = !fromCron && typeof body.post_id === "string" ? body.post_id : undefined;
      const results = await publishDue(deps, postId);
      if (!postId) results.push(...(await followUpYoutube({ store, fetch, now: deps.now, google, deadline: deps.deadline })));
      if (!postId) {
        // long YouTube videos of the next day go up privately ahead of time; a problem here must not hide the results above
        try {
          results.push(...(await preuploadYoutube(deps)));
        } catch (err) {
          console.error("social-publish preupload", err);
        }
      }
      if (!postId) {
        // the answers Christoph approved with the post (never replies to other people); a problem here must not hide the results above
        try {
          results.push(...(await sendDueReplies({ ...cdeps, deadline: deps.deadline })));
        } catch (err) {
          console.error("social-publish replies", err);
        }
      }
      return json({ results });
    }
    if (op === "refresh-tokens") return json({ results: await refreshTokens(deps) });
    if (op === "cleanup") return json({ results: await cleanup(deps) });
    if (op === "stats") {
      const results = await collectStats({ store, fetch, now: deps.now, google });
      // «Konkurrenz» once a day with the statistics; a problem here must not hide the results above
      let competitors: unknown[] = [];
      try {
        competitors = await collectCompetitors({ store, fetch, now: deps.now, google });
      } catch (err) {
        console.error("social-publish competitors", err);
      }
      return json({ results, competitors });
    }
    if (op === "competitors") return json({ results: await collectCompetitors({ store, fetch, now: deps.now, google }, str(body.competitor_id) || undefined) });
    if (op === "comments") {
      const results = await fetchComments(cdeps);
      let quiz: unknown[] = [];
      try {
        quiz = await answerQuizzes({ ...cdeps, deadline: deps.deadline });
      } catch (err) {
        console.error("social-publish quiz", err);
      }
      return json({ results, quiz });
    }
    if (op === "reply") return json(await replyTo(cdeps, str(body.comment_id), str(body.text)));
    if (op === "moderate") return json(await moderate(cdeps, str(body.comment_id), str(body.action) as ModerateAction));
    if (op === "youtube-auth") return json(youtubeAuth(google, allowed, str(body.app_id), str(body.redirect_uri), str(body.state)));
    if (op === "youtube-connect") return json(await youtubeConnect(cdeps, allowed, str(body.app_id), str(body.code), str(body.redirect_uri)));
    // admin only: ElevenLabs credits for Finanzen (own read-only key, secret ELEVENLABS_READ_KEY)
    if (op === "elevenlabs") return json(await elevenlabsCredits(fetch, Deno.env.get("ELEVENLABS_READ_KEY")));
    if (op === "outreach-translate") {
      // admin only: German translation of a suggestion; the small cost is added to that suggestion (budget)
      const key = Deno.env.get("ANTHROPIC_API_KEY");
      if (!key) return json({ error: "ANTHROPIC_API_KEY fehlt" }, 400);
      const text = str(body.text).slice(0, 2200), id = str(body.item_id);
      if (!text.trim()) return json({ error: "Kein Text" }, 400);
      const t = await translateGerman(fetch, key, text);
      if (/^[0-9a-f-]{36}$/.test(id)) {
        const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
        const { data: row } = await db.from("outreach_items").select("cost_usd").eq("id", id).maybeSingle();
        if (row) await db.from("outreach_items").update({ cost_usd: Number(row.cost_usd) + t.cost }).eq("id", id);
      }
      return json({ text: t.text });
    }
    if (op === "outreach") {
      const appId = Deno.env.get("META_APP_ID") ?? "", appSecret = Deno.env.get("META_APP_SECRET") ?? "";
      return json(await runOutreach({
        store, fetch, now: deps.now, deadline: deps.deadline ?? Date.now() + 100_000,
        anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") || null,
        meta: appId && appSecret ? { appId, appSecret } : null,
      }));
    }
    return json({ error: "unknown_op" }, 400);
  } catch (err) {
    // FinalError = a message for Christoph (German), everything else is logged
    if (err instanceof FinalError) return json({ error: err.message }, 400);
    console.error("social-publish", op, err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
