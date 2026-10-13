import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSecrets } from "../scripts/check-secrets.mjs";

const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url")}.c2lnbmF0dXJlc2lnbmF0dXJl`;

function project(files, env = "") {
  const root = mkdtempSync(join(tmpdir(), "qnh-secrets-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  if (env) writeFileSync(join(root, ".env"), env);
  return root;
}

test("clean project passes, anon key is allowed", () => {
  const root = project({ "src/a.js": `const k = "${jwt("anon")}";`, "supabase/m.sql": "grant execute on function f() to service_role;" },
    "VITE_QNH_SUPABASE_URL=https://x.supabase.co\nVITE_QNH_SUPABASE_ANON_KEY=abcdefghijk\n");
  assert.deepEqual(checkSecrets(root), []);
});

test("service_role JWT is found anywhere", () => {
  assert.equal(checkSecrets(project({ "dist/assets/i.js": `x="${jwt("service_role")}"` })).length, 1);
  assert.equal(checkSecrets(project({ "supabase/functions/f/index.ts": `x="${jwt("service_role")}"` })).length, 1);
});

test("secret key and Meta tokens are found", () => {
  const p = checkSecrets(project({ "src/a.js": `"sb_secret_abcdefghijklmnop" "EAAB${"x".repeat(40)}" "IGAAJ${"y".repeat(40)}"` }));
  assert.equal(p.length, 3);
});

test("the word service_role is not allowed in browser code", () => {
  assert.equal(checkSecrets(project({ "src/a.js": "// uses the service_role key" })).length, 1);
});

test("private .env values must not appear", () => {
  const root = project({ "src/a.js": "const t = 'supersecretvalue123';" }, "META_TOKEN=supersecretvalue123\nVITE_X_URL=https://x\n");
  assert.match(checkSecrets(root)[0], /META_TOKEN/);
});
