import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_BPS, bitrate, hasFfmpeg, prepareVideo } from "../scripts/social-video.mjs";

test("bitrate: bits per second, unknown without a duration", () => {
  assert.equal(bitrate(1_000_000, 8), 1_000_000);
  assert.equal(bitrate(1_000_000, 0), null);
  assert.ok(bitrate(90e6, 72) > MAX_BPS);   // a 72 s reel of 90 MB gets smaller
  assert.ok(bitrate(45e6, 72) < MAX_BPS);   // 45 MB in 72 s is already about 5 Mbit/s
  assert.ok(bitrate(11e6, 20) < MAX_BPS);   // an ordinary 20 s reel stays as it is
});

test("prepareVideo: small video stays, gets a JPEG still", { skip: !hasFfmpeg() && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "qnh-video-test-"));
  try {
    const f = join(dir, "v.mp4");
    execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=270x480:rate=30:duration=2", "-pix_fmt", "yuv420p", f]);
    const bytes = readFileSync(f);
    const v = prepareVideo(bytes);
    assert.equal(v.shrunk, null);
    assert.equal(v.bytes, bytes);
    assert.ok(v.still && v.still[0] === 0xff && v.still[1] === 0xd8, "still is a JPEG");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
