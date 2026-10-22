import test from "node:test";
import assert from "node:assert/strict";
import { byFilter, costSummary, isGerman, monthKey, monthName, openCount, parseWatch, settingsPatch, tokenDays, usd, watchLabel, web } from "../src/social/outreach.js";

test("parseWatch: @names, profile links and #hashtags, cleaned like the database wants them", () => {
  assert.deepEqual(parseWatch("@MeteoSuisse"), { kind: "account", value: "meteosuisse" });
  assert.deepEqual(parseWatch("  angleofattack "), { kind: "account", value: "angleofattack" });
  assert.deepEqual(parseWatch("https://www.instagram.com/redbullxalps/?hl=de"), { kind: "account", value: "redbullxalps" });
  assert.deepEqual(parseWatch("#Föhn"), { kind: "hashtag", value: "föhn" });
  assert.deepEqual(parseWatch("#lenticularclouds"), { kind: "hashtag", value: "lenticularclouds" });
  assert.throws(() => parseWatch(""), /eingeben/);
  assert.throws(() => parseWatch("Meteo Suisse"), /Buchstaben/);
  assert.throws(() => parseWatch("#two words"), /einzelnes Wort/);
  assert.throws(() => parseWatch("@" + "a".repeat(31)), /höchstens 30/);
  assert.equal(watchLabel({ kind: "hashtag", value: "föhn" }), "#föhn");
  assert.equal(watchLabel({ kind: "account", value: "meteosuisse" }), "@meteosuisse");
});

test("only https links from Meta are used", () => {
  assert.equal(web("https://www.instagram.com/p/x/"), "https://www.instagram.com/p/x/");
  assert.equal(web("javascript:alert(1)"), null);
  assert.equal(web("http://insecure"), null);
  assert.equal(web(null), null);
});

test("lists: open suggestions, newest first; done by the time they were done", () => {
  const items = [
    { id: "a", status: "proposed", drafted_at: "2026-10-21T05:00:00Z" },
    { id: "b", status: "proposed", drafted_at: "2026-10-21T13:00:00Z" },
    { id: "c", status: "done", drafted_at: "2026-10-20T05:00:00Z", done_at: "2026-10-21T09:00:00Z" },
    { id: "d", status: "done", drafted_at: "2026-10-21T05:00:00Z", done_at: "2026-10-21T08:00:00Z" },
    { id: "e", status: "dismissed", drafted_at: "2026-10-19T05:00:00Z" },
  ];
  assert.equal(openCount(items), 2);
  assert.deepEqual(byFilter(items, "proposed").map((i) => i.id), ["b", "a"]);
  assert.deepEqual(byFilter(items, "done").map((i) => i.id), ["c", "d"]);
});

test("money: small amounts stay readable", () => {
  assert.equal(usd(0), "0 USD");
  assert.equal(usd(0.0004), "< 0.001 USD");
  assert.equal(usd(0.0081), "0.008 USD");
  assert.equal(usd(0.0228), "0.02 USD");
  assert.equal(usd("2.314"), "2.31 USD");
});

test("costSummary: this and last month in Swiss time, share of the budget, the year", () => {
  const rows = [
    { month: "2026-10", calls: 90, suggestions: 80, usd: "2.5" },
    { month: "2026-09", calls: 40, suggestions: 35, usd: "1.1" },
    { month: "2025-12", calls: 5, suggestions: 5, usd: "0.2" },
  ];
  const s = costSummary(rows, "10.00", new Date("2026-10-21T08:00:00Z"));
  assert.equal(s.thisMonth.usd, 2.5);
  assert.equal(s.lastMonth.month, "2026-09");
  assert.equal(s.share, 0.25);
  assert.equal(Math.round(s.year * 100) / 100, 3.6);
  assert.deepEqual(s.months.map((m) => m.month), ["2026-10", "2026-09", "2025-12"]);
  // 31 Oct 23:30 UTC is already November in Zurich: nothing spent yet this month
  const n = costSummary(rows, 10, new Date("2026-10-31T23:30:00Z"));
  assert.equal(n.thisMonth.month, "2026-11");
  assert.equal(n.thisMonth.usd, 0);
  assert.equal(n.lastMonth.usd, 2.5);
  assert.equal(costSummary([], 0).share, 0);
  assert.equal(monthName("2026-03"), "März 2026");
  assert.equal(monthKey(new Date("2026-03-31T22:30:00Z")), "2026-04");
});

test("settings: limits are checked before saving", () => {
  assert.deepEqual(settingsPatch({ daily_limit: "12", monthly_budget_usd: "7,5", model: "claude-haiku-5-5", rules: "  Keine Emojis. " }),
    { daily_limit: 12, monthly_budget_usd: 7.5, model: "claude-haiku-5-5", rules: "Keine Emojis." });
  assert.throws(() => settingsPatch({ daily_limit: 0, monthly_budget_usd: 5, model: "claude-sonnet-5-5" }), /pro Tag/);
  assert.throws(() => settingsPatch({ daily_limit: 5, monthly_budget_usd: 900, model: "claude-sonnet-5-5" }), /Budget/);
  assert.throws(() => settingsPatch({ daily_limit: 5, monthly_budget_usd: "", model: "claude-sonnet-5-5" }), /eingeben/);
  assert.throws(() => settingsPatch({ daily_limit: 5, monthly_budget_usd: "zehn", model: "claude-sonnet-5-5" }), /Budget/);
  assert.equal(settingsPatch({ daily_limit: 5, monthly_budget_usd: " 12.50 ", model: "claude-sonnet-5-5" }).monthly_budget_usd, 12.5);
  assert.throws(() => settingsPatch({ daily_limit: 5, monthly_budget_usd: 5, model: "gpt" }), /Modell/);
  assert.equal(tokenDays("2026-11-01T00:00:00Z", Date.parse("2026-10-21T00:00:00Z")), 11);
  assert.equal(tokenDays(null), null);
});

test("isGerman: hides «Auf Deutsch» for German suggestions only", () => {
  assert.equal(isGerman("Wahnsinn, 5200 m im Jura! Spannend, wie die stabile Luft hinter dem Kamm schwingt."), true);
  assert.equal(isGerman("Was für ein Tag, das Licht ist mega schön."), true);
  assert.equal(isGerman("Those stacked lenses mark a standing wave over the ridge."), false);
  assert.equal(isGerman("Quelle belle mer de brouillard, l'inversion est parfaite !"), false);
  assert.equal(isGerman(""), false);
});
