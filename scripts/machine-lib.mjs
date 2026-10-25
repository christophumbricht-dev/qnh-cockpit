// Pure parts of machine-heartbeat.mjs (tested in tests/machines.test.mjs).

// programs that mean «this machine is working» (lower-case image names without .exe)
export const HEAVY = ["blender", "ffmpeg", "python", "pythonw"];

// `tasklist /fo csv /nh` → sorted unique heavy program names
export function parseTasklist(text) {
  const names = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)"/);
    if (!m) continue;
    const n = m[1].toLowerCase().replace(/\.exe$/, "");
    if (HEAVY.includes(n)) names.add(n === "pythonw" ? "python" : n);
  }
  return [...names].sort();
}

// `nvidia-smi --query-gpu=utilization.gpu,power.draw --format=csv,noheader,nounits` → { gpu, gpu_watts } (first card)
export function parseNvidia(text) {
  const line = String(text).split(/\r?\n/).find((l) => l.trim());
  if (!line) return { gpu: null, gpu_watts: null };
  const [u, w] = line.split(",").map((x) => Number.parseFloat(x));
  return { gpu: Number.isFinite(u) ? clamp(u, 0, 100) : null, gpu_watts: Number.isFinite(w) ? clamp(w, 0, 2000) : null };
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// one sample, timestamp rounded down to the 5-minute slot (so a re-run in the same slot does not count twice)
export function sample({ machine, now = new Date(), cpu, gpu = null, gpu_watts = null, ram, disk_free_gb, on_battery = false, jobs = [] }) {
  const slot = new Date(Math.floor(now.getTime() / 3e5) * 3e5).toISOString();
  const r = (v, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
  return { machine, at: slot, cpu: r(cpu == null ? null : clamp(cpu, 0, 100)), gpu: r(gpu), gpu_watts: r(gpu_watts), ram: r(ram == null ? null : clamp(ram, 0, 100)),
    disk_free_gb: r(disk_free_gb), on_battery: Boolean(on_battery), jobs: jobs.slice(0, 20) };
}

// upload when the oldest buffered sample is an hour old (one sign-in per hour instead of every 5 minutes)
export const uploadDue = (rows, now = Date.now()) => rows.length > 0 && now - Date.parse(rows[0].at) >= 55 * 60e3;
