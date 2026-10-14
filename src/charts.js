// Trend charts (tab "Verlauf"): small multiples, one series each, plain SVG.
// Pure functions – bucketing is unit-tested in tests/charts.test.mjs.

import { esc, num } from "./format.js";

// Daily rows from admin_timeseries() → periods. Up to 31 days stay daily, longer ranges become
// ISO weeks (Monday start). `sum` keys add up, `last` keys take the period's last value.
export function bucket(rows, { sum = [], last = [] } = {}) {
  const weekly = rows.length > 31;
  const out = [];
  for (const r of rows) {
    const key = weekly ? mondayOf(r.day) : r.day;
    let p = out.at(-1);
    if (!p || p.key !== key) {
      p = { key, from: r.day, to: r.day, days: 0 };
      for (const k of sum) p[k] = 0;
      out.push(p);
    }
    p.to = r.day;
    p.days++;
    for (const k of sum) p[k] += Number(r[k]) || 0;
    for (const k of last) p[k] = Number(r[k]) || 0;
  }
  return { weekly, periods: out };
}

export function mondayOf(day) {
  const d = new Date(`${String(day).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const dm = (day) => { const d = new Date(`${String(day).slice(0, 10)}T12:00:00Z`); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`; };
export const periodLabel = (p, weekly) => (weekly ? `Woche ab ${dm(p.from)}` : dm(p.from));

// "nice" axis maximum: 1, 2, 5 × 10^n
export function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

const W = 320, H = 132, PAD = { l: 30, r: 6, t: 8, b: 20 };

// kind: "bar" (counts per period) or "line" (running total)
export function chartSvg({ periods, weekly, key, kind, label }) {
  const n = periods.length;
  const values = periods.map((p) => p[key]);
  const max = niceMax(Math.max(0, ...values));
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const step = iw / n;
  const y = (v) => PAD.t + ih - (v / max) * ih;
  const grid = [0, max / 2, max].map((v) =>
    `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${PAD.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${num(v)}</text>`).join("");
  const xLabels = `<text class="tick" x="${PAD.l}" y="${H - 5}">${esc(dm(periods[0].from))}</text>
    <text class="tick" x="${W - PAD.r}" y="${H - 5}" text-anchor="end">${esc(dm(periods[n - 1].to))}</text>`;

  let marks = "";
  if (kind === "bar") {
    const bw = Math.max(1, step - 2); // 2px gap between bars
    marks = periods.map((p, i) => {
      const v = p[key];
      if (!v) return "";
      const x = PAD.l + i * step + 1, top = y(v), h = PAD.t + ih - top;
      const r = Math.min(4, bw / 2, h); // rounded data-end, square at the baseline
      return `<path class="bar" d="M${x} ${top + h}V${top + r}q0 ${-r} ${r} ${-r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${top + h}z"/>`;
    }).join("");
  } else {
    const pts = periods.map((p, i) => `${PAD.l + i * step + step / 2},${y(p[key])}`).join(" ");
    marks = `<polyline class="line" points="${pts}"/>`;
  }

  const hits = periods.map((p, i) => {
    const cx = PAD.l + i * step + step / 2;
    return `<rect class="hit" x="${PAD.l + i * step}" y="${PAD.t}" width="${step}" height="${ih}" data-tip="${esc(`${periodLabel(p, weekly)}: ${num(p[key])}`)}" data-cx="${cx}" data-cy="${y(p[key])}"/>`;
  }).join("");

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${grid}${marks}${xLabels}<line class="cross" x1="0" x2="0" y1="${PAD.t}" y2="${PAD.t + ih}" visibility="hidden"/><circle class="dot" r="4" visibility="hidden"/>${hits}
  </svg>`;
}

// Tiny trend line/bars for tiles (no axes, decorative – the number next to it is the real value).
export function sparkSvg(values, kind = "line") {
  const v = values.map((x) => Number(x) || 0);
  const n = v.length;
  if (n < 2) return "";
  const W = 120, H = 34;
  const max = Math.max(...v), min = kind === "line" ? Math.min(...v) : 0;
  const y = (x) => H - 3 - ((x - min) / (max - min || 1)) * (H - 6);
  if (kind === "bar") {
    const bw = W / n;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${v.map((x, i) =>
      x ? `<rect x="${(i * bw + 0.6).toFixed(1)}" y="${y(x).toFixed(1)}" width="${Math.max(0.8, bw - 1.2).toFixed(1)}" height="${(H - 3 - y(x)).toFixed(1)}" rx="1"/>` : "").join("")}</svg>`;
  }
  const pts = v.map((x, i) => `${((i / (n - 1)) * W).toFixed(1)},${y(x).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polygon class="area" points="0,${H} ${pts.join(" ")} ${W},${H}"/><polyline points="${pts.join(" ")}"/></svg>`;
}
