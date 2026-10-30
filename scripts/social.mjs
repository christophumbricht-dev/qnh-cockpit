#!/usr/bin/env node
// Imports post packages from pakete/ into the cockpit as DRAFTS (never approves, never publishes).
//
//   npm run social                        what is new / changed / already in the cockpit (changes nothing)
//   npm run social -- import              import new packages, update changed drafts
//   npm run social -- import <ordner> …   only these folders (also packages whose time has passed)
//   npm run social -- stats [--app downwind] [--days 28] [--json] [--refresh]   Instagram statistics (docs/social-statistik.md)
//   npm run social -- comments [fetch] [--all] [--app leesidelab]   comments on our posts/videos (Social → «Kommentare»)
//   npm run social -- comments draft <id> "…"                         reply suggestion – Christoph sends it himself
//   npm run social -- import --replace    also take over changed packages of approved/edited posts (asks Christoph first!)
//   npm run social -- todo-clear [--dry]  empty the to-do notes of drafts/planned/failed posts (backup in pakete/)
//   npm run social -- konkurrenz [--shorts] [--tage 60] [--json] [--holen]   what stands out at other YouTube channels (social-competitors.mjs)
//   npm run social -- platzhalter <app/plattform> <YYYY-MM-DD> <HH:MM> "Was kommt"   hold a day in the calendar (social-placeholder.mjs)
//
// Uses Christoph's admin session from `npm run roadmap -- login`. Remembers what was imported in
// pakete/.imported.json (local, gitignored like the packages). Format: docs/social-paket.md

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, args, fail, signedIn } from "./qnh-session.mjs";
import { EDITABLE, jpegSize, packageHash, plan, replacedPlaceholders } from "./social-lib.mjs";
import { placeholder } from "./social-placeholder.mjs";
import { stats } from "./social-stats.mjs";
import { mb, prepareVideo } from "./social-video.mjs";
import { comments } from "./social-comments.mjs";
import { competitors } from "./social-competitors.mjs";
import { studioFromImport } from "./studio.mjs";
import { findPublishedTwin } from "../src/social/dupes.js";
import { IMPORT, PackageError, isQuizStory, parsePackage } from "../src/social/package.js";
import { KINDS, formatZurich, hoursLabel, validatePost, zurichToUtc } from "../src/social/validate.js";

const DIR = join(ROOT, "pakete");
const MARKERS = join(DIR, ".imported.json");
const BUCKET = "social-media";
// story images named in to-dos ("Bild s1-beta"): looked up in the package folder, then in the Downwind render output
const ASSET_DIRS = [join(ROOT, "..", "..", "02_Apps", "Downwind", "app", "docs", "instagram", "out", "jpg")]; // cockpit lives in C:/QNH/01_Firma/cockpit
const ASSET_NAME = /\bBild ([a-z]\d{0,2}-[a-z0-9-]+)/gi;
const STATUS = { draft: "Entwurf", approved: "freigegeben", publishing: "wird veröffentlicht", published: "veröffentlicht", failed: "Fehler", cancelled: "abgebrochen" };
const ext = (type) => (type === "image/jpeg" ? "jpg" : type === "video/quicktime" ? "mov" : "mp4");

function readMarkers() {
  return existsSync(MARKERS) ? JSON.parse(readFileSync(MARKERS, "utf8")) : {};
}

// pakete/<folder>/post.json + files → parsed package (same rules as the cockpit's «Paket importieren»)
// post.json without its "topic" line – the topic only sorts the cockpit and is filled in separately (topicFills)
const withoutTopic = (bytes) => Buffer.from(bytes.toString("utf8").replace(/^[ \t]*"topic":[ \t]*"(?:[^"\\]|\\.)*",?\r?\n/m, ""), "utf8");

async function readFolder(folder, accounts) {
  const dir = join(DIR, folder);
  const raw = new Map();
  const entries = new Map();
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || !statSync(join(dir, name)).isFile()) continue;
    const bytes = readFileSync(join(dir, name));
    raw.set(name, bytes);
    entries.set(name, new File([bytes], name));
  }
  const pkg = await parsePackage(entries, accounts);
  if (!IMPORT.todo) pkg.todo = ""; // no hand work after posting for now (IMPORT in src/social/package.js)
  const used = ["post.json", ...pkg.files.map((f) => f.name), ...(pkg.cover ? [pkg.cover.name] : [])];
  const item = (f) => {
    const bytes = raw.get(f.name);
    const size = /\.jpe?g$/i.test(f.name) ? jpegSize(bytes) : null;
    // the cover comes straight from the folder without a type – derive it from the file name
    const type = f.type || (/\.jpe?g$/i.test(f.name) ? "image/jpeg" : /\.mp4$/i.test(f.name) ? "video/mp4" : /\.mov$/i.test(f.name) ? "video/quicktime" : "");
    return { file: f, bytes, type, size: bytes.length, width: size?.width, height: size?.height };
  };
  return {
    folder, pkg,
    account_id: pkg.account.id, caption: pkg.kind === "story" ? "" : pkg.caption, suggested_time: pkg.suggested_time,
    hash: packageHash(used.map((n) => [n, n === "post.json" ? withoutTopic(raw.get(n)) : raw.get(n)])),
    items: pkg.files.map((f, i) => ({ ...item(f), alt: pkg.alt[i] ?? "", user_tags: pkg.tags[i] })),
    cover: pkg.cover ? item(pkg.cover) : null,
  };
}

async function upload(sb, postId, it, i) {
  const path = `${postId}/${Date.now().toString(36)}-${i}.${ext(it.type)}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, it.bytes, { contentType: it.type, upsert: false });
  if (error) throw new Error(`Upload ${it.file.name}: ${error.message}`);
  return path;
}

// still frame of a package video → Storage path (null without ffmpeg)
async function uploadStill(sb, postId, jpg, i) {
  return jpg ? upload(sb, postId, { type: "image/jpeg", bytes: jpg, file: { name: `still ${i}` } }, `${i}-still`) : null;
}

async function save(sb, p, id, isNew) {
  const media = [];
  for (const [i, it] of p.items.entries()) {
    let up = it;
    let still = null;
    let video = {};
    if (/^video\//.test(it.type)) {
      const v = prepareVideo(it.bytes);
      if (v.shrunk) p.shrunk = [...(p.shrunk ?? []), v.shrunk];
      up = { ...it, bytes: v.bytes };
      still = await uploadStill(sb, id, v.still, i);
      video = v;   // length and size: YouTube needs the length for the right link (Short or normal video)
    }
    media.push({ path: await upload(sb, id, up, i), type: it.type, alt: it.alt, width: it.width ?? video.width ?? null, height: it.height ?? video.height ?? null,
      duration: video.seconds ?? null,
      ...(it.user_tags?.length ? { user_tags: it.user_tags } : {}), ...(still ? { still } : {}) });
  }
  const youtube = p.pkg.account.platform === "youtube";
  // YouTube cannot take a cover for Shorts through the API – not uploaded
  const cover_path = p.pkg.kind === "reel" && p.cover && !youtube ? await upload(sb, id, p.cover, "cover") : null;
  const row = {
    account_id: p.account_id, kind: p.pkg.kind, caption: p.caption, first_comment: p.pkg.kind === "story" ? "" : p.pkg.first_comment,
    ...(p.hasTitle ? { title: youtube ? p.pkg.title : "" } : {}),
    media, cover_path, scheduled_at: p.suggested_time ?? tomorrow18(),
    ...(p.hasTodo ? { todo: p.pkg.todo } : {}),
    ...(p.hasLocation ? { location: p.pkg.kind === "story" ? null : p.place } : {}),
    ...(p.hasAi ? { ai_generated: p.pkg.ai === true } : {}),
    ...(p.hasKids ? { made_for_kids: p.pkg.made_for_kids === true } : {}),
    ...(p.hasTopic && p.pkg.topic ? { topic: p.pkg.topic } : {}),
    ...(p.hasReply ? { first_comment_reply: p.pkg.kind === "story" ? "" : p.pkg.first_comment_reply, first_comment_reply_after_hours: p.pkg.first_comment_reply_after_hours,
      quiz_answer: p.pkg.quiz_answer, quiz_correct_replies: p.pkg.quiz_correct_replies } : {}),
  };
  const q = isNew
    ? sb.from("social_posts").insert({ id, ...row, source: "package" })
    : sb.from("social_posts").update(row).eq("id", id);
  const { data, error } = await q.select("*").single();   // the whole row: the studio version is made from it
  if (error) throw new Error(error.message);
  return data;
}

const tomorrow18 = () => zurichToUtc(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(Date.now() + 864e5))}T18:00`);

function checks(p, when) {
  const { errors, warnings } = validatePost(
    { kind: p.pkg.kind, items: p.items, caption: p.caption, first_comment: p.pkg.first_comment, first_comment_reply: p.pkg.first_comment_reply,
      first_comment_reply_after_hours: p.pkg.first_comment_reply_after_hours, quiz_answer: p.pkg.quiz_answer, quiz_correct_replies: p.pkg.quiz_correct_replies,
      platform: p.pkg.account.platform, title: p.pkg.title },
    { forApproval: true, scheduledAt: when },
  );
  return [...errors.map((e) => `    ✗ ${e}`), ...warnings.map((w) => `    ! ${w}`)];
}

const firstLine = (t) => String(t ?? "").split("\n").find(Boolean)?.slice(0, 70) ?? "";

// Christoph wants no hand work after posting (23.10.2026): empty the notes of posts that are not out yet.
// Published posts keep theirs. The old notes go to pakete/.todo-backup-<time>.json (local, gitignored).
async function todoClear(sb, a) {
  const { data: rows, error } = await sb.from("social_posts").select("id, status, todo, scheduled_at, caption, title, updated_at").in("status", ["draft", "approved", "failed"]).neq("todo", "");
  if (error) fail(error.message);
  if (!rows.length) return console.log("Keine offenen Notizen an Entwürfen oder geplanten Beiträgen.");
  for (const r of rows) console.log(`· ${formatZurich(r.scheduled_at) || "ohne Zeit"} · ${STATUS[r.status]} · ${firstLine(r.title || r.caption) || "(ohne Text)"}\n    ✋ ${firstLine(r.todo)}`);
  if (a.dry) return console.log(`\n${rows.length} Notizen würden geleert (--dry: nichts geändert).`);
  const backup = join(DIR, `.todo-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backup, JSON.stringify(rows.map(({ id, status, todo }) => ({ id, status, todo })), null, 2));
  const markers = readMarkers();
  let done = 0;
  for (const r of rows) {
    const { data, error: e } = await sb.from("social_posts").update({ todo: "" }).eq("id", r.id).select("updated_at").single();
    if (e) { console.log(`  ✗ ${r.id}: ${e.message}`); continue; }
    done++;
    // still the package's version: keep it that way, so later package updates are not taken for Christoph's edits
    for (const m of Object.values(markers)) if (m?.id === r.id && m.updated_at === r.updated_at) m.updated_at = data.updated_at;
  }
  writeFileSync(MARKERS, JSON.stringify(markers, null, 2));
  console.log(`\n${done} von ${rows.length} Notizen geleert. Sicherung: ${backup}`);
}

async function main() {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  if (!["status", "import", "stats", "comments", "todo-clear", "platzhalter", "konkurrenz"].includes(cmd)) fail("Befehle: status | import [ordner …] | stats [--app …] [--days 28] [--json] [--refresh] | comments [fetch|draft <id> \"…\"] | konkurrenz [--shorts] [--holen] | todo-clear [--dry] | platzhalter <app/plattform> <datum> <zeit> \"…\" | platzhalter list");
  if (cmd === "platzhalter") return placeholder(await signedIn(), args(process.argv.slice(3)));
  if (cmd === "todo-clear") return todoClear(await signedIn(), args(process.argv.slice(3), ["dry"]));
  if (cmd === "stats") return stats(await signedIn(), args(process.argv.slice(3), ["json", "refresh"]));
  if (cmd === "konkurrenz") return competitors(await signedIn(), args(process.argv.slice(3), ["json", "shorts", "holen"]));
  if (cmd === "comments") return comments(await signedIn(), args(process.argv.slice(3), ["json", "all", "clear"]));
  const a = args(rest, ["replace"]);
  const only = new Set(a._);
  if (!existsSync(DIR)) fail(`Ordner fehlt: ${DIR}`);

  const sb = await signedIn();
  const [{ data: accounts, error: e1 }, { data: placeRows }, { data: posts, error: e2 }] = await Promise.all([
    sb.from("social_accounts").select("id, app_id, platform, handle, active"),
    sb.from("social_locations").select("page_id, name"),
    sb.from("social_posts").select("*").neq("status", "cancelled"),
  ]);
  if (e1 || e2) fail((e1 ?? e2).message);
  // column "todo" exists after migration 20261014120000_social_todo.sql
  const hasTodo = posts.length ? "todo" in posts[0] : true;

  const folders = readdirSync(DIR).filter((f) => existsSync(join(DIR, f, "post.json")) && (!only.size || only.has(f))).sort();
  for (const f of only) if (!folders.includes(f)) fail(`Kein Paket «${f}» in pakete/`);

  const pkgs = [];
  const broken = [];
  const paused = []; // quiz/poll stories, switched off (IMPORT.quizStories)
  for (const folder of folders) {
    try {
      const p = await readFolder(folder, accounts);
      if (!IMPORT.quizStories && isQuizStory(folder, p.pkg.kind)) { paused.push(folder); continue; }
      pkgs.push(p);
    } catch (err) {
      broken.push({ folder, note: err instanceof PackageError ? err.message : String(err.message ?? err) });
    }
  }

  const markers = readMarkers();
  const rows = plan(pkgs, markers, posts).map((r) => (r.action === "past" && only.has(r.folder) ? { ...r, action: "new" } : r));
  const handle = (id) => `@${accounts.find((x) => x.id === id)?.handle ?? "?"}`;
  const hasLocation = posts.length ? "location" in posts[0] : true;
  // column ai_generated exists after migration 20261022100000_social_ai_label.sql
  const hasAi = posts.length ? "ai_generated" in posts[0] : true;
  // column topic exists after migration 20261023120000_social_topic.sql
  const hasTopic = posts.length ? "topic" in posts[0] : true;
  // column made_for_kids exists after migration 20261024100000_social_made_for_kids.sql
  const hasKids = posts.length ? "made_for_kids" in posts[0] : true;
  if (!hasKids && pkgs.some((p) => p.pkg.made_for_kids)) throw new Error("Pakete mit «made_for_kids» erst importieren, wenn die Migration 20261024100000_social_made_for_kids.sql eingespielt ist.");
  const aiMissing = !hasAi && pkgs.some((p) => p.pkg.ai);
  // column "title" exists after migration 20261020110000_social_youtube.sql
  const hasTitle = posts.length ? "title" in posts[0] : true;
  // columns first_comment_reply… exist after migration 20261023100000_social_comment_reply.sql
  const hasReply = posts.length ? "first_comment_reply" in posts[0] : true;
  const replyMissing = !hasReply && pkgs.some((p) => p.pkg.first_comment_reply || p.pkg.quiz_answer.length);
  const places = placeRows ?? [];
  for (const r of rows) {
    r.hasTodo = hasTodo;
    r.hasLocation = hasLocation;
    r.hasAi = hasAi;
    r.hasTopic = hasTopic;
    r.hasKids = hasKids;
    r.hasTitle = hasTitle;
    r.hasReply = hasReply;
    const loc = r.pkg.location;
    if (loc?.id) r.place = { id: loc.id, name: loc.name || places.find((p) => p.page_id === loc.id)?.name || loc.id };
    else if (loc?.name) {
      const p = places.find((x) => x.name.toLowerCase() === loc.name.toLowerCase());
      r.place = p ? { id: p.page_id, name: p.name } : null;
      if (!p) r.placeMissing = loc.name;
    } else r.place = null;
  }
  // --replace: Christoph asked to take a changed package over although the post was approved or edited
  // (approval is withdrawn → draft; published posts are never touched)
  if (a.replace) for (const r of rows) {
    if (["locked", "conflict"].includes(r.action) && ["approved", "draft", "failed"].includes(r.post.status)) {
      r.withdraw = r.post.status === "approved";
      r.action = "update";
      r.note = r.withdraw ? "Freigabe zurückgezogen – bitte neu freigeben" : "deine Änderungen im Cockpit ersetzt";
    }
  }
  // already on Instagram (also posted directly in the app)? then no new draft – flag it instead
  const seen = await sb.from("social_media_stats").select("media_id, account_id, caption, posted_at, permalink").order("day", { ascending: false }).limit(500);
  const published = [...new Map((seen.data ?? []).map((m) => [m.media_id, m])).values()];
  for (const r of rows) {
    if (r.action !== "new") continue;
    const twin = findPublishedTwin({ account_id: r.account_id, caption: r.caption }, published);
    if (twin) { r.action = "published-elsewhere"; r.note = `schon auf Instagram (${(twin.posted_at ?? "").slice(0, 10)}) – kein Entwurf angelegt. Ordner löschen oder im Plan als gepostet markieren.`; }
  }
  const todo = rows.filter((r) => ["new", "update", "link"].includes(r.action));
  // a to-do note from the package reaches existing posts too – but only where the post has none yet
  // a place added to the list after the import: fill it into existing drafts that have no location yet
  const placeFills = hasLocation ? rows.filter((r) => r.post && r.place && !r.post.location && r.pkg.kind !== "story"
    && ["same", "link", "conflict"].includes(r.action) && ["draft", "failed"].includes(r.post.status)) : [];
  // the package's topic reaches existing posts in every status (it only sorts the cockpit) – where the post has none yet
  const topicFills = hasTopic ? rows.filter((r) => r.post && r.pkg.topic && !r.post.topic && ["same", "link", "conflict", "locked"].includes(r.action)) : [];
  // drafts imported before stills existed: add a still frame from the local package video (the video stays as it is),
  // only while the post is unedited (a video replaced in the cockpit must not get a still of the old package video)
  const stillFills = rows.filter((r) => r.post && markers[r.folder]?.updated_at === r.post.updated_at
    && ["same", "link", "conflict"].includes(r.action) && ["draft", "failed"].includes(r.post.status)
    && !r.post.media_deleted_at && (r.post.media ?? []).some((m, i) => /^video\//.test(m.type) && !m.still && r.items[i]?.bytes));
  const notes = hasTodo ? rows.filter((r) => r.post && r.pkg.todo && !r.post.todo && ["same", "link", "conflict", "locked"].includes(r.action)) : [];

  // after a fill: the marker follows only if it was still in step with the post (an edit in the cockpit must stay
  // detectable, else the next re-rendered package would overwrite it); several fills on one post stay in step
  const bump = (r, at) => {
    if (markers[r.folder] && markers[r.folder].updated_at === r.post.updated_at) markers[r.folder].updated_at = at;
    r.post.updated_at = at;
  };
  if (cmd === "import") {
    for (const r of todo) {
      try {
        let saved = r.post;
        if (r.action === "new") saved = await save(sb, r, crypto.randomUUID(), true);
        if (r.action === "update") {
          const old = [...(r.post.media?.flatMap((m) => [m.path, ...(m.still ? [m.still] : [])]) ?? []), ...(r.post.cover_path ? [r.post.cover_path] : [])];
          if (r.withdraw) {
            const { error } = await sb.from("social_posts").update({ status: "draft" }).eq("id", r.post.id);
            if (error) throw new Error(error.message);
          }
          saved = await save(sb, r, r.post.id, false);
          if (old.length) await sb.storage.from(BUCKET).remove(old); // best effort
        }
        markers[r.folder] = { id: saved.id, hash: r.hash, updated_at: saved.updated_at, imported_at: new Date().toISOString() };
        // the real post is here: its placeholder for that day goes away
        for (const ph of replacedPlaceholders(posts, saved)) {
          const { error } = await sb.from("social_posts").update({ status: "cancelled" }).eq("id", ph.id);
          if (!error) { ph.status = "cancelled"; r.note = [r.note, "Platzhalter ersetzt"].filter(Boolean).join(" · "); }
        }
        // every imported or replaced draft with media becomes a studio version (docs/studio-paket.md)
        if (r.action !== "link" && saved.media?.length) {
          try {
            const note = await studioFromImport(sb, { folder: r.folder, dir: join(DIR, r.folder), post: saved, account: accounts.find((x) => x.id === saved.account_id),
              videoBytes: r.items.find((it) => /^video\//.test(it.type))?.bytes ?? null, packageHash: r.hash });
            if (note) r.note = [r.note, note].filter(Boolean).join(" · ");
          } catch (err) { r.note = [r.note, `Studio: ${err.message}`].filter(Boolean).join(" · "); }
        }
        r.done = true;
        r.status = saved.status;
        r.scheduled_at = saved.scheduled_at ?? r.post?.scheduled_at;
      } catch (err) {
        r.note = `Import fehlgeschlagen: ${err.message}`;
        r.action = "error";
      }
    }
    for (const r of placeFills) {
      const { data, error } = await sb.from("social_posts").update({ location: r.place }).eq("id", r.post.id).select("updated_at").single();
      if (error) { r.note = `Standort nicht übernommen: ${error.message}`; continue; }
      r.placeDone = true;
      bump(r, data.updated_at);
    }
    for (const r of topicFills) {
      const { data, error } = await sb.from("social_posts").update({ topic: r.pkg.topic }).eq("id", r.post.id).select("updated_at").single();
      if (error) { r.note = `Thema nicht übernommen: ${error.message}`; continue; }
      r.topicDone = true;
      bump(r, data.updated_at);
    }
    for (const r of stillFills) {
      try {
        const media = [];
        for (const [i, m] of r.post.media.entries()) {
          if (!/^video\//.test(m.type) || m.still || !r.items[i]?.bytes) { media.push(m); continue; }
          const still = await uploadStill(sb, r.post.id, prepareVideo(r.items[i].bytes).still, i);
          media.push(still ? { ...m, still } : m);
        }
        if (!media.some((m, i) => m.still !== r.post.media[i].still)) continue;
        const { data, error } = await sb.from("social_posts").update({ media }).eq("id", r.post.id).select("updated_at").single();
        if (error) { r.note = `Standbild nicht übernommen: ${error.message}`; continue; }
        r.stillDone = true;
        bump(r, data.updated_at);
      } catch (err) {
        r.note = `Standbild nicht übernommen: ${err.message}`;
      }
    }
    for (const r of notes) {
      const { data, error } = await sb.from("social_posts").update({ todo: r.pkg.todo }).eq("id", r.post.id).select("updated_at").single();
      if (error) { r.note = `To-do nicht übernommen: ${error.message}`; continue; }
      r.noteDone = true;
      bump(r, data.updated_at);
    }
    {
      const done = markers[".assets"] ?? {};
      const names = new Map();
      for (const r of rows) for (const [, n] of (r.pkg.todo ?? "").matchAll(ASSET_NAME)) names.set(n.toLowerCase(), r.folder);
      for (const [name, folder] of names) {
        const file = [join(DIR, folder, `${name}.jpg`), ...ASSET_DIRS.map((d) => join(d, `${name}.jpg`))].find((f) => existsSync(f));
        if (!file) { console.log(`\n! Story-Bild ${name}.jpg nicht gefunden (gesucht in pakete/${folder} und downwind/docs/instagram/out/jpg)`); continue; }
        const bytes = readFileSync(file);
        const hash = packageHash([[name, bytes]]);
        if (done[name] === hash) continue;
        const { error } = await sb.storage.from(BUCKET).upload(`assets/${name}.jpg`, bytes, { contentType: "image/jpeg", upsert: true });
        if (error) { console.log(`\n! Story-Bild ${name}: ${error.message}`); continue; }
        done[name] = hash;
        console.log(`\n⤓ Story-Bild ${name}.jpg hochgeladen`);
      }
      markers[".assets"] = done;
    }
    writeFileSync(MARKERS, JSON.stringify(markers, null, 2));
  }

  // ---- report ----
  const label = { "published-elsewhere": "schon veröffentlicht", new: "neu", update: "geändert", link: "schon im Cockpit (verknüpft)", same: "unverändert", locked: "gesperrt", conflict: "nicht überschrieben", deleted: "gelöscht", past: "verpasst", error: "Fehler" };
  const show = (r) => {
    const when = r.scheduled_at ?? r.post?.scheduled_at ?? r.suggested_time;
    const st = r.status ?? r.post?.status;
    console.log(`\n${r.done ? "✓" : "·"} ${r.folder}  [${label[r.action]}${st ? ` · ${STATUS[st] ?? st}` : ""}]`);
    console.log(`    ${formatZurich(when) || "ohne Zeit"} · ${KINDS[r.pkg.kind]} · ${handle(r.account_id)} · ${r.items.length} Datei${r.items.length === 1 ? "" : "en"}`);
    if (firstLine(r.caption)) console.log(`    «${firstLine(r.caption)}»`);
    if (r.pkg.quiz_answer.length) console.log(`    ? Quiz: richtig bei «${r.pkg.quiz_answer.join("», «")}» → automatisch «${r.pkg.quiz_correct_replies.join("» oder «")}»`);
    if (r.pkg.first_comment_reply && r.pkg.kind !== "story") console.log(`    ↳ Antwort auf den ersten Kommentar nach ${hoursLabel(r.pkg.first_comment_reply_after_hours)}: «${firstLine(r.pkg.first_comment_reply)}»`);
    if (r.note) console.log(`    → ${r.note}`);
    if (r.noteDone) console.log("    → To-do-Notiz ergänzt");
    if (r.topicDone) console.log(`    → Thema ergänzt: ${r.pkg.topic}`);
    if (r.stillDone) console.log("    → Standbild für die Vorschau ergänzt");
    for (const s of r.shrunk ?? []) console.log(`    → Video verkleinert: ${mb(s.from)} → ${mb(s.to)}`);
    if (r.placeDone) console.log(`    → Standort ergänzt: 📍 ${r.place.name}`);
    if (r.placeMissing) console.log(`    ! Standort «${r.placeMissing}» ist noch nicht in der Ortsliste – im Cockpit «+ Neuen Ort hinzufügen»; der nächste Import (spätestens 07:30) trägt ihn nach`);
    else if (r.place && (r.done || r.action === "new")) console.log(`    📍 ${r.place.name}`);
    if (r.pkg.todo && !/^nichts\b/i.test(r.pkg.todo.trim()) && (r.done || r.noteDone)) console.log(`    ✋ ${r.pkg.todo.trim().split("\n").join("\n       ")}`);
    if (["new", "update"].includes(r.action) || (r.done && EDITABLE.has(st))) for (const l of checks(r, when)) console.log(l);
  };

  const interesting = rows.filter((r) => r.action !== "same" || r.noteDone || r.topicDone || r.stillDone || r.placeDone || r.placeMissing || only.size);
  for (const r of interesting) show(r);
  for (const b of broken) console.log(`\n✗ ${b.folder}  [ungültig]\n    → ${b.note}`);

  const count = (act) => rows.filter((r) => r.action === act).length;
  console.log(`\n${pkgs.length + broken.length} Pakete: ${count("new")} neu, ${count("update")} geändert, ${count("link")} verknüpft, ${count("same")} unverändert` +
    `${count("past") ? `, ${count("past")} verpasst` : ""}${count("conflict") + count("locked") ? `, ${count("conflict") + count("locked")} nicht übernommen` : ""}${broken.length ? `, ${broken.length} ungültig` : ""}.`);
  if (cmd === "status" && stillFills.length) console.log(`${stillFills.length} Entwürfe bekommen beim Import ein Standbild für die Vorschau.`);
  if (paused.length) console.log(`Pausiert (Quiz-/Umfrage-Storys werden zurzeit nicht angelegt): ${paused.join(", ")}`);
  if (replyMissing) console.log("Hinweis: «first_comment_reply» und das Quiz werden erst übernommen, wenn die Migration 20261023100000_social_comment_reply.sql eingespielt ist.");
  if (aiMissing) console.log("Hinweis: «ai»: true (KI-Info) wird erst übernommen, wenn die Migration 20261022100000_social_ai_label.sql eingespielt ist.");
  if (!hasTodo && rows.some((r) => r.pkg.todo)) console.log("Hinweis: To-do-Notizen werden erst übernommen, wenn die Migration 20261014120000_social_todo.sql eingespielt ist.");
  if (!hasTopic && rows.some((r) => r.pkg.topic)) console.log("Hinweis: «topic» (Social → Themen) wird erst übernommen, wenn die Migration 20261023120000_social_topic.sql eingespielt ist.");
  if (cmd === "status" && (todo.length || notes.length || placeFills.length || topicFills.length || stillFills.length)) console.log("Importieren mit: npm run social -- import");
  if (cmd === "import" && todo.some((r) => r.done)) console.log("Als Entwürfe im Cockpit: https://cockpit.setqnh.ch/#social – freigeben machst nur du.");
}

await main();
