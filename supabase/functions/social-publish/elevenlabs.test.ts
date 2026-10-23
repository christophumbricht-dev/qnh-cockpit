import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { elevenlabsCredits } from "./elevenlabs.ts";

const reply = (status: number, body: unknown) => (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

Deno.test("ElevenLabs credits: used, limit and reset date; no key → not configured", async () => {
  assertEquals(await elevenlabsCredits(reply(200, {}), undefined), { configured: false });
  const c = await elevenlabsCredits(reply(200, { tier: "starter", character_count: 2900, character_limit: 30000, next_character_count_reset_unix: 1795000000 }), "k");
  assertEquals(c, { configured: true, tier: "starter", used: 2900, limit: 30000, reset_at: new Date(1795000000 * 1000).toISOString() });
});

Deno.test("ElevenLabs credits: a refused key gives a German hint, never the key", async () => {
  const c = await elevenlabsCredits(reply(401, { detail: { status: "missing_permissions" } }), "sk_secret_value");
  assertMatch(c.error!, /User → Read/);
  assertEquals(JSON.stringify(c).includes("sk_secret_value"), false);
});
