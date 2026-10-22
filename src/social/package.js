// Post packages: a folder or a .zip with post.json + media files, e.g. prepared in a Claude chat.
// A package always becomes a DRAFT – approving stays a separate, manual step.
// Format: docs/social-paket.md
import { unzipSync } from "fflate";
import { KINDS, TAG_DEFAULT, cleanUsername, zurichToUtc } from "./validate.js";

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime" };
const MAX_TOTAL = 200 * 1024 * 1024;
const base = (name) => String(name).split(/[\\/]/).pop();
const typeOf = (name) => TYPES[base(name).split(".").pop().toLowerCase()];

export class PackageError extends Error {}

// Browser entry: FileList/array from <input type=file> (one .zip, or the files of a folder).
export async function readPackage(fileList, accounts) {
  const files = [...fileList];
  const entries = new Map();
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    if (files[0].size > MAX_TOTAL) throw new PackageError("Das Paket ist grösser als 200 MB.");
    const unzipped = unzipSync(new Uint8Array(await files[0].arrayBuffer()), { filter: (f) => !f.name.endsWith("/") && !/(^|\/)(__MACOSX|\.)/.test(f.name) });
    for (const [name, bytes] of Object.entries(unzipped)) addEntry(entries, name, new File([bytes], base(name), { type: typeOf(name) ?? (name.endsWith(".json") ? "application/json" : "") }));
  } else {
    for (const f of files) addEntry(entries, f.webkitRelativePath || f.name, f);
  }
  return parsePackage(entries, accounts);
}

function addEntry(entries, name, file) {
  const key = base(name);
  if (entries.has(key)) throw new PackageError(`Die Datei «${key}» kommt zweimal vor.`);
  entries.set(key, file);
}

// Pure part (unit-tested): entries = Map<basename, File>
export async function parsePackage(entries, accounts) {
  const manifest = entries.get("post.json");
  if (!manifest) throw new PackageError("Im Paket fehlt die Datei post.json.");
  let post;
  try {
    post = JSON.parse(await manifest.text());
  } catch {
    throw new PackageError("post.json ist kein gültiges JSON.");
  }

  const [appId, platform = "instagram"] = String(post.account ?? "").split("/");
  const account = accounts.find((a) => a.app_id === appId && a.platform === platform);
  if (!account) throw new PackageError(`Unbekanntes Konto «${post.account}». Verbunden sind: ${accounts.map((a) => `${a.app_id}/${a.platform}`).join(", ") || "keine"}.`);
  if (!KINDS[post.kind]) throw new PackageError(`Unbekannte Art «${post.kind}». Erlaubt: ${Object.keys(KINDS).join(", ")}.`);

  const names = Array.isArray(post.media) ? post.media : [];
  if (!names.length) throw new PackageError("post.json: «media» braucht mindestens eine Datei.");
  if (names.length > 10) throw new PackageError("post.json: höchstens 10 Dateien.");
  const files = names.map((n) => {
    const f = entries.get(base(n));
    if (!f) throw new PackageError(`Die Datei «${n}» aus post.json fehlt im Paket.`);
    if (!typeOf(n)) throw new PackageError(/\.(png|webp|heic|heif|gif)$/i.test(n) ? `«${n}»: Instagram nimmt nur JPEG – das Bild bitte als .jpg speichern.` : `«${n}»: nur JPEG (.jpg) und MP4/MOV sind erlaubt.`);
    return f.type ? f : new File([f], f.name, { type: typeOf(n) });
  });
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL) throw new PackageError("Die Dateien sind zusammen grösser als 200 MB.");

  let cover = null;
  if (post.cover) {
    cover = entries.get(base(post.cover));
    if (!cover) throw new PackageError(`Das Titelbild «${post.cover}» fehlt im Paket.`);
  }

  let suggested = null;
  if (post.suggested_time) {
    const t = String(post.suggested_time);
    suggested = /(Z|[+-]\d\d:?\d\d)$/.test(t) ? new Date(t) : zurichToUtc(t) && new Date(zurichToUtc(t));
    if (!suggested || Number.isNaN(suggested.getTime())) throw new PackageError(`suggested_time «${t}» ist kein Datum (z. B. 2026-10-25T18:30).`);
    suggested = suggested.toISOString();
  }

  const todo = post.todo == null ? "" : Array.isArray(post.todo) ? post.todo.map(String).join("\n") : String(post.todo);
  if (todo.length > 2000) throw new PackageError("post.json: «todo» höchstens 2000 Zeichen.");

  // "user_tags": [{ "media": 1, "username": "exploring_the_skies", "x": 0.5, "y": 0.9 }] → one list per file
  const tags = names.map(() => []);
  if (post.user_tags != null) {
    if (!Array.isArray(post.user_tags)) throw new PackageError("post.json: «user_tags» muss eine Liste sein.");
    for (const t of post.user_tags) {
      const i = Number(t?.media ?? 1) - 1;
      if (!Number.isInteger(i) || !tags[i]) throw new PackageError(`post.json: user_tags «media: ${t?.media}» – es gibt nur ${names.length} Datei(en).`);
      tags[i].push({ username: cleanUsername(t.username), x: Number(t.x ?? TAG_DEFAULT.x), y: Number(t.y ?? TAG_DEFAULT.y) });
    }
  }

  // "location": "Flugplatz Birrfeld" (a saved place) or { "id": "<Facebook Page ID>", "name": "…" }
  let location = null;
  if (post.location != null && post.location !== "") {
    location = typeof post.location === "string" ? { name: post.location.trim() } : { id: post.location.id == null ? undefined : String(post.location.id), name: String(post.location.name ?? "").trim() };
    if (location.id && !/^[0-9]{5,25}$/.test(location.id)) throw new PackageError(`post.json: location.id «${location.id}» ist keine Facebook-Seiten-ID (nur Ziffern).`);
    if (!location.id && !location.name) throw new PackageError("post.json: «location» braucht einen Namen oder eine ID.");
  }

  // YouTube: video title (caption = description)
  const title = String(post.title ?? "").trim();
  if (title.length > 100) throw new PackageError(`post.json: «title» ist ${title.length} Zeichen lang, höchstens 100 (YouTube).`);

  const alt = Array.isArray(post.alt) ? post.alt.map(String) : names.map(() => String(post.alt ?? ""));
  return {
    account,
    kind: post.kind,
    title,
    caption: String(post.caption ?? ""),
    first_comment: String(post.first_comment ?? ""),
    alt,
    suggested_time: suggested,
    todo,
    tags,
    location,
    ai: post.ai === true, // «KI-Info» on Instagram (AI voice, AI music, AI image)
    files,
    cover,
  };
}
