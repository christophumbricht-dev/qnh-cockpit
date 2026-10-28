// Pure logic of `npm run studio` (scripts/studio.mjs) and of the studio part of the Social import.
// Tested in tests/studio-cli.test.mjs.
import { createHash } from "node:crypto";
import { formatOf } from "../src/studio/logic.js";

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
    christoph: items.filter((i) => i.status === "review1" || i.status === "review2"),
    claude: items.filter((i) => i.status === "work").map((i) => ({ item: i, open: of(i).filter(todo) })),
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

// a new version arrives: review 1 stays review 1, after a review (work) it is review 2; an approved item that changes
// needs a new approval (review 2)
export const statusAfterNewVersion = (status) => (status === "review1" ? "review1" : "review2");

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
