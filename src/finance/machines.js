// Rechner (Finanzen → «Rechner»): how busy the gaming PC and the laptop are and what their electricity costs.
// Pure helpers, tested in tests/machines.test.mjs. Data: machine_hours (per machine and hour, migration
// 20261025100000_machines.sql) from scripts/machine-heartbeat.mjs, which measures every 5 minutes.
// Watts are an estimate: rest + share of full CPU + GPU (measured by nvidia-smi where the card reports it).

export const SAMPLE_MIN = 5;              // the heartbeat measures every 5 minutes
export const ONLINE_MIN = 15;             // no sample for longer than this → «aus»
export const EXAMPLE_PRICE = 0.3;         // CHF/kWh, only shown as an example until the real price is entered

// same rule as the view machine_hours
export const isBusy = (s) => (s.jobs?.length ?? 0) > 0 || (s.cpu ?? 0) >= 40 || (s.gpu ?? 0) >= 30;

// estimated draw from the wall in watts for one sample or one hour average
export function watts(m, { cpu, gpu, gpu_watts: gw }) {
  const gpuPart = gw != null ? gw : ((gpu ?? 0) / 100) * m.gpu_w;
  return m.idle_w + ((cpu ?? 0) / 100) * m.cpu_w + gpuPart;
}

// one hour row of machine_hours → hours on (on mains), hours busy, kWh
export function hourEnergy(m, h) {
  const n = Math.min(h.n, 60 / SAMPLE_MIN);
  const mains = Math.max(0, n - (h.n_battery ?? 0)) * (SAMPLE_MIN / 60);
  const on = n * (SAMPLE_MIN / 60);
  const busy = Math.min(h.n_busy ?? 0, n) * (SAMPLE_MIN / 60);
  return { on, busy, kwh: (watts(m, h) * mains) / 1000 };
}

// Swiss calendar day of an ISO timestamp (YYYY-MM-DD)
export const zurichDay = (iso) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date(iso));

// totals of one machine since `from` (ISO), plus one row per Swiss day
export function summarize(m, hours, from) {
  const days = new Map();
  const total = { on: 0, busy: 0, kwh: 0 };
  for (const h of hours) {
    if (h.machine !== m.id || Date.parse(h.hour) < Date.parse(from)) continue;
    const e = hourEnergy(m, h);
    const d = zurichDay(h.hour);
    const row = days.get(d) ?? { day: d, on: 0, busy: 0, kwh: 0 };
    for (const k of ["on", "busy", "kwh"]) { row[k] += e[k]; total[k] += e[k]; }
    days.set(d, row);
  }
  return { ...total, share: total.on ? total.busy / total.on : 0, days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)) };
}

export const chf = (kwh, price) => (price == null ? null : kwh * price);

// «läuft» / «aus seit …» from the newest sample
export function status(last, now = Date.now()) {
  if (!last) return { online: false, since: null };
  const age = (now - Date.parse(last.at)) / 60000;
  return { online: age <= ONLINE_MIN, since: last.at, age };
}

// last `n` Swiss days ending today, filled with zeros (for the small bar strip)
export function lastDays(days, n, today) {
  const by = new Map(days.map((d) => [d.day, d]));
  const out = [];
  const t = new Date(`${today}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(t.getTime() - i * 864e5).toISOString().slice(0, 10);
    out.push(by.get(d) ?? { day: d, on: 0, busy: 0, kwh: 0 });
  }
  return out;
}

export const hoursText = (h) => (h >= 10 ? `${Math.round(h)} h` : `${h.toLocaleString("de-CH", { maximumFractionDigits: 1 })} h`);
export const kwhText = (k) => `${k.toLocaleString("de-CH", { maximumFractionDigits: k >= 10 ? 0 : 1 })} kWh`;
export const chfText = (v) => `CHF ${v.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
