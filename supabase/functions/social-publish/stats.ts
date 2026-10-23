// Daily Instagram statistics (op "stats"): per account and per media item (also posts made outside the cockpit).
// Needs the permission instagram_business_manage_insights on the token (docs/social-setup.md, step 3).
// Metric names change between API versions – every set is fetched tolerantly: if Instagram refuses the set,
// each metric is asked for alone and the ones it refuses are left out.
import { graph, GraphError, IG_HOST, type FetchFn } from "./graph.ts";
import { accessToken, parse, youtube, type GoogleConfig } from "./google.ts";

export type StatsAccount = { id: string; platform: string; remote_id: string; handle: string; active: boolean };
export type MediaRow = {
  media_id: string; account_id: string; day: string; kind: string; permalink: string | null; caption: string;
  posted_at: string | null; metrics: Record<string, number>;
};
export type StatsStore = {
  accounts(): Promise<StatsAccount[]>;
  token(accountId: string): Promise<string>;
  saveAccountDay(accountId: string, day: string, metrics: Record<string, number>): Promise<void>;
  saveMediaDays(rows: MediaRow[]): Promise<void>;
};
export type StatsDeps = { store: StatsStore; fetch: FetchFn; now: () => Date; google?: GoogleConfig | null };

// per media type (Instagram API with Instagram Login, v25). impressions/plays are gone – "views" replaces them.
export const MEDIA_METRICS: Record<string, string[]> = {
  FEED: ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "profile_visits", "follows"],
  REELS: ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time"],
  STORY: ["reach", "views", "replies", "shares", "total_interactions", "profile_visits", "follows", "navigation"],
};
// account, last 24 h (follower numbers come from the profile fields)
export const ACCOUNT_METRICS = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "saves", "shares", "profile_links_taps", "replies"];

// Swiss calendar day of a date
export const zurichDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(d);

// { data: [{ name, values: [{ value }], total_value: { value } }] } → { name: number }
export function parseInsights(body: { data?: Array<{ name: string; values?: Array<{ value: unknown }>; total_value?: { value: unknown } }> }) {
  const out: Record<string, number> = {};
  for (const m of body?.data ?? []) {
    let v = m.total_value?.value ?? m.values?.[m.values.length - 1]?.value;
    if (v && typeof v === "object") v = Object.values(v as Record<string, unknown>).reduce((s: number, x) => s + (typeof x === "number" ? x : 0), 0);
    if (typeof v === "number" && Number.isFinite(v)) out[m.name] = v;
  }
  return out;
}

async function tolerant(ask: (metrics: string[]) => Promise<Record<string, number>>, metrics: string[]) {
  try {
    return await ask(metrics);
  } catch (err) {
    if (!(err instanceof GraphError)) throw err;
    const out: Record<string, number> = {};
    for (const m of metrics) {
      try { Object.assign(out, await ask([m])); } catch { /* not available for this item / version */ }
    }
    return out;
  }
}

export type StatsResult = { account: string; status: "ok" | "failed"; media?: number; followers?: number; error?: string; note?: string };

// ---------- YouTube Analytics API (scope yt-analytics.readonly) ----------
// Watch time and average view percentage per channel (last 28 days) and per video (since upload).
// The click rate of thumbnails is asked for separately and left out when YouTube refuses it (not every
// channel / API version has it; for Shorts it hardly exists anyway).
export const YT_ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
export const ANALYTICS_KEYS: Record<string, string> = {
  views: "views", estimatedMinutesWatched: "watch_minutes", averageViewDuration: "avg_view_duration", averageViewPercentage: "avg_view_pct",
  subscribersGained: "subscribers_gained", videoThumbnailImpressions: "impressions", videoThumbnailImpressionsClickRate: "ctr",
};
const BASE_METRICS = ["views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage"];
const CTR_METRICS = ["videoThumbnailImpressions", "videoThumbnailImpressionsClickRate"];
type Report = { columnHeaders?: Array<{ name: string }>; rows?: unknown[][] };

// { columnHeaders: [{ name }], rows: [[…]] } → [{ name: value }]
export function reportRows(r: Report): Array<Record<string, unknown>> {
  return (r.rows ?? []).map((row) => Object.fromEntries((r.columnHeaders ?? []).map((h, i) => [h.name, row[i]])));
}
// one report row → our metric names (suffix "_28d" for the channel totals)
export function analyticsMetrics(row: Record<string, unknown> | undefined, suffix = ""): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    const name = ANALYTICS_KEYS[k];
    if (name && typeof v === "number" && Number.isFinite(v)) out[name + suffix] = Math.round(v * 100) / 100;
  }
  return out;
}
const shiftDay = (day: string, days: number) => new Date(Date.parse(day + "T12:00:00Z") + days * 864e5).toISOString().slice(0, 10);

async function analytics(deps: StatsDeps, token: string, day: string, ids: string[]) {
  const ask = async (q: Record<string, string>) => {
    const url = new URL(YT_ANALYTICS);
    for (const [k, v] of Object.entries({ ids: "channel==MINE", ...q })) url.searchParams.set(k, v);
    return reportRows(await parse(await deps.fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })));
  };
  const end = shiftDay(day, -2), start = shiftDay(end, -27); // YouTube Analytics lags about two days
  const account = analyticsMetrics((await ask({ startDate: start, endDate: end, metrics: [...BASE_METRICS, "subscribersGained"].join(",") }))[0], "_28d");
  Object.assign(account, analyticsMetrics((await ask({ startDate: start, endDate: end, metrics: CTR_METRICS.join(",") }).catch(() => []))[0], "_28d"));
  const perVideo = new Map<string, Record<string, number>>();
  if (ids.length) {
    const q = { startDate: "2020-01-01", endDate: end, dimensions: "video", filters: `video==${ids.join(",")}`, maxResults: "200" };
    for (const r of await ask({ ...q, metrics: BASE_METRICS.join(",") })) perVideo.set(String(r.video), analyticsMetrics(r));
    for (const r of await ask({ ...q, metrics: CTR_METRICS.join(",") }).catch(() => [])) Object.assign(perVideo.get(String(r.video)) ?? {}, analyticsMetrics(r));
  }
  return { account, perVideo };
}
export const ANALYTICS_MISSING = "YouTube Analytics fehlt: im Cockpit «YouTube verbinden» neu ausführen (neue Berechtigung) und in Google Cloud die «YouTube Analytics API» einschalten.";

// YouTube (Data API, scope youtube.force-ssl): channel totals + per video views/likes/comments.
// Watch time, average view percentage and click rate come from the YouTube Analytics API (see analytics()).
async function youtubeStats(deps: StatsDeps, acc: StatsAccount, day: string, limit: number): Promise<StatsResult> {
  try {
    if (!deps.google) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen");
    const token = await accessToken(deps.fetch, deps.google, await deps.store.token(acc.id));
    const yt = youtube(deps.fetch, token);
    const ch = (await yt.get("channels", { part: "statistics,contentDetails", id: acc.remote_id })).items?.[0];
    if (!ch) throw new Error("Kanal nicht gefunden");
    const s = ch.statistics ?? {};
    const n = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
    const metrics: Record<string, number> = {};
    for (const [k, v] of [["followers_count", s.hiddenSubscriberCount ? undefined : n(s.subscriberCount)], ["views_total", n(s.viewCount)], ["media_count", n(s.videoCount)]] as const) {
      if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
    }

    const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
    const ids: string[] = uploads
      ? ((await yt.get("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: Math.min(limit, 50) })).items ?? []).map((i: { contentDetails: { videoId: string } }) => i.contentDetails.videoId)
      : [];
    // watch time, average view percentage, click rate: only with the Analytics scope (else a note, the rest still counts)
    let note: string | undefined;
    let perVideo = new Map<string, Record<string, number>>();
    try {
      const a = await analytics(deps, token, day, ids);
      Object.assign(metrics, a.account);
      perVideo = a.perVideo;
    } catch {
      note = ANALYTICS_MISSING;
    }
    await deps.store.saveAccountDay(acc.id, day, metrics);

    const rows: MediaRow[] = [];
    if (ids.length) {
      for (const v of (await yt.get("videos", { part: "snippet,statistics", id: ids.join(",") })).items ?? []) {
        const st = v.statistics ?? {}, m: Record<string, number> = {};
        for (const [k, val] of [["views", n(st.viewCount)], ["likes", n(st.likeCount)], ["comments", n(st.commentCount)]] as const) if (typeof val === "number") m[k] = val;
        rows.push({
          media_id: String(v.id), account_id: acc.id, day, kind: "SHORT",
          permalink: `https://youtube.com/shorts/${v.id}`, caption: String(v.snippet?.title ?? "").slice(0, 300), posted_at: v.snippet?.publishedAt ?? null, metrics: { ...m, ...perVideo.get(String(v.id)) },
        });
      }
    }
    await deps.store.saveMediaDays(rows);
    return { account: acc.handle, status: "ok", media: rows.length, followers: metrics.followers_count, ...(note ? { note } : {}) };
  } catch (err) {
    return { account: acc.handle, status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function collectStats(deps: StatsDeps, mediaLimit = 50): Promise<StatsResult[]> {
  const day = zurichDay(deps.now());
  const out: StatsResult[] = [];
  for (const acc of await deps.store.accounts()) {
    if (!acc.active) continue;
    if (acc.platform === "youtube") { out.push(await youtubeStats(deps, acc, day, mediaLimit)); continue; }
    if (acc.platform !== "instagram") continue;
    try {
      const g = graph(deps.fetch, IG_HOST, await deps.store.token(acc.id));
      const ig = acc.remote_id;

      // account: profile numbers (no insights permission needed) + last 24 h
      const profile = await g.get(ig, { fields: "followers_count,follows_count,media_count" });
      const metrics: Record<string, number> = {};
      for (const k of ["followers_count", "follows_count", "media_count"]) if (typeof profile[k] === "number") metrics[k] = profile[k];
      Object.assign(metrics, await tolerant(async (ms) => parseInsights(await g.get(`${ig}/insights`, { metric: ms.join(","), period: "day", metric_type: "total_value" })), ACCOUNT_METRICS));
      await deps.store.saveAccountDay(acc.id, day, metrics);

      // media: feed posts + reels (latest first) and stories that are still up (24 h)
      const fields = "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count";
      const feed = (await g.get(`${ig}/media`, { fields, limit: mediaLimit })).data ?? [];
      const stories = await g.get(`${ig}/stories`, { fields }).then((r: { data?: unknown[] }) => r.data ?? [], () => []);
      const rows: MediaRow[] = [];
      for (const m of [...feed, ...stories] as Array<Record<string, string | number>>) {
        const kind = String(m.media_product_type ?? "FEED");
        const base: Record<string, number> = {};
        if (typeof m.like_count === "number") base.likes = m.like_count;
        if (typeof m.comments_count === "number") base.comments = m.comments_count;
        const insights = await tolerant(async (ms) => parseInsights(await g.get(`${m.id}/insights`, { metric: ms.join(",") })), MEDIA_METRICS[kind] ?? MEDIA_METRICS.FEED);
        rows.push({
          media_id: String(m.id), account_id: acc.id, day, kind: m.media_type === "CAROUSEL_ALBUM" && kind === "FEED" ? "CAROUSEL" : kind,
          permalink: (m.permalink as string) ?? null, caption: String(m.caption ?? "").slice(0, 300), posted_at: (m.timestamp as string) ?? null,
          metrics: { ...base, ...insights },
        });
      }
      await deps.store.saveMediaDays(rows);
      out.push({ account: acc.handle, status: "ok", media: rows.length, followers: metrics.followers_count });
    } catch (err) {
      out.push({ account: acc.handle, status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
