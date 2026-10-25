// Rechner (Finanzen → «Rechner»): measures this computer every 5 minutes and uploads the samples about once an hour.
//   node scripts/machine-heartbeat.mjs --machine gaming|laptop [--upload]
// Run by the Windows task «QNH Rechner-Messung» (scripts/machine-task.ps1). Samples wait in
// %USERPROFILE%\.qnh-machine\<machine>.jsonl (per computer, not synced; not in AppData, which programs started from
// the Claude app see redirected) until the upload worked, so a computer
// that is offline or not signed in yet loses nothing. Upload signs in like the social import (.qnh-session.json).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { freemem, homedir, totalmem } from "node:os";
import { join } from "node:path";
import { args, ROOT, signedIn } from "./qnh-session.mjs";
import { parseNvidia, parseTasklist, sample, uploadDue } from "./machine-lib.mjs";

const a = args(process.argv.slice(2), ["upload"]);
const machine = a.machine;
if (!/^[a-z0-9-]{2,24}$/.test(machine ?? "")) { console.error("--machine gaming|laptop fehlt"); process.exit(1); }
const dir = join(homedir(), ".qnh-machine");
const buffer = join(dir, `${machine}.jsonl`);
mkdirSync(dir, { recursive: true });

const run = (cmd, argv) => { try { return execFileSync(cmd, argv, { encoding: "utf8", timeout: 20000, windowsHide: true }); } catch { return ""; } };
const ps = (script) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]).trim();

function nvidiaSmi() {
  for (const exe of ["nvidia-smi", "C:\\Windows\\System32\\nvidia-smi.exe", "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe"]) {
    const out = run(exe, ["--query-gpu=utilization.gpu,power.draw", "--format=csv,noheader,nounits"]);
    if (out.trim()) return parseNvidia(out);
  }
  return { gpu: null, gpu_watts: null };
}

function measure() {
  // CPU: average of 3 readings over ~2 s (WMI class names are the same on German Windows)
  const cpu = Number(ps("$v = 1..3 | % { (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime; Start-Sleep -Milliseconds 700 }; ($v | Measure-Object -Average).Average"));
  const battery = ps("$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if ($b) { $b.BatteryStatus } else { 0 }");
  let disk = null;
  try { const s = statfsSync("C:\\"); disk = (s.bavail * s.bsize) / 1e9; } catch { /* no drive C: */ }
  return sample({
    machine, cpu: Number.isFinite(cpu) ? cpu : null, ...nvidiaSmi(),
    ram: (1 - freemem() / totalmem()) * 100, disk_free_gb: disk,
    on_battery: battery === "1",          // BatteryStatus 1 = discharging, 2 = on mains
    jobs: parseTasklist(run("tasklist", ["/fo", "csv", "/nh"])),
  });
}

const read = () => (existsSync(buffer) ? readFileSync(buffer, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : []);

appendFileSync(buffer, `${JSON.stringify(measure())}\n`);
let rows = read();
if (rows.length > 20000) rows = rows.slice(-20000);       // ~70 days; older ones are not worth keeping

if (a.upload || uploadDue(rows)) {
  if (!existsSync(join(ROOT, ".qnh-session.json"))) {
    console.log(`${rows.length} Messungen warten: dieser Rechner ist noch nicht angemeldet (npm run roadmap -- login).`);
  } else {
    const sb = await signedIn();
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("machine_samples").upsert(rows.slice(i, i + 500), { onConflict: "machine,at", ignoreDuplicates: true });
      if (error) { console.error(`Hochladen fehlgeschlagen: ${error.message}`); process.exit(1); }
    }
    writeFileSync(buffer, "");
    console.log(`${rows.length} Messungen hochgeladen.`);
  }
}
