// Daily Instagram statistics (op "stats"): per account and per media item (also posts made outside the cockpit).
// Needs the permission instagram_business_manage_insights on the token (docs/social-setup.md, step 3).
// Metric names change between API versions – every set is fetched tolerantly: if Instagram refuses the set,
// each metric is asked for alone and the ones it refuses are left out.
import { graph, GraphError, IG_HOST, type FetchFn } from "./graph.ts";

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
export type StatsDeps = { store: StatsStore; fetch: FetchFn; now: () => Date };

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

export type StatsResult = { account: string; status: "ok" | "failed"; media?: number; followers?: number; error?: string };

export async function collectStats(deps: StatsDeps, mediaLimit = 50): Promise<StatsResult[]> {
  const day = zurichDay(deps.now());
  const out: StatsResult[] = [];
  for (const acc of await deps.store.accounts()) {
    if (!acc.active || acc.platform !== "instagram") continue;
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
