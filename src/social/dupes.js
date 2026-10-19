// "Is this draft already on Instagram?" – compares the start of the caption with what Instagram reports
// (social_media_stats, so posts made directly in the app count too). Same account only.
export function captionKey(text) {
  return String(text ?? "").split("\n").find((l) => l.trim()) ?.toLowerCase().normalize("NFKD")
    .replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40) ?? "";
}

// published: [{ media_id, account_id, caption, posted_at, permalink }]; post: { account_id, caption, remote_media_id }
export function findPublishedTwin(post, published) {
  const key = captionKey(post.caption);
  if (key.length < 12) return null; // stories without text, very short captions: no guess
  return published.find((m) => m.account_id === post.account_id && m.media_id !== post.remote_media_id && captionKey(m.caption) === key) ?? null;
}
