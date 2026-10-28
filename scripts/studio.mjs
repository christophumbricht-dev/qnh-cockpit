#!/usr/bin/env node
// Digital Studio bridge for the Claude chats (docs/studio-paket.md).
//
//   npm run studio -- status [--kanal leesidelab/youtube]       what waits on Christoph, what on Claude
//   npm run studio -- markers <id | slug | ordner> [--json]     markers to work on; also writes review-v<n>.json
//   npm run studio -- resolve <marker-id> "was geändert" [--regel all|channel|post "Regeltext"]
//   npm run studio -- reject <marker-id> "warum nicht"
//   npm run studio -- upload <ordner> [--kanal leesidelab/youtube] [--tag YYYY-MM-DD] [--slug …]
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
import { CliError, approvalCarriesOver, checkMeta, checkScenes, itemFromPost, markerLine, rejectPatch, resolvePatch, reviewFile, sha256, slugOf,
  statusAfterNewVersion, summary, versionFromPost, workMarkers } from "./studio-lib.mjs";

const PAKETE = join(ROOT, "pakete");
const STATUS = { review1: "wartet auf Sichtung 1", work: "in Arbeit (Claude)", review2: "wartet auf Sichtung 2", approved: "freigegeben" };
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

async function upload(sb, a) {
  const dir = a._[0] && resolve(a._[0]);
  if (!dir || !existsSync(join(dir, "video.mp4"))) throw new CliError("Ordner mit video.mp4, scenes.json und meta.json angeben (docs/studio-paket.md).");
  const slug = slugOf(a.slug ?? (/^v\d+$/.test(basename(dir)) ? basename(dirname(dir)) : basename(dir)));
  const video = join(dir, "video.mp4");
  const duration = probe(video);
  const read = (n, empty) => (existsSync(join(dir, n)) ? JSON.parse(readFileSync(join(dir, n), "utf8")) : empty);
  const scenes = checkScenes(read("scenes.json", []), duration);
  const meta = checkMeta(read("meta.json", {}));
  const hash = await hashFile(video);

  const { items, versions } = await loadAll(sb);
  let item = items.find((i) => i.slug === slug);
  const mine = item ? versions.filter((v) => v.item_id === item.id).sort((x, y) => x.version - y.version) : [];
  if (mine.at(-1)?.hash === hash) return console.log(`= ${slug}: Fassung ${mine.at(-1).version} hat schon genau dieses Video. Nichts hochgeladen.`);
  const n = (mine.at(-1)?.version ?? 0) + 1;
  if (!item) {
    if (!a.kanal) throw new CliError("Neuer Beitrag: --kanal angeben (z. B. leesidelab/youtube).");
    item = must(await sb.from("studio_items").insert({ channel: a.kanal, format: "video_long", title: (meta.titles[0] ?? slug).slice(0, 200), slug, day: a.tag ?? null }).select().single());
  }
  const key = `studio/${slug}/v${n}/video.mp4`;
  console.log(`Lade ${(statSync(video).size / 1e6).toFixed(0)} MB nach R2 …`);
  const put = await r2Put(sb, key, video, "video/mp4");
  const source = put ? { kind: "r2", key } : { kind: "local", name: `${slug}/v${n}/video.mp4` };
  // thumbnails: small pictures, also to R2 (the cockpit signs them like the video)
  const thumbs = [];
  for (const t of meta.thumbnails) {
    const p = join(dir, t);
    if (!existsSync(p)) throw new CliError(`Titelbild fehlt: ${t}`);
    const k = `studio/${slug}/v${n}/${basename(t).replace(/[^A-Za-z0-9._-]/g, "-")}`;
    thumbs.push(put && (await r2Put(sb, k, p, /\.png$/i.test(t) ? "image/png" : "image/jpeg")) ? { key: k } : { name: t });
  }
  must(await sb.from("studio_versions").insert({ item_id: item.id, version: n, source, scenes, fps: meta.fps, duration, meta: { ...meta, thumbnails: thumbs }, hash }));
  must(await sb.from("studio_items").update({ current_version: n, status: n === 1 ? "review1" : statusAfterNewVersion(item.status), ...(a.tag ? { day: a.tag } : {}) }).eq("id", item.id));
  console.log(`✓ ${slug}: Fassung ${n}${put ? " (Video in R2)" : " · R2 nicht eingerichtet: Christoph öffnet das Video im Studio vom PC («Video vom PC öffnen»)"}.`);
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
  const versions = item ? must(await sb.from("studio_versions").select("*").eq("item_id", item.id).order("version")) : [];
  const last = versions.at(-1) ?? null;

  if (item && !item.social_post_id && approvalCarriesOver(item, last, { videoHash: videoBytes ? sha256(videoBytes) : null, caption: post.caption, title: post.title })) {
    must(await sb.from("studio_items").update({ social_post_id: post.id }).eq("id", item.id));
    must(await sb.from("social_posts").update({ status: "approved" }).eq("id", post.id).eq("status", "draft"));
    return "Studio-Freigabe übernommen (gleicher Inhalt)";
  }
  if (last?.hash === packageHash) return null;
  const scenes = existsSync(join(dir, "scenes.json")) ? checkScenes(JSON.parse(readFileSync(join(dir, "scenes.json"), "utf8"))) : [];
  const ver = versionFromPost(post, { scenes, fps: raw.fps ?? null, assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [] });
  if (!item) item = must(await sb.from("studio_items").insert(itemFromPost(post, account, folder)).select().single());
  else if (!item.social_post_id) must(await sb.from("studio_items").update({ social_post_id: post.id }).eq("id", item.id));
  const n = (last?.version ?? 0) + 1;
  must(await sb.from("studio_versions").insert({ item_id: item.id, version: n, ...ver, hash: packageHash }));
  const day = itemFromPost(post, account, folder).day;
  must(await sb.from("studio_items").update({ current_version: n, status: n === 1 ? "review1" : statusAfterNewVersion(item.status), day }).eq("id", item.id));
  return n === 1 ? "im Studio" : `Studio Fassung ${n}`;
}

async function main() {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const cmds = { status, markers, resolve: (sb, a) => judge(sb, a, "resolve"), reject: (sb, a) => judge(sb, a, "reject"), upload };
  if (!cmds[cmd]) fail("Befehle: status [--kanal …] | markers <id|slug|ordner> [--json] | resolve <marker-id> \"…\" [--regel all|channel|post \"Regel\"] | reject <marker-id> \"…\" | upload <ordner> [--kanal …] [--tag …]");
  try {
    await cmds[cmd](await signedIn(), args(rest, ["json"]));
  } catch (err) {
    if (err instanceof CliError) fail(err.message);
    throw err;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, "scripts", "studio.mjs")) main();
