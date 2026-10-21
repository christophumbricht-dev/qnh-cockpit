// «Bei anderen»: pure helpers (unit-tested in tests/social-outreach.test.mjs).
// Suggestions for comments under posts of other creators – Christoph posts them himself in the Instagram app.

export const MODELS = [
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (empfohlen)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (günstig)"],
  ["claude-opus-5-5", "Claude Opus 5.5 (teuer)"],
];
export const DAILY_MAX = 30;
export const BUDGET_MAX = 500;
export const FILTERS = [["proposed", "Vorschläge"], ["done", "Erledigt"], ["dismissed", "Verworfen"]];

// same rules as the database (migration 20261021140000_social_outreach.sql)
const ACCOUNT = /^[a-z0-9._]{1,30}$/;
const BAD_TAG = /[\s#@,;/]/;

// «@MeteoSuisse», «instagram.com/meteosuisse/», «#Föhn» → { kind, value }; throws a German message otherwise
export function parseWatch(input) {
  let s = String(input ?? "").trim();
  if (!s) throw new Error("Account (@name) oder Hashtag (#wort) eingeben.");
  const url = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
  if (url) s = `@${url[1]}`;
  if (s.startsWith("#")) {
    const value = s.slice(1).trim().toLowerCase();
    if (!value || value.length > 100 || BAD_TAG.test(value)) throw new Error("Ein Hashtag ist ein einzelnes Wort ohne Leerzeichen, z. B. #föhn.");
    return { kind: "hashtag", value };
  }
  const value = s.replace(/^@/, "").trim().toLowerCase();
  if (!ACCOUNT.test(value)) throw new Error("Ein Instagram-Name hat nur Buchstaben, Ziffern, Punkt und Unterstrich (höchstens 30), z. B. @meteosuisse.");
  return { kind: "account", value };
}
export const watchLabel = (w) => `${w.kind === "hashtag" ? "#" : "@"}${w.value}`;

// only http(s) links from Meta become href / src
export const web = (url) => (/^https:\/\//i.test(String(url ?? "")) ? url : null);

export const openCount = (items) => (items ?? []).filter((i) => i.status === "proposed").length;
export const byFilter = (items, filter) => (items ?? [])
  .filter((i) => i.status === filter)
  .sort((a, b) => String(filter === "done" ? b.done_at ?? "" : b.drafted_at ?? "").localeCompare(String(filter === "done" ? a.done_at ?? "" : a.drafted_at ?? "")));

// «2.31 USD», «0.004 USD», «< 0.001 USD»
export function usd(n) {
  const v = Number(n) || 0;
  if (v === 0) return "0 USD";
  if (v < 0.001) return "< 0.001 USD";
  if (v < 0.01) return `${v.toFixed(3)} USD`;
  return `${v.toFixed(2)} USD`;
}

// month key «2026-10» of a date in Swiss time
export const monthKey = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).format(new Date(d)).slice(0, 7);
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monthName = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`;

// rows of outreach_cost_months → this month, last month, share of the budget, older months (newest first)
export function costSummary(rows, budget, now = new Date()) {
  const list = [...(rows ?? [])].map((r) => ({ month: r.month, calls: Number(r.calls) || 0, suggestions: Number(r.suggestions) || 0, usd: Number(r.usd) || 0 }))
    .sort((a, b) => b.month.localeCompare(a.month));
  const cur = monthKey(now);
  const [y, m] = cur.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const empty = (month) => ({ month, calls: 0, suggestions: 0, usd: 0 });
  const thisMonth = list.find((r) => r.month === cur) ?? empty(cur);
  const lastMonth = list.find((r) => r.month === prev) ?? empty(prev);
  const b = Number(budget) || 0;
  const share = b > 0 ? Math.min(1, thisMonth.usd / b) : thisMonth.usd > 0 ? 1 : 0;
  const year = list.filter((r) => r.month.startsWith(cur.slice(0, 4))).reduce((s, r) => s + r.usd, 0);
  return { thisMonth, lastMonth, budget: b, share, year, months: list.slice(0, 12) };
}

// days until the Facebook token expires (null = unknown / never)
export const tokenDays = (iso, now = Date.now()) => (iso ? Math.floor((new Date(iso).getTime() - now) / 864e5) : null);

// settings form → checked patch, or a German error
export function settingsPatch({ daily_limit, monthly_budget_usd, model, rules }) {
  const limit = Number(daily_limit), budget = Number(String(monthly_budget_usd).replace(",", "."));
  if (!Number.isInteger(limit) || limit < 1 || limit > DAILY_MAX) throw new Error(`Vorschläge pro Tag: 1 bis ${DAILY_MAX}.`);
  if (!Number.isFinite(budget) || budget < 0 || budget > BUDGET_MAX) throw new Error(`Budget pro Monat: 0 bis ${BUDGET_MAX} USD.`);
  if (!MODELS.some(([m]) => m === model)) throw new Error("Unbekanntes Modell.");
  const r = String(rules ?? "").trim();
  if (r.length > 2000) throw new Error("Zusatzregeln: höchstens 2000 Zeichen.");
  return { daily_limit: limit, monthly_budget_usd: Math.round(budget * 100) / 100, model, rules: r };
}
