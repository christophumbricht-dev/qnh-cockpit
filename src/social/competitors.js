// Social → «Konkurrenz»: what stands out in the latest videos of watched YouTube channels. Pure, tested in
// tests/social-competitors.test.mjs. The numbers come from social-publish (supabase/functions/social-publish/competitors.ts).
//
// «Auffällig» = a video gets more views per day than usual FOR ITS CHANNEL and its kind (long or Short): views per day
// since publishing, against the median of the same channel. So a small channel with a hit shows up next to a big one.

const DAY = 864e5;
export const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const ageDays = (iso, now) => Math.max(1, (new Date(now).getTime() - new Date(iso).getTime()) / DAY);

// days: rows { video_id, day, views } → per video the latest views and the growth over the last 7 days (null when the
// cockpit has no number from 7 or more days ago yet)
export function latestViews(days) {
  const by = new Map();
  for (const d of days ?? []) {
    if (d.views == null) continue;
    (by.get(d.video_id) ?? by.set(d.video_id, []).get(d.video_id)).push(d);
  }
  const out = new Map();
  for (const [id, rows] of by) {
    rows.sort((a, b) => a.day.localeCompare(b.day));
    const last = rows.at(-1);
    const cut = new Date(new Date(`${last.day}T12:00:00Z`).getTime() - 7 * DAY).toISOString().slice(0, 10);
    const before = rows.filter((r) => r.day <= cut).at(-1);
    out.set(id, { views: last.views, day: last.day, week: before ? last.views - before.views : null });
  }
  return out;
}

// every video with its numbers and its factor against the usual of its channel and kind
export function rated(videos, days, now = new Date()) {
  const views = latestViews(days);
  const rows = (videos ?? []).filter((v) => v.published_at && views.has(v.video_id)).map((v) => {
    const n = views.get(v.video_id);
    const age = ageDays(v.published_at, now);
    return { ...v, views: n.views, week: n.week, age, perDay: n.views / age };
  });
  // the usual: median views per day of the channel's videos of the same kind (at least 3 of them, else no factor)
  const usual = new Map();
  for (const r of rows) {
    const k = `${r.competitor_id}|${r.is_short}`;
    (usual.get(k) ?? usual.set(k, []).get(k)).push(r.perDay);
  }
  return rows.map((r) => {
    const list = usual.get(`${r.competitor_id}|${r.is_short}`);
    const m = list.length >= 3 ? median(list) : null;
    return { ...r, factor: m ? r.perDay / m : null };
  });
}

// the videos that stand out: published in the last `withinDays`, at least `minFactor` times the usual, best first
export function standouts(videos, days, { now = new Date(), shorts = false, withinDays = 60, minFactor = 1.5, limit = 8 } = {}) {
  return rated(videos, days, now)
    .filter((r) => r.is_short === shorts && r.age <= withinDays && r.factor != null && r.factor >= minFactor)
    .sort((a, b) => b.factor - a.factor || b.views - a.views)
    .slice(0, limit);
}

// per channel: how often it posts and what is usual there
export function channelSummary(channels, videos, days, now = new Date()) {
  const all = rated(videos, days, now);
  return (channels ?? []).map((c) => {
    const mine = all.filter((v) => v.competitor_id === c.id);
    const long = mine.filter((v) => !v.is_short), shorts = mine.filter((v) => v.is_short);
    const recent = (list) => list.filter((v) => v.age <= 30).length;
    return {
      ...c,
      long30: recent(long), shorts30: recent(shorts),
      longViews: median(long.map((v) => v.views)), shortViews: median(shorts.map((v) => v.views)),
      longLength: median(long.map((v) => v.duration_s)),
    };
  });
}

// 754 → «12:34», 3723 → «1:02:03»
export function fmtDuration(s) {
  if (s == null) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  const pad = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
// 1234 → «1234», 12345 → «12'345», 1.2 Mio.
export function fmtViews(n) {
  if (n == null) return "–";
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("de-CH", { maximumFractionDigits: 1 })} Mio.`;
  return Math.round(n).toLocaleString("de-CH");
}
// what Christoph types: «@Name», «youtube.com/@Name», a channel link with UC… → the handle the server understands
export function parseChannel(input) {
  const t = String(input ?? "").trim();
  const id = /(UC[A-Za-z0-9_-]{22})/.exec(t);
  if (id) return id[1];
  const h = t.includes("@") ? /@([A-Za-z0-9._-]{3,30})(?![A-Za-z0-9._-])/.exec(t) : /^([A-Za-z0-9._-]{3,30})$/.exec(t);
  return h ? `@${h[1]}` : null;
}
export const videoUrl = (v) => (v.is_short ? `https://www.youtube.com/shorts/${v.video_id}` : `https://www.youtube.com/watch?v=${v.video_id}`);
export const channelUrl = (c) => (c.handle.startsWith("@") ? `https://www.youtube.com/${c.handle}` : `https://www.youtube.com/channel/${c.handle}`);
