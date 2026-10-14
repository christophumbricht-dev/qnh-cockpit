import test from "node:test";
import assert from "node:assert/strict";
import { search, normalize, greeting, firstName } from "../src/search.js";
import { sparkSvg } from "../src/charts.js";

const groups = [
  { title: "Seiten", items: [{ label: "Heute" }, { label: "Downwind · Feedback" }, { label: "Social" }] },
  { title: "Beta", items: [{ label: "Anna Müller", sub: "anna@example.com", text: "Birrfeld DA40" }, { label: "Marc Muster", sub: "marc@example.com" }] },
];

test("normalize removes accents and case", () => assert.equal(normalize("Müller ÉCOLE"), "muller ecole"));

test("search finds by every word, accents ignored", () => {
  assert.deepEqual(search("muller", groups).map((g) => g.items.map((i) => i.label)), [["Anna Müller"]]);
  assert.equal(search("anna birrfeld", groups)[0].items[0].label, "Anna Müller");
  assert.equal(search("anna lszh", groups).length, 0);
  assert.equal(search("feedback", groups)[0].items[0].label, "Downwind · Feedback");
});

test("empty query shows the pages only", () => {
  const r = search("  ", groups);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, "Seiten");
});

test("greeting by Swiss time and first name", () => {
  assert.equal(greeting(new Date("2026-10-14T06:00:00Z")), "Guten Morgen"); // 08:00 CEST
  assert.equal(greeting(new Date("2026-10-14T12:00:00Z")), "Guten Tag");
  assert.equal(greeting(new Date("2026-10-14T18:00:00Z")), "Guten Abend");
  assert.equal(firstName("christoph.umbricht@gmail.com"), "Christoph");
  assert.equal(firstName(""), "");
});

test("sparklines", () => {
  assert.match(sparkSvg([1, 2, 3], "line"), /polyline/);
  assert.equal((sparkSvg([0, 2, 0, 3], "bar").match(/<rect/g) ?? []).length, 2);
  assert.equal(sparkSvg([5]), "");
});
