// Studio → «Aufs Handy»: save the video or the pictures of the open post on the phone (Christoph 29.10.2026: «download
// videos or pictures to my phone when in the studio»).
// iPhone: the file is fetched first, then a second tap opens the share sheet with «Video sichern» / «Bild sichern»
// (Safari only allows the share sheet straight from a tap, not after a download). Laptop: a normal download.
// Long videos live in Cloudflare R2: the page may not fetch from there (CSP), so they open as a link to save from Safari.
// Pure helpers are tested in tests/studio-save.test.mjs.

const EXT = /\.(mp4|mov|m4v|jpe?g|png|webp|heic|gif|svg)(?:$|[?#])/i;
const TYPES = { mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif", svg: "image/svg+xml" };
const EXT_OF_TYPE = Object.fromEntries(Object.entries(TYPES).filter(([k]) => k !== "jpeg").map(([k, v]) => [v, k]));

// file extension from a URL (path before ? and #), else the fallback
export function extOf(url, fallback) {
  const m = String(url ?? "").split(/[?#]/)[0].match(EXT);
  return (m ? m[1] : fallback).toLowerCase().replace("jpeg", "jpg");
}

export const typeOf = (ext) => TYPES[ext] ?? "application/octet-stream";

// «Instrument-Reel: Horizont» v2 page 3 → instrument-reel-horizont-v2-3.jpg (plain ASCII, short, no spaces)
export function fileName({ title, version, page = null, url = "", fallbackExt = "mp4" }) {
  const base = String(title || "leeside")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 48).replace(/-+$/, "") || "leeside";
  return `${base}${version ? `-v${version}` : ""}${page != null ? `-${page + 1}` : ""}.${extOf(url, fallbackExt)}`;
}

// can this browser hand these files to the share sheet? (iPhone, iPad, Android; most laptops cannot)
export function canShareFiles(files, nav = globalThis.navigator) {
  try { return !!nav?.canShare && nav.canShare({ files }); } catch { return false; }
}

// fetch the media and wrap it as a File (the Social bucket allows this; R2 does not, see above)
export async function fetchFile(url, name, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const blob = await res.blob();
  // the server knows the type better than the URL: «.jpg» that is really a PNG gets «.png»
  const real = EXT_OF_TYPE[blob.type];
  const fixed = real && extOf(name, "") !== real ? name.replace(/\.[a-z0-9]+$/i, "") + `.${real}` : name;
  return new File([blob], fixed, { type: blob.type || typeOf(extOf(name, "")) });
}

// laptop: a normal download from memory
export function downloadFiles(files, doc = globalThis.document) {
  for (const f of files) {
    const a = doc.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
}

export const sizeText = (files) => {
  const b = files.reduce((s, f) => s + (f.size || 0), 0);
  return b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
};
