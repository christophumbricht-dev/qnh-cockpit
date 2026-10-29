#!/usr/bin/env node
// Digital Studio bridge for the Claude chats (docs/studio-paket.md).
//
//   npm run studio -- status [--kanal leesidelab/youtube]       what waits on Christoph, what on Claude
//   npm run studio -- markers <id | slug | ordner> [--json]     markers to work on; also writes review-v<n>.json
//   npm run studio -- resolve <marker-id> "was geändert" [--regel all|channel|post "Regeltext"]
//   npm run studio -- reject <marker-id> "warum nicht"
//   npm run studio -- upload <ordner> [--kanal leesidelab/youtube] [--tag YYYY-MM-DD] [--slug …]
//                                                               long YouTube video with "publish_at" in meta.json: also its
//                                                               Social draft (video stays in R2, title picture, captions)
//
// YouTube-Ablauf (src/studio/pipeline.js: Idee → Entwurf → Video → Feinschliff → bereit):
//   npm run studio -- idee <kanal> <YYYY-MM-DD> "Titel" "Worum es geht" [--format …] [--ok]   step 1 (--ok: Christoph already confirmed)
//   npm run studio -- ideen                                     waiting / accepted (make the draft) / dropped (propose another)
//   npm run studio -- entwurf <studio/<slug>>                  step 2: entwurf.json → draft video (Windows voice) → upload
//   npm run studio -- anfrage <slug|-> --titel "Vertonen: …" --saetze 12 --credits 1200 [--text datei.txt] [--art voice|other]
//                                                               ask Christoph in the cockpit (every ElevenLabs voicing!)
//   npm run studio -- anfragen                                  open questions; «ok» = go ahead, then anfrage-erledigt <id>
//   npm run studio -- anfrage-erledigt <id>
//   npm run studio -- auftraege                                 Christoph's instructions from «An Claude» (open first)
//   npm run studio -- auftrag <id> --status doing|done|failed [--antwort "kurz auf Deutsch"]
//   npm run studio -- uebernehmen [--von YYYY-MM-DD] [--wochen 4] [--alle] [--format short] [--dry]   take the Social plan into the Ablauf
//                                                               (--alle: also Shorts with video, outside the Ablauf)
//                                                               (placeholder → idea, draft → Sichtung 1, approved/out → ready)
//                                                               studio package of a long video → new version
//
// The Social import (npm run social -- import) adds a studio version for every draft it creates or replaces
// (studioFromImport below). Signs in like the roadmap CLI (scripts/qnh-session.mjs); admins only, as in the cockpit.
// Nothing here approves a post: the only approval is Christoph's click (or his studio approval of exactly this content).

import { createReadStream, existsSync, openAsBlob, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, args, fail, signedIn } from "./qnh-session.mjs";
import { buildDraft } from "./studio-draft.mjs";
import { PIPELINE_CHANNELS, inPipeline } from "../src/studio/pipeline.js";
import { formatZurich, isPlaceholder } from "../src/social/validate.js";
import { replacedPlaceholders } from "./social-lib.mjs";
import { addDaysIso, mondayOf } from "../src/social/weekplan.js";
import { CliError, approvalCarriesOver, adoptStatus, ideaRow, ideasOverview, pickIdea, placeholderText, requestRow, checkMeta, checkScenes, itemFromPost, markerLine, rejectPatch, resolvePatch, reviewFile, sha256, slugOf,
  statusAfterNewVersion, summary, versionFromPost, workMarkers, youtubeDraftRow } from "./studio-lib.mjs";

const PAKETE = join(ROOT, "pakete");
const STATUS = { idea: "Idee wartet auf Christoph", idea_ok: "Idee ok: Claude macht den Entwurf", draft: "Entwurf wartet auf Christoph", draft_done: "Entwurf ok: Claude macht das Video",
  review1: "wartet auf Sichtung 1", work: "in Arbeit (Claude)", review2: "wartet auf Sichtung 2", approved: "freigegeben", dropped: "Idee verworfen" };
const must = (r) => { if (r.error) throw new CliError(r.error.message); return r.data; };
const missingTables = (e) => /does not exist|could not find/i.test(e?.message ?? "");

async function loadAll(sb) {
  const items = await sb.from("studio_items").select("*").order("day", { ascending: true, nullsFirst: false });
  if (missingTables(items.error)) throw new CliError("Das Studio ist noch nicht eingerichtet (Migration 20261028100000_studio.sql fehlt).");
  const [versions, markers] = await Promise.all([sb.from("studio_versions").select("*"), sb.from("studio_markers").select("*").order("created_at")]);
  return { items: must(items), versions: must(versions), markers: must(markers) };
}
const findItem = (items, ref) => {
  const r = String(ref ?? "").replace(/[\\/]+$/, "");
  let slug = null;
  try { slug = slugOf(/^v\d+$/.test(basename(r)) ? basename(dirname(r)) : basename(r)); } catch { /* not a name */ }
  return items.find((i) => i.id === r) ?? items.find((i) => slug && i.slug === slug) ?? null;
};

async function status(sb, a) {
  const { items, markers } = await loadAll(sb);
  const shown = items.filter((i) => !a.kanal || i.channel === a.kanal);
  const s = summary(shown, markers);
  const line = (i) => `  ${i.day ?? "ohne Tag"}  ${i.channel.padEnd(20)} ${i.format.padEnd(10)} Fassung ${i.current_version}  ${i.title}  (${i.slug ?? i.id})`;
  console.log(`\nClaude ist dran (${s.claude.length}):`);
  for (const { item, open } of s.claude) console.log(`${line(item)}\n    ${open.length} ${open.length === 1 ? "Marker" : "Marker"} offen → npm run studio -- markers ${item.slug ?? item.id}`);
  console.log(`\nWartet auf Christoph (${s.christoph.length}):`);
  for (const i of s.christoph) console.log(`${line(i)}  · ${STATUS[i.status]}`);
  console.log(`\nFreigegeben: ${s.approved.length}`);
}

async function markers(sb, a) {
  const ref = a._[0];
  if (!ref) throw new CliError("Welcher Beitrag? npm run studio -- markers <id | slug | ordner>");
  const { items, markers: all } = await loadAll(sb);
  const item = findItem(items, ref);
  if (!item) throw new CliError(`Kein Studio-Beitrag zu «${ref}».`);
  const list = workMarkers(item, all);
  const file = reviewFile(item, list);
  // next to the package: the folder given, else pakete/<slug>
  const dir = existsSync(ref) && statSync(ref).isDirectory() ? resolve(ref) : item.slug && existsSync(join(PAKETE, item.slug)) ? join(PAKETE, item.slug) : null;
  if (dir) writeFileSync(join(dir, `review-v${item.current_version}.json`), JSON.stringify(file, null, 2));
  if (a.json) return console.log(JSON.stringify(file, null, 2));
  console.log(`\n${item.title} · ${item.channel} · Fassung ${item.current_version} · ${STATUS[item.status]}`);
  if (!list.length) console.log("  keine offenen Marker");
  for (const m of list) console.log(`  ${markerLine(m)}`);
  if (dir) console.log(`\nGeschrieben: ${join(dir, `review-v${item.current_version}.json`)}`);
  console.log("\nErledigt: npm run studio -- resolve <marker-id> \"was geändert\" [--regel all \"Regeltext\"] · Nicht gemacht: reject <marker-id> \"warum\"");
}

async function judge(sb, a, kind) {
  const [id, text, rule] = a._;
  if (!id) throw new CliError(`npm run studio -- ${kind} <marker-id> "…"`);
  const m = must(await sb.from("studio_markers").select("*").eq("id", id).maybeSingle());
  if (!m) throw new CliError(`Kein Marker ${id}.`);
  if (!["open", "not_yet"].includes(m.status)) throw new CliError(`Marker ${id} ist «${m.status}», nicht offen.`);
  const item = must(await sb.from("studio_items").select("*").eq("id", m.item_id).single());
  const patch = kind === "resolve" ? resolvePatch(item, text, a.regel ?? null, rule ?? null) : rejectPatch(item, text);
  must(await sb.from("studio_markers").update(patch).eq("id", id));
  console.log(`✓ Marker ${kind === "resolve" ? "erledigt" : "abgelehnt"} (zeigt sich in Fassung ${patch.done_version}).${patch.scope && patch.scope !== "post" ? " Regel auch in C:\\QNH\\03_Social\\Abnahme-Regeln.md eintragen." : ""}`);
}

const hashFile = (path) => new Promise((ok, no) => {
  const h = createHash("sha256");
  createReadStream(path).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", no);
});
const probe = (path) => {
  try { return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).toString().trim()) || null; } catch { return null; }
};

// R2 through the function studio-media (presigned PUT); null when R2 is not set up (fallback: file on the PC)
async function r2Put(sb, key, path, type) {
  const { data, error } = await sb.functions.invoke("studio-media", { body: { key, method: "PUT" } });
  if (error || !data?.url) return null;
  const res = await fetch(data.url, { method: "PUT", body: await openAsBlob(path, { type }), headers: { "content-type": type }, duplex: "half" });
  if (!res.ok) throw new CliError(`Upload nach R2 fehlgeschlagen (${res.status}).`);
  return key;
}

const probeVideo = (path) => {
  try {
    const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path]).toString().trim().split(",").map(Number);
    return { width: w || null, height: h || null };
  } catch { return {}; }
};

async function upload(sb, a) {
  const dir = a._[0] && resolve(a._[0]);
  if (!dir || !existsSync(join(dir, "video.mp4"))) throw new CliError("Ordner mit video.mp4, scenes.json und meta.json angeben (docs/studio-paket.md).");
  const slug = slugOf(a.slug ?? (/^v\d+$/.test(basename(dir)) ? basename(dirname(dir)) : basename(dir)));
  const video = join(dir, "video.mp4");
  const duration = probe(video);
  const read = (n, empty) => (existsSync(join(dir, n)) ? JSON.parse(readFileSync(join(dir, n), "utf8")) : empty);
  const scenes = checkScenes(read("scenes.json", []), duration);
  const meta = checkMeta(read("meta.json", {}));
  if (meta.captions && !existsSync(join(dir, meta.captions))) throw new CliError(`Untertitel fehlen: ${meta.captions}`);
  const hash = await hashFile(video);

  const { items, versions } = await loadAll(sb);
  let item = items.find((i) => i.slug === slug);
  // the confirmed idea of the same channel, day and format (Ablauf) becomes this video instead of a second item
  if (!item && a.kanal && a.tag) {
    const idea = pickIdea(items.filter((i) => i.channel === a.kanal && i.day === a.tag && i.format === "video_long" && !i.social_post_id && !["dropped", "approved"].includes(i.status)));
    if (idea) item = must(await sb.from("studio_items").update({ slug }).eq("id", idea.id).select().single());
  }
  const mine = item ? versions.filter((v) => v.item_id === item.id).sort((x, y) => x.version - y.version) : [];
  const last = mine.at(-1);
  if (last?.hash === hash) {
    console.log(`= ${slug}: Fassung ${last.version} hat schon genau dieses Video. Nichts hochgeladen.`);
    // its YouTube draft is still missing or holds another cut (e.g. it was approved meanwhile and then withdrawn)
    if (last.source?.kind === "r2" && item.channel.endsWith("/youtube") && item.format === "video_long") {
      const postId = item.social_post_id ?? crypto.randomUUID();
      const thumbs = await socialThumbs(sb, dir, last.meta?.thumbnails ?? [], meta.thumbnails, postId, last.version);
      const version = thumbs === last.meta?.thumbnails ? last : must(await sb.from("studio_versions").update({ meta: { ...last.meta, thumbnails: thumbs } }).eq("id", last.id).select().single());
      await youtubeDraft(sb, item, postId, version, probeVideo(video), last.meta?.captions_key ?? null);
    }
    return;
  }
  const n = (mine.at(-1)?.version ?? 0) + 1;
  if (!item) {
    if (!a.kanal) throw new CliError("Neuer Beitrag: --kanal angeben (z. B. leesidelab/youtube).");
    item = must(await sb.from("studio_items").insert({ channel: a.kanal, format: "video_long", title: (meta.titles[0] ?? slug).slice(0, 200), slug, day: a.tag ?? null }).select().single());
  }
  const key = `studio/${slug}/v${n}/video.mp4`;
  console.log(`Lade ${(statSync(video).size / 1e6).toFixed(0)} MB nach R2 …`);
  const put = await r2Put(sb, key, video, "video/mp4");
  // bytes: the cockpit adds them up against R2's free 10 GB (r2Usage in src/studio/logic.js)
  const source = put ? { kind: "r2", key, bytes: statSync(video).size } : { kind: "local", name: `${slug}/v${n}/video.mp4` };
  // a long YouTube video with a planned time gets its Social draft right away (social-publish reads the video from R2)
  const youtube = put && item.channel.endsWith("/youtube") && item.format === "video_long";
  const postId = youtube ? item.social_post_id ?? crypto.randomUUID() : null;
  // thumbnails: small pictures, also to R2 (the cockpit signs them like the video); for YouTube also into the Social
  // bucket, from where the chosen one becomes the title picture (cover_path)
  let thumbs = [];
  for (const t of meta.thumbnails) {
    const p = join(dir, t);
    if (!existsSync(p)) throw new CliError(`Titelbild fehlt: ${t}`);
    const k = `studio/${slug}/v${n}/${basename(t).replace(/[^A-Za-z0-9._-]/g, "-")}`;
    thumbs.push(put && (await r2Put(sb, k, p, /\.png$/i.test(t) ? "image/png" : "image/jpeg")) ? { key: k, bytes: statSync(p).size } : { name: t });
  }
  if (youtube) thumbs = await socialThumbs(sb, dir, thumbs, meta.thumbnails, postId, n);
  // captions (.srt) next to the video in R2: social-publish uploads them to YouTube
  let captionsKey = null;
  if (put && meta.captions) {
    captionsKey = `studio/${slug}/v${n}/${meta.captions}`;
    if (!(await r2Put(sb, captionsKey, join(dir, meta.captions), "application/x-subrip"))) captionsKey = null;
  }
  const versionMeta = { ...meta, thumbnails: thumbs, ...(captionsKey ? { captions_key: captionsKey } : {}) };
  const saved = must(await sb.from("studio_versions").insert({ item_id: item.id, version: n, source, scenes, fps: meta.fps, duration, meta: versionMeta, hash }).select().single());
  must(await sb.from("studio_items").update({ current_version: n, status: statusAfterNewVersion(item.status), ...(a.tag ? { day: a.tag } : {}) }).eq("id", item.id));
  console.log(`✓ ${slug}: Fassung ${n}${put ? " (Video in R2)" : " · R2 nicht eingerichtet: Christoph öffnet das Video im Studio vom PC («Video vom PC öffnen»)"}.`);
  if (youtube) await youtubeDraft(sb, item, postId, saved, probeVideo(video), captionsKey);
}

// every title picture also into the Social bucket (as JPEG – the bucket takes no PNG), from where the chosen one becomes
// the draft's cover_path and social-publish sets it on YouTube. Returns the same list when nothing was missing.
async function socialThumbs(sb, dir, thumbs, names, postId, n) {
  if (thumbs.every((t) => t?.social)) return thumbs;
  const out = [];
  for (const [i, t] of thumbs.entries()) {
    if (t?.social) { out.push(t); continue; }
    const p = join(dir, names[i] ?? "");
    if (!names[i] || !existsSync(p)) { out.push(t); continue; }
    const jpg = /\.jpe?g$/i.test(p) ? readFileSync(p) : execFileSync("ffmpeg", ["-v", "error", "-i", p, "-frames:v", "1", "-q:v", "2", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { maxBuffer: 64 * 1024 * 1024 });
    const path = `${postId}/thumb-v${n}-${i}.jpg`;
    const { error } = await sb.storage.from("social-media").upload(path, jpg, { contentType: "image/jpeg", upsert: true });
    if (error) throw new CliError(`Titelbild ${names[i]} in den Social-Speicher: ${error.message}`);
    out.push({ ...t, social: path });
  }
  return out;
}

// the Social draft of a long YouTube video (studio-lib youtubeDraftRow): new, or brought up to this version while it
// is still a draft. Christoph approves it in the studio (Sichtung 2 → «Freigeben»), never here.
async function youtubeDraft(sb, item, postId, version, video, captionsKey) {
  if (!version.meta?.publish_at) return console.log("  Kein Social-Entwurf: «publish_at» fehlt in meta.json.");
  const [app] = item.channel.split("/");
  const account = must(await sb.from("social_accounts").select("id, app_id, platform").eq("app_id", app).eq("platform", "youtube").maybeSingle());
  if (!account) return console.log(`  Kein Social-Entwurf: das YouTube-Konto ${item.channel} ist im Cockpit nicht verbunden.`);
  const row = youtubeDraftRow({ accountId: account.id, version, video, captionsKey });
  const old = item.social_post_id ? must(await sb.from("social_posts").select("id, status, media").eq("id", item.social_post_id).maybeSingle()) : null;
  if (old && !["draft", "failed"].includes(old.status)) {
    if (old.media?.[0]?.path === row.media[0].path) return console.log(`  Social-Beitrag ist «${old.status}» und hat schon diese Fassung.`);
    return console.log(`  Social-Beitrag ist schon «${old.status}» mit einer anderen Fassung: neue Fassung NICHT übernommen. Im Cockpit zurückziehen, dann nochmals «npm run studio -- upload» (die Freigabe im Studio prüft, dass es dieselbe Fassung ist).`);
  }
  if (old) must(await sb.from("social_posts").update(row).eq("id", old.id));
  else {
    must(await sb.from("social_posts").insert({ id: postId, ...row, source: "package" }));
    must(await sb.from("studio_items").update({ social_post_id: postId }).eq("id", item.id));
  }
  // the real post is here: its placeholder for that day goes away (like the Social import)
  const { data: holders } = await sb.from("social_posts").select("id, status, caption, media, account_id, scheduled_at").eq("account_id", account.id).eq("status", "draft").like("caption", "PLATZHALTER%");
  for (const ph of replacedPlaceholders(holders ?? [], { id: postId, account_id: account.id, scheduled_at: row.scheduled_at })) {
    const { error } = await sb.from("social_posts").update({ status: "cancelled" }).eq("id", ph.id);
    if (!error) console.log("  Platzhalter für diesen Tag ersetzt.");
  }
  console.log(`  ✓ Social-Entwurf ${old ? "aktualisiert" : "angelegt"}: «${row.title}», ${formatZurich(row.scheduled_at)}${row.cover_path ? ", mit Titelbild" : ""}${captionsKey ? ", mit Untertiteln" : ""}.`);
  console.log("    Freigabe: im Studio (Sichtung 2 → «Freigeben»). social-publish lädt ihn bis 24 h vorher privat hoch und stellt ihn zur Zeit öffentlich.");
}

// --- called by the Social import for every draft it created or replaced ---
let studioReady;
export async function studioFromImport(sb, { folder, dir, post, account, videoBytes, packageHash }) {
  if (studioReady === false) return null;
  const items = await sb.from("studio_items").select("*").or(`social_post_id.eq.${post.id},slug.eq.${slugOf(folder)}`);
  if (missingTables(items.error)) { studioReady = false; return null; }
  studioReady = true;
  const raw = existsSync(join(dir, "post.json")) ? JSON.parse(readFileSync(join(dir, "post.json"), "utf8")) : {};
  // a long video's package names its studio item («studio»: slug); else one item per package folder
  let item = must(items).find((i) => i.social_post_id === post.id) ?? null;
  if (!item && raw.studio) item = must(await sb.from("studio_items").select("*").eq("slug", slugOf(raw.studio)).maybeSingle());
  item ??= must(items).find((i) => i.slug === slugOf(folder)) ?? null;
  // Ablauf (src/studio/pipeline.js): the confirmed idea of the same channel, day and format is this post
  if (!item) {
    const want = itemFromPost(post, account, folder);
    if (inPipeline(want.channel, want.format) && want.day) {
      const open = must(await sb.from("studio_items").select("*").eq("channel", want.channel).eq("day", want.day).eq("format", want.format)
        .is("social_post_id", null).not("status", "in", "(dropped,approved)"));
      item = pickIdea(open);
    }
  }
  const versions = item ? must(await sb.from("studio_versions").select("*").eq("item_id", item.id).order("version")) : [];
  const last = versions.at(-1) ?? null;

  if (item && !item.social_post_id && approvalCarriesOver(item, last, { videoHash: videoBytes ? sha256(videoBytes) : null, caption: post.caption, title: post.title })) {
    const { data: ok, error } = await sb.from("social_posts").update({ status: "approved" }).eq("id", post.id).eq("status", "draft").select("id");
    if (!error && ok?.length) {
      must(await sb.from("studio_items").update({ social_post_id: post.id }).eq("id", item.id));
      return "Studio-Freigabe übernommen (gleicher Inhalt)";
    }
    // not approved (a check of the post failed): the item stays approved-but-unlinked, Christoph approves in Social
    return `Studio-Freigabe NICHT übernommen (${error?.message ?? "Entwurf nicht mehr im Status Entwurf"}): bitte in Social freigeben`;
  }
  if (last?.hash === packageHash) return null;
  const scenes = existsSync(join(dir, "scenes.json")) ? checkScenes(JSON.parse(readFileSync(join(dir, "scenes.json"), "utf8"))) : [];
  const ver = versionFromPost(post, { scenes, fps: raw.fps ?? null, assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [] });
  if (!item) item = must(await sb.from("studio_items").insert(itemFromPost(post, account, folder)).select().single());
  else if (!item.social_post_id) must(await sb.from("studio_items").update({ social_post_id: post.id }).eq("id", item.id));
  const n = (last?.version ?? 0) + 1;
  must(await sb.from("studio_versions").insert({ item_id: item.id, version: n, ...ver, hash: packageHash }));
  const day = itemFromPost(post, account, folder).day;
  must(await sb.from("studio_items").update({ current_version: n, status: statusAfterNewVersion(item.status), ...(day ? { day } : {}) }).eq("id", item.id));
  return n === 1 ? "im Studio" : `Studio Fassung ${n}`;
}

async function idea(sb, a) {
  const [channel, day, title, pitch] = a._;
  const row = ideaRow({ channel, day, title, pitch, format: a.format ?? "short", slug: a.slug ?? null });
  const { items } = await loadAll(sb);
  const taken = items.filter((i) => i.channel === channel && i.day === day && i.format === row.format && i.status !== "dropped");   // Shorts beside a long video are fine
  if (taken.length && !a.zusaetzlich) throw new CliError(`Am ${day} gibt es auf ${channel} schon: ${taken.map((i) => `«${i.title}»`).join(", ")}. Mit --zusaetzlich trotzdem anlegen.`);
  // --ok: Christoph confirmed the idea himself (in a chat): it goes straight to «Idee ok», Claude makes the draft
  if (a.ok) row.status = "idea_ok";
  const saved = must(await sb.from("studio_items").insert(row).select().single());
  console.log(`✓ Idee «${saved.title}» für ${day} (${channel}) ${a.ok ? "ist bestätigt, Claude macht den Entwurf" : "wartet auf Christophs Ok"}. Studio: ${saved.slug}`);
}

async function ideas(sb) {
  const { items } = await loadAll(sb);
  const o = ideasOverview(items);
  const line = (i) => `  ${i.day}  ${i.channel.padEnd(20)} ${i.title}  (${i.slug})${i.idea_note ? `
      Christoph: ${i.idea_note}` : ""}`;
  console.log(`
Warten auf Christophs Ok (${o.waiting.length}):`);
  o.waiting.forEach((i) => console.log(line(i)));
  console.log(`
Ok, Entwurf machen (${o.accepted.length}):  npm run studio -- entwurf <ordner>`);
  o.accepted.forEach((i) => console.log(line(i)));
  console.log(`
Verworfen, neue Idee vorschlagen (${o.replace.length}):  npm run studio -- idee …`);
  o.replace.forEach((i) => console.log(line(i)));
}

async function draft(sb, a) {
  const dir = a._[0] && resolve(a._[0]);
  if (!dir) throw new CliError("Ordner des Studio-Beitrags angeben (mit entwurf.json).");
  const { out, duration, voice } = buildDraft(dir);
  console.log(`Entwurf gebaut: ${out} (${duration.toFixed(1)} s, Stimme ${voice})`);
  await upload(sb, { ...a, _: [out], slug: a.slug ?? basename(dir) });
}

async function ask(sb, a) {
  const ref = a._[0];
  let item_id = null;
  if (ref && ref !== "-") {
    const { items } = await loadAll(sb);
    const it = findItem(items, ref);
    if (!it) throw new CliError(`Kein Studio-Beitrag zu «${ref}».`);
    item_id = it.id;
  }
  const body = a.text ? readFileSync(resolve(a.text), "utf8") : "";
  const row = requestRow({ title: a.titel, body, sentences: a.saetze, credits: a.credits, kind: a.art ?? "voice", item_id });
  const saved = must(await sb.from("studio_requests").insert(row).select("id").single());
  console.log(`✓ Frage im Cockpit (Studio → «Fragen von Claude»): ${row.title}${row.sentences != null ? ` · ${row.sentences} Sätze, etwa ${row.credits} Credits` : ""}. Id ${saved.id}`);
  console.log("Erst nach «ok» weitermachen: npm run studio -- anfragen");
}

async function requests(sb) {
  const r = await sb.from("studio_requests").select("*").in("status", ["pending", "approved", "declined"]).order("created_at");
  if (missingTables(r.error)) throw new CliError("Die Tabelle studio_requests fehlt noch (Migration 20261028200000_studio_jobs.sql).");
  const list = must(r).filter((q) => q.status !== "declined" || Date.now() - Date.parse(q.decided_at ?? q.created_at) < 7 * 864e5);
  const label = { pending: "wartet auf Christoph", approved: "OK: jetzt machen", declined: "abgelehnt" };
  if (!list.length) return console.log("Keine offenen Fragen.");
  for (const q of list) console.log(`  ${q.id}  [${label[q.status]}]  ${q.title}${q.sentences != null ? ` · ${q.sentences} Sätze, ${q.credits} Credits` : ""}${q.answer ? `  · Christoph: ${q.answer}` : ""}`);
  console.log("\nNach dem Erledigen: npm run studio -- anfrage-erledigt <id>");
}

async function requestDone(sb, a) {
  const id = a._[0];
  if (!id) throw new CliError("npm run studio -- anfrage-erledigt <id>");
  const done = must(await sb.from("studio_requests").update({ status: "done", done_at: new Date().toISOString() }).eq("id", id).eq("status", "approved").select("id"));
  console.log(done.length ? "✓ erledigt" : "Nichts geändert: die Frage ist nicht (mehr) freigegeben.");
}

async function instructions(sb) {
  const r = await sb.from("claude_inbox").select("*").in("status", ["open", "doing"]).order("created_at");
  if (missingTables(r.error)) throw new CliError("Die Tabelle claude_inbox fehlt noch (Migration 20261028210000_claude_inbox.sql).");
  const list = must(r);
  if (!list.length) return console.log("Keine offenen Anweisungen von Christoph.");
  for (const q of list) console.log(`\n${q.id}  [${q.status}]  ${q.scope}  (${q.created_at.slice(0, 16).replace("T", " ")} UTC)\n  ${q.body.split("\n").join("\n  ")}`);
  console.log("\nAntworten: npm run studio -- auftrag <id> --status done --antwort \"…\"");
}

async function instruction(sb, a) {
  const id = a._[0];
  const status = a.status ?? "done";
  if (!id || !["doing", "done", "failed"].includes(status)) throw new CliError("npm run studio -- auftrag <id> --status doing|done|failed [--antwort \"…\"]");
  if (status !== "doing" && !String(a.antwort ?? "").trim()) throw new CliError("Zu «done» und «failed» gehört eine kurze Antwort für Christoph (--antwort).");
  const patch = { status, ...(a.antwort ? { reply: String(a.antwort).trim().slice(0, 4000) } : {}), ...(status === "doing" ? {} : { done_at: new Date().toISOString() }) };
  const done = must(await sb.from("claude_inbox").update(patch).eq("id", id).in("status", ["open", "doing"]).select("id"));
  console.log(done.length ? `✓ Anweisung ${status}` : "Nichts geändert: die Anweisung ist nicht mehr offen (zurückgezogen?).");
}

async function adopt(sb, a) {
  const zurich = (iso) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date(iso));
  const from = a.von ?? mondayOf(zurich(new Date().toISOString()));
  const to = addDaysIso(from, 7 * Number(a.wochen ?? 4) - 1);
  const [{ data: accounts, error: e1 }, { data: posts, error: e2 }] = await Promise.all([
    sb.from("social_accounts").select("id, app_id, platform"),
    sb.from("social_posts").select("*").neq("status", "cancelled").gte("scheduled_at", addDaysIso(from, -1)).lte("scheduled_at", addDaysIso(to, 1)),
  ]);
  if (e1 || e2) throw new CliError((e1 ?? e2).message);
  const { items } = await loadAll(sb);
  const made = [];
  for (const p of posts.sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))) {
    const day = zurich(p.scheduled_at);
    if (day < from || day > to) continue;
    const acc = accounts.find((x) => x.id === p.account_id);
    if (!acc) continue;
    const ph = isPlaceholder(p);
    const base = itemFromPost(p, acc, `${day}-${p.id.slice(0, 6)}`);
    // a placeholder has no video yet: a long YouTube video is recognised by its text
    const format = !ph ? base.format
      : acc.platform === "youtube" && /lang(es)?\s*video|langvideo|long video/i.test(p.caption) ? "video_long"
      : /METAR|Karussell|carousel/i.test(p.caption) ? "carousel" : base.format;   // Saturday METAR is a carousel
    // --alle: also posts outside the Ablauf of these channels (YouTube Shorts) that have their video, for Sichtung 1 only
    if (!inPipeline(base.channel, format) && !(a.alle && !ph && PIPELINE_CHANNELS.includes(base.channel))) continue;
    if (a.format && format !== a.format) continue;   // e.g. --format short: only the Shorts
    if (items.some((i) => i.social_post_id === p.id)) continue;
    if (ph && items.some((i) => i.channel === base.channel && i.day === day && i.format === format && !i.social_post_id && i.status !== "dropped")) continue;
    const status = adoptStatus(p, isPlaceholder);
    const row = ph
      ? { channel: base.channel, format, ...placeholderText(p.caption), day, status, slug: slugOf(`${day}-${placeholderText(p.caption).title}`.slice(0, 70) + `-${p.id.slice(0, 4)}`) }
      : { ...base, format, status, ...(p.caption?.trim() || p.title?.trim() ? {} : { title: p.kind === "story" ? "Story" : "Beitrag" }), ...(status === "approved" ? { approved_at: p.updated_at } : {}) };
    made.push({ row, post: p, ph });
  }
  for (const m of made) console.log(`  ${m.row.day}  ${m.row.channel.padEnd(20)} ${m.row.format.padEnd(10)} ${m.row.status.padEnd(9)} ${m.row.title}`);
  if (a.dry) return console.log(`
${made.length} Einträge würden übernommen (Probelauf, nichts geschrieben).`);
  for (const m of made) {
    const it = must(await sb.from("studio_items").insert(m.row).select().single());
    if (!m.ph && (m.post.media ?? []).length) must(await sb.from("studio_versions").insert({ item_id: it.id, version: 1, ...versionFromPost(m.post), hash: null }));
  }
  console.log(`
✓ ${made.length} Einträge ins Studio übernommen (${from} bis ${to}).`);
}

async function main() {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const cmds = { status, markers, resolve: (sb, a) => judge(sb, a, "resolve"), reject: (sb, a) => judge(sb, a, "reject"), upload, idee: idea, ideen: ideas, entwurf: draft, uebernehmen: adopt, anfrage: ask, anfragen: requests, "anfrage-erledigt": requestDone, auftraege: instructions, auftrag: instruction };
  if (!cmds[cmd]) fail("Befehle: status [--kanal …] | markers <id|slug|ordner> [--json] | resolve <marker-id> \"…\" [--regel all|channel|post \"Regel\"] | reject <marker-id> \"…\" | upload <ordner> [--kanal …] [--tag …] | idee <kanal> <datum> \"Titel\" \"Worum\" | ideen | entwurf <ordner> | anfrage <slug|-> --titel … --saetze … --credits … | anfragen | anfrage-erledigt <id> | uebernehmen");
  try {
    await cmds[cmd](await signedIn(), args(rest, ["json", "zusaetzlich", "dry", "alle", "ok"]));
  } catch (err) {
    if (err instanceof CliError) fail(err.message);
    throw err;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, "scripts", "studio.mjs")) main();
