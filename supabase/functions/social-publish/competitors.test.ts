// Deno tests for «Konkurrenz» with a mocked YouTube Data API: npm run test:functions
import { assertEquals } from "jsr:@std/assert@1";
import { collectCompetitors, durationSeconds, videoRow, type CompetitorDay, type CompetitorStore, type CompetitorVideo } from "./competitors.ts";

const NOW = new Date("2026-10-30T03:23:00Z");

function fakeStore(list = [{ id: "c1", handle: "@GreenDotAviation", channel_id: null, active: true }, { id: "c2", handle: "@off", channel_id: null, active: false }]) {
  const saved: Record<string, unknown>[] = [];
  const videos: CompetitorVideo[] = [], days: CompetitorDay[] = [];
  const store: CompetitorStore = {
    async competitors() { return list; },
    async ourYoutubeAccount() { return { id: "yt" }; },
    async token() { return "REFRESH"; },
    async saveCompetitor(id, patch) { saved.push({ id, ...patch }); },
    async saveCompetitorVideos(v, d) { videos.push(...v); days.push(...d); },
  };
  return { store, saved, videos, days };
}

function mockFetch(routes: Record<string, (p: Record<string, string>) => unknown>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com") return new Response(JSON.stringify({ access_token: "ACCESS" }));
    const path = url.pathname.replace("/youtube/v3/", "");
    const p = Object.fromEntries(url.searchParams);
    calls.push(`${init?.method ?? "GET"} ${path} ${JSON.stringify(p)}`);
    const body = routes[path]?.(p) ?? { error: { message: `no mock ${path}` } };
    return new Response(JSON.stringify(body), { status: (body as { error?: unknown }).error ? 400 : 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const google = { clientId: "id", clientSecret: "secret" };

Deno.test("durationSeconds: ISO 8601 of the Data API", () => {
  assertEquals([durationSeconds("PT1H2M3S"), durationSeconds("PT59S"), durationSeconds("P1DT2H"), durationSeconds("PT"), durationSeconds("x"), durationSeconds(null)], [3723, 59, 93600, null, null, null]);
});

Deno.test("videoRow: a Short is up to 3 minutes; best thumbnail; tags capped", () => {
  const v = videoRow({ id: "abcdefghijk", snippet: { title: "T", publishedAt: "2026-10-01T10:00:00Z", thumbnails: { default: { url: "d" }, high: { url: "h" } }, tags: ["a"] }, contentDetails: { duration: "PT2M59S" } }, "c1");
  assertEquals([v.is_short, v.duration_s, v.thumbnail_url, v.tags], [true, 179, "h", ["a"]]);
  assertEquals(videoRow({ id: "x", contentDetails: { duration: "PT12M" } }, "c1").is_short, false);
});

Deno.test("collects active channels by handle: channel, latest uploads, numbers of the day; read only", async () => {
  const { store, saved, videos, days } = fakeStore();
  const { fn, calls } = mockFetch({
    channels: (p) => (p.forHandle === "GreenDotAviation" ? { items: [{ id: "UC1234567890123456789012", snippet: { title: "Green Dot Aviation" }, statistics: { subscriberCount: "629000", videoCount: "200", viewCount: "1" }, contentDetails: { relatedPlaylists: { uploads: "UU1234567890123456789012" } } }] } : { items: [] }),
    playlistItems: (p) => (p.playlistId === "UU1234567890123456789012" ? { items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }] } : { items: [] }),
    videos: (p) => ({ items: p.id.split(",").map((id, i) => ({ id, snippet: { title: id, publishedAt: "2026-10-2" + i + "T10:00:00Z" }, contentDetails: { duration: i ? "PT40S" : "PT14M" }, statistics: { viewCount: String(1000 * (i + 1)), likeCount: "10" } })) }),
  });
  const res = await collectCompetitors({ store, fetch: fn, now: () => NOW, google });
  assertEquals(res, [{ handle: "@GreenDotAviation", status: "ok", videos: 2 }]);
  assertEquals(videos.map((v) => [v.video_id, v.is_short]), [["v1", false], ["v2", true]]);
  assertEquals(days.map((d) => [d.video_id, d.day, d.views, d.comments]), [["v1", "2026-10-30", 1000, null], ["v2", "2026-10-30", 2000, null]]);
  assertEquals([saved[0].channel_id, saved[0].subscribers, saved[0].last_error], ["UC1234567890123456789012", 629000, null]);
  assertEquals(calls.every((c) => c.startsWith("GET ")), true);
});

Deno.test("a channel that is not found is noted and the others go on", async () => {
  const { store, saved } = fakeStore([{ id: "c1", handle: "@nobody", channel_id: null, active: true }, { id: "c2", handle: "UC1234567890123456789012", channel_id: null, active: true }]);
  const { fn, calls } = mockFetch({
    channels: (p) => (p.id === "UC1234567890123456789012" ? { items: [{ id: "UC1234567890123456789012", snippet: { title: "X" }, statistics: { hiddenSubscriberCount: true } }] } : { items: [] }),
    playlistItems: () => ({ items: [] }),
  });
  const res = await collectCompetitors({ store, fetch: fn, now: () => NOW, google });
  assertEquals(res.map((r) => r.status), ["failed", "ok"]);
  assertEquals(saved[0].last_error, "Kanal «@nobody» nicht gefunden.");
  assertEquals(saved[1].subscribers, null);
  assertEquals(calls.some((c) => c.startsWith("GET videos")), false);   // no uploads, no videos call
});
