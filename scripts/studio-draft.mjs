// YouTube-Ablauf step 2: a cheap draft video from entwurf.json, spoken by a free Windows voice (no ElevenLabs).
// Each scene: the picture from the package (or a slate with its title and sentence), slowly zooming so the picture
// never stands still, the sentence spoken, a short breath after it. Output: <ordner>/v<n>/ with video.mp4,
// scenes.json and meta.json, then uploaded like any studio package (scripts/studio.mjs upload).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError, checkDraft, draftScenes, wrap } from "./studio-lib.mjs";

const FPS = 30;
const GAP = 0.4;
const FONT = "C\\:/Windows/Fonts/arial.ttf";
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
const seconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

// all sentences in one PowerShell run (System.Speech, English voice if there is one)
function speak(lines, dir) {
  const list = join(dir, "say.json");
  writeFileSync(list, JSON.stringify(lines));
  const ps = join(dir, "say.ps1");
  writeFileSync(ps, `param([string]$List)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$en = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1
if ($en) { $s.SelectVoice($en.VoiceInfo.Name) }
foreach ($l in (Get-Content -Raw -Encoding UTF8 $List | ConvertFrom-Json)) { $s.SetOutputToWaveFile($l.file); $s.Speak($l.text) }
$s.SetOutputToNull()
if ($en) { $en.VoiceInfo.Name } else { $s.Voice.Name }
`, "utf8");
  return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps, "-List", list]).toString().trim().split(/\r?\n/).at(-1);
}

export function buildDraft(folder) {
  const file = join(folder, "entwurf.json");
  if (!existsSync(file)) throw new CliError(`entwurf.json fehlt in ${folder} (docs/studio-paket.md).`);
  const draft = JSON.parse(readFileSync(file, "utf8"));
  const scenes = checkDraft(draft);
  for (const s of scenes) if (s.image && !existsSync(join(folder, s.image))) throw new CliError(`Bild fehlt: ${s.image}`);
  const n = 1 + Math.max(0, ...readdirSync(folder).map((d) => Number(/^v(\d+)$/.exec(d)?.[1] ?? 0)));
  const out = join(folder, `v${n}`);
  const tmp = mkdtempSync(join(tmpdir(), "qnh-draft-"));
  try {
    const voice = speak(scenes.map((s, i) => ({ text: s.text, file: join(tmp, `s${i}.wav`) })), tmp);
    const durations = scenes.map((_, i) => seconds(join(tmp, `s${i}.wav`)));
    const times = draftScenes(scenes, durations, GAP);
    const clips = scenes.map((s, i) => {
      const len = times[i].end - times[i].start;
      let pic = s.image ? join(folder, s.image) : join(tmp, `slate${i}.png`);
      if (!s.image) {
        writeFileSync(join(tmp, `t${i}.txt`), wrap(s.text));
        writeFileSync(join(tmp, `l${i}.txt`), s.label);
        ff(["-f", "lavfi", "-i", "color=c=0x102A43:s=1920x1080", "-frames:v", "1", "-vf",
          `drawtext=fontfile='${FONT}':textfile='${join(tmp, `l${i}.txt`).replace(/\\/g, "/").replace(":", "\\:")}':fontcolor=0x3BC9DB:fontsize=64:x=(w-text_w)/2:y=300,` +
          `drawtext=fontfile='${FONT}':textfile='${join(tmp, `t${i}.txt`).replace(/\\/g, "/").replace(":", "\\:")}':fontcolor=0xF6F4EF:fontsize=46:line_spacing=18:x=(w-text_w)/2:y=460`, pic]);
      }
      const clip = join(tmp, `c${i}.mp4`);
      const frames = Math.ceil(len * FPS);
      // slow zoom (about 6 % over the scene): the picture never stands still
      ff(["-loop", "1", "-framerate", String(FPS), "-i", pic, "-i", join(tmp, `s${i}.wav`), "-filter_complex",
        `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='1+0.06*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS},format=yuv420p[v];[1:a]aresample=48000,apad[a]`,
        "-map", "[v]", "-map", "[a]", "-frames:v", String(frames), "-t", len.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-c:a", "aac", "-b:a", "128k", clip]);
      return clip;
    });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(tmp, "list.txt"), clips.map((c) => `file '${c.replace(/\\/g, "/")}'`).join("\n"));
    ff(["-f", "concat", "-safe", "0", "-i", join(tmp, "list.txt"), "-c", "copy", "-movflags", "+faststart", join(out, "video.mp4")]);
    writeFileSync(join(out, "scenes.json"), JSON.stringify(times, null, 2));
    const meta = draft.meta ?? {};
    writeFileSync(join(out, "meta.json"), JSON.stringify({
      ...meta, titles: meta.titles ?? (draft.title ? [draft.title] : []), fps: FPS,
      assumptions: [`Entwurf: Windows-Stimme «${voice}», Bilder nur zum Vorstellen`, ...(meta.assumptions ?? [])],
    }, null, 2));
    return { out, duration: times.at(-1).end, voice };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
