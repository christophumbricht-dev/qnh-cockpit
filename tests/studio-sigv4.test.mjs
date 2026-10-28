import test from "node:test";
import assert from "node:assert/strict";
import { STUDIO_KEY, presign, r2Presign } from "../supabase/functions/_shared/sigv4.js";

// AWS documentation, «Authenticating Requests: Using Query Parameters» example (GET test.txt, 24 h)
test("presign matches the AWS documentation example", async () => {
  const url = await presign({
    host: "examplebucket.s3.amazonaws.com", path: "/test.txt", region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    expires: 86400, now: new Date("2013-05-24T00:00:00Z"),
  });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  assert.match(url, /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/);
});

test("r2Presign: path style on the account host, region auto", async () => {
  const url = await r2Presign({ accountId: "abc123", bucket: "qnh-studio", key: "studio/foehn/v1/video.mp4", accessKeyId: "K", secretAccessKey: "S", now: new Date("2026-10-28T12:00:00Z") });
  assert.ok(url.startsWith("https://abc123.r2.cloudflarestorage.com/qnh-studio/studio/foehn/v1/video.mp4?"));
  assert.match(url, /%2Fauto%2Fs3%2F/);
});

test("STUDIO_KEY: only studio/<slug>/v<n>/<file>", () => {
  assert.ok(STUDIO_KEY.test("studio/foehn-long/v2/video.mp4"));
  for (const k of ["secrets/x", "studio/../x/v1/a.mp4", "studio/foehn/v1/../a", "studio/Foehn/v1/a.mp4", "studio/foehn/1/a.mp4"]) assert.equal(STUDIO_KEY.test(k), false, k);
});

import { r2Host } from "../supabase/functions/_shared/sigv4.js";
test("r2Host: default and EU jurisdiction", () => {
  assert.equal(r2Host("abc"), "abc.r2.cloudflarestorage.com");
  assert.equal(r2Host("abc", "eu"), "abc.eu.r2.cloudflarestorage.com");
});
