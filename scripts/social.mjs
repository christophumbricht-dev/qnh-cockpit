#!/usr/bin/env node
// Imports post packages from pakete/ into the cockpit as DRAFTS (never approves, never publishes).
//
//   npm run social                        what is new / changed / already in the cockpit (changes nothing)
//   npm run social -- import              import new packages, update changed drafts
//   npm run social -- import <ordner> …   only these folders (also packages whose time has passed)
//   npm run social -- stats [--app downwind] [--days 28] [--json] [--refresh]   Instagram statistics (docs/social-statistik.md)
//   npm run social -- import --replace    also take over changed packages of approved/edited posts (asks Christoph first!)
//
// Uses Christoph's admin session from `npm run roadmap -- login`. Remembers what was imported in
// pakete/.imported.json (local, gitignored like the packages). Format: docs/social-paket.md

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, args, fail, signedIn } from "./qnh-session.mjs";
import { EDITABLE, jpegSize, packageHash, plan } from "./social-lib.mjs";
import { stats } from "./social-stats.mjs";
import { PackageError, parsePackage } from "../src/social/package.js";
import { KINDS, formatZurich, validatePost, zurichToUtc } from "../src/social/validate.js";

const DIR = join(ROOT, "pakete");
const MARKERS = join(DIR, ".imported.json");
const BUCKET = "social-media";
// story images named in to-dos ("Bild s1-beta"): looked up in the package folder, then in the Downwind render output
const ASSET_DIRS = [join(ROOT, "..", "downwind", "docs", "instagram", "out", "jpg")];
const ASSET_NAME = /\bBild ([a-z]\d{0,2}-[a-z0-9-]+)/gi;
const STATUS = { draft: "Entwurf", approved: "freigegeben", publishing: "wird veröffentlicht", published: "veröffentlicht", failed: "Fehler", cancelled: "abgebrochen" };
const ext = (type) => (type === "image/jpeg" ? "jpg" : type === "video/quicktime" ? "mov" : "mp4");

function readMarkers() {
  return existsSync(MARKERS) ? JSON.parse(readFileSync(MARKERS, "utf8")) : {};
}

// pakete/<folder>/post.json + files → parsed package (same rules as the cockpit's «Paket importieren»)
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
    hash: packageHash(used.map((n) => [n, raw.get(n)])),
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

async function save(sb, p, id, isNew) {
  const media = [];
  for (const [i, it] of p.items.entries()) {
    media.push({ path: await upload(sb, id, it, i), type: it.type, alt: it.alt, width: it.width ?? null, height: it.height ?? null, duration: null,
      ...(it.user_tags?.length ? { user_tags: it.user_tags } : {}) });
  }
  const cover_path = p.pkg.kind === "reel" && p.cover ? await upload(sb, id, p.cover, "cover") : null;
  const row = {
    account_id: p.account_id, kind: p.pkg.kind, caption: p.caption, first_comment: p.pkg.kind === "story" ? "" : p.pkg.first_comment,
    media, cover_path, scheduled_at: p.suggested_time ?? tomorrow18(),
    ...(p.hasTodo ? { todo: p.pkg.todo } : {}),
    ...(p.hasLocation ? { location: p.pkg.kind === "story" ? null : p.place } : {}),
  };
  const q = isNew
    ? sb.from("social_posts").insert({ id, ...row, source: "package" })
    : sb.from("social_posts").update(row).eq("id", id);
  const { data, error } = await q.select("id, status, updated_at, scheduled_at").single();
  if (error) throw new Error(error.message);
  return data;
}

const tomorrow18 = () => zurichToUtc(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(Date.now() + 864e5))}T18:00`);

function checks(p, when) {
  const { errors, warnings } = validatePost(
    { kind: p.pkg.kind, items: p.items, caption: p.caption, first_comment: p.pkg.first_comment },
    { forApproval: true, scheduledAt: when },
  );
  return [...errors.map((e) => `    ✗ ${e}`), ...warnings.map((w) => `    ! ${w}`)];
}

const firstLine = (t) => String(t ?? "").split("\n").find(Boolean)?.slice(0, 70) ?? "";

async function main() {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  if (!["status", "import", "stats"].includes(cmd)) fail("Befehle: status | import [ordner …] | stats [--app …] [--days 28] [--json] [--refresh]");
  if (cmd === "stats") return stats(await signedIn(), args(process.argv.slice(3), ["json", "refresh"]));
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
  for (const folder of folders) {
    try {
      pkgs.push(await readFolder(folder, accounts));
    } catch (err) {
      broken.push({ folder, note: err instanceof PackageError ? err.message : String(err.message ?? err) });
    }
  }

  const markers = readMarkers();
  const rows = plan(pkgs, markers, posts).map((r) => (r.action === "past" && only.has(r.folder) ? { ...r, action: "new" } : r));
  const handle = (id) => `@${accounts.find((x) => x.id === id)?.handle ?? "?"}`;
  const hasLocation = posts.length ? "location" in posts[0] : true;
  const places = placeRows ?? [];
  for (const r of rows) {
    r.hasTodo = hasTodo;
    r.hasLocation = hasLocation;
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
  const todo = rows.filter((r) => ["new", "update", "link"].includes(r.action));
  // a to-do note from the package reaches existing posts too – but only where the post has none yet
  // a place added to the list after the import: fill it into existing drafts that have no location yet
  const placeFills = hasLocation ? rows.filter((r) => r.post && r.place && !r.post.location && r.pkg.kind !== "story"
    && ["same", "link", "conflict"].includes(r.action) && ["draft", "failed"].includes(r.post.status)) : [];
  const notes = hasTodo ? rows.filter((r) => r.post && r.pkg.todo && !r.post.todo && ["same", "link", "conflict", "locked"].includes(r.action)) : [];

  if (cmd === "import") {
    for (const r of todo) {
      try {
        let saved = r.post;
        if (r.action === "new") saved = await save(sb, r, crypto.randomUUID(), true);
        if (r.action === "update") {
          const old = r.post.media?.map((m) => m.path) ?? [];
          if (r.withdraw) {
            const { error } = await sb.from("social_posts").update({ status: "draft" }).eq("id", r.post.id);
            if (error) throw new Error(error.message);
          }
          saved = await save(sb, r, r.post.id, false);
          if (old.length) await sb.storage.from(BUCKET).remove(old); // best effort
        }
        markers[r.folder] = { id: saved.id, hash: r.hash, updated_at: saved.updated_at, imported_at: new Date().toISOString() };
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
      if (markers[r.folder] && r.action !== "conflict") markers[r.folder].updated_at = data.updated_at;
    }
    for (const r of notes) {
      const { data, error } = await sb.from("social_posts").update({ todo: r.pkg.todo }).eq("id", r.post.id).select("updated_at").single();
      if (error) { r.note = `To-do nicht übernommen: ${error.message}`; continue; }
      r.noteDone = true;
      // keep "edited in the cockpit" detection for conflicts; otherwise the post still equals the package
      if (markers[r.folder] && r.action !== "conflict") markers[r.folder].updated_at = data.updated_at;
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
  const label = { new: "neu", update: "geändert", link: "schon im Cockpit (verknüpft)", same: "unverändert", locked: "gesperrt", conflict: "nicht überschrieben", deleted: "gelöscht", past: "verpasst", error: "Fehler" };
  const show = (r) => {
    const when = r.scheduled_at ?? r.post?.scheduled_at ?? r.suggested_time;
    const st = r.status ?? r.post?.status;
    console.log(`\n${r.done ? "✓" : "·"} ${r.folder}  [${label[r.action]}${st ? ` · ${STATUS[st] ?? st}` : ""}]`);
    console.log(`    ${formatZurich(when) || "ohne Zeit"} · ${KINDS[r.pkg.kind]} · ${handle(r.account_id)} · ${r.items.length} Datei${r.items.length === 1 ? "" : "en"}`);
    if (firstLine(r.caption)) console.log(`    «${firstLine(r.caption)}»`);
    if (r.note) console.log(`    → ${r.note}`);
    if (r.noteDone) console.log("    → To-do-Notiz ergänzt");
    if (r.placeDone) console.log(`    → Standort ergänzt: 📍 ${r.place.name}`);
    if (r.placeMissing) console.log(`    ! Standort «${r.placeMissing}» ist noch nicht in der Ortsliste – im Cockpit «+ Neuen Ort hinzufügen»; der nächste Import (spätestens 07:30) trägt ihn nach`);
    else if (r.place && (r.done || r.action === "new")) console.log(`    📍 ${r.place.name}`);
    if (r.pkg.todo && !/^nichts\b/i.test(r.pkg.todo.trim()) && (r.done || r.noteDone)) console.log(`    ✋ ${r.pkg.todo.trim().split("\n").join("\n       ")}`);
    if (["new", "update"].includes(r.action) || (r.done && EDITABLE.has(st))) for (const l of checks(r, when)) console.log(l);
  };

  const interesting = rows.filter((r) => r.action !== "same" || r.noteDone || r.placeDone || r.placeMissing || only.size);
  for (const r of interesting) show(r);
  for (const b of broken) console.log(`\n✗ ${b.folder}  [ungültig]\n    → ${b.note}`);

  const count = (act) => rows.filter((r) => r.action === act).length;
  console.log(`\n${pkgs.length + broken.length} Pakete: ${count("new")} neu, ${count("update")} geändert, ${count("link")} verknüpft, ${count("same")} unverändert` +
    `${count("past") ? `, ${count("past")} verpasst` : ""}${count("conflict") + count("locked") ? `, ${count("conflict") + count("locked")} nicht übernommen` : ""}${broken.length ? `, ${broken.length} ungültig` : ""}.`);
  if (!hasTodo && rows.some((r) => r.pkg.todo)) console.log("Hinweis: To-do-Notizen werden erst übernommen, wenn die Migration 20261014120000_social_todo.sql eingespielt ist.");
  if (cmd === "status" && (todo.length || notes.length || placeFills.length)) console.log("Importieren mit: npm run social -- import");
  if (cmd === "import" && todo.some((r) => r.done)) console.log("Als Entwürfe im Cockpit: https://cockpit.setqnh.ch/#social – freigeben machst nur du.");
}

await main();
