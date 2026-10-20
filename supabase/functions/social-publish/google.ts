// Minimal Google OAuth + YouTube Data API v3 client (no SDK). The refresh token of a channel lives in Vault;
// every run trades it for a short-lived access token. Client ID/secret are Edge Function secrets
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (docs/social-setup.md, «YouTube verbinden»).

import type { FetchFn } from "./graph.ts";

export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
export const YT_API = "https://www.googleapis.com/youtube/v3";
export const YT_UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
// upload videos + read/write comments on our own channel (force-ssl also covers channels.list mine=true)
export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"];

export type GoogleConfig = { clientId: string; clientSecret: string };

export class GoogleError extends Error {
  status: number;
  reason?: string;
  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

// JSON body of a Google response, or a GoogleError (also used for the upload session in youtube.ts)
export async function parse(res: Response) {
  if (res.status === 204) return {};
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    // OAuth errors: { error: "invalid_grant", error_description }; API errors: { error: { message, errors: [{ reason }] } }
    const e = body?.error;
    if (typeof e === "string") throw new GoogleError(body.error_description || e, res.status, e);
    throw new GoogleError(e?.message || `HTTP ${res.status}`, res.status, e?.errors?.[0]?.reason ?? e?.status);
  }
  return body;
}

export function authUrl(cfg: GoogleConfig, redirectUri: string, state: string): string {
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YT_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline"); // we need a refresh token for the cron
  url.searchParams.set("prompt", "consent select_account"); // always a fresh refresh token; pick the channel's account
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields),
});

export async function exchangeCode(fetchFn: FetchFn, cfg: GoogleConfig, code: string, redirectUri: string) {
  const body = await parse(await fetchFn(GOOGLE_TOKEN, form({
    code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
  })));
  return { accessToken: String(body.access_token ?? ""), refreshToken: body.refresh_token ? String(body.refresh_token) : null, scope: String(body.scope ?? "") };
}

export async function accessToken(fetchFn: FetchFn, cfg: GoogleConfig, refreshToken: string): Promise<string> {
  const body = await parse(await fetchFn(GOOGLE_TOKEN, form({
    refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token",
  })));
  return String(body.access_token);
}

type Params = Record<string, string | number | boolean | undefined | null>;

export function youtube(fetchFn: FetchFn, token: string) {
  async function call(method: string, path: string, params: Params = {}, json?: unknown) {
    const url = new URL(`${YT_API}/${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) } };
    if (json) init.body = JSON.stringify(json);
    return parse(await fetchFn(url, init));
  }
  return {
    get: (path: string, params?: Params) => call("GET", path, params),
    post: (path: string, params?: Params, json?: unknown) => call("POST", path, params, json),
    del: (path: string, params?: Params) => call("DELETE", path, params),
  };
}
export type YouTube = ReturnType<typeof youtube>;

export function googleGerman(err: GoogleError): string {
  if (err.reason === "invalid_grant") return "Der YouTube-Zugang wurde entzogen oder ist abgelaufen. Im Cockpit unter Social → Konten «YouTube verbinden» neu ausführen.";
  if (err.reason === "quotaExceeded") return "Das YouTube-Tageskontingent ist aufgebraucht (es setzt um Mitternacht pazifischer Zeit zurück, ca. 09:00 Schweizer Zeit).";
  if (err.reason === "insufficientPermissions" || (err.status === 403 && /scope|permission/i.test(err.message))) return "Dem YouTube-Zugang fehlt eine Berechtigung – «YouTube verbinden» neu ausführen und alle Häkchen setzen.";
  if (err.reason === "commentsDisabled") return "Bei diesem Video sind Kommentare ausgeschaltet.";
  return `YouTube meldet: ${err.message}`;
}
