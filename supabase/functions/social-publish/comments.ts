// Comment inbox for our own Instagram posts and YouTube videos, and connecting a YouTube channel.
//
//   op "comments"          fetch new comments of all active accounts (cron every 15 min, or «Jetzt abholen»)
//   op "reply"             post Christoph's reply (always his click in the cockpit, never automatic)
//   sendDueReplies         (publish cron) the answer Christoph approved together with a post, posted hours later
//                          below that post's OWN first comment (e.g. the solution of a quiz)
//   answerQuizzes          (comments cron) a comment that answers the post's quiz correctly gets one of the
//                          prepared answers Christoph approved with the post – once per person, within 72 h
//   op "moderate"          hide / show / approve (YouTube «zurückgehalten») / delete (own comments only)
//   op "youtube-auth"      Google sign-in URL for «YouTube verbinden»
//   op "youtube-connect"   code → refresh token (to Vault, never shown) + account row for the channel
//
// No liking, following or commenting on other accounts – only answers below our own posts. Comments of other
// people are answered by Christoph's click, with one exception he asked for (23.10.2026): a correct quiz answer
// gets one of his prepared, approved texts (answerQuizzes). Never free text, never AI, never a wrong or unclear answer.
// Logic independent of Supabase and the network (store + fetch injected), tested in comments.test.ts.

import { graph, GraphError, IG_HOST, type FetchFn } from "./graph.ts";
import { accessToken, authUrl, exchangeCode, GoogleError, googleGerman, youtube, YT_SCOPES, type GoogleConfig, type YouTube } from "./google.ts";
import { type Account, FinalError, germanError, type Post } from "./publish.ts";

export type CommentRow = {
  account_id: string;
  remote_id: string;
  parent_remote_id: string | null;
  media_id: string;
  media_title: string;
  media_permalink: string | null;
  author: string;
  author_url: string | null;
  body: string;
  posted_at: string | null;
  like_count: number;
  own: boolean;
  held: boolean;
  hidden?: boolean; // Instagram: hidden on the platform (becomes the status, not stored as a column)
};
export type CommentStatus = "new" | "done" | "hidden";
export type StoredComment = Omit<CommentRow, "hidden"> & {
  id: string;
  status: CommentStatus;
  draft: string;
  replied_at: string | null;
  deleted_at: string | null;
  fetched_at?: string | null;
};

export interface CommentsStore {
  accounts(): Promise<Account[]>;
  account(id: string): Promise<Account>;
  token(accountId: string): Promise<string>;
  storeToken(accountId: string, token: string, expiresAt: Date | null): Promise<void>;
  comments(accountId: string): Promise<StoredComment[]>; // every row of the account, also deleted ones
  comment(id: string): Promise<StoredComment | null>;
  insertComments(rows: Array<Record<string, unknown>>): Promise<void>; // new rows (with status); duplicates ignored
  updateComments(rows: Array<Record<string, unknown>>): Promise<void>; // existing rows, same keys, never the status
  updateComment(id: string, patch: Record<string, unknown>): Promise<void>;
  // sets replied_at = at unless the comment was answered less than a minute ago; false = someone just answered it
  claimReply(id: string, at: string): Promise<boolean>;
  markDeleted(ids: string[], at: string): Promise<void>;
  upsertAccount(row: { app_id: string; platform: string; remote_id: string; handle: string; token_name: string }): Promise<Account>;
}

export type CommentDeps = { store: CommentsStore; fetch: FetchFn; now: () => Date; google?: GoogleConfig | null };

export const REPLY_MAX = 2200;
const firstLine = (t: unknown, n = 300) => String(t ?? "").split("\n").map((s) => s.trim()).find(Boolean)?.slice(0, n) ?? "";
// links from the platforms end up as href in the cockpit: only their own https addresses
const IG_LINK = /^https:\/\/(www\.)?instagram\.com\//, YT_LINK = /^https?:\/\/(www\.)?youtube\.com\//;
const safeLink = (url: unknown, ok: RegExp) => (typeof url === "string" && ok.test(url) && url.length <= 500 ? url.replace(/^http:/, "https:") : null);

// user-facing German message for any error of these ops
export function commentError(err: unknown): string {
  if (err instanceof GraphError && (err.code === 10 || err.code === 200)) {
    return "Dem Instagram-Zugang fehlt die Berechtigung instagram_business_manage_comments (docs/social-setup.md, Schritt 3).";
  }
  if (err instanceof GoogleError) return googleGerman(err);
  return germanError(err);
}

// ---------- merge: what to insert, update, re-status and mark deleted ----------

export type MergePlan = {
  inserts: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
  statusChanges: Array<{ id: string; status: CommentStatus }>;
  deletions: string[]; // ids of stored rows
};

const SAME_KEYS = ["parent_remote_id", "media_id", "media_title", "media_permalink", "author", "author_url", "body", "like_count", "own", "held"] as const;
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null); // "…Z", "…+0000" and "…+00:00" are the same moment
const changed = (e: StoredComment, row: Omit<CommentRow, "hidden">) =>
  SAME_KEYS.some((k) => (e[k] ?? null) !== (row[k] ?? null)) || time(e.posted_at) !== time(row.posted_at);
// a reply we just sent may take a few minutes to show up in the platform's lists – do not call it deleted meanwhile
const GRACE_MS = 30 * 60_000;

// complete(mediaId): true when every comment of that post/video was fetched – only then is a missing one deleted.
export function mergeComments(existing: StoredComment[], fetched: CommentRow[], complete: (mediaId: string) => boolean, nowIso: string): MergePlan {
  const plan: MergePlan = { inserts: [], updates: [], statusChanges: [], deletions: [] };
  const stored = new Map(existing.map((e) => [e.remote_id, e]));
  const seen = new Set<string>();
  // newest own reply per thread (fetched or stored) – a comment we already answered elsewhere is not «new»
  const answeredAt = new Map<string, number>();
  for (const c of [...existing.filter((e) => !e.deleted_at), ...fetched]) {
    if (!c.own || !c.parent_remote_id || !c.posted_at) continue;
    const t = Date.parse(c.posted_at);
    if (t > (answeredAt.get(c.parent_remote_id) ?? 0)) answeredAt.set(c.parent_remote_id, t);
  }
  for (const f of fetched) {
    if (seen.has(f.remote_id)) continue; // a reply can show up twice (thread + replies list)
    seen.add(f.remote_id);
    const { hidden, ...row } = f;
    const e = stored.get(f.remote_id);
    if (!e) {
      const thread = f.parent_remote_id ?? f.remote_id;
      const answered = !f.own && f.posted_at !== null && (answeredAt.get(thread) ?? 0) > Date.parse(f.posted_at);
      plan.inserts.push({ ...row, status: hidden ? "hidden" : f.own || answered ? "done" : "new", fetched_at: nowIso, deleted_at: null });
      continue;
    }
    if (e.deleted_at || changed(e, row)) plan.updates.push({ ...row, fetched_at: nowIso, deleted_at: null });
    // answered in the Instagram/YouTube app since the last run → no longer open
    const thread = f.parent_remote_id ?? f.remote_id;
    if (e.status === "new" && !f.own && hidden !== true && f.posted_at && (answeredAt.get(thread) ?? 0) > Date.parse(f.posted_at)) {
      plan.statusChanges.push({ id: e.id, status: "done" });
    }
    // Instagram tells us whether a comment is hidden (also when Christoph hid it in the app)
    if (hidden === true && e.status !== "hidden") plan.statusChanges.push({ id: e.id, status: "hidden" });
    if (hidden === false && e.status === "hidden") plan.statusChanges.push({ id: e.id, status: "done" });
  }
  for (const e of existing) {
    if (e.deleted_at || seen.has(e.remote_id) || e.status === "hidden" || !complete(e.media_id)) continue;
    if (e.fetched_at && Date.parse(nowIso) - Date.parse(e.fetched_at) < GRACE_MS) continue;
    plan.deletions.push(e.id);
  }
  return plan;
}

async function applyPlan(store: CommentsStore, plan: MergePlan, nowIso: string) {
  if (plan.inserts.length) await store.insertComments(plan.inserts);
  if (plan.updates.length) await store.updateComments(plan.updates);
  for (const s of plan.statusChanges) await store.updateComment(s.id, { status: s.status });
  if (plan.deletions.length) await store.markDeleted(plan.deletions, nowIso);
}

// ---------- Instagram ----------

type IgComment = {
  id: string; text?: string; timestamp?: string; username?: string; from?: { id?: string; username?: string };
  like_count?: number; hidden?: boolean; replies?: { data?: IgComment[]; paging?: { next?: string } };
};
type IgMedia = { id: string; caption?: string; permalink?: string; comments_count?: number; timestamp?: string };

const IG_FIELDS = "id,text,timestamp,username,from,like_count,hidden,replies{id,text,timestamp,username,from,like_count,hidden}";
const IG_FIELDS_BASIC = "id,text,timestamp,username,like_count,replies{id,text,timestamp,username,like_count}";
export const IG_MEDIA_LIMIT = 30;

function igRow(acc: Account, media: IgMedia, c: IgComment, parent: string | null): CommentRow {
  const username = String(c.username ?? c.from?.username ?? "");
  return {
    account_id: acc.id, remote_id: String(c.id), parent_remote_id: parent, media_id: String(media.id),
    media_title: firstLine(media.caption), media_permalink: safeLink(media.permalink, IG_LINK),
    author: username, author_url: /^[A-Za-z0-9._]{1,30}$/.test(username) ? `https://www.instagram.com/${username}/` : null,
    body: String(c.text ?? "").slice(0, 10000), posted_at: c.timestamp ?? null, like_count: Number(c.like_count ?? 0) || 0,
    own: username !== "" && username.toLowerCase() === acc.handle.toLowerCase(), held: false,
    ...(typeof c.hidden === "boolean" ? { hidden: c.hidden } : {}),
  };
}

async function fetchInstagram(deps: CommentDeps, acc: Account, existing: StoredComment[]) {
  const g = graph(deps.fetch, IG_HOST, await deps.store.token(acc.id));
  const media: IgMedia[] = (await g.get(`${acc.remote_id}/media`, { fields: "id,caption,permalink,comments_count,timestamp", limit: IG_MEDIA_LIMIT })).data ?? [];
  const storedCount = new Map<string, number>();
  for (const e of existing) if (!e.deleted_at) storedCount.set(e.media_id, (storedCount.get(e.media_id) ?? 0) + 1);
  const rows: CommentRow[] = [];
  const complete = new Set<string>();
  let fields = IG_FIELDS;
  // read a post again when its comment count changed, when it is less than 3 days old, or when it is its turn
  // (every 15-minute run re-reads an eighth of the posts – catches hidden/edited comments and likes within 2 h)
  const now = deps.now().getTime();
  const slot = Math.floor(now / (15 * 60_000)) % 8;
  for (const [i, m] of media.entries()) {
    const recent = m.timestamp ? now - Date.parse(m.timestamp) < 3 * 864e5 : false;
    if ((Number(m.comments_count) || 0) === (storedCount.get(m.id) ?? 0) && !recent && i % 8 !== slot) continue;
    if (!(Number(m.comments_count) || 0) && !storedCount.get(m.id)) continue; // nothing there, nothing stored
    let after: string | undefined;
    let finished = false, truncated = false;
    const before = rows.length;
    try {
      for (let page = 0; page < 6; page++) {
        let res;
        try {
          res = await g.get(`${m.id}/comments`, { fields, limit: 50, after });
        } catch (err) {
          // an older API version refusing a field: ask once more with the basic set
          if (err instanceof GraphError && err.code === 100 && /field/i.test(err.message) && fields === IG_FIELDS) { fields = IG_FIELDS_BASIC; page--; continue; }
          throw err;
        }
        for (const c of (res.data ?? []) as IgComment[]) {
          rows.push(igRow(acc, m, c, null));
          for (const r of c.replies?.data ?? []) rows.push(igRow(acc, m, r, String(c.id)));
          if (c.replies?.paging?.next) truncated = true; // more replies than in this answer
        }
        after = res.paging?.next ? res.paging?.cursors?.after : undefined;
        if (!after) { finished = true; break; }
      }
    } catch (err) {
      // token or permission: the whole account is affected; anything else only skips this post (e.g. a live video)
      if (err instanceof GraphError && [190, 10, 200].includes(err.code ?? 0)) throw err;
      rows.length = before;
      continue;
    }
    if (finished && !truncated) complete.add(m.id);
  }
  return { rows, complete: (id: string) => complete.has(id) };
}

// ---------- YouTube ----------

type YtComment = {
  id: string;
  snippet?: {
    authorDisplayName?: string; authorChannelUrl?: string; authorChannelId?: { value?: string };
    textDisplay?: string; textOriginal?: string; likeCount?: number; publishedAt?: string; videoId?: string; parentId?: string;
    moderationStatus?: string; // only for the channel owner: published | heldForReview | likelySpam | rejected
  };
};
type YtThread = { id: string; snippet?: { videoId?: string; topLevelComment?: YtComment; totalReplyCount?: number }; replies?: { comments?: YtComment[] } };

export const ytWatchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

async function youtubeFor(deps: CommentDeps, acc: Account): Promise<YouTube> {
  if (!deps.google) throw new FinalError("YouTube ist noch nicht eingerichtet: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen (docs/social-setup.md, «YouTube verbinden»).");
  return youtube(deps.fetch, await accessToken(deps.fetch, deps.google, await deps.store.token(acc.id)));
}

// held: YouTube's own status of this comment; without it (should not happen for the owner) the list it came from
function ytRow(acc: Account, c: YtComment, parent: string | null, videoId: string, fromHeldList: boolean): CommentRow {
  const s = c.snippet ?? {};
  const held = s.moderationStatus ? ["heldForReview", "likelySpam"].includes(s.moderationStatus) : fromHeldList && !parent;
  return {
    account_id: acc.id, remote_id: String(c.id), parent_remote_id: parent, media_id: videoId, media_title: "", media_permalink: ytWatchUrl(videoId),
    author: String(s.authorDisplayName ?? "").slice(0, 200), author_url: safeLink(s.authorChannelUrl, YT_LINK),
    body: String(s.textDisplay ?? s.textOriginal ?? "").slice(0, 10000), posted_at: s.publishedAt ?? null, like_count: Number(s.likeCount ?? 0) || 0,
    own: s.authorChannelId?.value === acc.remote_id, held,
  };
}

async function fetchYoutube(deps: CommentDeps, acc: Account, existing: StoredComment[]) {
  const yt = await youtubeFor(deps, acc);
  const rows: CommentRow[] = [];
  let whole = true;
  // published threads (newest first, up to 300) + the ones YouTube holds back for review (1 page)
  for (const [moderationStatus, pages] of [["published", 3], ["heldForReview", 1]] as const) {
    let pageToken: string | undefined;
    let done = false;
    for (let p = 0; p < pages; p++) {
      const res = await yt.get("commentThreads", {
        part: "snippet,replies", allThreadsRelatedToChannelId: acc.remote_id, maxResults: 100, order: "time", textFormat: "plainText", moderationStatus, pageToken,
      });
      for (const t of (res.items ?? []) as YtThread[]) {
        const top = t.snippet?.topLevelComment;
        const videoId = String(t.snippet?.videoId ?? top?.snippet?.videoId ?? "");
        if (!top || !videoId) continue;
        rows.push(ytRow(acc, top, null, videoId, moderationStatus === "heldForReview"));
        let replies = t.replies?.comments ?? [];
        if ((t.snippet?.totalReplyCount ?? 0) > replies.length) {
          const more = await yt.get("comments", { part: "snippet", parentId: t.id, maxResults: 100, textFormat: "plainText" });
          replies = more.items ?? replies;
          if (more.nextPageToken) whole = false;
        }
        for (const r of replies) rows.push(ytRow(acc, r, String(top.id), videoId, moderationStatus === "heldForReview"));
      }
      pageToken = res.nextPageToken;
      if (!pageToken) { done = true; break; }
    }
    if (!done) whole = false;
  }
  // video titles for context: from rows we already have, otherwise one videos.list call (1 unit per 50 videos)
  const titles = new Map<string, string>();
  for (const e of existing) if (e.media_title) titles.set(e.media_id, e.media_title);
  const unknown = [...new Set(rows.map((r) => r.media_id))].filter((id) => !titles.has(id));
  for (let i = 0; i < unknown.length; i += 50) {
    const res = await yt.get("videos", { part: "snippet", id: unknown.slice(i, i + 50).join(",") }); // maxResults is not allowed with id
    for (const v of res.items ?? []) titles.set(String(v.id), firstLine(v.snippet?.title));
  }
  for (const r of rows) r.media_title = titles.get(r.media_id) ?? "";
  // comments that YouTube no longer lists are deleted only if every list was read completely
  return { rows, complete: () => whole };
}

// ---------- ops ----------

export type FetchResult = { account: string; platform: string; status: "ok" | "failed"; new?: number; error?: string };

export async function fetchComments(deps: CommentDeps): Promise<FetchResult[]> {
  const out: FetchResult[] = [];
  const nowIso = deps.now().toISOString();
  for (const acc of await deps.store.accounts()) {
    if (!acc.active || !["instagram", "youtube"].includes(acc.platform)) continue;
    try {
      const existing = await deps.store.comments(acc.id);
      const { rows, complete } = acc.platform === "instagram" ? await fetchInstagram(deps, acc, existing) : await fetchYoutube(deps, acc, existing);
      const plan = mergeComments(existing, rows, complete, nowIso);
      await applyPlan(deps.store, plan, nowIso);
      out.push({ account: acc.handle, platform: acc.platform, status: "ok", new: plan.inserts.filter((r) => r.status === "new").length });
    } catch (err) {
      out.push({ account: acc.handle, platform: acc.platform, status: "failed", error: commentError(err) });
    }
  }
  return out;
}

async function load(deps: CommentDeps, commentId: string) {
  const c = await deps.store.comment(commentId);
  if (!c) throw new FinalError("Diesen Kommentar gibt es nicht mehr im Cockpit.");
  const acc = await deps.store.account(c.account_id);
  if (!acc?.active) throw new FinalError("Das Konto ist nicht aktiv.");
  return { c, acc };
}

export async function replyTo(deps: CommentDeps, commentId: string, text: string) {
  const msg = String(text ?? "").trim();
  if (!msg) throw new FinalError("Die Antwort ist leer.");
  if (msg.length > REPLY_MAX) throw new FinalError(`Die Antwort ist ${msg.length} Zeichen lang, höchstens ${REPLY_MAX}.`);
  const { c, acc } = await load(deps, commentId);
  if (c.deleted_at) throw new FinalError("Dieser Kommentar wurde inzwischen gelöscht.");
  if (c.status === "hidden") throw new FinalError("Der Kommentar ist ausgeblendet – zuerst einblenden.");
  const now = deps.now();
  const nowIso = now.toISOString();
  // claimed in the database before anything is sent: a second click or a second cockpit tab gets «schon beantwortet»
  if (!(await deps.store.claimReply(c.id, nowIso))) throw new FinalError("Gerade eben schon beantwortet – nicht doppelt senden.");
  // both platforms only thread one level deep: a reply to a reply goes into the same thread
  const parent = c.parent_remote_id ?? c.remote_id;
  let replyId: string;
  try {
    if (acc.platform === "instagram") {
      const g = graph(deps.fetch, IG_HOST, await deps.store.token(acc.id));
      replyId = String((await g.post(`${parent}/replies`, { message: msg })).id);
    } else if (acc.platform === "youtube") {
      const yt = await youtubeFor(deps, acc);
      replyId = String((await yt.post("comments", { part: "snippet" }, { snippet: { parentId: parent, textOriginal: msg } })).id);
    } else throw new FinalError("Antworten geht nur auf Instagram und YouTube.");
  } catch (err) {
    await deps.store.updateComment(c.id, { replied_at: c.replied_at }).catch(() => {}); // not sent: release the claim
    throw err instanceof FinalError ? err : new FinalError(commentError(err));
  }
  // the answer is online now – bookkeeping problems must not look like a failed send (and invite a second one)
  try {
    await deps.store.insertComments([{
      account_id: acc.id, remote_id: replyId, parent_remote_id: parent, media_id: c.media_id, media_title: c.media_title, media_permalink: c.media_permalink,
      author: acc.handle, author_url: null, body: msg, posted_at: nowIso, like_count: 0, own: true, held: false, status: "done", fetched_at: nowIso, deleted_at: null,
    }]);
    await deps.store.updateComment(c.id, { status: "done", draft: "", replied_at: nowIso });
  } catch (err) {
    console.error("reply bookkeeping", err);
    return { id: c.id, status: "replied", reply_id: replyId, note: "Gesendet. Das Cockpit zeigt die Antwort nach dem nächsten Abholen." };
  }
  return { id: c.id, status: "replied", reply_id: replyId };
}

// ---------- prepared answer below our own first comment ----------
// A text Christoph approved together with the post (frozen with it), sent once some
// hours after publishing, below the first comment our server wrote for that post (remote_comment_id). It goes
// through replyTo like his click, so the inbox shows it and a deleted or hidden first comment stops it.
// Never below comments of other people.

export const REPLY_WINDOW_MS = 7 * 864e5; // posts published longer ago are not picked up any more
export const NO_COMMENT_GRACE_MS = 6 * 3600_000; // YouTube may write the first comment up to 2 h late

export interface ReplyStore {
  dueReplies(since: Date): Promise<Post[]>; // published since then, answer prepared, status still empty
  claimFirstCommentReply(postId: string): Promise<boolean>; // status empty → "sending"; false = already taken
  commentByRemote(accountId: string, remoteId: string): Promise<StoredComment | null>;
  update(postId: string, patch: Record<string, unknown>): Promise<void>;
}
export type ReplyDeps = CommentDeps & { store: CommentsStore & ReplyStore; deadline?: number };

export async function sendDueReplies(deps: ReplyDeps): Promise<Array<{ id: string; status: string }>> {
  const out: Array<{ id: string; status: string }> = [];
  const now = deps.now().getTime();
  for (const post of await deps.store.dueReplies(new Date(now - REPLY_WINDOW_MS))) {
    if (deps.deadline && deps.now().getTime() > deps.deadline) break;
    const text = String(post.first_comment_reply ?? "").trim();
    const hours = Number(post.first_comment_reply_after_hours ?? 4);
    const published = Date.parse(post.published_at ?? "");
    if (post.status !== "published" || post.kind === "story" || !text || post.first_comment_reply_status || !Number.isFinite(published) || !(hours > 0)) continue;
    const due = published + hours * 3600_000;
    if (now < due) continue;
    const fail = async (why: string) => {
      await deps.store.update(post.id, { first_comment_reply_status: "failed", first_comment_reply_error: why.slice(0, 500) });
      out.push({ id: post.id, status: "reply-failed" });
    };
    if (!post.remote_comment_id || !post.remote_media_id) {
      // the first comment never went online: nothing of ours to answer below
      if (now > due + NO_COMMENT_GRACE_MS && (await deps.store.claimFirstCommentReply(post.id))) await fail("Der erste Kommentar fehlt, darum wurde die Antwort nicht gesendet.");
      continue;
    }
    // claimed before anything is sent: a second run never sends it again, whatever happens afterwards
    if (!(await deps.store.claimFirstCommentReply(post.id))) continue;
    let comment: StoredComment | null = null;
    let replyId: string;
    try {
      const acc = await deps.store.account(post.account_id);
      comment = await deps.store.commentByRemote(acc.id, post.remote_comment_id);
      if (!comment) {
        // the inbox has not fetched it yet – we wrote it ourselves when publishing, so it is ours
        const nowIso = deps.now().toISOString();
        await deps.store.insertComments([{
          account_id: acc.id, remote_id: post.remote_comment_id, parent_remote_id: null, media_id: post.remote_media_id,
          media_title: firstLine(post.title || post.caption), media_permalink: acc.platform === "youtube" ? ytWatchUrl(post.remote_media_id) : safeLink(post.permalink, IG_LINK),
          author: acc.handle, author_url: null, body: post.first_comment.slice(0, 10000), posted_at: post.published_at ?? nowIso, like_count: 0,
          own: true, held: false, status: "done", fetched_at: nowIso, deleted_at: null,
        }]);
        comment = await deps.store.commentByRemote(acc.id, post.remote_comment_id);
      }
      if (!comment) throw new FinalError("Der erste Kommentar ist im Cockpit nicht zu finden.");
      if (!comment.own || comment.parent_remote_id) throw new FinalError("Der erste Kommentar ist nicht unser eigener – keine automatische Antwort.");
      replyId = (await replyTo(deps, comment.id, text)).reply_id;
    } catch (err) {
      const why = err instanceof FinalError ? err.message : commentError(err);
      // ready to send by hand: the answer waits as a draft below the first comment in «Kommentare»
      const usable = comment && !comment.deleted_at && comment.own;
      if (usable) await deps.store.updateComment(comment!.id, { draft: text }).catch(() => {});
      await fail(`Antwort nicht gesendet: ${why}${usable ? " Sie liegt unter «Kommentare» als Entwurf bereit." : ""}`);
      continue;
    }
    // online now: a bookkeeping problem leaves "sending" (never sent again), not "failed" (would invite a second send)
    try {
      await deps.store.update(post.id, { first_comment_reply_status: "sent", first_comment_reply_id: replyId, first_comment_reply_sent_at: deps.now().toISOString(), first_comment_reply_error: null });
    } catch (err) {
      console.error("first comment reply bookkeeping", post.id, err);
    }
    out.push({ id: post.id, status: "replied" });
  }
  return out;
}

// ---------- quiz: automatic answer to a correct solution ----------
// Only the prepared texts from the approved post (quiz_correct_replies), picked at random. A comment counts as
// correct when it contains one of the keywords (quiz_answer) as whole words, ignoring case and accents.
// Wrong, unclear, hidden, held-back or already answered comments stay open for Christoph in «Kommentare».

export const QUIZ_WINDOW_MS = 72 * 3600_000;
export const QUIZ_MAX_PER_RUN = 20;

const words = (t: string) =>
  " " + t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2") // "190hPa" → "190 hpa"
    .replace(/(\d)[',’](?=\d{3}\b)/g, "$1") // "1'707" / "1,707" → "1707"
    .replace(/[^a-z0-9]+/g, " ").trim() + " ";
export function quizMatch(text: string, keywords: string[]): boolean {
  const hay = words(String(text ?? ""));
  return keywords.some((k) => { const w = words(String(k ?? "")).trim(); return w.length >= 2 && hay.includes(` ${w} `); });
}

export interface QuizStore {
  quizPosts(since: Date): Promise<Post[]>; // published since then, with a quiz
  claimQuizReply(postId: string, author: string, commentId: string): Promise<string | null>; // id; null = this person already got one
  updateQuizReply(id: string, patch: Record<string, unknown>): Promise<void>;
}
export type QuizDeps = CommentDeps & { store: CommentsStore & QuizStore; random?: () => number; deadline?: number };

export async function answerQuizzes(deps: QuizDeps): Promise<Array<{ id: string; author: string; status: string }>> {
  const out: Array<{ id: string; author: string; status: string }> = [];
  const now = deps.now().getTime();
  const random = deps.random ?? Math.random;
  for (const post of await deps.store.quizPosts(new Date(now - QUIZ_WINDOW_MS))) {
    const keys = (post.quiz_answer ?? []).filter((k) => String(k).trim());
    const texts = (post.quiz_correct_replies ?? []).map((t) => String(t).trim()).filter(Boolean);
    const published = Date.parse(post.published_at ?? "");
    if (post.status !== "published" || !keys.length || !texts.length || !post.remote_media_id || !(now - published <= QUIZ_WINDOW_MS)) continue;
    const acc = await deps.store.account(post.account_id);
    if (!acc?.active) continue;
    const seen = new Set<string>();
    const open = (await deps.store.comments(acc.id))
      .filter((c) => c.media_id === post.remote_media_id && !c.own && !c.deleted_at && !c.held && c.status === "new" && c.author.trim()
        && (!c.posted_at || Date.parse(c.posted_at) >= published))
      .sort((a, b) => Date.parse(a.posted_at ?? "") - Date.parse(b.posted_at ?? ""));
    for (const c of open) {
      if (out.length >= QUIZ_MAX_PER_RUN || (deps.deadline && deps.now().getTime() > deps.deadline)) return out;
      const author = c.author.trim().toLowerCase();
      if (seen.has(author) || !quizMatch(c.body, keys)) continue; // the oldest correct comment of each person
      seen.add(author);
      // the claim (one row per post and person) comes first: never two automatic answers to the same person
      const claim = await deps.store.claimQuizReply(post.id, author, c.id);
      if (!claim) continue;
      const text = texts[Math.min(texts.length - 1, Math.floor(random() * texts.length))];
      try {
        const res = await replyTo(deps, c.id, text);
        await deps.store.updateQuizReply(claim, { status: "sent", reply_text: text, reply_remote_id: res.reply_id }).catch((e) => console.error("quiz bookkeeping", e));
        out.push({ id: c.id, author, status: "replied" });
      } catch (err) {
        // not retried; the comment stays open in «Kommentare» for Christoph
        const why = err instanceof FinalError ? err.message : commentError(err);
        await deps.store.updateQuizReply(claim, { status: "failed", reply_text: text, error: why.slice(0, 500) }).catch(() => {});
        out.push({ id: c.id, author, status: "failed" });
      }
    }
  }
  return out;
}

export type ModerateAction = "hide" | "show" | "approve" | "delete";

export async function moderate(deps: CommentDeps, commentId: string, action: ModerateAction) {
  if (!["hide", "show", "approve", "delete"].includes(action)) throw new FinalError("Unbekannte Aktion.");
  const { c, acc } = await load(deps, commentId);
  if (c.deleted_at) throw new FinalError("Dieser Kommentar wurde inzwischen gelöscht.");
  if (action === "delete" && !c.own) throw new FinalError("Löschen geht nur bei deinen eigenen Antworten – fremde Kommentare ausblenden.");
  if (action === "hide" && c.own) throw new FinalError("Eigene Kommentare kann man nicht ausblenden – löschen geht.");
  try {
    if (acc.platform === "instagram") {
      if (action === "approve") throw new FinalError("Auf Instagram gibt es kein Zurückhalten.");
      const g = graph(deps.fetch, IG_HOST, await deps.store.token(acc.id));
      if (action === "delete") await g.del(c.remote_id);
      else await g.post(c.remote_id, { hide: action === "hide" });
    } else if (acc.platform === "youtube") {
      const yt = await youtubeFor(deps, acc);
      if (action === "delete") await yt.del("comments", { id: c.remote_id });
      // «ausblenden» = back to «zur Überprüfung zurückgehalten»: invisible for others, and reversible (rejected is not)
      else await yt.post("comments/setModerationStatus", { id: c.remote_id, moderationStatus: action === "hide" ? "heldForReview" : "published" });
    } else throw new FinalError("Nur Instagram und YouTube.");
  } catch (err) {
    throw err instanceof FinalError ? err : new FinalError(commentError(err));
  }
  const nowIso = deps.now().toISOString();
  const patch: Record<string, unknown> =
    action === "delete" ? { deleted_at: nowIso }
    : action === "hide" ? { status: "hidden" }
    : action === "show" ? { status: "done", held: false }
    : { held: false, status: c.status === "hidden" ? "new" : c.status };
  await deps.store.updateComment(c.id, patch);
  return { id: c.id, status: action };
}

// ---------- connecting a YouTube channel ----------

// local development (http://localhost:5185/youtube-callback.html) only when listed in GOOGLE_REDIRECT_URIS
export const REDIRECTS_DEFAULT = ["https://cockpit.setqnh.ch/youtube-callback.html"];
const APP_ID = /^[a-z0-9-]{2,30}$/;

function checkConnect(google: GoogleConfig | null | undefined, allowed: string[], appId: string, redirectUri: string): GoogleConfig {
  if (!google) throw new FinalError("YouTube ist noch nicht eingerichtet: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen (docs/social-setup.md, «YouTube verbinden»).");
  if (!APP_ID.test(appId)) throw new FinalError("Unbekannte App/Marke.");
  if (!allowed.includes(redirectUri)) throw new FinalError(`Diese Rücksprung-Adresse ist nicht erlaubt: ${redirectUri}`);
  return google;
}

export function youtubeAuth(google: GoogleConfig | null | undefined, allowed: string[], appId: string, redirectUri: string, state: string) {
  const cfg = checkConnect(google, allowed, appId, redirectUri);
  if (!/^[A-Za-z0-9-]{16,100}$/.test(state)) throw new FinalError("Ungültiger Status-Wert.");
  return { url: authUrl(cfg, redirectUri, state) };
}

export async function youtubeConnect(deps: CommentDeps, allowed: string[], appId: string, code: string, redirectUri: string) {
  const cfg = checkConnect(deps.google, allowed, appId, redirectUri);
  if (!code || code.length > 2000) throw new FinalError("Kein Code von Google erhalten.");
  try {
    const t = await exchangeCode(deps.fetch, cfg, code, redirectUri);
    const granted = t.scope.split(/\s+/);
    if (!YT_SCOPES.every((s) => granted.includes(s))) {
      throw new FinalError("Bei Google wurden nicht alle Häkchen gesetzt. Bitte neu verbinden und beide YouTube-Berechtigungen erlauben (Videos hochladen, Kommentare verwalten).");
    }
    if (!t.refreshToken) throw new FinalError("Google hat keinen dauerhaften Zugang geliefert. Bitte neu verbinden.");
    const ch = await youtube(deps.fetch, t.accessToken).get("channels", { part: "snippet", mine: true });
    const item = ch.items?.[0];
    if (!item?.id) throw new FinalError("Mit diesem Google-Konto ist kein YouTube-Kanal verbunden. Beim Anmelden den Kanal (bzw. das Brand-Konto) wählen.");
    const handle = (String(item.snippet?.customUrl ?? "").replace(/^@/, "") || String(item.snippet?.title ?? "") || String(item.id)).slice(0, 60);
    const yts = (await deps.store.accounts()).filter((a) => a.platform === "youtube");
    const mine = yts.find((a) => a.app_id === appId);
    if (mine && mine.remote_id !== String(item.id)) {
      throw new FinalError(`Für diese App ist schon der Kanal @${mine.handle} verbunden – du hast @${handle} gewählt. Beim Anmelden den richtigen Kanal wählen.`);
    }
    const other = yts.find((a) => a.app_id !== appId && a.remote_id === String(item.id));
    if (other) throw new FinalError(`Der Kanal @${handle} ist schon mit «${other.app_id}» verbunden.`);
    const acc = await deps.store.upsertAccount({ app_id: appId, platform: "youtube", remote_id: String(item.id), handle, token_name: `google_token_${appId.replace(/-/g, "_")}_youtube` });
    await deps.store.storeToken(acc.id, t.refreshToken, null); // Google refresh tokens do not expire on a fixed date
    return { account_id: acc.id, handle, title: String(item.snippet?.title ?? "") };
  } catch (err) {
    throw err instanceof FinalError ? err : new FinalError(commentError(err));
  }
}
