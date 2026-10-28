// Social → Statistik (28.10.2026, Christoph: «schöne Graphen, Finanzen pro Viewer, Ziel bis zur kommerziellen Nutzung»).
// Pure helpers, tested in tests/growth.test.mjs: daily series for the charts, cost per viewer from Finanzen, and the
// way to monetisation with a forecast at the current pace.
import { monthly } from "../finance/calc.js";

// account day rows ([{ day, metrics }], ascending) → periods for chartSvg ({ from, to, value })
export function daySeries(rows, pick) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const v = pick(rows[i], rows[i - 1]);
    if (v == null || !Number.isFinite(v)) continue;
    out.push({ key: rows[i].day, from: rows[i].day, to: rows[i].day, days: 1, value: v });
  }
  return out;
}
export const metric = (k) => (r) => (r.metrics?.[k] == null ? null : Number(r.metrics[k]));
// a running total (YouTube views_total) → what was added that day; a day after a gap or a drop counts nothing
export const dailyGain = (k) => (r, prev) => {
  if (!prev || r.metrics?.[k] == null || prev.metrics?.[k] == null) return null;
  const gap = (Date.parse(`${r.day}T12:00:00Z`) - Date.parse(`${prev.day}T12:00:00Z`)) / 864e5;
  return gap === 1 ? Math.max(0, Number(r.metrics[k]) - Number(prev.metrics[k])) : null;
};

// monthly costs of one app from Finanzen (active costs with that scope), per currency
export function costPerMonth(costs, appId) {
  const out = {};
  for (const c of costs ?? []) if (c.active !== false && c.scope === appId && c.interval !== "once") out[c.currency] = (out[c.currency] ?? 0) + monthly(c);
  return out;
}
// CHF per 1'000 views and per new follower, on a 30-day basis; null when there is nothing to divide by
export function costPer(chfPerMonth, viewsInPeriod, followersGained, days) {
  if (!chfPerMonth || !days) return { perThousandViews: null, perFollower: null };
  const per30 = (n) => (n > 0 ? (n / days) * 30 : 0);
  const v = per30(viewsInPeriod), f = per30(followersGained);
  return { perThousandViews: v ? Math.round((chfPerMonth / v) * 1000 * 100) / 100 : null, perFollower: f ? Math.round((chfPerMonth / f) * 100) / 100 : null };
}

// Monetisation thresholds (checked 28.10.2026 on support.google.com/youtube/answer/72851 and 13429240,
// help.instagram.com/738469380549477). YouTube raises the hours to 8'000 for new applicants from 1.2.2027.
export const GOALS = {
  youtube: [
    { stage: "Etappe 1: Fan-Funding und Shopping", needs: [["subscribers", 500], ["uploads_90d", 3]], or: [["watch_hours_long_365d", 3000], ["shorts_views_90d", 3_000_000]] },
    { stage: "Werbeeinnahmen (YouTube-Partnerprogramm)", needs: [["subscribers", 1000]], or: [["watch_hours_long_365d", 4000], ["shorts_views_90d", 10_000_000]] },
  ],
  instagram: [
    { stage: "Geschenke auf Reels", needs: [["followers", 500]], or: [] },
  ],
};
export const GOAL_LABEL = {
  subscribers: "Abonnenten", followers: "Follower", uploads_90d: "Uploads in 90 Tagen",
  watch_hours_long_365d: "Wiedergabestunden lange Videos (12 Monate)", shorts_views_90d: "Shorts-Aufrufe (90 Tage)",
};

// progress of one stage: every «needs» must be met, of «or» the best one counts
export function stageProgress(stage, values) {
  const part = ([k, goal]) => ({ key: k, goal, value: values[k] ?? null, share: values[k] == null ? null : Math.min(1, values[k] / goal) });
  const needs = stage.needs.map(part);
  const or = stage.or.map(part);
  const best = or.length ? or.reduce((a, b) => ((b.share ?? -1) > (a.share ?? -1) ? b : a)) : null;
  const parts = [...needs, ...(best ? [best] : [])];
  const done = parts.every((p) => p.share === 1);
  return { stage: stage.stage, needs, or, best, done, share: parts.length ? Math.min(...parts.map((p) => p.share ?? 0)) : 0 };
}

// when a value reaches its goal at the pace of the period (per day); null without growth
export function forecast(value, goal, gainInPeriod, days, today) {
  if (value == null || value >= goal) return value == null ? null : { days: 0, date: today };
  const perDay = days ? gainInPeriod / days : 0;
  if (!(perDay > 0)) return null;
  const n = Math.ceil((goal - value) / perDay);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return { days: n, date: d.toISOString().slice(0, 10) };
}
