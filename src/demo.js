// Invented sample data for ?demo (layout checks without signing in).

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

const fb = [
  { id: "f1", created_at: ago(35), text: "The replay of my flight stops after the first circuit. Recorded with the iPhone, 1 h 10 min flight.", app_version: "0.9.3 (41)", device: "iPhone 16 Pro, iOS 26.0", screenshot_path: "demo.jpg", status: "new", pilot: "Demo Pilot A" },
  { id: "f2", created_at: ago(60 * 20), text: "Love the Pilot Form! Could we get the logbook export as PDF?", app_version: "0.9.3 (41)", device: "iPhone 15, iOS 26.0", screenshot_path: null, status: "new", pilot: "Demo Pilot B" },
  { id: "f3", created_at: ago(60 * 24 * 4), text: "Typo in the German settings: «Benachrichtigungn».", app_version: "0.9.2 (38)", device: "iPhone 13 mini, iOS 18.6", screenshot_path: null, status: "done", pilot: "Demo Pilot C" },
];

const errs = [
  { message: "TypeError: Cannot read properties of undefined (reading 'lat')", n: 14, users: 3, last_at: ago(50), versions: ["0.9.3 (41)"], platforms: ["ios"], stack: "TypeError: Cannot read properties of undefined (reading 'lat')\n    at drawMap (map/draw.js:212:18)\n    at viewDetail (feed/detail.js:88:5)" },
  { message: "Weather: METAR fetch timed out", n: 4, users: 2, last_at: ago(60 * 9), versions: ["0.9.3 (41)", "0.9.2 (38)"], platforms: ["ios", "web"], stack: null },
];

const betaRows = [
  { id: "b1", first_name: "Anna", last_name: "Beispiel", email: "anna@example.com", source: "instagram", note: "Fliege in Birrfeld, DA40.", lang: "de", status: "new", created_at: ago(90), handled_at: null },
  { id: "b2", first_name: "Marc", last_name: "Muster", email: "marc@example.com", source: "club", note: "", lang: "de", status: "new", created_at: ago(60 * 30), handled_at: null },
  { id: "b3", first_name: "Laura", last_name: "Test", email: "laura@example.com", source: "airfield", note: "", lang: "en", status: "invited", created_at: ago(60 * 24 * 3), handled_at: ago(60 * 24 * 2) },
];

const delay = (v) => new Promise((r) => setTimeout(() => r(structuredClone(v)), 150));

export const stats = () => delay({
  pilots: 37, pilots_7d: 5, active_7d: 14, flights_7d: 29, flights: 412,
  beta_new: betaRows.filter((b) => b.status === "new").length, beta_total: betaRows.length,
  feedback_new: fb.filter((f) => f.status === "new").length, errors_24h: 14, errors_7d: 18,
});
export const feedback = () => delay(fb);
export const errors = () => delay(errs);
export const beta = () => delay(betaRows);

const verifs = [
  { id: "v1", user_id: "u1", name: "Demo Pilot D", kind: "instructor", target: "", contact_email: "", message: "FI(A) since 2019, Birrfeld.", doc_path: "demo.jpg", expires_on: "2028-04-30", status: "pending", reason: "", created_at: ago(60 * 5), reviewed_at: null },
  { id: "v2", user_id: "u2", name: "Demo Flugplatz", kind: "airfield", target: "LSZF", contact_email: "info@example.com", message: "Official account of the airfield.", doc_path: null, expires_on: null, status: "pending", reason: "", created_at: ago(60 * 30), reviewed_at: null },
  { id: "v3", user_id: "u3", name: "Demo Club", kind: "club", target: "c1", target_name: "Demo Fluggruppe", contact_email: "", message: "", doc_path: null, expires_on: null, status: "approved", reason: "", created_at: ago(60 * 24 * 6), reviewed_at: ago(60 * 24 * 5) },
];

const reps = [
  { id: "r1", created_at: ago(120), status: "open", reason: "Spam link in the comment", action: null, handled_at: null, reporter: "DEMO1",
    target: { kind: "comment", id: "c9", preview: "Cheap headsets here: example.com", hidden: false }, author: { id: "u9", name: "SPAMMER", banned: false } },
  { id: "r2", created_at: ago(60 * 24 * 3), status: "dismissed", reason: "Wrong airfield", action: "dismiss", handled_at: ago(60 * 24 * 2), reporter: "DEMO2",
    target: { kind: "flight", id: "f9", preview: "Evening circuit · LSZF → LSZF", hidden: false }, author: { id: "u8", name: "HB-DEMO", banned: false } },
];

// invented, deterministic daily series that grows slowly
export function timeseries(days) {
  let seed = 7, total = 12;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const weekend = [0, 6].includes(d.getDay());
    const growth = 1 + (days - i) / days;
    const pilots_new = rnd() < 0.18 * growth ? 1 + Math.floor(rnd() * 2) : 0;
    total += pilots_new;
    rows.push({ day: d.toISOString().slice(0, 10), pilots_new, pilots_total: total,
      flights: Math.floor(rnd() * (weekend ? 7 : 3) * growth), active: Math.floor(rnd() * (weekend ? 5 : 2) * growth),
      errors: rnd() < 0.15 ? Math.floor(rnd() * 6) : 0, feedback: rnd() < 0.08 ? 1 : 0, beta: rnd() < 0.2 ? 1 : 0 });
  }
  return delay(rows);
}

export const verifications = () => delay(verifs);
export const reports = () => delay(reps);

export function reviewVerification(id, approve, reason) {
  const row = verifs.find((v) => v.id === id);
  if (row) Object.assign(row, { status: approve ? "approved" : "rejected", reason, reviewed_at: new Date().toISOString(), doc_path: null });
  return delay(null);
}
export function moderate(id, action) {
  const row = reps.find((r) => r.id === id);
  if (row) {
    Object.assign(row, { status: action === "dismiss" ? "dismissed" : "actioned", action, handled_at: new Date().toISOString() });
    if (action === "hide" || action === "unhide") row.target.hidden = action === "hide";
    if (action === "ban" || action === "unban") row.author.banned = action === "ban";
  }
  return delay(null);
}

export function setFeedbackStatus(id, status) {
  const row = fb.find((f) => f.id === id);
  if (row) row.status = status;
  return delay(null);
}
export function setBetaStatus(id, status) {
  const row = betaRows.find((b) => b.id === id);
  if (row) row.status = status;
  return delay(null);
}
