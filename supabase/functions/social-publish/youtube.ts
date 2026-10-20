// Publishing a video to YouTube (a Short when it is vertical and at most 3 minutes long).
//
// Resumable upload in 8 MB pieces, read straight from the public file in Supabase Storage. The upload session
// is kept in remote_container_id, so a run that runs out of time (deadline) or breaks continues where it
// stopped, and a finished upload whose answer got lost is found again – never a second video.
// After the upload: permalink and the first comment. YouTube may refuse comments while it still processes
// the video; then followUpYoutube() (every publish run) tries again for two hours.

import type { FetchFn } from "./graph.ts";
import { accessToken, GoogleError, googleGerman, parse, youtube, YT_UPLOAD, type YouTube } from "./google.ts";
import { type Account, type Deps, FinalError, type Post, type Result } from "./publish.ts";

export const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB
export const CATEGORY_EDUCATION = "27";
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
const WAIT_REASONS = new Set(["quotaExceeded", "uploadLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"]);

export const shortsUrl = (videoId: string) => `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`;

// YouTube refuses < and > in title and description
const clean = (s: string) => s.replace(/[<>]/g, "");
function cutBytes(s: string, max: number) {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let out = s;
  while (enc.encode(out).length > max) out = out.slice(0, -1);
  return out;
}

export function videoResource(post: Post) {
  return {
    snippet: {
      title: clean(String(post.title ?? "")).trim().slice(0, TITLE_MAX),
      description: cutBytes(clean(post.caption), DESCRIPTION_MAX_BYTES),
      categoryId: CATEGORY_EDUCATION,
    },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true, license: "youtube" },
  };
}

// "bytes=0-8388607" → 8388608 (next byte to send); no header → nothing stored yet
export function nextOffset(range: string | null): number {
  const m = range?.match(/bytes=\d+-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

// total size of the file: one byte with a Range request (Supabase Storage answers 206 + Content-Range)
async function fileSize(fetchFn: FetchFn, url: string): Promise<number> {
  const res = await fetchFn(url, { headers: { Range: "bytes=0-0" } });
  await res.body?.cancel();
  const total = Number(res.headers.get("Content-Range")?.split("/")[1] ?? (res.status === 200 ? res.headers.get("Content-Length") : NaN));
  if (!res.ok || !(total > 0)) throw new Error(`Die Videodatei ist nicht lesbar (HTTP ${res.status}).`);
  return total;
}

async function readRange(fetchFn: FetchFn, url: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetchFn(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new Error(`Die Videodatei ist nicht lesbar (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (res.status === 200) return bytes.subarray(start, end + 1); // server ignored the Range header
  if (bytes.length !== end - start + 1) throw new Error("Die Videodatei kam unvollständig an.");
  return bytes;
}

type UploadState = { done: true; video: { id: string; status?: { privacyStatus?: string; uploadStatus?: string } } } | { done: false; offset: number } | { expired: true };

// where does the session stand? (308 = incomplete, 200/201 = video exists, 404/410 = session gone)
async function uploadState(fetchFn: FetchFn, token: string, session: string, total: number): Promise<UploadState> {
  // empty body → Content-Length: 0 (set by fetch itself)
  const res = await fetchFn(session, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Range": `bytes */${total}` }, body: new Uint8Array(0) });
  if (res.status === 308) { await res.body?.cancel(); return { done: false, offset: nextOffset(res.headers.get("Range")) }; }
  if (res.status === 404 || res.status === 410) { await res.body?.cancel(); return { expired: true }; }
  return { done: true, video: await parse(res) };
}

async function startUpload(fetchFn: FetchFn, token: string, post: Post, total: number, type: string): Promise<string> {
  const res = await fetchFn(`${YT_UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(total), "X-Upload-Content-Type": type || "video/mp4",
    },
    body: JSON.stringify(videoResource(post)),
  });
  if (!res.ok) await parse(res); // throws the GoogleError
  await res.body?.cancel();
  const session = res.headers.get("Location");
  if (!session?.startsWith("https://")) throw new Error("YouTube hat keine Upload-Adresse geliefert.");
  return session;
}

export async function publishYoutube(deps: Deps, post: Post, account: Account): Promise<Result> {
  const { store } = deps;
  if (post.kind !== "reel") throw new FinalError("Auf YouTube geht nur ein Video (Art «Reel»).");
  if (!String(post.title ?? "").trim()) throw new FinalError("Für YouTube fehlt der Titel.");
  if (!deps.google) throw new FinalError("YouTube ist noch nicht eingerichtet: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen (docs/social-setup.md).");
  const file = post.media[0];
  if (!file || !file.type.startsWith("video/")) throw new FinalError("Der Beitrag hat kein Video.");
  try {
    const token = await accessToken(deps.fetch, deps.google, await store.token(account.id));
    const yt = youtube(deps.fetch, token);
    if (post.remote_media_id) return await finish(deps, yt, post, post.remote_media_id); // uploaded before, only finish

    const url = store.publicUrl(file.path);
    const total = await fileSize(deps.fetch, url);
    let session = post.remote_container_id;
    let offset = 0;
    if (session) {
      const st = await uploadState(deps.fetch, token, session, total);
      if ("expired" in st) session = null; // older than about a week: start again (nothing was finished)
      else if (st.done) return await uploaded(deps, yt, post, st.video);
      else offset = st.offset;
    }
    if (!session) {
      session = await startUpload(deps.fetch, token, post, total, file.type);
      await store.update(post.id, { remote_container_id: session });
    }

    while (offset < total) {
      if (deps.deadline && deps.now().getTime() > deps.deadline) {
        await store.update(post.id, { last_error: `YouTube-Upload läuft (${Math.round((offset / total) * 100)} %). Der nächste Durchgang macht weiter.` });
        return { id: post.id, status: "processing" };
      }
      const end = Math.min(offset + (deps.chunkSize ?? CHUNK), total) - 1;
      const bytes = await readRange(deps.fetch, url, offset, end);
      const res = await deps.fetch(session, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Range": `bytes ${offset}-${end}/${total}`, "Content-Type": file.type }, // Content-Length from the body
        body: bytes,
      });
      if (res.status === 308) { await res.body?.cancel(); offset = nextOffset(res.headers.get("Range")); continue; }
      if (res.status === 404 || res.status === 410) {
        await res.body?.cancel();
        await store.update(post.id, { remote_container_id: null });
        throw new Error("Die YouTube-Upload-Sitzung ist abgelaufen. Der nächste Versuch beginnt neu.");
      }
      return await uploaded(deps, yt, post, await parse(res));
    }
    // every byte sent but no final answer (e.g. a lost response): ask the session
    const st = await uploadState(deps.fetch, token, session, total);
    if ("done" in st && st.done) return await uploaded(deps, yt, post, st.video);
    throw new Error("YouTube hat den Upload nicht abgeschlossen. Nächster Versuch automatisch.");
  } catch (err) {
    // daily quota / upload limit: wait for the next run, not a failed attempt
    if (err instanceof GoogleError && err.reason && WAIT_REASONS.has(err.reason)) {
      await store.update(post.id, {
        status: "approved",
        attempts: Math.max(0, post.attempts - 1),
        last_error: `${googleGerman(err)} Wird automatisch später veröffentlicht.`,
      });
      return { id: post.id, status: "waiting" };
    }
    throw err;
  }
}

async function uploaded(deps: Deps, yt: YouTube, post: Post, video: { id?: string; status?: { privacyStatus?: string } }): Promise<Result> {
  if (!video?.id) throw new Error("YouTube hat keine Video-ID zurückgegeben.");
  await deps.store.update(post.id, { remote_media_id: video.id }); // saved at once: never upload this post again
  return await finish(deps, yt, post, video.id, video.status?.privacyStatus);
}

async function finish(deps: Deps, yt: YouTube, post: Post, videoId: string, privacy?: string): Promise<Result> {
  const notes: string[] = [];
  if (privacy && privacy !== "public") notes.push(`YouTube hat das Video als «${privacy}» gespeichert – in YouTube Studio prüfen.`);
  const patch: Record<string, unknown> = { status: "published", published_at: deps.now().toISOString(), remote_media_id: videoId, permalink: shortsUrl(videoId) };
  if (post.first_comment.trim() && !post.remote_comment_id) {
    try {
      patch.remote_comment_id = await firstComment(yt, videoId, post.first_comment);
    } catch {
      notes.push("Der erste Kommentar folgt, sobald YouTube das Video fertig verarbeitet hat.");
    }
  }
  patch.last_error = notes.length ? notes.join(" ") : null;
  await deps.store.update(post.id, patch);
  return { id: post.id, status: "published" };
}

async function firstComment(yt: YouTube, videoId: string, text: string): Promise<string> {
  const r = await yt.post("commentThreads", { part: "snippet" }, { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text.slice(0, 10000) } } } });
  return String(r.id);
}

// first comments that YouTube did not take right after the upload: try again for 2 hours, then say so
export const FOLLOW_UP_MS = 2 * 3600_000;
export type FollowUpStore = {
  youtubeWithoutComment(since: Date): Promise<Post[]>; // published YouTube posts with a first comment still to write
  account(id: string): Promise<Account>;
  token(accountId: string): Promise<string>;
  update(postId: string, patch: Record<string, unknown>): Promise<void>;
};
export async function followUpYoutube(deps: { store: FollowUpStore; fetch: FetchFn; now: () => Date; google?: Deps["google"] }): Promise<Result[]> {
  if (!deps.google) return [];
  const out: Result[] = [];
  const now = deps.now().getTime();
  for (const post of await deps.store.youtubeWithoutComment(new Date(now - FOLLOW_UP_MS))) {
    try {
      const acc = await deps.store.account(post.account_id);
      const yt = youtube(deps.fetch, await accessToken(deps.fetch, deps.google, await deps.store.token(acc.id)));
      const id = await firstComment(yt, post.remote_media_id!, post.first_comment);
      const rest = String(post.last_error ?? "").replace("Der erste Kommentar folgt, sobald YouTube das Video fertig verarbeitet hat.", "").trim();
      await deps.store.update(post.id, { remote_comment_id: id, last_error: rest || null });
      out.push({ id: post.id, status: "commented" });
    } catch (err) {
      // last tries of the window: tell Christoph (after the window the post is no longer picked up)
      if (now - Date.parse(post.published_at ?? "") > FOLLOW_UP_MS - 30 * 60_000) {
        await deps.store.update(post.id, { last_error: `Veröffentlicht, aber der erste Kommentar ging nicht: ${err instanceof GoogleError ? googleGerman(err) : err instanceof Error ? err.message : String(err)} – bitte in YouTube von Hand schreiben.` });
      }
      out.push({ id: post.id, status: "comment-waiting" });
    }
  }
  return out;
}
