// ElevenLabs credits for the cockpit (Finanzen → API-Verbrauch). Uses its own read-only key
// (ELEVENLABS_READ_KEY, permission «User → Read» only) – the voice key on Christoph's PC stays there.
type FetchFn = typeof fetch;

export type Credits = {
  configured: boolean;
  tier?: string;
  used?: number;
  limit?: number;
  reset_at?: string | null;
  error?: string;
};

export async function elevenlabsCredits(fetchFn: FetchFn, key: string | undefined): Promise<Credits> {
  if (!key) return { configured: false };
  let res: Response;
  try {
    res = await fetchFn("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15_000) });
  } catch {
    return { configured: true, error: "Keine Verbindung zu ElevenLabs." };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = res.status === 401 ? "Schlüssel ungültig oder ohne Berechtigung «User → Read»." : `HTTP ${res.status}`;
    return { configured: true, error: `ElevenLabs: ${why}` };
  }
  const reset = Number(body.next_character_count_reset_unix);
  return {
    configured: true,
    tier: String(body.tier ?? ""),
    used: Number(body.character_count) || 0,
    limit: Number(body.character_limit) || 0,
    reset_at: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null,
  };
}
