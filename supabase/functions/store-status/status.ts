// App Store Connect + Codemagic status for the cockpit. Pure logic: all I/O goes through Deps.fetch,
// so the tests can mock both APIs.

export type AscKey = { issuer: string; keyId: string; privateKey: string };
export type Deps = {
  fetch: typeof fetch;
  now: () => Date;
  asc: AscKey | null;
  codemagicToken: string | null;
};

const ASC = "https://api.appstoreconnect.apple.com";
const enc = encodeURIComponent;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

// The .p8 file pasted as a secret: with or without BEGIN/END lines, real or escaped (\n) line breaks.
export function p8ToDer(p8: string): Uint8Array<ArrayBuffer> {
  const body = p8.replace(/-----[A-Z ]+-----/g, "").replace(/\\n/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

// ES256 JWT for the App Store Connect API (valid 15 min; Apple allows at most 20).
export async function ascToken(key: AscKey, now: Date): Promise<string> {
  const k = await crypto.subtle.importKey("pkcs8", p8ToDer(key.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(now.getTime() / 1000);
  const unsigned = `${b64urlJson({ alg: "ES256", kid: key.keyId, typ: "JWT" })}.${b64urlJson({ iss: key.issuer, iat, exp: iat + 15 * 60, aud: "appstoreconnect-v1" })}`;
  // WebCrypto returns r||s (IEEE P1363), which is exactly the JWS format
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, new TextEncoder().encode(unsigned)));
  return `${unsigned}.${b64url(sig)}`;
}

async function getJson(deps: Deps, url: string, headers: Record<string, string>, label: string) {
  const r = await deps.fetch(url, { headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j?.errors?.[0];
    if (r.status === 401) throw new Error(`${label}: Schlüssel ungültig oder abgelaufen (401)`);
    if (r.status === 403) throw new Error(`${label}: keine Berechtigung (403)${e?.detail ? ` – ${e.detail}` : ""}`);
    throw new Error(`${label}: ${e?.detail ?? e?.title ?? j?.message ?? `HTTP ${r.status}`}`);
  }
  return j;
}

type Included = { type: string; id: string; attributes?: Record<string, unknown> };
const findIncluded = (list: Included[] | undefined, rel: { data?: { type: string; id: string } | null } | undefined) =>
  rel?.data ? list?.find((x) => x.type === rel.data!.type && x.id === rel.data!.id)?.attributes : undefined;

export async function appStatus(deps: Deps, token: string | null, bundleId: string) {
  const out: Record<string, unknown> = { bundle_id: bundleId, errors: [] as string[] };
  const errors = out.errors as string[];

  // public App Store rating (only once the app is released; no key needed)
  try {
    const j = await getJson(deps, `https://itunes.apple.com/lookup?bundleId=${enc(bundleId)}&country=ch`, {}, "App Store");
    const r = j.results?.[0];
    out.store = r ? { version: r.version ?? null, rating: r.averageUserRating ?? null, ratings: r.userRatingCount ?? 0, url: r.trackViewUrl ?? null } : null;
  } catch (e) {
    errors.push(msg(e));
  }
  if (!token) return out;

  const asc = (path: string) => getJson(deps, ASC + path, { Authorization: `Bearer ${token}` }, "App Store Connect");
  let app;
  try {
    app = (await asc(`/v1/apps?filter[bundleId]=${enc(bundleId)}&fields[apps]=name,bundleId&limit=1`)).data?.[0];
  } catch (e) {
    errors.push(msg(e));
    return out;
  }
  if (!app) {
    errors.push(`App Store Connect: keine App mit ${bundleId}`);
    return out;
  }
  out.asc_id = app.id;
  out.name = app.attributes?.name ?? null;

  const [versions, builds, reviews, testers] = await Promise.allSettled([
    asc(`/v1/apps/${app.id}/appStoreVersions?limit=3&fields[appStoreVersions]=versionString,appStoreState,appVersionState,createdDate,platform`),
    asc(`/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=6&include=preReleaseVersion,buildBetaDetail` +
      `&fields[builds]=version,uploadedDate,processingState,expired,preReleaseVersion,buildBetaDetail` +
      `&fields[preReleaseVersions]=version&fields[buildBetaDetails]=internalBuildState,externalBuildState`),
    asc(`/v1/apps/${app.id}/customerReviews?sort=-createdDate&limit=5&fields[customerReviews]=rating,title,body,reviewerNickname,createdDate,territory`),
    asc(`/v1/betaTesters?filter[apps]=${app.id}&limit=1&fields[betaTesters]=state`),
  ]);
  const ok = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : (errors.push(msg(r.reason)), null));

  const v = ok(versions);
  if (v) out.versions = (v.data ?? []).map((x: { attributes: Record<string, string> }) => ({
    version: x.attributes.versionString, state: x.attributes.appVersionState ?? x.attributes.appStoreState, platform: x.attributes.platform, created: x.attributes.createdDate,
  }));
  const b = ok(builds);
  if (b) out.builds = (b.data ?? []).map((x: { attributes: Record<string, unknown>; relationships?: Record<string, { data?: { type: string; id: string } }> }) => {
    const pre = findIncluded(b.included, x.relationships?.preReleaseVersion);
    const beta = findIncluded(b.included, x.relationships?.buildBetaDetail);
    return {
      version: pre?.version ?? null, build: x.attributes.version, uploaded: x.attributes.uploadedDate, processing: x.attributes.processingState,
      expired: x.attributes.expired === true, internal: beta?.internalBuildState ?? null, external: beta?.externalBuildState ?? null,
    };
  });
  const r = ok(reviews);
  if (r) out.reviews = (r.data ?? []).map((x: { id: string; attributes: Record<string, unknown> }) => ({
    id: x.id, rating: x.attributes.rating, title: x.attributes.title ?? "", body: x.attributes.body ?? "", nick: x.attributes.reviewerNickname ?? "", date: x.attributes.createdDate, territory: x.attributes.territory ?? "",
  }));
  const t = ok(testers);
  if (t) out.testers = t.meta?.paging?.total ?? (t.data ?? []).length;
  return out;
}

export async function codemagicBuilds(deps: Deps) {
  const j = await getJson(deps, "https://api.codemagic.io/builds", { "x-auth-token": deps.codemagicToken! }, "Codemagic");
  const names = new Map<string, string>((j.applications ?? []).map((a: { _id: string; appName: string }) => [a._id, a.appName]));
  const when = (x: Record<string, string>) => x.startedAt ?? x.createdAt ?? "";
  return (j.builds ?? [])
    .slice()
    .sort((a: Record<string, string>, b: Record<string, string>) => (!when(a) ? -1 : !when(b) ? 1 : when(b).localeCompare(when(a))))
    .slice(0, 15)
    .map((x: Record<string, any>) => ({
      id: x._id, app: names.get(x.appId) ?? null, workflow: x.fileWorkflowId ?? x.workflowId ?? null, status: x.status, branch: x.branch ?? null,
      index: x.index ?? null, started: x.startedAt ?? null, finished: x.finishedAt ?? null,
      message: typeof x.commit?.commitMessage === "string" ? x.commit.commitMessage.split("\n")[0].slice(0, 120) : null,
      url: `https://codemagic.io/app/${x.appId}/build/${x._id}`,
    }));
}

export const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{2,154}$/;

export async function storeStatus(deps: Deps, bundleIds: string[]) {
  let token: string | null = null;
  let ascError: string | null = null;
  if (deps.asc) {
    try { token = await ascToken(deps.asc, deps.now()); } catch (e) { ascError = `App Store Connect: privater Schlüssel unlesbar (${msg(e)})`; }
  }
  const [apps, codemagic] = await Promise.all([
    Promise.all(bundleIds.map((b) => appStatus(deps, token, b))),
    deps.codemagicToken ? codemagicBuilds(deps).then((builds) => ({ builds }), (e) => ({ error: msg(e) })) : Promise.resolve(null),
  ]);
  if (ascError) for (const a of apps) (a.errors as string[]).unshift(ascError);
  return {
    fetched_at: deps.now().toISOString(),
    configured: { asc: Boolean(deps.asc), codemagic: Boolean(deps.codemagicToken) },
    apps: Object.fromEntries(apps.map((a) => [a.bundle_id as string, a])),
    codemagic,
  };
}
