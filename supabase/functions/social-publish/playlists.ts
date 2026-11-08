// YouTube playlists of one channel (Christoph 8.11.2026: «playlists machen und ergänzen, wenn neue videos kommen»).
// Admin-only op `playlists`: { app_id, playlists: [{ title, description?, videos: [videoId] }] }. Creates a missing playlist
// (public) and adds the videos that are not in it yet. Never removes anything. About 50 quota units per added video.
import { accessToken, type GoogleConfig, youtube, type YouTube } from "./google.ts";
import type { FetchFn } from "./graph.ts";
import { FinalError } from "./publish.ts";

export type WantedPlaylist = { title: string; description?: string; videos: string[] };
type Deps = { fetch: FetchFn; google?: GoogleConfig | null; account: () => Promise<{ id: string } | null>; token: (id: string) => Promise<string> };

// pure: which videos each playlist still needs, in the order wanted, without duplicates
export function missingVideos(wanted: string[], present: string[]): string[] {
  const have = new Set(present);
  const out: string[] = [];
  for (const v of wanted) if (v && !have.has(v) && !out.includes(v)) out.push(v);
  return out;
}

async function all(yt: YouTube, path: string, params: Record<string, string>) {
  const items: any[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await yt.get(path, { ...params, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    items.push(...(r.items ?? []));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}

export async function syncPlaylists(deps: Deps, wanted: WantedPlaylist[]) {
  if (!deps.google) throw new FinalError("YouTube ist noch nicht eingerichtet: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen.");
  if (!Array.isArray(wanted) || !wanted.length) throw new FinalError("Keine Playlists angegeben.");
  const acc = await deps.account();
  if (!acc) throw new FinalError("Kein YouTube-Konto für diese App verbunden.");
  const yt = youtube(deps.fetch, await accessToken(deps.fetch, deps.google, await deps.token(acc.id)));
  const mine = await all(yt, "playlists", { part: "snippet", mine: "true" });
  const results = [];
  for (const w of wanted) {
    const title = String(w.title ?? "").trim().slice(0, 150);
    if (!title) continue;
    let pl = mine.find((p) => p.snippet?.title === title);
    let made = false;
    if (!pl && !(w.videos ?? []).length) continue; // no empty playlists on the channel
    if (!pl) {
      pl = await yt.post("playlists", { part: "snippet,status" }, {
        snippet: { title, description: String(w.description ?? "").slice(0, 5000) }, status: { privacyStatus: "public" },
      });
      made = true;
    }
    const present = (await all(yt, "playlistItems", { part: "contentDetails", playlistId: pl.id })).map((i) => i.contentDetails?.videoId);
    const add = missingVideos((w.videos ?? []).map(String), present);
    for (const videoId of add) {
      await yt.post("playlistItems", { part: "snippet" }, { snippet: { playlistId: pl.id, resourceId: { kind: "youtube#video", videoId } } });
    }
    results.push({ title, id: pl.id, made, added: add.length, total: present.length + add.length });
  }
  return results;
}
