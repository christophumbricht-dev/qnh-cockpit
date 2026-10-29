// Studio → «Speichern» (src/studio/save.js): file names, extensions, share check, fetch to File.
import test from "node:test";
import assert from "node:assert/strict";
import { canShareFiles, extOf, fetchFile, fileName, sizeText, typeOf } from "../src/studio/save.js";

test("extension from the URL path, also with a query string; else the fallback", () => {
  assert.equal(extOf("https://x.supabase.co/storage/v1/object/public/social-media/a/1.mp4", "jpg"), "mp4");
  assert.equal(extOf("https://acc.r2.cloudflarestorage.com/qnh-studio/studio/a/v1/video.MP4?X-Amz-Signature=abc", "jpg"), "mp4");
  assert.equal(extOf("https://x/y/page-2.jpeg#t", "png"), "jpg");
  assert.equal(extOf("blob:https://cockpit/123", "mp4"), "mp4");
  assert.equal(typeOf("mp4"), "video/mp4");
  assert.equal(typeOf("jpg"), "image/jpeg");
});

test("file name: plain ASCII from the title, version, page number for pictures", () => {
  assert.equal(fileName({ title: "Instrument-Reel: künstlicher Horizont", version: 2, url: "https://x/1.mp4" }), "instrument-reel-kunstlicher-horizont-v2.mp4");
  assert.equal(fileName({ title: "Föhn über den Alpen", version: 1, page: 2, url: "https://x/p3.png", fallbackExt: "jpg" }), "fohn-uber-den-alpen-v1-3.png");
  assert.equal(fileName({ title: "Strasse ß", version: null, url: "" }), "strasse-ss.mp4");
  assert.equal(fileName({ title: "", version: 3, url: "x.jpg" }), "leeside-v3.jpg");
  assert.ok(fileName({ title: "a".repeat(200), version: 1, url: "x.mp4" }).length <= 48 + 8);
});

test("share check: only when the browser can share these files", () => {
  const files = [{ name: "a.mp4" }];
  assert.equal(canShareFiles(files, { canShare: () => true }), true);
  assert.equal(canShareFiles(files, { canShare: () => false }), false);
  assert.equal(canShareFiles(files, {}), false);
  assert.equal(canShareFiles(files, { canShare: () => { throw new Error("x"); } }), false);
  assert.equal(canShareFiles(files, undefined), false);
});

test("fetch to a File with name and type; a failed download is an error", async () => {
  const ok = async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(1500)], { type: "video/mp4" }) });
  const f = await fetchFile("https://x/1.mp4", "reel-v1.mp4", ok);
  assert.equal(f.name, "reel-v1.mp4");
  assert.equal(f.type, "video/mp4");
  assert.equal(f.size, 1500);
  const untyped = async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(10)]) });
  assert.equal((await fetchFile("https://x/p.jpg", "p.jpg", untyped)).type, "image/jpeg");
  const png = async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(5)], { type: "image/png" }) });
  assert.equal((await fetchFile("https://x/p", "post-v1-2.jpg", png)).name, "post-v1-2.png");
  await assert.rejects(fetchFile("https://x/1.mp4", "a.mp4", async () => ({ ok: false, status: 403 })), /403/);
  assert.equal(sizeText([{ size: 7_052_377 }]), "7.1 MB");
  assert.equal(sizeText([{ size: 900 }, { size: 300 }]), "1 KB");
});
