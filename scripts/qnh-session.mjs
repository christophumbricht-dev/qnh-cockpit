// Shared by the local tools (roadmap.mjs, social.mjs): Christoph's QNH Core admin session on this PC.
// The refresh token lives in .qnh-session.json (gitignored) and rotates on every use.
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION = join(ROOT, ".qnh-session.json");

export function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// flags = names that never take a value (e.g. "replace"), so `--replace a b` keeps a and b as folders
export function args(list, flags = []) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith("--")) {
      const next = list[i + 1];
      const name = list[i].slice(2);
      out[name] = flags.includes(name) || next === undefined || next.startsWith("--") ? true : list[++i];
    } else out._.push(list[i]);
  }
  return out;
}

function env() {
  const file = join(ROOT, ".env");
  const vars = existsSync(file)
    ? Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]))
    : {};
  const url = process.env.VITE_QNH_SUPABASE_URL ?? vars.VITE_QNH_SUPABASE_URL;
  const key = process.env.VITE_QNH_SUPABASE_ANON_KEY ?? vars.VITE_QNH_SUPABASE_ANON_KEY;
  if (!url || !key) fail("VITE_QNH_SUPABASE_URL / VITE_QNH_SUPABASE_ANON_KEY fehlen in .env");
  return { url, key };
}

export const supabase = () => {
  const { url, key } = env();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

export async function signedIn() {
  if (!existsSync(SESSION)) fail("Noch nicht angemeldet: npm run roadmap -- login");
  const saved = JSON.parse(readFileSync(SESSION, "utf8"));
  const sb = supabase();
  const { data, error } = await sb.auth.refreshSession({ refresh_token: saved.refresh_token });
  if (error || !data.session) fail(`Anmeldung abgelaufen (${error?.message ?? "keine Sitzung"}): npm run roadmap -- login`);
  saveSession(data.session, saved);
  return sb;
}

export function saveSession(session, extra = {}) {
  writeFileSync(SESSION, JSON.stringify({ ...extra, refresh_token: session.refresh_token, email: session.user.email }, null, 2));
}
