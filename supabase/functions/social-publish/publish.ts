// Publishing logic, independent of Supabase and the network (both are passed in), so it can be tested
// with a fake store and a mocked Graph API (publish.test.ts).
//
// Instagram Content Publishing: container(s) → wait until FINISHED (videos) → media_publish
// → permalink → optional first comment. Idempotent: a post that already has a remote_media_id is never
// published again, and a container that Instagram reports as PUBLISHED is matched instead of re-published.

import { FB_HOST, graph, GraphError, IG_HOST, refreshInstagramToken, scrubToken, type FetchFn } from "./graph.ts";
import { GoogleError, googleGerman, type GoogleConfig } from "./google.ts";
import { publishYoutube } from "./youtube.ts";

export const MAX_ATTEMPTS = 3;

export type UserTag = { username: string; x: number; y: number };
export type MediaItem = { path: string; type: string; alt?: string; user_tags?: UserTag[]; width?: number | null; height?: number | null; duration?: number | null };

// Instagram user_tags (images only): JSON list of { username, x, y } with x/y in 0..1
export function userTags(m: MediaItem): string | undefined {
  const tags = (m.user_tags ?? [])
    .filter((t) => /^[A-Za-z0-9._]{1,30}$/.test(t?.username ?? "") && t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1)
    .slice(0, 20)
    .map((t) => ({ username: t.username, x: t.x, y: t.y }));
  return tags.length ? JSON.stringify(tags) : undefined;
}
export type Post = {
  id: string;
  account_id: string;
  kind: "image" | "carousel" | "reel" | "story";
  title?: string; // YouTube: video title (caption = description)
  caption: string;
  first_comment: string;
  media: MediaItem[];
  cover_path: string | null;
  status: string;
  scheduled_at: string | null;
  attempts: number;
  remote_container_id: string | null;
  remote_media_id: string | null;
  remote_comment_id: string | null;
  permalink: string | null;
  last_error?: string | null;
  published_at?: string | null;
  media_deleted_at?: string | null;
  location?: { id: string; name?: string } | null;
  location_dropped?: boolean; // set while publishing when Instagram refused the location
};
export type Account = { id: string; app_id?: string; platform: "instagram" | "facebook" | "youtube"; remote_id: string; handle: string; active: boolean; token_expires_at: string | null };

export interface Store {
  claim(postId?: string): Promise<Post[]>;
  account(id: string): Promise<Account>;
  accounts(): Promise<Account[]>;
  token(accountId: string): Promise<string>;
  storeToken(accountId: string, token: string, expiresAt: Date | null): Promise<void>;
  update(postId: string, patch: Partial<Post> & Record<string, unknown>): Promise<void>;
  publicUrl(path: string): string;
  publishedWithFiles(before: Date): Promise<Post[]>;
  removeFiles(paths: string[]): Promise<void>;
  missingFiles?(paths: string[]): Promise<string[]>; // paths that are not in the bucket
}

export type Deps = {
  store: Store;
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  facebookEnabled?: boolean;
  pollMs?: number; // between status checks of a video container
  maxPolls?: number; // per run; afterwards the post stays "publishing" and the next run continues
  google?: GoogleConfig | null; // YouTube (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
  deadline?: number; // ms timestamp: a YouTube upload stops here and the next run continues
  chunkSize?: number; // YouTube upload piece (tests use small ones)
};

export type Result = { id: string; status: string; error?: string };

// Errors that will not go away by trying again (bad file, expired token, …)
export class FinalError extends Error {}

export async function publishDue(deps: Deps, postId?: string): Promise<Result[]> {
  const posts = await deps.store.claim(postId);
  const results: Result[] = [];
  for (const post of posts) {
    // out of time: the rest stays «publishing» and the next run picks it up (not counted as a new attempt)
    if (deps.deadline && deps.now().getTime() > deps.deadline) break;
    results.push(await publishOne(deps, post));
  }
  return results;
}

async function publishOne(deps: Deps, post: Post): Promise<Result> {
  const { store } = deps;
  try {
    const account = await store.account(post.account_id);
    if (account.platform === "facebook") return await publishFacebook(deps, post, account);
    if (account.platform === "youtube") return await publishYoutube(deps, post, account);
    const g = graph(deps.fetch, IG_HOST, await store.token(account.id));

    if (post.remote_media_id) return await finish(deps, g, post, post.remote_media_id); // published before, only finish
    if (!post.remote_container_id) await checkFiles(deps, post);

    let container = post.remote_container_id;
    if (container) {
      const { status_code } = await g.get(container, { fields: "status_code" });
      if (status_code === "PUBLISHED") return await finish(deps, g, post, await findPublishedMedia(g, account, post));
      if (status_code === "EXPIRED") container = null; // older than 24 h: make a new one
      if (status_code === "ERROR") throw new FinalError(VIDEO_ERROR);
    }

    if (!container) {
      const limit = await g.get(`${account.remote_id}/content_publishing_limit`, { fields: "quota_usage,config" });
      const usage = Number(limit?.data?.[0]?.quota_usage ?? 0);
      const total = Number(limit?.data?.[0]?.config?.quota_total ?? 100);
      if (usage >= total) {
        await store.update(post.id, {
          status: "approved",
          attempts: Math.max(0, post.attempts - 1), // waiting for the limit is not a failed attempt
          last_error: `Tageslimit von Instagram erreicht (${usage}/${total} Beiträge in 24 Stunden). Wird automatisch später veröffentlicht.`,
        });
        return { id: post.id, status: "waiting" };
      }
      container = await createContainer(deps, g, account, post);
      await store.update(post.id, { remote_container_id: container });
    }

    if (!(await waitUntilFinished(deps, g, container))) {
      await store.update(post.id, { last_error: "Instagram verarbeitet das Video noch. Der nächste Durchgang macht weiter." });
      return { id: post.id, status: "processing" };
    }

    const published = await g.post(`${account.remote_id}/media_publish`, { creation_id: container });
    await store.update(post.id, { remote_media_id: published.id }); // saved at once: never publish this post again
    return await finish(deps, g, post, published.id);
  } catch (err) {
    return await fail(deps, post, err);
  }
}

// before Instagram fetches anything: the post has media and every file is really in the bucket
export async function checkFiles(deps: Deps, post: Post) {
  if (!post.media?.length) throw new FinalError("Kein Bild/Video im Beitrag – bitte im Cockpit hochladen und «Erneut versuchen».");
  if (!deps.store.missingFiles) return;
  const missing = await deps.store.missingFiles([...post.media.map((m) => m.path), ...(post.cover_path ? [post.cover_path] : [])]);
  if (missing.length) throw new FinalError(`Datei fehlt im Speicher (${missing.map((p) => p.split("/").pop()).join(", ")}) – bitte im Cockpit neu hochladen und «Erneut versuchen».`);
}

async function createContainer(deps: Deps, g: ReturnType<typeof graph>, account: Account, post: Post): Promise<string> {
  const url = (m: MediaItem) => deps.store.publicUrl(m.path);
  const isVideo = (m: MediaItem) => m.type.startsWith("video/");
  const ig = account.remote_id;
  const [first] = post.media;
  if (!first) throw new FinalError("Der Beitrag hat keine Bilder oder Videos.");

  // carousel: every item must have the first one's shape – otherwise Instagram crops (stop instead of posting)
  if (post.kind === "carousel") {
    const shaped = post.media.filter((m) => m.width && m.height);
    const r0 = shaped[0] ? shaped[0].width! / shaped[0].height! : 0;
    if (shaped.some((m) => Math.abs(m.width! / m.height! - r0) > r0 * 0.01)) {
      throw new FinalError("Die Bilder im Karussell haben unterschiedliche Formate – nicht veröffentlicht. Bitte alle im gleichen Format (z. B. 1080 × 1350) hochladen.");
    }
  }

  // location (Facebook Page ID of a place): images, reels and the carousel container – not stories.
  // If Instagram refuses it, publish without and say so (the post matters more than the pin).
  const withLocation = async (params: Record<string, string | number | boolean | undefined>) => {
    const id = /^[0-9]{5,25}$/.test(post.location?.id ?? "") ? post.location!.id : undefined;
    if (!id) return (await g.post(`${ig}/media`, params)).id;
    try {
      return (await g.post(`${ig}/media`, { ...params, location_id: id })).id;
    } catch (err) {
      if (!(err instanceof GraphError) || !/location/i.test(err.message)) throw err;
      post.location_dropped = true;
      return (await g.post(`${ig}/media`, params)).id;
    }
  };

  if (post.kind === "image") {
    return await withLocation({ image_url: url(first), caption: post.caption, alt_text: first.alt || undefined, user_tags: userTags(first) });
  }
  if (post.kind === "story") {
    return (await g.post(`${ig}/media`, isVideo(first)
      ? { media_type: "STORIES", video_url: url(first) }
      : { media_type: "STORIES", image_url: url(first) })).id;
  }
  if (post.kind === "reel") {
    return await withLocation({
      media_type: "REELS",
      video_url: url(first),
      caption: post.caption,
      cover_url: post.cover_path ? deps.store.publicUrl(post.cover_path) : undefined,
      share_to_feed: true,
    });
  }
  // carousel: 2–10 child containers, then the carousel container
  if (post.media.length < 2 || post.media.length > 10) throw new FinalError("Ein Karussell braucht 2 bis 10 Bilder oder Videos.");
  const children: string[] = [];
  for (const m of post.media) {
    children.push((await g.post(`${ig}/media`, isVideo(m)
      ? { media_type: "VIDEO", video_url: url(m), is_carousel_item: true }
      : { image_url: url(m), is_carousel_item: true, alt_text: m.alt || undefined, user_tags: userTags(m) })).id);
  }
  for (const child of children) if (!(await waitUntilFinished(deps, g, child))) throw new Error("Instagram verarbeitet ein Karussell-Video noch.");
  return await withLocation({ media_type: "CAROUSEL", children: children.join(","), caption: post.caption });
}

const VIDEO_ERROR = "Instagram konnte die Datei nicht verarbeiten. Bitte Format prüfen (Bild: JPEG; Video: MP4, H.264, AAC) und neu hochladen.";

// true = ready to publish, false = still processing after this run's polls
async function waitUntilFinished(deps: Deps, g: ReturnType<typeof graph>, container: string): Promise<boolean> {
  const polls = deps.maxPolls ?? 5;
  for (let i = 0; i < polls; i++) {
    const { status_code } = await g.get(container, { fields: "status_code" });
    if (status_code === "FINISHED" || status_code === "PUBLISHED") return true;
    if (status_code === "ERROR") throw new FinalError(VIDEO_ERROR);
    if (status_code === "EXPIRED") throw new Error("Der Instagram-Container ist abgelaufen. Wird neu erstellt.");
    if (i < polls - 1) await deps.sleep(deps.pollMs ?? 20000);
  }
  return false;
}

// A container is PUBLISHED but we never got the media id (e.g. a timeout right after media_publish):
// take the newest media published after the post was due, instead of publishing a second time.
async function findPublishedMedia(g: ReturnType<typeof graph>, account: Account, post: Post): Promise<string> {
  const list = await g.get(`${account.remote_id}/media`, { fields: "id,timestamp", limit: 10 });
  const since = new Date(post.scheduled_at ?? 0).getTime() - 60_000;
  const match = (list?.data ?? []).find((m: { timestamp: string }) => new Date(m.timestamp).getTime() >= since);
  if (!match) throw new FinalError("Instagram meldet den Beitrag als veröffentlicht, aber er ist nicht auffindbar. Bitte auf Instagram prüfen, bevor du ihn neu planst.");
  return match.id;
}

async function finish(deps: Deps, g: ReturnType<typeof graph>, post: Post, mediaId: string): Promise<Result> {
  const patch: Record<string, unknown> = {
    status: "published", published_at: deps.now().toISOString(), remote_media_id: mediaId,
    last_error: post.location_dropped ? `Veröffentlicht, aber Instagram hat den Standort «${post.location?.name ?? post.location?.id}» nicht angenommen – bitte in der App ergänzen.` : null,
  };
  try {
    patch.permalink = (await g.get(mediaId, { fields: "permalink" }))?.permalink ?? null;
  } catch { /* stories may have no permalink */ }
  if (post.first_comment.trim() && post.kind !== "story" && !post.remote_comment_id) {
    try {
      patch.remote_comment_id = (await g.post(`${mediaId}/comments`, { message: post.first_comment })).id;
    } catch (err) {
      patch.last_error = `${patch.last_error ? `${patch.last_error} ` : ""}Veröffentlicht, aber der erste Kommentar ging nicht: ${germanError(err)}`;
    }
  }
  await deps.store.update(post.id, patch);
  return { id: post.id, status: "published" };
}

async function fail(deps: Deps, post: Post, err: unknown): Promise<Result> {
  const message = germanError(err);
  const final = err instanceof FinalError || isFinalGraphError(err) || post.attempts >= MAX_ATTEMPTS;
  await deps.store.update(post.id, {
    status: final ? "failed" : "approved", // approved + due → the next run tries again
    last_error: final || post.attempts >= MAX_ATTEMPTS ? message : `${message} (Versuch ${post.attempts} von ${MAX_ATTEMPTS}, nächster Versuch automatisch)`,
  });
  return { id: post.id, status: final ? "failed" : "retry", error: message };
}

function isFinalGraphError(err: unknown) {
  if (err instanceof GoogleError) return err.reason === "invalid_grant" || [400, 401, 403].includes(err.status); // bad title, revoked access, …
  return err instanceof GraphError && (err.code === 190 || err.code === 10 || err.code === 200 || (err.code === 100 && err.status === 400));
}

export function germanError(err: unknown): string {
  if (err instanceof GoogleError) return googleGerman(err);
  if (err instanceof GraphError) {
    if (err.code === 190) return "Der Instagram-Zugang (Token) ist abgelaufen oder ungültig. Neuen Token eintragen (docs/social-setup.md).";
    if (err.code === 10 || err.code === 200) return "Der App fehlt eine Berechtigung bei Meta (instagram_business_content_publish).";
    if (err.code === 4 || err.code === 17 || err.code === 32 || err.code === 613) return "Zu viele Anfragen an Instagram. Neuer Versuch später.";
    const code = ` (Code ${err.code ?? "?"}${err.subcode ? `/${err.subcode}` : ""})`;
    if (err.code === 9004 || err.subcode === 2207052) return `Instagram konnte die Datei nicht von Supabase laden – meist fehlt die Datei oder sie ist kein JPEG/MP4. Bild im Cockpit prüfen bzw. neu hochladen, dann «Erneut versuchen».${code}`;
    if (err.subcode === 2207026 || err.subcode === 2207004) return `Instagram lehnt das Format ab (Bild: JPEG 4:5 bis 1.91:1, max. 8 MB; Video: MP4 H.264). Datei anpassen, dann «Erneut versuchen».${code}`;
    return `Instagram meldet: ${err.message}${code}`;
  }
  return scrubToken(err instanceof Error ? err.message : String(err));
}

// ---------- Facebook Page (prepared, off unless FACEBOOK_ENABLED=true) ----------
async function publishFacebook(deps: Deps, post: Post, account: Account): Promise<Result> {
  if (!deps.facebookEnabled) throw new FinalError("Facebook ist noch nicht eingeschaltet (FACEBOOK_ENABLED).");
  if (post.kind !== "image") throw new FinalError("Auf Facebook ist vorerst nur ein einzelnes Bild vorbereitet.");
  if (post.remote_media_id) return { id: post.id, status: "published" };
  const g = graph(deps.fetch, FB_HOST, await deps.store.token(account.id));
  const res = await g.post(`${account.remote_id}/photos`, { url: deps.store.publicUrl(post.media[0].path), caption: post.caption });
  await deps.store.update(post.id, {
    status: "published", published_at: deps.now().toISOString(), remote_media_id: res.post_id ?? res.id,
    permalink: `https://www.facebook.com/${res.post_id ?? res.id}`, last_error: null,
  });
  return { id: post.id, status: "published" };
}

// ---------- weekly: refresh long-lived Instagram tokens (valid 60 days) ----------
export async function refreshTokens(deps: Deps, refreshBeforeDays = 20): Promise<Result[]> {
  const out: Result[] = [];
  const soon = deps.now().getTime() + refreshBeforeDays * 86400_000;
  for (const acc of await deps.store.accounts()) {
    if (!acc.active || acc.platform !== "instagram") continue;
    if (acc.token_expires_at && new Date(acc.token_expires_at).getTime() > soon) continue;
    try {
      const fresh = await refreshInstagramToken(deps.fetch, await deps.store.token(acc.id));
      await deps.store.storeToken(acc.id, fresh.token, new Date(deps.now().getTime() + fresh.expiresIn * 1000));
      out.push({ id: acc.id, status: "refreshed" });
    } catch (err) {
      out.push({ id: acc.id, status: "failed", error: germanError(err) });
    }
  }
  return out;
}

// ---------- daily: delete files of posts published more than 14 days ago ----------
export async function cleanup(deps: Deps, keepDays = 14): Promise<Result[]> {
  const before = new Date(deps.now().getTime() - keepDays * 86400_000);
  const out: Result[] = [];
  for (const post of await deps.store.publishedWithFiles(before)) {
    const paths = [...post.media.map((m) => m.path), ...(post.cover_path ? [post.cover_path] : [])];
    await deps.store.removeFiles(paths);
    await deps.store.update(post.id, { media_deleted_at: deps.now().toISOString() });
    out.push({ id: post.id, status: "files-deleted" });
  }
  return out;
}
