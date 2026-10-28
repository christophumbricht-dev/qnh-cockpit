// Pure logic of `npm run studio` (scripts/studio.mjs) and of the studio part of the Social import.
// Tested in tests/studio-cli.test.mjs.
import { createHash } from "node:crypto";
import { formatOf } from "../src/studio/logic.js";
import { afterNewVersion, phaseOf } from "../src/studio/pipeline.js";

export class CliError extends Error {}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const SCOPE_WORDS = ["post", "channel", "all"];
const SLUG = /^[a-z0-9][a-z0-9._-]{1,80}$/;

// a package folder name → studio slug (lower case, only a-z 0-9 . _ -)
export function slugOf(name) {
  const s = String(name).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 81);
  if (!SLUG.test(s)) throw new CliError(`Kein gültiger Name für das Studio: «${name}»`);
  return s;
}

// scenes.json: [{ id, label, start, end }] in seconds, ascending, inside the video
export function checkScenes(list, duration = null) {
  if (!Array.isArray(list)) throw new CliError("scenes.json muss eine Liste sein.");
  const ids = new Set();
  let last = -1;
  return list.map((s, i) => {
    const id = String(s?.id ?? "").trim();
    const label = String(s?.label ?? id).trim();
    const start = Number(s?.start), end = Number(s?.end);
    if (!id || id.length > 60) throw new CliError(`Szene ${i + 1}: «id» fehlt oder ist zu lang.`);
    if (ids.has(id)) throw new CliError(`Szene «${id}» kommt zweimal vor.`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new CliError(`Szene «${id}»: start/end stimmen nicht.`);
    if (start < last - 0.001) throw new CliError(`Szene «${id}» beginnt vor dem Ende der vorherigen.`);
    if (duration && end > duration + 0.5) throw new CliError(`Szene «${id}» endet nach dem Video (${duration.toFixed(1)} s).`);
    ids.add(id);
    last = end;
    return { id, label, start, end };
  });
}

// meta.json of a studio package (long video)
export function checkMeta(m = {}) {
  const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const titles = list(m.titles).map(String).filter(Boolean);
  if (titles.some((t) => t.length > 100)) throw new CliError("Ein Titel ist länger als 100 Zeichen (YouTube).");
  const fps = m.fps == null ? null : Number(m.fps);
  if (fps != null && !(fps >= 1 && fps <= 120)) throw new CliError("fps muss zwischen 1 und 120 liegen.");
  return {
    titles, thumbnails: list(m.thumbnails).map(String), description: String(m.description ?? ""), chapters: String(m.chapters ?? ""),
    shorts: list(m.shorts).map((s) => (typeof s === "string" ? { title: s } : s)), assumptions: list(m.assumptions).map(String),
    ...(m.first_comment ? { first_comment: String(m.first_comment) } : {}), fps,
  };
}

// who is next: Christoph (Sichtung 1/2) or Claude (status work = open / «noch nicht» markers)
export function summary(items, markers) {
  const of = (it) => markers.filter((m) => m.item_id === it.id);
  const todo = (m) => m.status === "open" || m.status === "not_yet";
  return {
    christoph: items.filter((i) => phaseOf(i.status).who === "christoph"),
    claude: items.filter((i) => phaseOf(i.status).who === "claude" && i.status !== "dropped").map((i) => ({ item: i, open: of(i).filter(todo) })),
    approved: items.filter((i) => i.status === "approved"),
  };
}

// the markers Claude works on: the ones of the last finished review (open) and the «noch nicht» of review 2
export const workMarkers = (item, markers) => markers.filter((m) => m.item_id === item.id && (m.status === "open" || m.status === "not_yet"))
  .sort((a, b) => (a.page ?? -1) - (b.page ?? -1) || (a.at ?? -1) - (b.at ?? -1));

// resolve / reject: done in the next version (the one Claude is about to upload)
export function resolvePatch(item, note, scope = null, rule = null) {
  if (!String(note ?? "").trim()) throw new CliError("Bitte kurz sagen, was geändert wurde.");
  if (scope != null && !SCOPE_WORDS.includes(scope)) throw new CliError("--regel muss post, channel oder all sein.");
  if (scope && scope !== "post" && !String(rule ?? "").trim()) throw new CliError("Zur Regel gehört der Regeltext (wie in Abnahme-Regeln.md).");
  return { status: "done", note: String(note).trim().slice(0, 2000), scope: scope ?? null, rule: rule ? String(rule).trim().slice(0, 500) : null, done_version: item.current_version + 1 };
}
export function rejectPatch(item, why) {
  if (!String(why ?? "").trim()) throw new CliError("Bitte den Grund angeben.");
  return { status: "rejected", note: String(why).trim().slice(0, 2000), done_version: item.current_version + 1 };
}

// a new version arrives: an accepted idea becomes a draft, after the draft it is Sichtung 1, after a review (work)
// Sichtung 2; an approved item that changes needs a new approval (src/studio/pipeline.js)
export const statusAfterNewVersion = afterNewVersion;

// the version row for a Social draft (reels, carousels, Shorts): media from the Social bucket
export function versionFromPost(post, { scenes = [], fps = null, assumptions = [] } = {}) {
  const media = post.media ?? [];
  const video = media.find((m) => /^video\//.test(m.type));
  const source = video ? { kind: "storage", path: video.path, ...(video.still ? { still: video.still } : {}) }
    : { kind: "storage", pages: media.map((m) => m.path) };
  return {
    source, scenes, fps, duration: video?.duration ?? null,
    meta: {
      caption: post.caption ?? "", ...(post.title ? { titles: [post.title] } : {}), ...(post.first_comment ? { first_comment: post.first_comment } : {}),
      ...(post.quiz_correct_replies?.length ? { quiz_correct_replies: post.quiz_correct_replies } : {}), ...(assumptions.length ? { assumptions } : {}),
    },
  };
}
export const itemFromPost = (post, account, folder) => ({
  channel: `${account.app_id}/${account.platform}`,
  format: formatOf(post.kind, account.platform, (post.media ?? []).find((m) => m.duration)?.duration ?? null),
  title: (post.title || post.caption || folder).split("\n")[0].slice(0, 200), slug: slugOf(folder),
  day: post.scheduled_at ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date(post.scheduled_at)) : null,
  social_post_id: post.id,
});

// Christoph approved a long video in the studio before its Social draft existed: the import takes the approval over
// only if the draft is exactly what he saw (same video bytes, same description, the title he chose)
export function approvalCarriesOver(item, version, { videoHash, caption, title }) {
  if (item?.status !== "approved" || !item.approved_hash || !version) return false;
  if (item.approved_hash !== version.hash || videoHash !== version.hash) return false;
  const m = version.meta ?? {};
  const chosen = (m.titles ?? [])[m.chosen_title ?? 0] ?? "";
  return (caption ?? "").trim() === (m.description ?? "").trim() && (title ?? "").trim() === chosen.trim();
}

// markers as a review file next to the package (review-v<n>.json) and as text for the chat
export function reviewFile(item, markers) {
  return {
    item: { id: item.id, title: item.title, channel: item.channel, format: item.format, version: item.current_version, status: item.status },
    markers: markers.map(({ id, version, at, page, scene_id, offset_s, x, y, target, category, body, status }) => ({ id, version, at, page, scene_id, offset_s, x, y, target, category, body, status })),
  };
}
export function markerLine(m) {
  const where = m.target !== "medium" ? m.target : m.page != null ? `Seite ${m.page + 1}` : m.at != null ? `${m.at.toFixed(1)} s${m.scene_id ? ` (${m.scene_id} +${(m.offset_s ?? 0).toFixed(1)} s)` : ""}` : "ganzer Beitrag";
  return `${m.id}  ${where}${m.x != null ? ` @${m.x}%/${m.y}%` : ""}  [${m.category}${m.status === "not_yet" ? ", noch nicht" : ""}]  ${m.body}`;
}

// ---------- YouTube-Ablauf: ideas and drafts ----------
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// a new idea (step 1) → studio_items row
export function ideaRow({ channel, day, title, pitch, format = "short", slug = null }) {
  if (!/^[a-z0-9-]{2,30}\/(instagram|youtube|facebook)$/.test(channel ?? "")) throw new CliError("Kanal wie leesidelab/youtube angeben.");
  if (!DAY.test(day ?? "")) throw new CliError("Datum als YYYY-MM-DD angeben.");
  if (!String(title ?? "").trim()) throw new CliError("Titel fehlt.");
  if (!String(pitch ?? "").trim()) throw new CliError("Bitte in ein, zwei Sätzen sagen, worum es geht.");
  if (!["short", "video_long", "reel"].includes(format)) throw new CliError("--format short, video_long oder reel.");
  return { channel, format, title: String(title).trim().slice(0, 200), pitch: String(pitch).trim().slice(0, 2000), day, status: "idea", slug: slugOf(slug ?? `${day}-${title}`) };
}
// what the chats do next with ideas: waiting on Christoph, accepted (make the draft), dropped without a replacement yet
export function ideasOverview(items) {
  const live = items.filter((i) => i.status !== "dropped");
  return {
    waiting: items.filter((i) => i.status === "idea"),
    accepted: items.filter((i) => i.status === "idea_ok"),
    replace: items.filter((i) => i.status === "dropped" && !live.some((x) => x.channel === i.channel && x.day === i.day)),
  };
}
// draft: scene times from the spoken lengths (a short breath between sentences; the picture keeps moving)
export function draftScenes(scenes, durations, gap = 0.4) {
  let t = 0;
  return scenes.map((s, i) => {
    const len = Math.round((durations[i] + gap) * 1000) / 1000;
    const out = { id: s.id, label: s.label ?? s.id, start: Math.round(t * 1000) / 1000, end: Math.round((t + len) * 1000) / 1000 };
    t += len;
    return out;
  });
}
// entwurf.json: { title, scenes: [{ id, label, text, image? }], meta? }
export function checkDraft(d) {
  if (!d || !Array.isArray(d.scenes) || !d.scenes.length) throw new CliError("entwurf.json braucht «scenes»: [{ id, label, text }].");
  const ids = new Set();
  return d.scenes.map((s, i) => {
    const id = String(s.id ?? `s${i + 1}`);
    if (ids.has(id)) throw new CliError(`Szene «${id}» kommt zweimal vor.`);
    ids.add(id);
    if (!String(s.text ?? "").trim()) throw new CliError(`Szene «${id}»: «text» fehlt.`);
    return { id, label: String(s.label ?? id), text: String(s.text).trim(), image: s.image ? String(s.image) : null };
  });
}
// slate text: wrap the sentence for the picture
export function wrap(text, width = 52) {
  const lines = [];
  let line = "";
  for (const w of String(text).split(/\s+/)) {
    if ((line + " " + w).trim().length > width && line) { lines.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

// the import finds the idea a package belongs to: one candidate of the same channel, day and format; with several,
// the one furthest along (a draft before an accepted idea before a mere proposal), never a guess between equals
const ORDER = ["idea", "idea_ok", "draft", "draft_done", "review1", "work", "review2"];
export function pickIdea(candidates) {
  const list = (candidates ?? []).filter((i) => ORDER.includes(i.status));
  if (list.length <= 1) return list[0] ?? null;
  const rank = (i) => ORDER.indexOf(i.status);
  const top = Math.max(...list.map(rank));
  const best = list.filter((i) => rank(i) === top);
  return best.length === 1 ? best[0] : null;
}

// ---------- take over the current Social plan into the Ablauf (npm run studio -- uebernehmen) ----------
// a planned post → Ablauf status: placeholder = idea waiting for Christoph's Ok (step 1), a draft with media = the
// finished post for Sichtung 1 (step 3), approved or out = ready (green); cancelled posts are left out
export function adoptStatus(post, isPlaceholder) {
  if (post.status === "cancelled") return null;
  if (isPlaceholder(post)) return "idea";
  if (["approved", "publishing", "published"].includes(post.status)) return "approved";
  return (post.media ?? []).length ? "review1" : "idea";
}
// placeholder caption «PLATZHALTER · Föhn Teil 2: …» → the idea's title and pitch
export function placeholderText(caption) {
  const text = String(caption ?? "").replace(/^PLATZHALTER\s*[·:–-]?\s*/, "").trim();
  const [first, ...rest] = text.split("\n");
  return { title: (first || "Idee").slice(0, 200), pitch: (rest.join("\n").trim() || first || "").slice(0, 2000) };
}
