// Deno tests for the daily statistics with a mocked Instagram API: npm run test:functions
import { assertEquals } from "jsr:@std/assert@1";
import { analyticsMetrics, collectStats, parseInsights, reportRows, type MediaRow, type StatsStore } from "./stats.ts";

const NOW = new Date("2026-10-20T04:23:00Z");

function fakeStore() {
  const accountDays: Array<{ accountId: string; day: string; metrics: Record<string, number> }> = [];
  const media: MediaRow[] = [];
  const store: StatsStore = {
    async accounts() { return [{ id: "acc1", platform: "instagram", remote_id: "IG1", handle: "fly_downwind", active: true }, { id: "acc2", platform: "instagram", remote_id: "IG2", handle: "off", active: false }]; },
    async token() { return "TOKEN"; },
    async saveAccountDay(accountId, day, metrics) { accountDays.push({ accountId, day, metrics }); },
    async saveMediaDays(rows) { media.push(...rows); },
  };
  return { store, accountDays, media };
}

// path → body or (params) => body; { error } → HTTP 400
function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    calls.push(`${path}?metric=${url.searchParams.get("metric") ?? ""}`);
    let body = routes[path];
    if (typeof body === "function") body = body(Object.fromEntries(url.searchParams));
    if (body === undefined) return new Response(JSON.stringify({ error: { message: `no mock ${path}` } }), { status: 400 });
    return new Response(JSON.stringify(body), { status: (body as { error?: unknown }).error ? 400 : 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const insights = (pairs: Record<string, number>) => ({ data: Object.entries(pairs).map(([name, value]) => ({ name, period: "lifetime", values: [{ value }] })) });

Deno.test("parseInsights: values, total_value and breakdown objects", () => {
  assertEquals(parseInsights({ data: [
    { name: "reach", values: [{ value: 5 }, { value: 12 }] },
    { name: "views", total_value: { value: 40 } },
    { name: "navigation", values: [{ value: { tap_forward: 3, tap_back: 1 } }] },
    { name: "broken", values: [{ value: "x" }] },
  ] }), { reach: 12, views: 40, navigation: 4 });
});

Deno.test("collects account numbers and every media item; refused metrics are left out", async () => {
  const { store, accountDays, media } = fakeStore();
  const { fn } = mockFetch({
    IG1: { followers_count: 42, follows_count: 3, media_count: 9 },
    "IG1/insights": (p: Record<string, string>) => (p.metric.includes(",") ? { error: { message: "metric replies not supported" } } : p.metric === "replies" ? { error: { message: "nope" } } : insights({ [p.metric]: 7 })),
    "IG1/media": { data: [
      { id: "17900000000000001", media_type: "VIDEO", media_product_type: "REELS", caption: "Fog", timestamp: "2026-10-18T16:00:00+0000", permalink: "https://instagram.com/reel/1", like_count: 5, comments_count: 2 },
      { id: "17900000000000002", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", caption: "Launch", timestamp: "2026-10-16T16:01:00+0000", like_count: 30, comments_count: 4 },
    ] },
    "IG1/stories": { data: [] },
    "17900000000000001/insights": insights({ reach: 200, views: 310, saved: 9, ig_reels_avg_watch_time: 6400 }),
    "17900000000000002/insights": insights({ reach: 90, views: 150, saved: 3, likes: 31 }),
  });
  const res = await collectStats({ store, fetch: fn, now: () => NOW });
  assertEquals(res, [{ account: "fly_downwind", status: "ok", media: 2, followers: 42 }]);
  assertEquals(accountDays[0].day, "2026-10-20");
  assertEquals(accountDays[0].metrics.followers_count, 42);
  assertEquals(accountDays[0].metrics.reach, 7);
  assertEquals("replies" in accountDays[0].metrics, false);
  assertEquals(media[0].kind, "REELS");
  assertEquals(media[0].metrics, { likes: 5, comments: 2, reach: 200, views: 310, saved: 9, ig_reels_avg_watch_time: 6400 });
  assertEquals(media[1].kind, "CAROUSEL");
  assertEquals(media[1].metrics.likes, 31); // insights win over the basic counter
});

Deno.test("a missing permission fails one account, not the whole run", async () => {
  const { store } = fakeStore();
  const { fn } = mockFetch({ IG1: { error: { message: "(#10) Application does not have permission for this action" } } });
  const res = await collectStats({ store, fetch: fn, now: () => NOW });
  assertEquals(res[0].status, "failed");
});

Deno.test("YouTube: channel totals and per-video views/likes/comments", async () => {
  const days: Array<{ metrics: Record<string, number> }> = [];
  const media: MediaRow[] = [];
  const store: StatsStore = {
    async accounts() { return [{ id: "yt1", platform: "youtube", remote_id: "UC123", handle: "leesidelab", active: true }]; },
    async token() { return "REFRESH"; },
    async saveAccountDay(_a, _d, metrics) { days.push({ metrics }); },
    async saveMediaDays(rows) { media.push(...rows); },
  };
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.host === "oauth2.googleapis.com") return body({ access_token: "ACCESS" });
    assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer ACCESS");
    if (url.pathname.endsWith("/channels")) return body({ items: [{ statistics: { subscriberCount: "12", viewCount: "8100", videoCount: "3" }, contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] });
    if (url.pathname.endsWith("/playlistItems")) return body({ items: [{ contentDetails: { videoId: "abc_DEF-123" } }] });
    if (url.pathname.endsWith("/videos")) return body({ items: [{ id: "abc_DEF-123", snippet: { title: "Föhn, part 1 #Shorts", publishedAt: "2026-10-21T13:17:00Z" }, statistics: { viewCount: "540", likeCount: "21", commentCount: "4" } }] });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const res = await collectStats({ store, fetch: fn, now: () => NOW, google: { clientId: "C", clientSecret: "S" } });
  assertEquals(res, [{ account: "leesidelab", status: "ok", media: 1, followers: 12 }]);
  assertEquals(days[0].metrics, { followers_count: 12, views_total: 8100, media_count: 3 });
  assertEquals(media[0].kind, "SHORT");
  assertEquals(media[0].permalink, "https://youtube.com/shorts/abc_DEF-123");
  assertEquals(media[0].metrics, { views: 540, likes: 21, comments: 4 });
});

Deno.test("youtube analytics: report rows become our metric names", () => {
  const r = { columnHeaders: [{ name: "video" }, { name: "estimatedMinutesWatched" }, { name: "averageViewPercentage" }, { name: "videoThumbnailImpressionsClickRate" }], rows: [["abc", 120, 63.456, 4.8]] };
  const [row] = reportRows(r);
  assertEquals(row.video, "abc");
  assertEquals(analyticsMetrics(row), { watch_minutes: 120, avg_view_pct: 63.46, ctr: 4.8 });
  assertEquals(analyticsMetrics({ views: 10, subscribersGained: 2 }, "_28d"), { views_28d: 10, subscribers_gained_28d: 2 });
  assertEquals(reportRows({}), []);
});
