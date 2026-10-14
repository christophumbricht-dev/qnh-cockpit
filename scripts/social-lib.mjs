// Pure helpers for scripts/social.mjs (unit-tested in tests/social-import.test.mjs).
import { createHash } from "node:crypto";

// Width/height from a JPEG's SOF marker (no image library needed).
export function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

// Fingerprint of a package: post.json + all files it references, so a re-rendered image counts as a change.
export function packageHash(files) {
  const h = createHash("sha256");
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) h.update(name).update("\0").update(bytes).update("\0");
  return h.digest("hex").slice(0, 16);
}

export const EDITABLE = new Set(["draft", "failed"]);

// What to do with each package folder.
//   pkgs:    [{ folder, hash, account_id, caption, suggested_time }]
//   markers: { folder: { id, hash, updated_at } }   (pakete/.imported.json; updated_at = row after our write)
//   posts:   [{ id, status, account_id, caption, source, updated_at }]  (current rows in QNH Core)
export function plan(pkgs, markers, posts, now = new Date()) {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const claimed = new Set(Object.values(markers).map((m) => m.id));
  return pkgs.map((pkg) => {
    const m = markers[pkg.folder];
    if (m) {
      const post = byId.get(m.id);
      if (!post) return { ...pkg, action: "deleted", note: "im Cockpit gelöscht – wird nicht neu angelegt" };
      if (m.hash === pkg.hash) return { ...pkg, action: "same", post };
      if (!EDITABLE.has(post.status)) return { ...pkg, action: "locked", post, note: "geändert, aber schon freigegeben/veröffentlicht – im Cockpit anpassen" };
      // Christoph edited the draft in the cockpit since the last import: his version wins
      if (m.updated_at && post.updated_at !== m.updated_at) return { ...pkg, action: "conflict", post, note: "Paket geändert, aber du hast den Entwurf im Cockpit bearbeitet – nicht überschrieben" };
      return { ...pkg, action: "update", post };
    }
    // imported by hand in the cockpit before this tool existed: same account + same text
    const twin = posts.find((p) => !claimed.has(p.id) && p.source === "package" && p.account_id === pkg.account_id && p.caption === pkg.caption);
    if (twin) return { ...pkg, action: "link", post: twin };
    if (pkg.suggested_time && new Date(pkg.suggested_time) < now) return { ...pkg, action: "past", note: "Zeitpunkt vorbei – nur mit Ordnername importieren" };
    return { ...pkg, action: "new" };
  });
}
