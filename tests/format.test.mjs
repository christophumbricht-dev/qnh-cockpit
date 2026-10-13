import test from "node:test";
import assert from "node:assert/strict";
import { esc, relTime, num, errorText, sourceLabel } from "../src/format.js";

test("esc escapes HTML", () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(esc(null), "");
});

test("relTime in German", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const at = (min) => new Date(now - min * 60_000);
  assert.equal(relTime(at(0.5), now), "gerade eben");
  assert.equal(relTime(at(5), now), "vor 5 Min.");
  assert.equal(relTime(at(180), now), "vor 3 Std.");
  assert.equal(relTime(at(60 * 30), now), "gestern");
  assert.equal(relTime(at(60 * 24 * 4), now), "vor 4 Tagen");
  assert.equal(relTime(new Date("2026-09-01T10:00:00Z"), now), "1.9.2026");
  assert.equal(relTime("nonsense", now), "");
});

test("num formats Swiss style and handles missing values", () => {
  assert.equal(num(null), "–");
  assert.equal(num(0), "0");
  assert.match(num(12345), /^12.345$/);
});

test("errorText explains common errors", () => {
  assert.equal(errorText({ code: "42501", message: "Only admins" }), "Dieses Konto ist kein Admin dieser App.");
  assert.match(errorText({ code: "PGRST202", message: "x" }), /apply-pending/);
  assert.equal(errorText({ message: "Token has expired or is invalid" }), "Der Code ist falsch oder abgelaufen.");
  assert.equal(errorText({ message: "Signups not allowed for otp" }), "Zu dieser E-Mail gibt es kein Konto.");
  assert.equal(errorText({ message: "something else" }), "something else");
});

test("sourceLabel", () => {
  assert.equal(sourceLabel("club"), "Club");
  assert.equal(sourceLabel("unknown"), "unknown");
});
