#!/usr/bin/env node
// Digital Studio bridge for the Claude chats (docs/studio-paket.md).
//
//   npm run studio -- status [--kanal leesidelab/youtube]       what waits on Christoph, what on Claude
//   npm run studio -- markers <id | slug | ordner> [--json]     markers to work on; also writes review-v<n>.json
//   npm run studio -- resolve <marker-id> "was geändert" [--regel all|channel|post "Regeltext"]
//   npm run studio -- reject <marker-id> "warum nicht"
//   npm run studio -- upload <ordner> [--kanal leesidelab/youtube] [--tag YYYY-MM-DD] [--slug …]
//
// YouTube-Ablauf (src/studio/pipeline.js: Idee → Entwurf → Video → Feinschliff → bereit):
//   npm run studio -- idee <kanal> <YYYY-MM-DD> "Titel" "Worum es geht" [--format short|video_long]   step 1
//   npm run studio -- ideen                                     waiting / accepted (make the draft) / dropped (propose another)
//   npm run studio -- entwurf <studio/<slug>>                  step 2: entwurf.json → draft video (Windows voice) → upload
//   npm run studio -- uebernehmen [--von YYYY-MM-DD] [--wochen 4] [--dry]   take the Social plan into the Ablauf
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
import { inPipeline } from "../src/studio/pipeline.js";
import { isPlaceholder } from "../src/social/validate.js";
import { addDaysIso, mondayOf } from "../src/social/weekplan.js";
import { CliError, approvalCarriesOver, adoptStatus, ideaRow, ideasOverview, pickIdea, placeholderText, checkMeta, checkScenes, itemFromPost, markerLine, rejectPatch, resolvePatch, reviewFile, sha256, slugOf,
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
  // bytes: the cockpit adds them up against R2's free 10 GB (r2Usage in src/studio/logic.js)
  const source = put ? { kind: "r2", key, bytes: statSync(video).size } : { kind: "local", name: `${slug}/v${n}/video.mp4` };
  // thumbnails: small pictures, also to R2 (the cockpit signs them like the video)
  const thumbs = [];
  for (const t of meta.thumbnails) {
    const p = join(dir, t);
    if (!existsSync(p)) throw new CliError(`Titelbild fehlt: ${t}`);
    const k = `studio/${slug}/v${n}/${basename(t).replace(/[^A-Za-z0-9._-]/g, "-")}`;
    thumbs.push(put && (await r2Put(sb, k, p, /\.png$/i.test(t) ? "image/png" : "image/jpeg")) ? { key: k, bytes: statSync(p).size } : { name: t });
  }
  must(await sb.from("studio_versions").insert({ item_id: item.id, version: n, source, scenes, fps: meta.fps, duration, meta: { ...meta, thumbnails: thumbs }, hash }));
  must(await sb.from("studio_items").update({ current_version: n, status: statusAfterNewVersion(item.status), ...(a.tag ? { day: a.tag } : {}) }).eq("id", item.id));
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
  must(await sb.from("studio_items").update({ current_version: n, status: statusAfterNewVersion(item.status), day }).eq("id", item.id));
  return n === 1 ? "im Studio" : `Studio Fassung ${n}`;
}

async function idea(sb, a) {
  const [channel, day, title, pitch] = a._;
  const row = ideaRow({ channel, day, title, pitch, format: a.format ?? "short", slug: a.slug ?? null });
  const { items } = await loadAll(sb);
  const taken = items.filter((i) => i.channel === channel && i.day === day && i.status !== "dropped");
  if (taken.length && !a.zusaetzlich) throw new CliError(`Am ${day} gibt es auf ${channel} schon: ${taken.map((i) => `«${i.title}»`).join(", ")}. Mit --zusaetzlich trotzdem anlegen.`);
  const saved = must(await sb.from("studio_items").insert(row).select().single());
  console.log(`✓ Idee «${saved.title}» für ${day} (${channel}) wartet auf Christophs Ok. Studio: ${saved.slug}`);
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
      : acc.platform === "youtube" && /lang(es)?s*video|langvideo|long video/i.test(p.caption) ? "video_long"
      : /METAR|Karussell|carousel/i.test(p.caption) ? "carousel" : base.format;   // Saturday METAR is a carousel
    if (!inPipeline(base.channel, format)) continue;
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
  const cmds = { status, markers, resolve: (sb, a) => judge(sb, a, "resolve"), reject: (sb, a) => judge(sb, a, "reject"), upload, idee: idea, ideen: ideas, entwurf: draft, uebernehmen: adopt };
  if (!cmds[cmd]) fail("Befehle: status [--kanal …] | markers <id|slug|ordner> [--json] | resolve <marker-id> \"…\" [--regel all|channel|post \"Regel\"] | reject <marker-id> \"…\" | upload <ordner> [--kanal …] [--tag …] | idee <kanal> <datum> \"Titel\" \"Worum\" | ideen | entwurf <ordner>");
  try {
    await cmds[cmd](await signedIn(), args(rest, ["json", "zusaetzlich", "dry"]));
  } catch (err) {
    if (err instanceof CliError) fail(err.message);
    throw err;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, "scripts", "studio.mjs")) main();
