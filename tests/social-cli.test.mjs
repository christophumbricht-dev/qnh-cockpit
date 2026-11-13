import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// scripts/social.mjs runs main() when imported, so the check reads its source:
// «npm run social -- speicher» was documented and dispatched but refused by the command list (12.11. to 13.11.2026)
const src = readFileSync(new URL("../scripts/social.mjs", import.meta.url), "utf8");

test("every command main() dispatches is accepted", () => {
  const list = JSON.parse(src.match(/export const COMMANDS = (\[[^\]]*\]);/)[1]);
  const body = src.slice(src.indexOf("async function main()"));
  const used = [...body.matchAll(/cmd === "([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(used.includes("speicher"));
  for (const c of used) assert.ok(list.includes(c), `${c} fehlt in COMMANDS`);
});

test("every command in the header comment is accepted", () => {
  const list = JSON.parse(src.match(/export const COMMANDS = (\[[^\]]*\]);/)[1]);
  const head = src.slice(0, src.indexOf("import "));
  for (const m of head.matchAll(/npm run social -- ([a-z-]+)/g)) assert.ok(list.includes(m[1]), `${m[1]} fehlt in COMMANDS`);
});
