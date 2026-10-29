// Publishing a video to YouTube: a Short when it is vertical and at most 3 minutes long, else a normal ("long") video.
//
// Resumable upload in 8 MB pieces, read straight from the file: the public Social bucket (Supabase Storage), or for a
// long video of the Digital Studio Cloudflare R2 (presigned GET, the same R2_* secrets as studio-media). The upload
// session is kept in remote_container_id, so a run that runs out of time (deadline) or breaks continues where it
// stopped, and a finished upload whose answer got lost is found again – never a second video.
//
// Shorts go up public at the planned time. A long video goes up PRIVATE, up to a day ahead (preuploadYoutube, every
// publish run), gets its title picture (cover_path) and its captions (media[0].captions, an .srt in R2), and only at
// the planned time is it switched to public (goPublic). A post withdrawn in the meantime is never claimed, so its
// video simply stays private. After going public: permalink and the first comment. YouTube may refuse comments while
// it still processes the video; then followUpYoutube() (every publish run) tries again for two hours.

import type { FetchFn } from "./graph.ts";
import { accessToken, GoogleError, googleGerman, parse, youtube, YT_UPLOAD, type YouTube } from "./google.ts";
import { type Account, type Deps, FinalError, germanError, type MediaItem, type Post, type Result } from "./publish.ts";
import { r2Presign, STUDIO_KEY } from "../_shared/sigv4.js";

export const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB
export const CATEGORY_EDUCATION = "27";
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
export const SHORT_MAX_S = 180;
export const PRE_HOURS = 24; // a long video goes up (private) at most this long before its planned time
const WAIT_REASONS = new Set(["quotaExceeded", "uploadLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"]);
const isWait = (err: unknown) => err instanceof GoogleError && !!err.reason && WAIT_REASONS.has(err.reason);

export const shortsUrl = (videoId: string) => `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`;
const ytWatch = (videoId: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

// a long video from the Digital Studio: the file is in R2 (too big for the Social bucket), path = its key
export const fromR2 = (m?: MediaItem | null) => m?.source === "r2";
// landscape or longer than 3 minutes (or from the studio): a normal video, not a Short
export function isLong(post: Post): boolean {
  const m = post.media[0];
  if (!m) return false;
  return fromR2(m) || Number(m.duration) > SHORT_MAX_S || (!!m.width && !!m.height && m.width > m.height);
}

// YouTube refuses < and > in title and description
const clean = (s: string) => s.replace(/[<>]/g, "");
function cutBytes(s: string, max: number) {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let out = s;
  while (enc.encode(out).length > max) out = out.slice(0, -1);
  return out;
}
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

export function videoResource(post: Post, privacy: "public" | "private" = "public") {
  const lang = LANG.test(String(post.media[0]?.lang ?? "")) ? post.media[0].lang : undefined;
  return {
    snippet: {
      title: clean(String(post.title ?? "")).trim().slice(0, TITLE_MAX),
      description: cutBytes(clean(post.caption), DESCRIPTION_MAX_BYTES),
      categoryId: CATEGORY_EDUCATION,
      ...(lang ? { defaultLanguage: lang, defaultAudioLanguage: lang } : {}),
    },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: post.made_for_kids === true, embeddable: true, license: "youtube" },
  };
}

// "bytes=0-8388607" → 8388608 (next byte to send); no header → nothing stored yet
export function nextOffset(range: string | null): number {
  const m = range?.match(/bytes=\d+-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

// where a file is read from: the public Social bucket, or a short-lived signed link into R2 (never the bucket itself)
export async function fileUrl(deps: Deps, m: MediaItem, path = m.path): Promise<string> {
  if (!fromR2(m)) return deps.store.publicUrl(path);
  if (!STUDIO_KEY.test(path)) throw new FinalError("Das Video liegt an einem unbekannten Ort in R2 – im Studio neu hochladen.");
  if (!deps.r2) throw new FinalError("Das lange Video liegt in Cloudflare R2, aber social-publish fehlen die R2-Secrets (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET – dieselben wie bei studio-media, docs/studio-setup.md).");
  return await r2Presign({ ...deps.r2, key: path, method: "GET", expires: 3600, now: deps.now() });
}

// reading a file: a network error never shows the (signed) link in a message
const getFile = (fetchFn: FetchFn, url: string, init?: RequestInit) =>
  fetchFn(url, init).catch(() => { throw new Error("Die Datei ist gerade nicht erreichbar (Netzwerk). Der nächste Durchgang versucht es wieder."); });

// total size of the file: one byte with a Range request (Storage and R2 answer 206 + Content-Range)
async function fileSize(fetchFn: FetchFn, url: string): Promise<number> {
  const res = await getFile(fetchFn, url, { headers: { Range: "bytes=0-0" } });
  await res.body?.cancel();
  const total = Number(res.headers.get("Content-Range")?.split("/")[1] ?? (res.status === 200 ? res.headers.get("Content-Length") : NaN));
  if (!res.ok || !(total > 0)) throw new Error(`Die Videodatei ist nicht lesbar (HTTP ${res.status}).`);
  return total;
}

async function readRange(fetchFn: FetchFn, url: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  const res = await getFile(fetchFn, url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new Error(`Die Videodatei ist nicht lesbar (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer().catch(() => { throw new Error("Die Videodatei kam unvollständig an."); }));
  if (res.status === 200) return bytes.subarray(start, end + 1); // server ignored the Range header
  if (bytes.length !== end - start + 1) throw new Error("Die Videodatei kam unvollständig an.");
  return bytes;
}

type Video = { id?: string; status?: { privacyStatus?: string; uploadStatus?: string } };
type UploadState = { done: true; video: Video } | { done: false; offset: number } | { expired: true };

// What remote_container_id holds for a YouTube post (JSON):
//   while uploading  { s: session URL, fp, total, file, meta, old? }   (YouTube fixes title, description and size when
//                    the session starts – a withdrawn and edited post must not continue an old session; file and meta
//                    say which cut and which text the session was started with)
//   after a private upload of a long video  { v: video id, file: media path, meta: fingerprint of title/description,
//                    thumb / captions: cover_path / captions key that is set, tp+tt / cp+ct: tries for that picture /
//                    those captions, te: last reason, old? }
//   old: ids of earlier private uploads of this post (an older cut) – Christoph deletes them in YouTube Studio
//   busy: a pre-upload run works on the post until then (ms); the publish run waits meanwhile
type Session = { s: string; fp: string; total: number; file?: string; meta?: string; old?: string[] };
type Uploaded = { v: string; file: string; meta: string; thumb?: string; tp?: string; tt?: number; te?: string; captions?: string; cp?: string; ct?: number; old?: string[] };
type YDeps = Deps & { busyUntil?: number };
const isSessionUrl = (u: unknown): u is string => typeof u === "string" && u.startsWith("https://www.googleapis.com/upload/");
const json = (v: string | null | undefined) => { try { const x = JSON.parse(v ?? ""); return x && typeof x === "object" ? x : null; } catch { return null; } };
const oldIds = (x: { old?: unknown } | null) => (Array.isArray(x?.old) ? x!.old.filter((s): s is string => typeof s === "string").slice(-5) : []);
export function parseSession(v: string | null): Session | null {
  const x = json(v);
  return isSessionUrl(x?.s) && typeof x.fp === "string" && x.total > 0 ? { s: x.s, fp: x.fp, total: x.total, file: x.file, meta: x.meta, old: oldIds(x) } : null;
}
export function parseUploaded(v: string | null): Uploaded | null {
  const x = json(v);
  if (typeof x?.v !== "string" || typeof x.file !== "string") return null;
  const { busy: _b, ...rest } = x;
  return { ...rest, old: oldIds(x) };
}
const busyUntil = (post: Post) => Number(json(post.remote_container_id)?.busy) || 0;

// every write of the state goes through here: a pre-upload run keeps its «busy» mark on it, the publish run drops it
async function writeState(deps: YDeps, post: Post, state: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const { busy: _b, ...rest } = state ?? {};
  const full = deps.busyUntil ? { ...rest, busy: deps.busyUntil } : rest;
  const value = Object.keys(full).length ? JSON.stringify(full) : null;
  await deps.store.update(post.id, { remote_container_id: value, ...extra });
  Object.assign(post, { remote_container_id: value, ...extra });
}

const hash = async (parts: unknown[]) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts))))].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
const fingerprint = (post: Post, total: number) => hash([post.media[0]?.path, total, post.title ?? "", post.caption]);
const metaPrint = (post: Post) => hash([post.title ?? "", post.caption, post.made_for_kids === true, post.media[0]?.lang ?? ""]);

// session requests: never follow a redirect (the bearer token must only go to Google's upload host)
const put = (fetchFn: FetchFn, session: string, token: string, headers: Record<string, string>, body: Uint8Array<ArrayBuffer>) =>
  fetchFn(session, { method: "PUT", headers: { Authorization: `Bearer ${token}`, ...headers }, body, redirect: "manual" });

// where does the session stand? 308 = incomplete, 200/201 = the video exists, 404/410 = gone,
// 400 = it does not match (e.g. another file size) – in both last cases no video was made
async function uploadState(fetchFn: FetchFn, token: string, session: string, total: number): Promise<UploadState> {
  const res = await put(fetchFn, session, token, { "Content-Range": `bytes */${total}` }, new Uint8Array(0)); // empty body → Content-Length: 0
  if (res.status === 308) { await res.body?.cancel(); return { done: false, offset: nextOffset(res.headers.get("Range")) }; }
  if ([400, 404, 410].includes(res.status)) { await res.body?.cancel(); return { expired: true }; }
  return { done: true, video: await parse(res) };
}

async function startUpload(fetchFn: FetchFn, token: string, post: Post, total: number, type: string, privacy: "public" | "private"): Promise<string> {
  const res = await fetchFn(`${YT_UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(total), "X-Upload-Content-Type": type || "video/mp4",
    },
    body: JSON.stringify(videoResource(post, privacy)),
  });
  if (!res.ok) await parse(res); // throws the GoogleError
  await res.body?.cancel();
  const session = res.headers.get("Location");
  if (!isSessionUrl(session)) throw new Error("YouTube hat keine gültige Upload-Adresse geliefert.");
  return session;
}

const RETRIES = 4;
// a finished upload: the video, plus which cut (file) and which text (meta) it was made from
type Done = { video: Video; file: string; meta: string; old: string[]; note?: string };
type Sent = Done | { progress: number };

// sends the file (continuing a stored session where possible). The session in use is kept in `ctx`, so the caller
// can still ask it after an error (a lost final answer means the video exists).
async function sendVideo(deps: YDeps, token: string, post: Post, privacy: "public" | "private", ctx: { current: Session | null }): Promise<Sent> {
  const file = post.media[0];
  const url = await fileUrl(deps, file);
  const total = await fileSize(deps.fetch, url);
  const fp = await fingerprint(post, total);
  const meta = await metaPrint(post);
  let offset = 0;
  const old = parseSession(post.remote_container_id);
  const keepOld = old?.old ?? oldIds(json(post.remote_container_id));
  const done = (video: Video, s: Session): Done => ({ video, old: keepOld, file: s.file ?? (s.fp === fp ? file.path : ""), meta: s.meta ?? (s.fp === fp ? meta : "") });
  if (old) {
    const st = await uploadState(deps.fetch, token, old.s, old.total);
    if ("expired" in st) { /* nothing was made: start again */ }
    else if (st.done) {
      // finished earlier (the answer got lost); if the post was edited since, say that the old version is online
      // (a long video: the recorded file/meta make the caller upload the new cut or bring the new text)
      return { ...done(st.video, old), note: old.fp === fp || isLong(post) ? undefined : "Hochgeladen wurde der Stand vor deiner letzten Änderung – Titel/Beschreibung in YouTube Studio prüfen." };
    } else if (old.fp === fp) { ctx.current = old; offset = st.offset; }
    // edited after the upload had started: the half session is dropped (YouTube discards it after a week)
  }
  if (!ctx.current) {
    ctx.current = { s: await startUpload(deps.fetch, token, post, total, file.type, privacy), fp, total, file: file.path, meta, ...(keepOld.length ? { old: keepOld } : {}) };
    offset = 0;
    await writeState(deps, post, ctx.current);
  }
  const current = ctx.current;

  let retries = 0;
  while (offset < total) {
    if (deps.deadline && deps.now().getTime() > deps.deadline) return { progress: Math.round((offset / total) * 100) };
    const end = Math.min(offset + (deps.chunkSize ?? CHUNK), total) - 1;
    const bytes = await readRange(deps.fetch, url, offset, end);
    const res = await put(deps.fetch, current.s, token, { "Content-Range": `bytes ${offset}-${end}/${total}`, "Content-Type": file.type }, bytes).catch(() => null);
    if (res?.status === 308) { await res.body?.cancel(); offset = nextOffset(res.headers.get("Range")); retries = 0; continue; }
    if (res && (res.status === 200 || res.status === 201)) return done(await parse(res), current);
    if (!res || res.status >= 500) {
      // lost connection or a Google hiccup: wait a little, ask the session where it stands, go on from there
      await res?.body?.cancel();
      if (++retries > RETRIES) throw new Error("YouTube antwortet beim Hochladen nicht. Der nächste Durchgang macht weiter.");
      await deps.sleep(Math.min(1000 * 2 ** retries, 16_000));
      const st = await uploadState(deps.fetch, token, current.s, total);
      if ("expired" in st) break;
      if (st.done) return done(st.video, current);
      offset = st.offset;
      continue;
    }
    // any other answer: the session cannot go on and no video exists → next attempt starts a new one
    await writeState(deps, post, keepOld.length ? { old: keepOld } : null);
    ctx.current = null;
    if (res.status === 404 || res.status === 410) { await res.body?.cancel(); throw new Error("Die YouTube-Upload-Sitzung ist abgelaufen. Der nächste Versuch beginnt neu."); }
    await parse(res); // throws YouTube's error
    throw new Error(`YouTube meldet HTTP ${res.status}.`);
  }
  // every byte sent but no final answer: ask the session
  const st = await uploadState(deps.fetch, token, current.s, total);
  if ("done" in st && st.done) return done(st.video, current);
  await writeState(deps, post, keepOld.length ? { old: keepOld } : null);
  ctx.current = null;
  throw new Error("YouTube hat den Upload nicht abgeschlossen. Der nächste Versuch beginnt neu.");
}

// the video exists: its id is saved at once (never upload this post again); a long one also remembers which file and
// which title/description it was made with
async function saveVideo(deps: YDeps, post: Post, sent: Done): Promise<string> {
  const id = sent.video?.id;
  if (!id) throw new Error("YouTube hat keine Video-ID zurückgegeben.");
  if (!isLong(post)) {
    await deps.store.update(post.id, { remote_media_id: id });
    post.remote_media_id = id;
    return id;
  }
  const up: Uploaded = { v: id, file: sent.file, meta: sent.meta, ...(sent.old.length ? { old: sent.old } : {}) };
  await writeState(deps, post, up, { remote_media_id: id });
  return id;
}

// before a long video goes on: is the private upload still this post's cut? A new file (another studio version,
// withdrawn + changed + approved again, or a lost answer of an older session) means a fresh upload; the old private
// video is named for Christoph to delete
async function staleUpload(deps: YDeps, post: Post): Promise<boolean> {
  const up = parseUploaded(post.remote_container_id);
  if (!post.remote_media_id || !isLong(post) || !up || up.file === post.media[0]?.path) return false;
  await writeState(deps, post, { old: [...(up.old ?? []), post.remote_media_id] }, { remote_media_id: null });
  return true;
}
const oldNote = (old: string[] | undefined) =>
  old?.length ? `Eine ältere private Fassung liegt noch auf YouTube (${old.map((id) => `youtu.be/${id}`).join(", ")}) – bitte in YouTube Studio löschen.` : "";
const BUSY_NOTE = "Der Vorab-Upload läuft gerade – der nächste Durchgang macht weiter.";
const NEW_CUT_NOTE = "Fertig hochgeladen war eine ältere Fassung – die aktuelle wird im nächsten Durchgang hochgeladen.";

export async function publishYoutube(deps: Deps, post: Post, account: Account): Promise<Result> {
  const { store } = deps;
  if (post.kind !== "reel") throw new FinalError("Auf YouTube geht nur ein Video (Art «Reel»).");
  if (!String(post.title ?? "").trim()) throw new FinalError("Für YouTube fehlt der Titel.");
  if (!deps.google) throw new FinalError("YouTube ist noch nicht eingerichtet: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen (docs/social-setup.md).");
  const file = post.media[0];
  if (!file || !file.type.startsWith("video/")) throw new FinalError("Der Beitrag hat kein Video.");
  // a pre-upload run is working on this post right now: never two writers on one upload session
  if (busyUntil(post) > deps.now().getTime()) {
    await store.update(post.id, { last_error: BUSY_NOTE });
    return { id: post.id, status: "processing" };
  }
  const long = isLong(post);
  let token = "";
  const ctx: { current: Session | null } = { current: null }; // the session this run works with (asked once more if anything breaks)
  try {
    token = await accessToken(deps.fetch, deps.google, await store.token(account.id));
    const yt = youtube(deps.fetch, token);
    await staleUpload(deps, post);
    if (post.remote_media_id) return long ? await goPublic(deps, yt, token, post, post.remote_media_id) : await finish(deps, yt, post, post.remote_media_id); // uploaded before

    const sent = await sendVideo(deps, token, post, long ? "private" : "public", ctx);
    if ("progress" in sent) {
      await store.update(post.id, { last_error: `YouTube-Upload läuft (${sent.progress} %). Der nächste Durchgang macht weiter.` });
      return { id: post.id, status: "processing" };
    }
    const id = await saveVideo(deps, post, sent);
    if (long && (await staleUpload(deps, post))) {
      await store.update(post.id, { last_error: NEW_CUT_NOTE });
      return { id: post.id, status: "processing" };
    }
    return long ? await goPublic(deps, yt, token, post, id) : await finish(deps, yt, post, id, sent.video.status?.privacyStatus, sent.note);
  } catch (err) {
    // daily quota / upload limit: wait for the next run, not a failed attempt
    if (isWait(err)) {
      await store.update(post.id, {
        status: "approved",
        attempts: Math.max(0, post.attempts - 1),
        last_error: `${googleGerman(err as GoogleError)} Wird automatisch später veröffentlicht.`,
      });
      return { id: post.id, status: "waiting" };
    }
    // before this counts as failed: maybe the video is there after all (a lost final answer)
    if (ctx.current && token && !(err instanceof FinalError) && !post.remote_media_id) {
      const current = ctx.current;
      const st = await uploadState(deps.fetch, token, current.s, current.total).catch(() => null);
      if (st && "done" in st && st.done) {
        const yt = youtube(deps.fetch, token);
        const id = await saveVideo(deps, post, { video: st.video, old: current.old ?? [], file: current.file ?? file.path, meta: current.meta ?? "" });
        if (long && (await staleUpload(deps, post))) {
          await store.update(post.id, { last_error: NEW_CUT_NOTE });
          return { id: post.id, status: "processing" };
        }
        return long ? await goPublic(deps, yt, token, post, id) : await finish(deps, yt, post, id, st.video.status?.privacyStatus);
      }
    }
    throw err;
  }
}

// ---------- title picture and captions of a long video (on the private video, before it goes public) ----------

const THUMB_FORBIDDEN = "Eigene Titelbilder erlaubt YouTube erst, wenn der Kanal bestätigt ist (YouTube Studio → Einstellungen → Kanal → Funktionsberechtigung → Telefonnummer).";

async function setThumbnail(deps: Deps, token: string, videoId: string, coverPath: string) {
  const img = await getFile(deps.fetch, deps.store.publicUrl(coverPath));
  if (!img.ok) throw new Error(`Titelbild nicht lesbar (HTTP ${img.status}).`);
  const bytes = new Uint8Array(await img.arrayBuffer());
  const res = await deps.fetch(`${YT_UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" }, body: bytes,
  });
  await parse(res);
}

async function insertCaptions(deps: Deps, token: string, post: Post, videoId: string, key: string) {
  const m = post.media[0];
  const src = await getFile(deps.fetch, await fileUrl(deps, { ...m, source: "r2" }, key));
  if (!src.ok) throw new Error(`Untertitel-Datei nicht lesbar (HTTP ${src.status}).`);
  const srt = await src.text();
  if (!srt.trim()) throw new Error("Die Untertitel-Datei ist leer.");
  const lang = LANG.test(String(m.lang ?? "")) ? m.lang! : "en";
  const boundary = `qnh${crypto.randomUUID().replace(/-/g, "")}`;
  const meta = JSON.stringify({ snippet: { videoId, language: lang, name: "", isDraft: false } });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${srt}\r\n--${boundary}--\r\n`;
  const res = await deps.fetch(`${YT_UPLOAD}/captions?part=snippet&uploadType=multipart`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  await parse(res);
}

const why = (err: unknown) => (err instanceof GoogleError ? googleGerman(err) : err instanceof Error ? err.message : String(err));

// at most this many tries each for the title picture and the captions (they cost quota: 50 and 400 of 10 000 a day).
// A refused daily quota is not a try; a new picture or new captions start counting again.
export const EXTRA_TRIES = 3;
const thumbTries = (post: Post, up: Uploaded | null) => (up?.tp === post.cover_path ? up?.tt ?? 0 : 0);
const capTries = (post: Post, up: Uploaded | null) => (up?.cp === post.media[0]?.captions ? up?.ct ?? 0 : 0);
const extrasLeft = (post: Post, up: Uploaded | null) =>
  (!!post.cover_path && up?.thumb !== post.cover_path && thumbTries(post, up) < EXTRA_TRIES) ||
  (!!post.media[0]?.captions && up?.captions !== post.media[0].captions && capTries(post, up) < EXTRA_TRIES);

// what is still missing on the uploaded video (each step remembered at once, so nothing is set twice); returns notes.
// final = the planned time has come: what still fails is named for Christoph to do in YouTube Studio
async function addExtras(deps: YDeps, token: string, post: Post, videoId: string, final: boolean): Promise<string[]> {
  const up: Uploaded = parseUploaded(post.remote_container_id) ?? { v: videoId, file: post.media[0].path, meta: "" };
  const notes: string[] = [];
  const cover = post.cover_path;
  if (cover && up.thumb !== cover) {
    const tries = thumbTries(post, up);
    if (tries >= EXTRA_TRIES) notes.push(`Titelbild nicht gesetzt${up.te ? `: ${up.te}` : ""} – bitte in YouTube Studio setzen.`);
    else {
      try {
        await setThumbnail(deps, token, videoId, cover);
        Object.assign(up, { thumb: cover, tp: cover, tt: 0, te: undefined });
      } catch (err) {
        if (isWait(err)) notes.push(final ? "Titelbild nicht gesetzt: das YouTube-Tageskontingent ist aufgebraucht – bitte in YouTube Studio setzen." : "Titelbild: wartet auf das YouTube-Kontingent.");
        else {
          const forbidden = err instanceof GoogleError && err.status === 403; // channel not verified: no point in trying again
          Object.assign(up, { tp: cover, tt: forbidden ? EXTRA_TRIES : tries + 1, te: (forbidden ? THUMB_FORBIDDEN : why(err)).slice(0, 300) });
          if (final || up.tt! >= EXTRA_TRIES) notes.push(`Titelbild nicht gesetzt: ${up.te} – bitte in YouTube Studio setzen.`);
          else notes.push("Titelbild: neuer Versuch im nächsten Durchgang.");
        }
      }
      await writeState(deps, post, up);
    }
  }
  const key = post.media[0]?.captions;
  if (key && up.captions !== key) {
    const tries = capTries(post, up);
    if (tries >= EXTRA_TRIES) notes.push("Untertitel nicht hochgeladen – bitte in YouTube Studio hochladen.");
    else {
      try {
        await insertCaptions(deps, token, post, videoId, key);
        Object.assign(up, { captions: key, cp: key, ct: 0 });
      } catch (err) {
        if (isWait(err)) notes.push(final ? "Untertitel nicht hochgeladen: das YouTube-Tageskontingent ist aufgebraucht – bitte in YouTube Studio hochladen." : "Untertitel: warten auf das YouTube-Kontingent.");
        else {
          Object.assign(up, { cp: key, ct: tries + 1 });
          if (final || up.ct! >= EXTRA_TRIES) notes.push(`Untertitel nicht hochgeladen: ${why(err)} – bitte in YouTube Studio hochladen.`);
          else notes.push("Untertitel: neuer Versuch im nächsten Durchgang.");
        }
      }
      await writeState(deps, post, up);
    }
  }
  return notes;
}

const pick = (o: Record<string, unknown> | undefined, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o![k]]));

// the planned time of a long video has come: missing extras, title/description if they changed since the upload, public.
// What Christoph set in YouTube Studio meanwhile (tags, statistics, «altered content» …) is kept: the update starts
// from the video as it is (an update resets every property it does not name).
async function goPublic(deps: YDeps, yt: YouTube, token: string, post: Post, videoId: string): Promise<Result> {
  const notes = await addExtras(deps, token, post, videoId, true);
  const up = parseUploaded(post.remote_container_id);
  const changed = up?.meta !== (await metaPrint(post));
  const cur = (await yt.get("videos", { part: "snippet,status", id: videoId }))?.items?.[0];
  if (!cur) {
    // deleted in YouTube Studio meanwhile: the retry uploads it again
    await writeState(deps, post, up?.old?.length ? { old: up.old } : null, { remote_media_id: null });
    throw new Error("Das vorab hochgeladene Video ist auf YouTube nicht mehr da. Der nächste Versuch lädt es neu hoch.");
  }
  const res = videoResource(post, "public");
  const status = { ...pick(cur.status, ["embeddable", "license", "publicStatsViewable", "containsSyntheticMedia"]), privacyStatus: "public", selfDeclaredMadeForKids: post.made_for_kids === true };
  const body = changed
    ? { id: videoId, snippet: { ...pick(cur.snippet, ["tags", "defaultLanguage", "defaultAudioLanguage"]), ...res.snippet }, status }
    : { id: videoId, status };
  const v = await yt.put("videos", { part: changed ? "snippet,status" : "status" }, body);
  const old = oldNote(up?.old);
  if (old) notes.push(old);
  return await finish(deps, yt, post, videoId, v?.status?.privacyStatus ?? "public", notes.join(" ") || undefined);
}

export const COMMENT_LATER = "Der erste Kommentar folgt, sobald YouTube das Video fertig verarbeitet hat.";
const COMMENT_FAILED = /Veröffentlicht, aber der erste Kommentar ging nicht:.*?– bitte in YouTube von Hand schreiben\./s;

async function finish(deps: Deps, yt: YouTube, post: Post, videoId: string, privacy?: string, note?: string): Promise<Result> {
  const notes: string[] = note ? [note] : [];
  if (privacy && privacy !== "public") notes.push(`YouTube hat das Video als «${privacy}» gespeichert – in YouTube Studio prüfen.`);
  const patch: Record<string, unknown> = { status: "published", published_at: deps.now().toISOString(), remote_media_id: videoId, permalink: isLong(post) ? ytWatch(videoId) : shortsUrl(videoId) };
  // videos «for kids» have comments switched off by YouTube: no first comment there
  if (post.first_comment.trim() && !post.remote_comment_id && post.made_for_kids === true) notes.push("Video für Kinder: YouTube erlaubt keine Kommentare, der erste Kommentar entfällt.");
  else if (post.first_comment.trim() && !post.remote_comment_id) {
    try {
      patch.remote_comment_id = await firstComment(yt, videoId, post.first_comment);
    } catch {
      notes.push(COMMENT_LATER);
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

// ---------- every publish run: long videos that are due within a day go up privately ahead of time ----------
// so that the video is processed (HD) and has its title picture and captions when it goes public at the planned time.
// Problems here never fail the post: the run at the planned time tries again and reports properly. Notes that start
// with «Vorab privat», «Vorab-Upload auf YouTube läuft», «Vorab-Upload wartet» or «Vorab-Upload:» are progress (grey
// in the cockpit); «Vorab-Upload geht nicht» is a problem Christoph has to fix (red).
export const PRE_NOTE = "Vorab privat auf YouTube hochgeladen";
export type PreStore = { youtubeUpcoming(from: Date, until: Date): Promise<Post[]> };

const zurich = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
// cannot heal by itself (missing secrets, a bad key, revoked access, a refused title …)
const needsChristoph = (err: unknown) => err instanceof FinalError || (err instanceof GoogleError && !isWait(err) && (err.reason === "invalid_grant" || [400, 401, 403].includes(err.status)));

export async function preuploadYoutube(deps: Deps & { store: Deps["store"] & Partial<PreStore> }): Promise<Result[]> {
  if (!deps.google || !deps.store.youtubeUpcoming) return [];
  const out: Result[] = [];
  const now = deps.now().getTime();
  // marks every post this run works on, so a publish run (e.g. «Jetzt veröffentlichen») waits instead of writing to the same session
  const pdeps: YDeps = { ...deps, busyUntil: (deps.deadline ?? now + 100_000) + 60_000 };
  for (const post of await deps.store.youtubeUpcoming(new Date(now), new Date(now + PRE_HOURS * 3600_000))) {
    if (deps.deadline && deps.now().getTime() > deps.deadline) break;
    if (post.kind !== "reel" || !isLong(post) || !post.media[0]?.type.startsWith("video/") || !String(post.title ?? "").trim()) continue;
    if (busyUntil(post) > deps.now().getTime()) continue; // another run is on it
    if (post.remote_media_id && parseUploaded(post.remote_container_id)?.file === post.media[0].path && !extrasLeft(post, parseUploaded(post.remote_container_id))) continue; // all done: no call, no write
    const when = zurich.format(new Date(post.scheduled_at!));
    const note = async (text: string) => { if (post.last_error !== text) { await deps.store.update(post.id, { last_error: text }); post.last_error = text; } };
    const ctx: { current: Session | null } = { current: null };
    await writeState(pdeps, post, json(post.remote_container_id)); // busy
    try {
      await staleUpload(pdeps, post);
      const token = await accessToken(deps.fetch, deps.google, await deps.store.token(post.account_id));
      let sentNote: string | undefined;
      if (!post.remote_media_id) {
        const sent = await sendVideo(pdeps, token, post, "private", ctx);
        if ("progress" in sent) {
          await note(`Vorab-Upload auf YouTube läuft (${sent.progress} %) – privat, geht am ${when} öffentlich.`);
          out.push({ id: post.id, status: "preuploading" });
          continue;
        }
        await saveVideo(pdeps, post, sent);
        sentNote = sent.note;
        if (await staleUpload(pdeps, post)) { // that finished session was an older cut: the current one goes up next run
          await note(`Vorab-Upload: ${NEW_CUT_NOTE}`);
          out.push({ id: post.id, status: "preuploading" });
          continue;
        }
      }
      const notes = await addExtras(pdeps, token, post, post.remote_media_id!, false);
      await note([`${PRE_NOTE}; geht am ${when} öffentlich.`, sentNote, ...notes, oldNote(parseUploaded(post.remote_container_id)?.old)].filter(Boolean).join(" "));
      out.push({ id: post.id, status: "preuploaded" });
    } catch (err) {
      const text = needsChristoph(err) ? `Vorab-Upload geht nicht: ${germanError(err)}` : isWait(err) ? `Vorab-Upload wartet: ${germanError(err)}` : `Vorab-Upload: ${germanError(err)} Neuer Versuch im nächsten Durchgang.`;
      await note(text).catch(() => {});
      out.push({ id: post.id, status: "preupload-waiting", error: germanError(err) });
    } finally {
      await writeState(deps, post, json(post.remote_container_id)).catch(() => {}); // not busy any more
    }
  }
  return out;
}

// first comments that YouTube did not take right after the upload: try again for 2 hours, then say so
export const FOLLOW_UP_MS = 2 * 3600_000;
export type FollowUpStore = {
  youtubeWithoutComment(since: Date): Promise<Post[]>; // published YouTube posts with a first comment still to write
  account(id: string): Promise<Account>;
  token(accountId: string): Promise<string>;
  update(postId: string, patch: Record<string, unknown>): Promise<void>;
};
export async function followUpYoutube(deps: { store: FollowUpStore; fetch: FetchFn; now: () => Date; google?: Deps["google"]; deadline?: number }): Promise<Result[]> {
  if (!deps.google) return [];
  const out: Result[] = [];
  const now = deps.now().getTime();
  for (const post of await deps.store.youtubeWithoutComment(new Date(now - FOLLOW_UP_MS))) {
    if (deps.deadline && deps.now().getTime() > deps.deadline) break;
    // the other notes (e.g. «privat gespeichert») stay; the comment notes are rebuilt here
    const others = String(post.last_error ?? "").replace(COMMENT_LATER, "").replace(COMMENT_FAILED, "").trim();
    try {
      const acc = await deps.store.account(post.account_id);
      const yt = youtube(deps.fetch, await accessToken(deps.fetch, deps.google, await deps.store.token(acc.id)));
      const id = await firstComment(yt, post.remote_media_id!, post.first_comment);
      await deps.store.update(post.id, { remote_comment_id: id, last_error: others || null });
      out.push({ id: post.id, status: "commented" });
    } catch (err) {
      // last tries of the window: tell Christoph once (after the window the post is no longer picked up)
      if (now - Date.parse(post.published_at ?? "") > FOLLOW_UP_MS - 30 * 60_000 && !COMMENT_FAILED.test(String(post.last_error ?? ""))) {
        await deps.store.update(post.id, { last_error: `${others ? `${others} ` : ""}Veröffentlicht, aber der erste Kommentar ging nicht: ${why(err)} – bitte in YouTube von Hand schreiben.` });
      }
      out.push({ id: post.id, status: "comment-waiting" });
    }
  }
  return out;
}
