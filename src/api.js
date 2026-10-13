// Data access per app. Every call runs with the signed-in admin's own session
// against the app's admin functions (is_admin() in the database decides).
// No secret keys: the cockpit only knows each app's public URL and anon key.

import { createClient } from "@supabase/supabase-js";
import * as demo from "./demo.js";

export const DEMO = new URLSearchParams(location.search).has("demo");

const clients = new Map();

export function configured(app) {
  return DEMO || Boolean(app.url && app.anonKey);
}

export function client(app) {
  if (!clients.has(app.id)) {
    clients.set(app.id, createClient(app.url, app.anonKey, {
      // QNH Core can only send Supabase's default e-mail (a sign-in link, no code) on the free plan,
      // so its client also accepts the link (tokens in the URL). The app projects use the 6-digit code.
      auth: { storageKey: `qnh-cockpit-${app.id}`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: app.id === "qnh" },
    }));
  }
  return clients.get(app.id);
}

async function rpc(app, fn, args) {
  const { data, error } = await client(app).rpc(fn, args);
  if (error) throw error;
  return data;
}

// ---- auth (6-digit code from the app's sign-in e-mail; no new accounts) ----

export async function currentUser(app) {
  if (DEMO) return { email: "christoph@setqnh.ch" };
  const { data } = await client(app).auth.getSession();
  return data.session?.user ?? null;
}

export async function sendCode(app, email) {
  const emailRedirectTo = app.id === "qnh" ? location.origin + location.pathname : undefined;
  const { error } = await client(app).auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } });
  if (error) throw error;
}

export async function verifyCode(app, email, token) {
  const { error } = await client(app).auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

export async function signOut(app) {
  if (DEMO) return;
  await client(app).auth.signOut({ scope: "local" });
}

// ---- admin data ----

export const stats = (app) => (DEMO ? demo.stats() : rpc(app, "admin_stats"));

export const feedback = (app, days = 60) => (DEMO ? demo.feedback() : rpc(app, "admin_feedback", { p_days: days }));

export const setFeedbackStatus = (app, id, status) =>
  DEMO ? demo.setFeedbackStatus(id, status) : rpc(app, "set_feedback_status", { p_id: id, p_status: status });

export const timeseries = (app, days = 91) => (DEMO ? demo.timeseries(days) : rpc(app, "admin_timeseries", { p_days: days }));

export const errors = (app, days = 7) => (DEMO ? demo.errors(days) : rpc(app, "admin_errors", { p_days: days }));

export async function betaSignups(app) {
  if (DEMO) return demo.beta();
  const { data, error } = await client(app)
    .from("beta_signups")
    .select("id, first_name, last_name, email, source, note, lang, status, created_at, handled_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data;
}

export async function setBetaStatus(app, id, status) {
  if (DEMO) return demo.setBetaStatus(id, status);
  const { error } = await client(app)
    .from("beta_signups")
    .update({ status, handled_at: status === "new" ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ---- verification of role badges (airfield / club / instructor) ----

export async function verificationQueue(app) {
  if (DEMO) return demo.verifications();
  const rows = await rpc(app, "verification_queue");
  // show club names instead of ids
  const clubIds = [...new Set(rows.filter((r) => r.kind === "club").map((r) => r.target))];
  if (clubIds.length) {
    const { data } = await client(app).from("clubs").select("id, name").in("id", clubIds);
    const names = Object.fromEntries((data ?? []).map((c) => [c.id, c.name]));
    for (const r of rows) if (r.kind === "club") r.target_name = names[r.target];
  }
  return rows;
}

export async function verificationDocUrl(app, path) {
  if (DEMO) return "icon.svg";
  const { data, error } = await client(app).storage.from("verification-docs").createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

// Same steps as Downwind's own admin screen: decide, delete the licence photo, notify the pilot.
export async function reviewVerification(app, row, approve, reason = "") {
  if (DEMO) return demo.reviewVerification(row.id, approve, reason);
  const sb = client(app);
  await rpc(app, "review_verification", { rid: row.id, approve, why: reason });
  if (row.doc_path) {
    await sb.storage.from("verification-docs").remove([row.doc_path]).catch(() => {});
    await sb.rpc("clear_verification_doc", { rid: row.id });
  }
  sb.functions.invoke("push", { body: { verification: { id: row.id } } }).catch(() => {});
}

// ---- moderation of reports (Downwind edge function "moderate", moderators only) ----

async function invoke(app, fn, body) {
  const { data, error } = await client(app).functions.invoke(fn, { body });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw Object.assign(new Error(detail?.error ?? error.message), { code: detail?.error ? "function" : error.name });
  }
  if (data?.error) throw Object.assign(new Error(data.error), { code: "function" });
  return data;
}

export async function reports(app) {
  if (DEMO) return demo.reports();
  return (await invoke(app, "moderate", { op: "list" })).reports ?? [];
}

export async function moderate(app, reportId, action, note = "") {
  if (DEMO) return demo.moderate(reportId, action);
  await invoke(app, "moderate", { op: "act", report_id: reportId, action, note });
}

export async function screenshotUrl(app, path) {
  if (DEMO) return "icon.svg";
  const { data, error } = await client(app).storage.from("feedback").createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
