import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { jpegSize, packageHash, plan } from "../scripts/social-lib.mjs";

// minimal JPEG: SOI, APP0 (skipped), SOF0 with 1350 x 1080, EOI
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x05, 0x46, 0x04, 0x38, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);

test("jpegSize reads width and height from the SOF marker", () => {
  assert.deepEqual(jpegSize(jpeg), { width: 1080, height: 1350 });
  assert.equal(jpegSize(Buffer.from("not a jpeg")), null);
});

test("jpegSize works on a real package image", { skip: !existsSync("pakete") }, () => {
  const dir = readdirSync("pakete").find((d) => existsSync(`pakete/${d}/1.jpg`));
  const size = jpegSize(readFileSync(`pakete/${dir}/1.jpg`));
  assert.ok(size.width >= 320 && size.height >= 320);
});

test("packageHash changes when an image changes, not with file order", () => {
  const a = packageHash([["post.json", Buffer.from("{}")], ["1.jpg", Buffer.from("x")]]);
  assert.equal(a, packageHash([["1.jpg", Buffer.from("x")], ["post.json", Buffer.from("{}")]]));
  assert.notEqual(a, packageHash([["post.json", Buffer.from("{}")], ["1.jpg", Buffer.from("y")]]));
});

const NOW = new Date("2026-10-14T12:00:00Z");
const pkg = (folder, over = {}) => ({ folder, hash: "h1", account_id: "acc", caption: `text ${folder}`, suggested_time: "2026-10-20T16:00:00.000Z", ...over });
const post = (id, over = {}) => ({ id, status: "draft", account_id: "acc", caption: "", source: "package", updated_at: "t1", ...over });
const act = (rows) => Object.fromEntries(rows.map((r) => [r.folder, r.action]));

test("plan: new, unchanged, changed draft, deleted in the cockpit", () => {
  const markers = { b: { id: "p2", hash: "h1", updated_at: "t1" }, c: { id: "p3", hash: "old", updated_at: "t1" }, d: { id: "gone", hash: "h1" } };
  const rows = plan([pkg("a"), pkg("b"), pkg("c"), pkg("d")], markers, [post("p2"), post("p3")], NOW);
  assert.deepEqual(act(rows), { a: "new", b: "same", c: "update", d: "deleted" });
});

test("plan: never overwrites approved posts or drafts Christoph edited", () => {
  const markers = { a: { id: "p1", hash: "old", updated_at: "t1" }, b: { id: "p2", hash: "old", updated_at: "t1" } };
  const rows = plan([pkg("a"), pkg("b")], markers, [post("p1", { status: "approved" }), post("p2", { updated_at: "t2" })], NOW);
  assert.deepEqual(act(rows), { a: "locked", b: "conflict" });
});

test("plan: links packages imported by hand earlier, skips past times", () => {
  const rows = plan([pkg("a"), pkg("b", { suggested_time: "2026-10-10T16:00:00.000Z" }), pkg("c")],
    {}, [post("p9", { caption: "text a", status: "published" }), post("p8", { caption: "text c", source: "editor" })], NOW);
  assert.deepEqual(act(rows), { a: "link", b: "past", c: "new" });
  assert.equal(rows[0].post.id, "p9");
});
