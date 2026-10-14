// ?demo: invented store status.
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();

export function demoStatus(bundleIds) {
  const apps = Object.fromEntries(bundleIds.map((b) => [b, {
    bundle_id: b, name: "Downwind", errors: [], store: null, testers: 37,
    versions: [{ version: "1.0", state: "PREPARE_FOR_SUBMISSION", platform: "IOS", created: ago(24 * 9) }],
    builds: [
      { version: "0.9", build: "58", uploaded: ago(3), processing: "PROCESSING", expired: false, internal: "PROCESSING", external: "PROCESSING" },
      { version: "0.9", build: "57", uploaded: ago(50), processing: "VALID", expired: false, internal: "IN_BETA_TESTING", external: "IN_BETA_TESTING" },
      { version: "0.8", build: "51", uploaded: ago(24 * 12), processing: "VALID", expired: false, internal: "IN_BETA_TESTING", external: "BETA_APPROVED" },
      { version: "0.7", build: "44", uploaded: ago(24 * 40), processing: "VALID", expired: true, internal: "EXPIRED", external: "EXPIRED" },
    ],
    reviews: [],
  }]));
  return new Promise((r) => setTimeout(() => r({
    fetched_at: new Date().toISOString(),
    configured: { asc: true, codemagic: true },
    apps,
    codemagic: { builds: [
      { id: "c3", app: "downwind", workflow: "ios-release", status: "finished", branch: "main", index: 58, started: ago(3.5), finished: ago(3.2), message: "Logbuch: Export als CSV", url: "https://codemagic.io/apps" },
      { id: "c2", app: "downwind", workflow: "ios-check", status: "failed", branch: "feature/widget", index: 57, started: ago(20), finished: ago(19.8), message: "Widget: neue Grösse", url: "https://codemagic.io/apps" },
      { id: "c1", app: "downwind", workflow: "ios-release", status: "finished", branch: "main", index: 56, started: ago(50), finished: ago(49.7), message: "Beta 0.9", url: "https://codemagic.io/apps" },
    ] },
  }), 150));
}
