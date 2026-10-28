// ?demo: invented studio items (a long video, a reel, a carousel) with markers, kept in memory.
// The videos are not in the repo: the player offers «Video vom PC öffnen» like the real fallback.
import { mondayOf, addDaysIso } from "../social/weekplan.js";

const listeners = new Set();
const emit = () => setTimeout(() => listeners.forEach((f) => f()), 0);
const wait = (v, ms = 100) => new Promise((r) => setTimeout(() => r(structuredClone(v)), ms));
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
const mon = mondayOf(today);
let n = 100;
const id = () => `d${++n}`;

const SCENES = [
  { id: "intro", label: "Intro", start: 0, end: 28 }, { id: "rain", label: "Warum der Süden Regen bekommt", start: 28, end: 77 },
  { id: "warm", label: "Warum der Norden warm wird", start: 77, end: 114 }, { id: "pilots", label: "Was es für Piloten heisst", start: 114, end: 149 },
  { id: "case", label: "Unfall Gotthard 2007", start: 149, end: 230 }, { id: "signs", label: "Föhn erkennen", start: 230, end: 277 },
  { id: "check", label: "Checkliste", start: 277, end: 316 }, { id: "outro", label: "Schluss", start: 316, end: 337 },
];
const items = [
  { id: "long", channel: "leesidelab/youtube", format: "video_long", title: "Föhn explained for pilots", slug: "foehn-long", day: addDaysIso(mon, 6), status: "review1", current_version: 1, social_post_id: null },
  { id: "reel", channel: "leesidelab/instagram", format: "reel", title: "Panel Puzzle 1: kalter Motor", slug: "2026-11-08-panel-1", day: addDaysIso(mon, 6), status: "review2", current_version: 2, social_post_id: null },
  { id: "car", channel: "downwind/instagram", format: "carousel", title: "3 Dinge, die dein Papier-Flugbuch nicht kann", slug: "2026-11-04-papier", day: addDaysIso(mon, 2), status: "review1", current_version: 1, social_post_id: null },
  // YouTube-Ablauf: one item per step
  { id: "yt1", channel: "leesidelab/youtube", format: "video_long", title: "Wind im Griff 3: Böen beim Aufsetzen", slug: "yt-wind-3", day: addDaysIso(mon, 1), status: "approved", current_version: 2, social_post_id: null },
  { id: "yt2", channel: "leesidelab/youtube", format: "video_long", title: "Woher kommt das Wetter? Die Bise", slug: "yt-bise", day: addDaysIso(mon, 10), status: "work", current_version: 1, social_post_id: null },
  { id: "yt3", channel: "leesidelab/youtube", format: "video_long", title: "Mountain waves explained", slug: "yt-waves", day: addDaysIso(mon, 13), status: "draft_done", current_version: 1, social_post_id: null, pitch: "Lee waves in 3D, rotor, the Andermatt accident as the case." },
  { id: "yt4", channel: "leesidelab/youtube", format: "video_long", title: "Thermik am Morgen", slug: "yt-thermik", day: addDaysIso(mon, 16), status: "draft", current_version: 1, social_post_id: null, pitch: "Why the first thermals start over dry fields and rocks, and when they are strong enough." },
  { id: "yt5", channel: "leesidelab/youtube", format: "video_long", title: "Nebel im Mittelland", slug: "yt-nebel", day: addDaysIso(mon, 23), status: "idea", current_version: 1, social_post_id: null, pitch: "Hochnebel over the Swiss plateau: how it forms in autumn, why it stays all day, what it means for VFR." },
  { id: "yt6", channel: "leesidelab/youtube", format: "video_long", title: "Gewitter im Jura", slug: "yt-gewitter", day: addDaysIso(mon, 25), status: "idea", current_version: 1, social_post_id: null, pitch: "Afternoon thunderstorms along the Jura: where they start and how to see them early." },
];
const versions = [
  { id: "v1", item_id: "long", version: 1, source: { kind: "r2", key: "studio/foehn-long/v1/video.mp4" }, scenes: SCENES, fps: 30, duration: 337,
    meta: { titles: ["Föhn explained for pilots", "Why the north gets 8 °C warmer: föhn for pilots"], thumbnails: [], description: "Föhn in 3D: why the south gets the rain …",
      chapters: SCENES.map((s) => `${Math.floor(s.start / 60)}:${String(s.start % 60).padStart(2, "0")} ${s.label}`).join("\n"), shorts: [], assumptions: ["Musik gleichmässig −15 dB unter der Stimme", "Ortsnamen bleiben (Entscheid 28.10.)"],
      thumbnails: [{ path: "logos/leesidelab.svg" }, { name: "thumb_b.jpg" }] } },
  { id: "v2", item_id: "reel", version: 1, source: { kind: "storage", path: "demo/panel1.mp4" }, scenes: [], fps: 30, duration: 18.5, meta: { caption: "Oil pressure high, oil temp low. What's going on? 👇" } },
  { id: "v3", item_id: "reel", version: 2, source: { kind: "storage", path: "demo/panel1.mp4" }, scenes: [], fps: 30, duration: 18.5, meta: { caption: "Oil pressure high, oil temp low. What's going on? 👇", assumptions: ["Ölanzeigen 12 mm vom Höhenmesser"] } },
  { id: "v5", item_id: "yt4", version: 1, source: { kind: "local", name: "yt-thermik/v1/video.mp4" }, scenes: [{ id: "a", label: "Morgens", start: 0, end: 12 }, { id: "b", label: "Felder und Fels", start: 12, end: 30 }], fps: 30, duration: 30,
    meta: { caption: "Entwurf mit Windows-Stimme", assumptions: ["Entwurf: Stimme Microsoft Zira, Bilder als Skizzen"] } },
  { id: "v4", item_id: "car", version: 1, source: { kind: "storage", pages: ["logos/downwind.svg", "logos/leesidelab.svg", "logos/wolkenhof.svg"] }, scenes: [], meta: { caption: "3 Dinge, die dein Papier-Flugbuch nicht kann 👇" } },
];
const markers = [
  { id: id(), item_id: "long", version: 1, at: 160.4, scene_id: "case", offset_s: 11.4, x: 52, y: 38, target: "medium", category: "picture", body: "Wolkendecke wirkt zu flach, etwas mehr Tiefe?", status: "draft", created_at: "2026-10-28T10:00:00Z" },
  { id: id(), item_id: "reel", version: 1, at: 6.2, scene_id: null, offset_s: null, x: 60, y: 30, target: "medium", category: "picture", body: "Ölanzeigen überschneiden sich mit dem Höhenmesser", status: "done", note: "Ölanzeigen 12 mm nach rechts, Prüfung im Modell", scope: "all", rule: "Instrumente, Schrauben und Ringe mindestens 4 mm Abstand", done_version: 2, created_at: "2026-10-26T09:00:00Z" },
  { id: id(), item_id: "reel", version: 1, at: null, target: "caption", category: "text", body: "Kein Strich als Satzzeichen", status: "done", note: "Strich durch Punkt ersetzt", scope: "all", rule: "Keine Striche als Satzzeichen", done_version: 2, created_at: "2026-10-26T09:01:00Z" },
];

export const load = () => wait({ items, versions, markers });
// demo media: pictures from public/, no videos (the player offers the PC file)
export const url = (source) => (source?.path && !/\.mp4$/.test(source.path) ? source.path : null);
export async function saveMarker(m) {
  const row = m.id ? Object.assign(markers.find((x) => x.id === m.id), m) : { id: id(), status: "draft", created_at: new Date().toISOString(), ...m };
  if (!m.id) markers.push(row);
  emit();
  return structuredClone(row);
}
export async function deleteMarker(mid) { markers.splice(markers.findIndex((x) => x.id === mid), 1); emit(); }
export async function judgeMarker(mid, status) { markers.find((x) => x.id === mid).status = status; emit(); }
export async function finishReview(iid, next = "work") {
  for (const m of markers) if (m.item_id === iid && m.status === "draft") m.status = "open";
  items.find((i) => i.id === iid).status = next;
  emit();
}
export async function setItem(iid, patch) { Object.assign(items.find((i) => i.id === iid), patch); emit(); }
export async function setVersionMeta(vid, meta) { versions.find((v) => v.id === vid).meta = meta; emit(); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
