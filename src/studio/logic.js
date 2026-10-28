// Digital Studio: pure helpers (tested in tests/studio-logic.test.mjs). No DOM, no Supabase.

export const STATUS = {
  idea: "Idee wartet auf dich",
  idea_ok: "Idee ok, Claude macht den Entwurf",
  draft: "Entwurf wartet auf dich",
  draft_done: "Claude macht das Video",
  dropped: "Idee verworfen",
  review1: "wartet auf Sichtung 1",
  work: "in Arbeit",
  review2: "wartet auf Sichtung 2",
  approved: "freigegeben",
};
export const MARKER_STATUS = { draft: "Entwurf", open: "offen", done: "erledigt", rejected: "abgelehnt", ok: "ok", not_yet: "noch nicht" };
export const CATEGORIES = { picture: "Bild", sound: "Ton", text: "Text", fact: "Fakt", other: "Sonstiges" };
export const TARGETS = { medium: "Video / Bild", caption: "Caption", title: "Titel", description: "Beschreibung", first_comment: "Erster Kommentar", quiz: "Quiz-Antworten", thumbnail: "Titelbild", general: "Ganzer Beitrag" };
export const SCOPES = { post: "nur dieser Beitrag", channel: "ganzer Kanal", all: "alle Kanäle" };
export const isVideo = (format) => ["video_long", "reel", "short", "story"].includes(format);
export const isPages = (format) => format === "carousel" || format === "image";

// 75.25 → "01:15.2"
export function fmtTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r.toFixed(1).padStart(4, "0")}`;
}

// the scene a time falls into (start inclusive, end exclusive; the last scene keeps its end)
export function sceneAt(scenes, t) {
  const list = scenes ?? [];
  return list.find((s, i) => t >= s.start && (t < s.end || (i === list.length - 1 && t <= s.end))) ?? null;
}

// where a marker sits: { scene_id, offset_s } for a time in a version with scenes
export function anchor(scenes, t) {
  const s = sceneAt(scenes, t);
  return s ? { scene_id: s.id, offset_s: Math.round((t - s.start) * 1000) / 1000 } : { scene_id: null, offset_s: null };
}

// a marker of an older version on the new version: same scene, same distance from its start (clamped to the
// scene's new length). Without scenes it keeps its time. → { at, removed } – removed: the scene is gone.
export function remap(marker, newScenes, newDuration = null) {
  if (marker.at == null) return { at: null, removed: false };
  if (!marker.scene_id) return { at: newDuration != null ? Math.min(marker.at, newDuration) : marker.at, removed: false };
  const s = (newScenes ?? []).find((x) => x.id === marker.scene_id);
  if (!s) return { at: null, removed: true };
  const len = Math.max(0, s.end - s.start);
  return { at: Math.round((s.start + Math.min(Math.max(0, marker.offset_s ?? 0), len)) * 1000) / 1000, removed: false };
}

// keyboard → action. inText: the focus is in a text field (then only Escape counts)
export function keyAction({ key, inText = false, format = "reel", paused = true }) {
  if (inText) return key === "Escape" ? "blur" : null;
  if (isPages(format)) {
    if (key === "ArrowLeft") return "prevPage";
    if (key === "ArrowRight") return "nextPage";
    if (key === "m" || key === "M") return "mark";
    return null;
  }
  switch (key) {
    case " ": return "toggle";
    case "ArrowLeft": return "back";
    case "ArrowRight": return "fwd";
    case ",": return paused ? "frameBack" : null;
    case ".": return paused ? "frameFwd" : null;
    case "m": case "M": return "mark";
    default: return null;
  }
}
// arrow step: 5 s for long videos, 1 s for reels and shorts
export const arrowStep = (format) => (format === "video_long" ? 5 : 1);

// the scene start before t (if t is just after a start, the one before that), and the next one
export function sceneJump(scenes, t, dir, duration) {
  const starts = (scenes ?? []).map((s) => s.start).sort((a, b) => a - b);
  if (!starts.length) return dir < 0 ? 0 : duration ?? t;
  if (dir < 0) return [...starts].reverse().find((s) => s < t - 0.5) ?? 0;
  return starts.find((s) => s > t + 0.05) ?? duration ?? t;
}

// markers shown for an item: in Sichtung 2 only those Claude worked on for the current version (so a later round
// shows just the points that were «noch nicht»), plus new ones Christoph sets now; otherwise all
export function markersFor(markers, item) {
  const mine = markers.filter((m) => m.item_id === item.id);
  if (!["draft", "review1", "review2"].includes(item.status)) return mine;
  // a look shows what was worked on for this version and the new drafts; earlier rounds stay behind
  return mine.filter((m) => m.done_version === item.current_version || (m.status === "draft" && m.version === item.current_version));
}

export const openCount = (markers) => markers.filter((m) => m.status === "draft" || m.status === "open" || m.status === "not_yet").length;

// the order of a week round: reels and shorts, then carousels and pictures, then long videos; by day within each
const ROUND_ORDER = { reel: 0, short: 0, story: 0, carousel: 1, image: 1, video_long: 2 };
export function roundOrder(items) {
  return [...items].sort((a, b) => (ROUND_ORDER[a.format] ?? 3) - (ROUND_ORDER[b.format] ?? 3) || String(a.day ?? "").localeCompare(String(b.day ?? "")) || String(a.channel).localeCompare(String(b.channel)));
}

// sort markers: medium by time/page, then texts by target
export function sortMarkers(markers) {
  const t = (m) => (m.target === "medium" ? 0 : 1);
  return [...markers].sort((a, b) => t(a) - t(b) || (a.at ?? a.page ?? 0) - (b.at ?? b.page ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
}

// what a social post's kind and account mean as studio format
export const formatOf = (kind, platform, durationSec = null) =>
  kind === "carousel" ? "carousel" : kind === "image" ? "image" : kind === "story" ? "story"
    : platform === "youtube" ? (durationSec != null && durationSec > 180 ? "video_long" : "short") : "reel";

// Cloudflare R2 (28.10.2026, Christoph: flag it in the cockpit as soon as it would cost something). R2 has no spending
// cap; egress is free, so only storage above the free 10 GB-month costs ($0.015 per GB-month, Standard class).
// What we store is known: every R2 file of a studio version carries its size (source.bytes, thumbnails[].bytes).
export const R2_FREE_BYTES = 10e9;
export const R2_USD_PER_GB = 0.015;
export const R2_WARN_SHARE = 0.8;
export function r2Usage(versions) {
  let bytes = 0, files = 0;
  for (const v of versions ?? []) {
    const parts = [v.source, ...(v.meta?.thumbnails ?? [])].filter((x) => x && (x.kind === "r2" || x.key) && Number(x.bytes) > 0);
    for (const p of parts) { bytes += Number(p.bytes); files++; }
  }
  return { bytes, files };
}
// → null (well inside the free tier), { level: "warn" } from 80 %, { level: "cost", usd } above 10 GB (USD per month)
export function r2Flag(bytes) {
  if (bytes > R2_FREE_BYTES) return { level: "cost", usd: Math.ceil(((bytes - R2_FREE_BYTES) / 1e9) * R2_USD_PER_GB * 100) / 100 };
  if (bytes >= R2_FREE_BYTES * R2_WARN_SHARE) return { level: "warn", usd: 0 };
  return null;
}
export const fmtGB = (bytes) => `${(bytes / 1e9).toFixed(bytes < 1e10 ? 2 : 1)} GB`;
