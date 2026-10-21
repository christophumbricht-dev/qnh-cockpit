// Minimal Meta Graph API client (Instagram API with Instagram Login + Facebook Pages, prepared).
// Change the API version only here.

export const GRAPH_VERSION = "v25.0";
export const IG_HOST = "https://graph.instagram.com";
export const FB_HOST = "https://graph.facebook.com";

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class GraphError extends Error {
  status: number;
  code?: number;
  subcode?: number;
  constructor(message: string, status: number, code?: number, subcode?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

// Network errors of fetch quote the full URL – which holds the token for GET/DELETE (and for debug_token /
// the token exchange also input_token, fb_exchange_token, client_secret). Never pass that on.
export const scrubToken = (text: string) => text.replace(/(access_token|input_token|fb_exchange_token|client_secret)=[^&\s)"']+/g, "$1=…");
async function send(fetchFn: FetchFn, url: URL, init: RequestInit, host: string) {
  try {
    return await fetchFn(url, init);
  } catch (err) {
    throw new Error(`Keine Verbindung zu ${new URL(host).host} (${scrubToken(err instanceof Error ? err.message : String(err)).slice(0, 200)}).`);
  }
}

export function graph(fetchFn: FetchFn, host: string, token: string) {
  async function call(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}) {
    const url = new URL(`${host}/${GRAPH_VERSION}/${path}`);
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) form.set(k, String(v));
    const init: RequestInit = { method };
    if (method !== "POST") { // GET, and DELETE as documented by Meta (parameters in the query)
      form.forEach((v, k) => url.searchParams.set(k, v));
      url.searchParams.set("access_token", token);
    } else {
      form.set("access_token", token); // in the body, so the token never shows up in URL logs
      init.body = form;
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    }
    const res = await send(fetchFn, url, init, host);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      const e = body?.error ?? {};
      throw new GraphError(scrubToken(e.error_user_msg || e.message || `HTTP ${res.status}`), res.status, e.code, e.error_subcode);
    }
    return body;
  }
  return {
    get: (path: string, params?: Params) => call("GET", path, params),
    post: (path: string, params?: Params) => call("POST", path, params),
    del: (path: string, params?: Params) => call("DELETE", path, params),
  };
}

// Long-lived Instagram tokens (60 days) are refreshed without the version prefix.
export async function refreshInstagramToken(fetchFn: FetchFn, token: string): Promise<{ token: string; expiresIn: number }> {
  const url = new URL(`${IG_HOST}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const res = await send(fetchFn, url, { method: "GET" }, IG_HOST);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error || !body?.access_token) {
    throw new GraphError(scrubToken(body?.error?.message ?? `HTTP ${res.status}`), res.status, body?.error?.code);
  }
  return { token: body.access_token, expiresIn: Number(body.expires_in) || 60 * 86400 };
}
