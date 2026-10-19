import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parsePackage, readPackage } from "../src/social/package.js";

const ACCOUNTS = [
  { id: "acc-dw", app_id: "downwind", platform: "instagram", handle: "flydownwind" },
  { id: "acc-ss", app_id: "secondseat", platform: "instagram", handle: "secondseat.app" },
];
const POST = {
  account: "downwind/instagram", kind: "carousel", caption: "Fünf Dinge, die dein Flugbuch erledigt.", first_comment: "#ppl",
  alt: ["Startseite der App", "Flugbuch"], suggested_time: "2026-10-25T18:30", media: ["1.jpg", "2.jpg"],
};
const entries = (post = POST, extra = {}) => new Map([
  ["post.json", new File([JSON.stringify(post)], "post.json", { type: "application/json" })],
  ["1.jpg", new File([new Uint8Array(10)], "1.jpg", { type: "image/jpeg" })],
  ["2.jpg", new File([new Uint8Array(10)], "2.jpg", { type: "image/jpeg" })],
  ...Object.entries(extra),
]);

test("a valid package becomes the data for a draft", async () => {
  const p = await parsePackage(entries(), ACCOUNTS);
  assert.equal(p.account.id, "acc-dw");
  assert.equal(p.kind, "carousel");
  assert.equal(p.files.length, 2);
  assert.deepEqual(p.alt, ["Startseite der App", "Flugbuch"]);
  assert.equal(p.suggested_time, "2026-10-25T17:30:00.000Z"); // 18:30 Swiss time; summer time ended at 03:00 that day → UTC+1
  assert.ok(!("status" in p), "a package never carries a status – it is always a draft");
});

test("suggested_time with an explicit offset is kept", async () => {
  const p = await parsePackage(entries({ ...POST, suggested_time: "2026-11-02T08:00:00+01:00" }), ACCOUNTS);
  assert.equal(p.suggested_time, "2026-11-02T07:00:00.000Z");
});

test("clear German errors for broken packages", async () => {
  await assert.rejects(parsePackage(new Map(), ACCOUNTS), /post\.json/);
  await assert.rejects(parsePackage(entries({ ...POST, account: "unknown/instagram" }), ACCOUNTS), /Unbekanntes Konto.*downwind\/instagram/);
  await assert.rejects(parsePackage(entries({ ...POST, kind: "tiktok" }), ACCOUNTS), /Unbekannte Art/);
  await assert.rejects(parsePackage(entries({ ...POST, media: ["1.jpg", "missing.jpg"] }), ACCOUNTS), /missing\.jpg.*fehlt/);
  await assert.rejects(parsePackage(entries({ ...POST, media: ["notes.txt"] }, { "notes.txt": new File(["x"], "notes.txt") }), ACCOUNTS), /nur JPEG/);
  await assert.rejects(parsePackage(entries({ ...POST, suggested_time: "next friday" }), ACCOUNTS), /kein Datum/);
  const bad = new Map(entries()); bad.set("post.json", new File(["{nope"], "post.json"));
  await assert.rejects(parsePackage(bad, ACCOUNTS), /kein gültiges JSON/);
});

test("zip packages, also with a folder inside, and macOS junk is ignored", async () => {
  const zip = zipSync({
    "paket/post.json": strToU8(JSON.stringify({ ...POST, account: "secondseat/instagram", kind: "image", media: ["1.jpg"], alt: "Cockpit" })),
    "paket/1.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
    "__MACOSX/paket/._1.jpg": new Uint8Array([1]),
  });
  const p = await readPackage([new File([zip], "paket.zip", { type: "application/zip" })], ACCOUNTS);
  assert.equal(p.account.id, "acc-ss");
  assert.equal(p.files[0].type, "image/jpeg");
  assert.deepEqual(p.alt, ["Cockpit"]);
});

test("files picked from a folder work like a zip", async () => {
  const files = [...entries().values()];
  const p = await readPackage(files, ACCOUNTS);
  assert.equal(p.files.length, 2);
});

test("todo: optional hand-work note, text or list of lines, max 2000 characters", async () => {
  assert.equal((await parsePackage(entries(), ACCOUNTS)).todo, "");
  assert.equal((await parsePackage(entries({ ...POST, todo: "Story am Vortag\nJürg markieren" }), ACCOUNTS)).todo, "Story am Vortag\nJürg markieren");
  assert.equal((await parsePackage(entries({ ...POST, todo: ["Story", "Standort"] }), ACCOUNTS)).todo, "Story\nStandort");
  await assert.rejects(parsePackage(entries({ ...POST, todo: "x".repeat(2001) }), ACCOUNTS), /todo/);
});

test("user_tags: per file, @ removed, default position bottom centre, index checked", async () => {
  const p = await parsePackage(entries({ ...POST, user_tags: [{ media: 2, username: "@exploring_the_skies" }, { username: "pilot.one", x: 0.2, y: 0.3 }] }), ACCOUNTS);
  assert.deepEqual(p.tags, [[{ username: "pilot.one", x: 0.2, y: 0.3 }], [{ username: "exploring_the_skies", x: 0.5, y: 0.9 }]]);
  assert.deepEqual((await parsePackage(entries(), ACCOUNTS)).tags, [[], []]);
  await assert.rejects(parsePackage(entries({ ...POST, user_tags: [{ media: 3, username: "x" }] }), ACCOUNTS), /user_tags/);
});

test("location: a saved place by name, or a Facebook Page ID with name", async () => {
  assert.equal((await parsePackage(entries(), ACCOUNTS)).location, null);
  assert.deepEqual((await parsePackage(entries({ ...POST, location: "Flugplatz Birrfeld" }), ACCOUNTS)).location, { name: "Flugplatz Birrfeld" });
  assert.deepEqual((await parsePackage(entries({ ...POST, location: { id: 112233445566, name: "Birrfeld" } }), ACCOUNTS)).location, { id: "112233445566", name: "Birrfeld" });
  await assert.rejects(parsePackage(entries({ ...POST, location: { id: "birrfeld" } }), ACCOUNTS), /Facebook-Seiten-ID/);
});
