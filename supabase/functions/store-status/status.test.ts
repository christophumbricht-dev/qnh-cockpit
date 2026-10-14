// Deno tests with mocked App Store Connect / iTunes / Codemagic APIs: npm run test:functions
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { ascToken, p8ToDer, storeStatus, type AscKey, type Deps } from "./status.ts";

const NOW = new Date("2026-10-20T10:00:00Z");
const BUNDLE = "ch.umbricht.downwind";

async function testKey(): Promise<{ key: AscKey; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join("\n");
  return { key: { issuer: "ISSUER", keyId: "KEY123", privateKey: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----` }, publicKey: pair.publicKey };
}

type Route = (url: URL, headers: Headers) => { status?: number; body: unknown };
function mockFetch(routes: Record<string, Route | unknown>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.origin + url.pathname);
    const key = Object.keys(routes).find((k) => (url.origin + url.pathname).startsWith(k));
    if (!key) return new Response(JSON.stringify({ errors: [{ detail: "no mock for " + url }] }), { status: 404 });
    const r = routes[key];
    const res = typeof r === "function" ? (r as Route)(url, new Headers(init?.headers)) : { body: r };
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const deps = (fetchFn: typeof fetch, over: Partial<Deps> = {}): Deps => ({ fetch: fetchFn, now: () => NOW, asc: null, codemagicToken: null, ...over });

const ascRoutes = (auth: string[] = []): Record<string, Route | unknown> => ({
  "https://itunes.apple.com/lookup": { resultCount: 0, results: [] },
  "https://api.appstoreconnect.apple.com/v1/apps/APP1/appStoreVersions": {
    data: [{ id: "v1", attributes: { versionString: "1.0", appVersionState: "PREPARE_FOR_SUBMISSION", platform: "IOS", createdDate: "2026-10-01T00:00:00Z" } }],
  },
  "https://api.appstoreconnect.apple.com/v1/apps/APP1/customerReviews": {
    data: [{ id: "rv1", attributes: { rating: 5, title: "Super", body: "Endlich ein Logbuch", reviewerNickname: "pilot1", createdDate: "2026-10-18T08:00:00Z", territory: "CHE" } }],
  },
  "https://api.appstoreconnect.apple.com/v1/apps": (url: URL, h: Headers) => {
    auth.push(h.get("Authorization") ?? "");
    assertEquals(url.searchParams.get("filter[bundleId]"), BUNDLE);
    return { body: { data: [{ id: "APP1", attributes: { name: "Downwind", bundleId: BUNDLE } }] } };
  },
  "https://api.appstoreconnect.apple.com/v1/builds": (url: URL) => {
    assertEquals(url.searchParams.get("filter[app]"), "APP1");
    return { body: {
      data: [
        { id: "b2", attributes: { version: "42", uploadedDate: "2026-10-19T12:00:00Z", processingState: "PROCESSING", expired: false },
          relationships: { preReleaseVersion: { data: { type: "preReleaseVersions", id: "pre1" } }, buildBetaDetail: { data: { type: "buildBetaDetails", id: "bd2" } } } },
        { id: "b1", attributes: { version: "41", uploadedDate: "2026-10-12T12:00:00Z", processingState: "VALID", expired: false },
          relationships: { preReleaseVersion: { data: { type: "preReleaseVersions", id: "pre1" } }, buildBetaDetail: { data: { type: "buildBetaDetails", id: "bd1" } } } },
      ],
      included: [
        { type: "preReleaseVersions", id: "pre1", attributes: { version: "0.9" } },
        { type: "buildBetaDetails", id: "bd1", attributes: { internalBuildState: "IN_BETA_TESTING", externalBuildState: "BETA_APPROVED" } },
        { type: "buildBetaDetails", id: "bd2", attributes: { internalBuildState: "PROCESSING", externalBuildState: "PROCESSING" } },
      ],
    } };
  },
  "https://api.appstoreconnect.apple.com/v1/betaTesters": { data: [{ id: "t1" }], meta: { paging: { total: 37, limit: 1 } } },
});

Deno.test("signs a valid ES256 token for App Store Connect", async () => {
  const { key, publicKey } = await testKey();
  const jwt = await ascToken(key, NOW);
  const [h, p, s] = jwt.split(".");
  const dec = (x: string) => JSON.parse(atob(x.replace(/-/g, "+").replace(/_/g, "/")));
  assertEquals(dec(h), { alg: "ES256", kid: "KEY123", typ: "JWT" });
  const payload = dec(p);
  assertEquals(payload.iss, "ISSUER");
  assertEquals(payload.aud, "appstoreconnect-v1");
  assertEquals(payload.exp - payload.iat, 900);
  const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  assertEquals(sig.length, 64);
  assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, sig, new TextEncoder().encode(`${h}.${p}`)));
});

Deno.test("accepts the .p8 key pasted with escaped line breaks or without header", async () => {
  const { key } = await testKey();
  const der = p8ToDer(key.privateKey);
  assertEquals(p8ToDer(key.privateKey.replace(/\n/g, "\\n")), der);
  assertEquals(p8ToDer(key.privateKey.replace(/-----[A-Z ]+-----/g, "")), der);
});

Deno.test("collects builds, versions, reviews and tester count", async () => {
  const { key } = await testKey();
  const auth: string[] = [];
  const { fn } = mockFetch(ascRoutes(auth));
  const out = await storeStatus(deps(fn, { asc: key }), [BUNDLE]);
  const app = out.apps[BUNDLE] as Record<string, any>;
  assertEquals(out.configured, { asc: true, codemagic: false });
  assertEquals(out.codemagic, null);
  assertEquals(app.errors, []);
  assertEquals(app.name, "Downwind");
  assertEquals(app.store, null);
  assertEquals(app.testers, 37);
  assertEquals(app.versions, [{ version: "1.0", state: "PREPARE_FOR_SUBMISSION", platform: "IOS", created: "2026-10-01T00:00:00Z" }]);
  assertEquals(app.builds[0], { version: "0.9", build: "42", uploaded: "2026-10-19T12:00:00Z", processing: "PROCESSING", expired: false, internal: "PROCESSING", external: "PROCESSING" });
  assertEquals(app.builds[1].external, "BETA_APPROVED");
  assertEquals(app.reviews[0].nick, "pilot1");
  assertMatch(auth[0], /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
});

Deno.test("without keys only the public App Store rating is fetched", async () => {
  const { fn, calls } = mockFetch({
    "https://itunes.apple.com/lookup": { resultCount: 1, results: [{ version: "1.2", averageUserRating: 4.7, userRatingCount: 23, trackViewUrl: "https://apps.apple.com/ch/app/id1" }] },
  });
  const out = await storeStatus(deps(fn), [BUNDLE]);
  assertEquals(calls, ["https://itunes.apple.com/lookup"]);
  assertEquals((out.apps[BUNDLE] as any).store, { version: "1.2", rating: 4.7, ratings: 23, url: "https://apps.apple.com/ch/app/id1" });
  assertEquals(out.configured, { asc: false, codemagic: false });
});

Deno.test("a missing review permission does not hide the builds", async () => {
  const { key } = await testKey();
  const routes = ascRoutes();
  routes["https://api.appstoreconnect.apple.com/v1/apps/APP1/customerReviews"] = () => ({ status: 403, body: { errors: [{ title: "Forbidden", detail: "role not allowed" }] } });
  const { fn } = mockFetch(routes);
  const app = (await storeStatus(deps(fn, { asc: key }), [BUNDLE])).apps[BUNDLE] as Record<string, any>;
  assertEquals(app.builds.length, 2);
  assertEquals(app.reviews, undefined);
  assertEquals(app.errors, ["App Store Connect: keine Berechtigung (403) – role not allowed"]);
});

Deno.test("unknown bundle id and broken key are reported, not thrown", async () => {
  const routes = ascRoutes();
  routes["https://api.appstoreconnect.apple.com/v1/apps"] = { data: [] };
  const { key } = await testKey();
  const { fn } = mockFetch(routes);
  const app = (await storeStatus(deps(fn, { asc: key }), ["ch.setqnh.secondseat"])).apps["ch.setqnh.secondseat"] as Record<string, any>;
  assertEquals(app.errors, ["App Store Connect: keine App mit ch.setqnh.secondseat"]);

  const broken = await storeStatus(deps(fn, { asc: { ...key, privateKey: "not a key" } }), [BUNDLE]);
  assertMatch((broken.apps[BUNDLE] as any).errors[0], /privater Schlüssel unlesbar/);
});

Deno.test("Codemagic builds: newest first, app names, short commit message", async () => {
  const { fn } = mockFetch({
    "https://itunes.apple.com/lookup": { results: [] },
    "https://api.codemagic.io/builds": (_url: URL, h: Headers) => {
      assertEquals(h.get("x-auth-token"), "CM");
      return { body: {
        applications: [{ _id: "cm1", appName: "downwind" }],
        builds: [
          { _id: "x1", appId: "cm1", status: "finished", fileWorkflowId: "ios-release", branch: "main", index: 40, startedAt: "2026-10-18T10:00:00Z", finishedAt: "2026-10-18T10:20:00Z", commit: { commitMessage: "Release 0.9\n\nlong text" } },
          { _id: "x3", appId: "cm1", status: "queued", fileWorkflowId: "ios-check", branch: "main", index: 42 },
          { _id: "x2", appId: "cm1", status: "failed", fileWorkflowId: "ios-check", branch: "feature", index: 41, startedAt: "2026-10-19T10:00:00Z" },
        ],
      } };
    },
  });
  const out = await storeStatus(deps(fn, { codemagicToken: "CM" }), [BUNDLE]);
  const builds = (out.codemagic as any).builds;
  assertEquals(builds.map((b: any) => b.id), ["x3", "x2", "x1"]);
  assertEquals(builds[2].message, "Release 0.9");
  assertEquals(builds[2].app, "downwind");
  assertEquals(builds[1].url, "https://codemagic.io/app/cm1/build/x2");
});

Deno.test("Codemagic error is reported next to the App Store data", async () => {
  const { fn } = mockFetch({ "https://itunes.apple.com/lookup": { results: [] }, "https://api.codemagic.io/builds": () => ({ status: 401, body: {} }) });
  const out = await storeStatus(deps(fn, { codemagicToken: "bad" }), [BUNDLE]);
  assertEquals(out.codemagic, { error: "Codemagic: Schlüssel ungültig oder abgelaufen (401)" });
});
