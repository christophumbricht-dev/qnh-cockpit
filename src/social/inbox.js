// Comment inbox – pure helpers (unit-tested in tests/social-inbox.test.mjs).
// Rows come from social_comments; replying/hiding goes through the Edge Function (src/social/data.js).

export const REPLY_MAX = 2200;
export const FILTERS = [["open", "Offen"], ["held", "Zurückgehalten"], ["done", "Erledigt"], ["hidden", "Ausgeblendet"], ["all", "Alle"]];

// a comment that waits for Christoph: new, not ours, still there – and not held back by YouTube (mostly spam,
// invisible for others until he approves it; those have their own filter)
export const isOpen = (c) => c.status === "new" && !c.own && !c.deleted_at && !c.held;
export const isHeld = (c) => c.held && c.status !== "hidden" && !c.deleted_at;
export const openCount = (rows) => (rows ?? []).filter(isOpen).length;
export const heldCount = (rows) => (rows ?? []).filter(isHeld).length;
const t = (c) => (c?.posted_at ? Date.parse(c.posted_at) : 0);

// rows → posts (newest activity first) → threads (top comment + its replies, oldest reply first).
// accountOk(account_id) filters by app; filter: open | held | done | hidden | all
export function groupComments(rows, { filter = "open", accountOk = () => true } = {}) {
  const live = (rows ?? []).filter((c) => !c.deleted_at && accountOk(c.account_id));
  const threads = new Map();
  const thread = (key) => threads.get(key) ?? threads.set(key, { top: null, replies: [] }).get(key);
  for (const c of live) {
    if (c.parent_remote_id) thread(`${c.account_id}:${c.parent_remote_id}`).replies.push(c);
    else thread(`${c.account_id}:${c.remote_id}`).top = c;
  }
  const keep = { open: (x) => x.open, held: (x) => x.held, done: (x) => !x.open && !x.hidden && !x.held, hidden: (x) => x.hidden, all: () => true }[filter] ?? (() => true);
  const posts = new Map();
  for (const [key, th] of threads) {
    th.replies.sort((a, b) => t(a) - t(b));
    const all = [th.top, ...th.replies].filter(Boolean);
    Object.assign(th, {
      key,
      account_id: all[0].account_id,
      media_id: all[0].media_id,
      latest: Math.max(...all.map(t)),
      open: all.some(isOpen),
      held: all.some(isHeld),
      hidden: all.some((c) => c.status === "hidden"),
    });
    if (!keep(th)) continue;
    const pk = `${th.account_id}:${th.media_id}`;
    const post = posts.get(pk) ?? posts.set(pk, { key: pk, account_id: th.account_id, media_id: th.media_id, title: "", permalink: null, latest: 0, open: 0, threads: [] }).get(pk);
    post.threads.push(th);
    post.latest = Math.max(post.latest, th.latest);
    post.open += all.filter(isOpen).length;
    for (const c of all) {
      if (!post.title && c.media_title) post.title = c.media_title;
      if (!post.permalink && c.media_permalink) post.permalink = c.media_permalink;
    }
  }
  const out = [...posts.values()];
  for (const p of out) p.threads.sort((a, b) => b.latest - a.latest);
  return out.sort((a, b) => b.latest - a.latest);
}

// whom the reply box answers: the newest open comment of the thread, else the top comment
export function replyTarget(th) {
  const open = [th.top, ...th.replies].filter((c) => c && isOpen(c));
  return open.at(-1) ?? th.top ?? th.replies.find((c) => !c.own) ?? null;
}

// text the reply box starts with: Claude's/Christoph's draft, else «@name » when answering inside a thread
export function replyPrefill(c) {
  if (!c) return "";
  if (c.draft?.trim()) return c.draft;
  const name = String(c.author ?? "").replace(/^@/, "");
  return c.parent_remote_id && /^[A-Za-z0-9._-]{1,40}$/.test(name) ? `@${name} ` : "";
}

// link to the comment on the platform (YouTube jumps right to it; Instagram has no comment links)
export function commentUrl(c, platform) {
  if (!c?.media_permalink) return null;
  return platform === "youtube" ? `${c.media_permalink}&lc=${encodeURIComponent(c.remote_id)}` : c.media_permalink;
}
