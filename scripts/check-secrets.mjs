#!/usr/bin/env node
// npm run check:secrets – fails if something secret could end up in the repo or the published site.
// The cockpit runs in the browser: only public values (Supabase URL + anon key) may ever be in it.
//
// Checks src/, public/, dist/ (browser code) and supabase/ (server code + SQL):
//   - JWTs whose payload has role "service_role"
//   - Supabase secret keys (sb_secret_…)
//   - Meta / Instagram access tokens (EAA…, IGAA…), Google client secrets and tokens (GOCSPX-…, 1//…, ya29.…)
//   - the word "service_role" in browser code (src/, public/, dist/)
//   - any value from .env that is not a VITE_*_URL / VITE_*_ANON_KEY
// Usage: node scripts/check-secrets.mjs [rootDir]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BROWSER_DIRS = ["src", "public", "dist"];
const SERVER_DIRS = ["supabase"];
const SKIP = new Set(["node_modules", ".git", ".temp", ".branches"]);
const TEXT = /\.(js|mjs|cjs|ts|tsx|jsx|json|html|css|svg|sql|toml|md|txt|webmanifest|map|yml|yaml)$|^CNAME$|^\.env/i;

const PATTERNS = [
  { name: "Supabase secret key (sb_secret_…)", re: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  { name: "Meta access token (EAA…)", re: /\bEAA[A-Za-z0-9]{30,}/g },
  { name: "Instagram access token (IGAA…)", re: /\bIGAA[A-Za-z0-9_-]{30,}/g },
  { name: "Google OAuth client secret (GOCSPX-…)", re: /\bGOCSPX-[A-Za-z0-9_-]{20,}/g },
  { name: "Google refresh token (1//…)", re: /(?<![A-Za-z0-9:])1\/\/0[A-Za-z0-9_-]{40,}/g },
  { name: "Google access token (ya29.…)", re: /\bya29\.[A-Za-z0-9_-]{30,}/g },
];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;

function jwtRole(payload) {
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
  } catch {
    return undefined;
  }
}

function files(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (TEXT.test(name)) out.push(p);
  }
  return out;
}

// values from .env that must never be published (everything except VITE_*_URL / VITE_*_ANON_KEY)
function privateEnvValues(root) {
  const file = join(root, ".env");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$/))
    .filter(Boolean)
    .filter(([, key, value]) => !/^VITE_[A-Z0-9_]*_(URL|ANON_KEY)$/.test(key) && value.length >= 8)
    .map(([, key, value]) => ({ key, value }));
}

export function checkSecrets(root) {
  const problems = [];
  const envValues = privateEnvValues(root);
  const scan = (dir, browser) => {
    for (const file of files(join(root, dir))) {
      const text = readFileSync(file, "utf8");
      const where = relative(root, file);
      for (const { name, re } of PATTERNS) if (re.test(text)) problems.push(`${where}: ${name}`), (re.lastIndex = 0);
      for (const m of text.matchAll(JWT)) if (jwtRole(m[1]) === "service_role") problems.push(`${where}: JWT with role service_role`);
      if (browser && /service_role/.test(text)) problems.push(`${where}: mentions "service_role" in browser code`);
      for (const { key, value } of envValues) if (text.includes(value)) problems.push(`${where}: contains the value of .env ${key}`);
    }
  };
  for (const d of BROWSER_DIRS) scan(d, true);
  for (const d of SERVER_DIRS) scan(d, false);
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(fileURLToPath(import.meta.url), "..", ".."));
  const problems = checkSecrets(root);
  if (problems.length) {
    console.error("check:secrets FAILED – remove these before committing or publishing:");
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("check:secrets ok – no secrets in src/, public/, dist/, supabase/");
}
