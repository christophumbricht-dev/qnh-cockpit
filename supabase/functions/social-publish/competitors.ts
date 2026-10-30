// YouTube channels of other creators (Social → «Konkurrenz», Christoph 30.10.2026): once a day (with op stats) or on
// «Jetzt holen» (op competitors) the public numbers of their latest videos: title, thumbnail, length, date, views,
// likes, comments. Only the YouTube Data API with the token of our own channel (read only, about 3 quota units per
// channel). Nothing is downloaded, nothing is posted, liked or subscribed.
import { accessToken, youtube, type GoogleConfig } from "./google.ts";

type FetchFn = typeof fetch;

export type Competitor = { id: string; handle: string; channel_id: string | null; active: boolean };
export type CompetitorChannel = {
  channel_id: string; title: string; thumbnail_url: string | null; subscribers: number | null; videos: number | null; views: number | null;
};
export type CompetitorVideo = {
  video_id: string; competitor_id: string; title: string; description: string; published_at: string | null;
  duration_s: number | null; is_short: boolean; thumbnail_url: string | null; tags: string[];
};
export type CompetitorDay = { video_id: string; day: string; views: number | null; likes: number | null; comments: number | null };
export type CompetitorStore = {
  competitors(): Promise<Competitor[]>;
  ourYoutubeAccount(): Promise<{ id: string } | null>;   // the token of our own channel reads public data
  token(accountId: string): Promise<string>;
  saveCompetitor(id: string, patch: Partial<CompetitorChannel> & { last_checked_at: string; last_error: string | null }): Promise<void>;
  saveCompetitorVideos(videos: CompetitorVideo[], days: CompetitorDay[]): Promise<void>;
};
export type CompetitorDeps = { store: CompetitorStore; fetch: FetchFn; now: () => Date; google?: GoogleConfig | null };
export type CompetitorResult = { handle: string; status: "ok" | "failed"; videos?: number; error?: string };

// Shorts: YouTube says nothing about it in the Data API; up to 3 minutes and vertical is a Short since 2024, the
// length is the best sign we get
export const SHORT_MAX_S = 180;
export const VIDEOS_PER_CHANNEL = 50;

// ISO 8601 duration of the Data API: PT1H2M3S → 3723; P1DT2H → 93600; anything else → null
export function durationSeconds(iso: unknown): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso ?? ""));
  if (!m || iso === "P" || iso === "PT") return null;
  const [d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}
const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const thumb = (t: Record<string, { url?: string }> | undefined) => t?.maxres?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? null;
const zurichDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(d);

// what the cockpit stores of a channel and a video (pure, tested)
export function channelRow(c: Record<string, any>): CompetitorChannel {
  return {
    channel_id: String(c.id), title: String(c.snippet?.title ?? "").slice(0, 200), thumbnail_url: thumb(c.snippet?.thumbnails),
    subscribers: c.statistics?.hiddenSubscriberCount ? null : n(c.statistics?.subscriberCount), videos: n(c.statistics?.videoCount), views: n(c.statistics?.viewCount),
  };
}
export function videoRow(v: Record<string, any>, competitorId: string): CompetitorVideo {
  const duration_s = durationSeconds(v.contentDetails?.duration);
  return {
    video_id: String(v.id), competitor_id: competitorId, title: String(v.snippet?.title ?? "").slice(0, 300),
    description: String(v.snippet?.description ?? "").slice(0, 5000), published_at: v.snippet?.publishedAt ?? null,
    duration_s, is_short: duration_s != null && duration_s <= SHORT_MAX_S, thumbnail_url: thumb(v.snippet?.thumbnails),
    tags: (Array.isArray(v.snippet?.tags) ? v.snippet.tags : []).slice(0, 30).map((t: unknown) => String(t).slice(0, 100)),
  };
}

export async function collectCompetitors(deps: CompetitorDeps, only?: string): Promise<CompetitorResult[]> {
  const list = (await deps.store.competitors()).filter((c) => c.active && (!only || c.id === only));
  if (!list.length) return [];
  if (!deps.google) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen");
  const acc = await deps.store.ourYoutubeAccount();
  if (!acc) throw new Error("Kein YouTube-Kanal verbunden (Social → «YouTube verbinden»).");
  const yt = youtube(deps.fetch, await accessToken(deps.fetch, deps.google, await deps.store.token(acc.id)));
  const now = deps.now(), day = zurichDay(now);
  const out: CompetitorResult[] = [];
  for (const c of list) {
    try {
      // @handle (or a channel id UC…) → channel with its numbers
      const handle = c.handle.replace(/^@/, "");
      const res = await yt.get("channels", { part: "snippet,statistics,contentDetails", ...(c.channel_id ? { id: c.channel_id } : /^UC[\w-]{22}$/.test(handle) ? { id: handle } : { forHandle: handle }) });
      const ch = res.items?.[0];
      if (!ch) throw new Error(`Kanal «${c.handle}» nicht gefunden.`);
      const uploads = ch.contentDetails?.relatedPlaylists?.uploads ?? `UU${String(ch.id).slice(2)}`;
      const pl = await yt.get("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: VIDEOS_PER_CHANNEL });
      const ids = (pl.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
      const vids = ids.length ? (await yt.get("videos", { part: "snippet,contentDetails,statistics", id: ids.join(",") })).items ?? [] : [];
      const videos = vids.map((v: any) => videoRow(v, c.id));
      const days = vids.map((v: any) => ({ video_id: String(v.id), day, views: n(v.statistics?.viewCount), likes: n(v.statistics?.likeCount), comments: n(v.statistics?.commentCount) }));
      await deps.store.saveCompetitorVideos(videos, days);
      await deps.store.saveCompetitor(c.id, { ...channelRow(ch), last_checked_at: now.toISOString(), last_error: null });
      out.push({ handle: c.handle, status: "ok", videos: videos.length });
    } catch (err) {
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await deps.store.saveCompetitor(c.id, { last_checked_at: now.toISOString(), last_error: error }).catch(() => {});
      out.push({ handle: c.handle, status: "failed", error });
    }
  }
  return out;
}
