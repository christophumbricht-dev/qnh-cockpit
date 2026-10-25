// Videos from packages before they go to Storage (Supabase egress, 25.10.2026):
// - shrink: above MAX_BPS the video is re-encoded to about 5 Mbit/s (Instagram and YouTube re-encode anyway)
// - still: a small JPEG frame for the cockpit's lists and previews, so no video is downloaded just to be shown
// Both need ffmpeg/ffprobe on the PATH; without them the video goes up unchanged and without a still.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_BPS = 6_000_000;

let ffmpeg;
export function hasFfmpeg() {
  if (ffmpeg === undefined) {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
      ffmpeg = true;
    } catch {
      ffmpeg = false;
    }
  }
  return ffmpeg;
}

// bits per second of a file of `bytes` lasting `seconds` (null when the duration is unknown)
export const bitrate = (bytes, seconds) => (seconds > 0 ? (bytes * 8) / seconds : null);

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "qnh-video-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = (args) => execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });

// → { bytes, still, shrunk: { from, to } | null }
export function prepareVideo(bytes) {
  if (!hasFfmpeg()) return { bytes, still: null, shrunk: null };
  return withTemp((dir) => {
    const src = join(dir, "in.mp4");
    writeFileSync(src, bytes);
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString().trim());
    let out = bytes;
    let shrunk = null;
    if ((bitrate(bytes.length, seconds) ?? 0) > MAX_BPS) {
      const small = join(dir, "small.mp4");
      run(["-i", src, "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-maxrate", "5M", "-bufsize", "10M", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", small]);
      const b = readFileSync(small);
      if (b.length < bytes.length) {
        out = b;
        shrunk = { from: bytes.length, to: b.length };
      }
    }
    let still = null;
    try {
      const jpg = join(dir, "still.jpg");
      run(["-ss", String(Math.min(0.5, Math.max(0, seconds / 2) || 0)), "-i", src, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", jpg]);
      still = readFileSync(jpg);
    } catch {
      still = null;
    }
    return { bytes: out, still, shrunk };
  });
}

export const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
