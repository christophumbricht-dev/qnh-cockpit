import test from "node:test";
import assert from "node:assert/strict";
import { chf, hourEnergy, isBusy, lastDays, status, summarize, watts } from "../src/finance/machines.js";
import { parseNvidia, parseTasklist, sample, uploadDue } from "../scripts/machine-lib.mjs";

const gaming = { id: "gaming", idle_w: 45, cpu_w: 65, gpu_w: 145 };
const laptop = { id: "laptop", idle_w: 10, cpu_w: 20, gpu_w: 40 };

test("watts: rest + share of full CPU + GPU; a measured GPU draw replaces the GPU estimate", () => {
  assert.equal(watts(gaming, { cpu: 0, gpu: 0 }), 45);
  assert.equal(watts(gaming, { cpu: 100, gpu: 100 }), 45 + 65 + 145);
  assert.equal(watts(gaming, { cpu: 50, gpu: 100, gpu_watts: 120 }), 45 + 32.5 + 120);
  assert.equal(watts(laptop, { cpu: null, gpu: null }), 10);
});

test("hourEnergy: 12 samples = 1 h on; battery samples draw nothing from the wall", () => {
  const e = hourEnergy(gaming, { n: 12, n_battery: 0, n_busy: 6, cpu: 0, gpu: 0, gpu_watts: 21 });
  assert.equal(e.on, 1);
  assert.equal(e.busy, 0.5);
  assert.ok(Math.abs(e.kwh - 0.066) < 1e-9);
  const b = hourEnergy(laptop, { n: 12, n_battery: 6, n_busy: 0, cpu: 0, gpu: 0, gpu_watts: null });
  assert.equal(b.on, 1);
  assert.ok(Math.abs(b.kwh - 0.005) < 1e-9);
  // more than 12 samples in an hour (clock change, re-runs) never counts more than one hour
  assert.equal(hourEnergy(laptop, { n: 30, n_battery: 0, n_busy: 30, cpu: 0 }).on, 1);
});

test("summarize: only this machine and the period, grouped by Swiss day", () => {
  const hours = [
    { machine: "gaming", hour: "2026-10-24T21:00:00+00:00", n: 12, n_battery: 0, n_busy: 12, cpu: 0, gpu: 0, gpu_watts: 155 },
    { machine: "gaming", hour: "2026-10-24T22:00:00+00:00", n: 12, n_battery: 0, n_busy: 0, cpu: 0, gpu: 0, gpu_watts: 55 },  // 00:00 Swiss time = next day
    { machine: "laptop", hour: "2026-10-24T22:00:00+00:00", n: 12, n_battery: 0, n_busy: 12, cpu: 100 },
    { machine: "gaming", hour: "2026-10-01T10:00:00+00:00", n: 12, n_battery: 0, n_busy: 12, cpu: 100 },                      // before the period
  ];
  const s = summarize(gaming, hours, "2026-10-20T00:00:00.000Z");
  assert.equal(s.on, 2);
  assert.equal(s.busy, 1);
  assert.equal(s.share, 0.5);
  assert.ok(Math.abs(s.kwh - 0.3) < 1e-9);
  assert.deepEqual(s.days.map((d) => d.day), ["2026-10-24", "2026-10-25"]);
});

test("chf: none without a price", () => {
  assert.equal(chf(10, null), null);
  assert.ok(Math.abs(chf(10, 0.29) - 2.9) < 1e-9);
});

test("status: on when the newest sample is at most 15 minutes old", () => {
  const now = Date.parse("2026-10-25T08:00:00Z");
  assert.equal(status(null, now).online, false);
  assert.equal(status({ at: "2026-10-25T07:50:00Z" }, now).online, true);
  assert.equal(status({ at: "2026-10-25T07:40:00Z" }, now).online, false);
});

test("lastDays fills missing days with zeros, oldest first", () => {
  const out = lastDays([{ day: "2026-10-24", on: 5, busy: 2, kwh: 1 }], 3, "2026-10-25");
  assert.deepEqual(out.map((d) => [d.day, d.busy]), [["2026-10-23", 0], ["2026-10-24", 2], ["2026-10-25", 0]]);
});

test("isBusy: heavy program or real load", () => {
  assert.equal(isBusy({ cpu: 5, gpu: 1, jobs: [] }), false);
  assert.equal(isBusy({ cpu: 5, gpu: 1, jobs: ["blender"] }), true);
  assert.equal(isBusy({ cpu: 45, gpu: 0, jobs: [] }), true);
  assert.equal(isBusy({ cpu: 5, gpu: 35, jobs: [] }), true);
});

test("parseTasklist keeps only heavy programs, once each", () => {
  const t = '"System Idle Process","0","Services","0","8 K"\r\n"blender.exe","4120","Console","1","2.100.000 K"\r\n"python.exe","1","Console","1","1 K"\r\n"pythonw.exe","2","Console","1","1 K"\r\n"Claude.exe","9","Console","1","1 K"';
  assert.deepEqual(parseTasklist(t), ["blender", "python"]);
});

test("parseNvidia reads load and watts, tolerates N/A", () => {
  assert.deepEqual(parseNvidia("19, 21.46\n"), { gpu: 19, gpu_watts: 21.46 });
  assert.deepEqual(parseNvidia("3, [N/A]"), { gpu: 3, gpu_watts: null });
  assert.deepEqual(parseNvidia(""), { gpu: null, gpu_watts: null });
});

test("sample rounds the time down to the 5-minute slot and clamps values", () => {
  const s = sample({ machine: "gaming", now: new Date("2026-10-25T07:53:41Z"), cpu: 104, ram: 48.26, disk_free_gb: 345.678, jobs: ["ffmpeg"] });
  assert.equal(s.at, "2026-10-25T07:50:00.000Z");
  assert.equal(s.cpu, 100);
  assert.equal(s.ram, 48.3);
  assert.equal(s.disk_free_gb, 345.7);
  assert.equal(s.on_battery, false);
});

test("uploadDue once the oldest waiting sample is about an hour old", () => {
  const now = Date.parse("2026-10-25T08:00:00Z");
  assert.equal(uploadDue([], now), false);
  assert.equal(uploadDue([{ at: "2026-10-25T07:30:00Z" }], now), false);
  assert.equal(uploadDue([{ at: "2026-10-25T07:00:00Z" }], now), true);
});
