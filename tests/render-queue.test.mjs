// Render queue of the gaming PC → «An Claude» → Warteschlange: log parsing and rows (scripts/render-lib.mjs), the three
// lanes (src/queue/logic.js) and the table render_jobs (migration 20261029100000_render_jobs.sql, PGlite).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { buildRows, decodeLog, jobTitle, parseLocalStamp, parseLog, zurichTime } from "../scripts/render-lib.mjs";
import { agendaItems, lanes, span } from "../src/queue/logic.js";

const NOW = Date.parse("2026-10-29T06:00:00Z");          // 07:00 in Zurich (winter time)

test("Swiss wall-clock time in summer and in winter", () => {
  assert.equal(zurichTime(2026, 10, 29, 7, 0).toISOString(), "2026-10-29T06:00:00.000Z");
  assert.equal(zurichTime(2026, 7, 1, 7, 0).toISOString(), "2026-07-01T05:00:00.000Z");
  assert.equal(parseLocalStamp("2026-10-29 02:27:03"), "2026-10-29T01:27:03.000Z");
  assert.equal(parseLocalStamp("kaputt"), null);
});

const LOG = [
  "28.10 21:23 start 42v_voices.ps1",
  "fahrtmesser ok vo_1.wav",
  "VOICES 1028 DONE",
  "28.10 21:30 end 42v_voices.ps1",
  "28.10 21:30 start 43_hz_reel.ps1",
  "Traceback (most recent call last):",
  "1683 frames missing, first 863",
  "HZ REEL FAILED (pack)",
  "29.10 06:50 end 43_hz_reel.ps1",
  "29.10 06:50 start 43b_hz_resume.ps1",
  "device OPTIX",
].join("\r\n");

test("the log is UTF-16 from Windows PowerShell; runs with outcome, the last one still running", () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(LOG, "utf16le")]);
  assert.equal(decodeLog(buf), LOG);
  const runs = parseLog(LOG, NOW);
  assert.deepEqual(runs.map((r) => [r.name, r.failed, r.result]), [
    ["42v_voices.ps1", false, "VOICES 1028 DONE"], ["43_hz_reel.ps1", true, "HZ REEL FAILED (pack)"], ["43b_hz_resume.ps1", false, null]]);
  assert.equal(runs[0].started_at, "2026-10-28T20:23:00.000Z");
  assert.equal(runs[2].finished_at, null);
});

test("a log line from late December read in January belongs to the year before", () => {
  const runs = parseLog("31.12 23:50 start a.ps1\r\n01.01 00:10 end a.ps1", Date.parse("2027-01-01T12:00:00Z"));
  assert.equal(runs[0].started_at, "2026-12-31T22:50:00.000Z");
  assert.equal(runs[0].finished_at, "2026-12-31T23:10:00.000Z");
});

test("the queue was stopped during a job: the run counts as aborted, and a stopped queue runs nothing", () => {
  const log = "28.10 21:30 start 43_hz_reel.ps1\r\ndevice OPTIX\r\n29.10 07:21 start 43_hz_reel.ps1\r\nHZ REEL FAILED (abgebrochen)\r\n29.10 07:21 end 43_hz_reel.ps1\r\n29.10 07:21 start 43b_hz_resume.ps1";
  const runs = parseLog(log, NOW);
  assert.deepEqual(runs.map((r) => [r.name, r.failed, r.finished_at]), [
    ["43_hz_reel.ps1", true, "2026-10-29T06:21:00.000Z"], ["43_hz_reel.ps1", true, "2026-10-29T06:21:00.000Z"], ["43b_hz_resume.ps1", false, null]]);
  assert.equal(runs[0].result, "abgebrochen (Warteschlange war gestoppt)");
  const stopped = buildRows({ queued: ["43_hz_reel.ps1", "43b_hz_resume.ps1"], runs: parseLog("28.10 21:30 start 43_hz_reel.ps1", NOW),
    status: { auftrag: "43_hz_reel.ps1", warteschlange_laeuft: false }, now: NOW });
  assert.deepEqual(stopped.map((r) => [r.name, r.status, r.position]), [["43_hz_reel.ps1", "queued", 0], ["43b_hz_resume.ps1", "queued", 1]]);
  const l = lanes({ jobs: stopped, now: NOW });
  assert.equal(l.halted, true);
  assert.equal(lanes({ jobs: buildRows({ queued: ["43b_hz_resume.ps1"], runs: parseLog("29.10 06:58 start 43b_hz_resume.ps1", NOW), now: NOW }), now: NOW }).halted, false);
});

test("job title: first comment line up to the first colon outside «…» and (…)", () => {
  assert.equal(jobTitle("﻿# Unfall-Reel Vogesen Fassung 2 (Pruefung von v1, 28.10.2026): Robin HR100 statt PA-28\n$t0 = 1"), "Unfall-Reel Vogesen Fassung 2 (Pruefung von v1, 28.10.2026)");
  assert.equal(jobTitle("# Langes YouTube-Video «Two Holes, Three Instruments: Pitot-Static in 3D» (16:9, etwa 4 Min.): Saetze neu"),
    "Langes YouTube-Video «Two Holes, Three Instruments: Pitot-Static in 3D» (16:9, etwa 4 Min.)");
  assert.equal(jobTitle("$x = 1"), null);
  assert.ok(jobTitle(`# ${"x".repeat(300)}`).length <= 160);
});

test("rows: running job with the helper's pictures, waiting jobs in order, finished jobs of the last 7 days", () => {
  const rows = buildRows({
    queued: ["43b_hz_resume.ps1", "43v_voices_vogesen.ps1", "44_asi_reel_v3.ps1"], paused: ["46_vog_reel_v2.ps1"],
    titles: { "44_asi_reel_v3.ps1": "Fahrtmesser-Reel Fassung 3" },
    runs: parseLog(LOG, NOW),
    status: { auftrag: "43b_hz_resume.ps1", bilder_im_ordner: 880, bilder_letzte_10_min: 17, letztes_bild: "2026-10-29 06:59:30" },
    now: NOW,
  });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by["43b_hz_resume.ps1"].status, "running");
  assert.equal(by["43b_hz_resume.ps1"].frames, 880);
  assert.equal(by["43b_hz_resume.ps1"].last_frame_at, "2026-10-29T05:59:30.000Z");
  assert.deepEqual([by["43v_voices_vogesen.ps1"].position, by["44_asi_reel_v3.ps1"].position], [0, 1]);
  assert.equal(by["44_asi_reel_v3.ps1"].title, "Fahrtmesser-Reel Fassung 3");
  assert.equal(by["46_vog_reel_v2.ps1"].status, "paused");
  assert.equal(by["43_hz_reel.ps1"].status, "failed");
  assert.equal(by["42v_voices.ps1"].status, "done");
  // finished more than 7 days ago: gone
  assert.equal(buildRows({ runs: parseLog(LOG, NOW), now: NOW + 9 * 864e5 }).length, 0);
});

const iso = (min) => new Date(NOW - min * 60000).toISOString();

test("lanes: running, planned, done (24 h) across the GPU queue, the background runs and the instructions", () => {
  const l = lanes({
    now: NOW,
    jobs: [
      { name: "43b_hz_resume.ps1", title: "Horizont weiter", status: "running", started_at: iso(10), frames: 900, frames_10min: 20, last_frame_at: iso(1), seen_at: iso(1) },
      { name: "45_x.ps1", status: "queued", position: 1, seen_at: iso(1) },
      { name: "44_y.ps1", status: "queued", position: 0, seen_at: iso(1) },
      { name: "43_hz_reel.ps1", title: "Horizont", status: "failed", started_at: iso(570), finished_at: iso(10), result: "HZ REEL FAILED (pack)", seen_at: iso(1) },
      { name: "30_old.ps1", status: "done", started_at: iso(3000), finished_at: iso(2900), seen_at: iso(1) },
    ],
    runs: [{ id: "r", trigger: "button", status: "queued", requested_at: iso(2) }, { id: "d", trigger: "daily", status: "done", finished_at: iso(100), summary: "3 Ideen" }],
    inbox: [{ id: "i", body: "Prüf die Rechnungen", status: "doing", created_at: iso(30), updated_at: iso(5) }, { id: "o", body: "Nebel-Serie", status: "open", created_at: iso(20) }],
  });
  assert.deepEqual(l.running.map((x) => x.key), ["gpu:43b_hz_resume.ps1", "inbox:i"]);
  assert.match(l.running[0].sub, /900 Bilder/);
  assert.deepEqual(l.planned.map((x) => x.key), ["gpu:44_y.ps1", "gpu:45_x.ps1", "run:r", "inbox:o"]);
  assert.equal(l.planned[0].title, "y");                               // no title: the file name without number
  assert.deepEqual(l.done.map((x) => x.key), ["gpu:43_hz_reel.ps1", "run:d"]);   // 30_old.ps1 is older than 24 h
  assert.equal(l.done[0].tone, "fail");
  assert.equal(l.stale, null);
});

test("lanes: a running job without a new picture for 20 minutes is marked, a silent gaming PC is reported", () => {
  const jobs = [{ name: "a.ps1", status: "running", started_at: iso(90), last_frame_at: iso(40), seen_at: iso(30) }];
  const l = lanes({ jobs, now: NOW });
  assert.equal(l.running[0].tone, "warn");
  assert.match(l.running[0].sub, /kein neues Bild seit 40 Min\./);
  assert.equal(l.stale, "30 Min.");
  const items = agendaItems({ jobs: [...jobs, { name: "b.ps1", status: "failed", finished_at: iso(5), result: "X FAILED" }], now: NOW });
  assert.deepEqual(items.map((x) => x.key), ["gpu:b.ps1", "gpu:stale"]);
  assert.equal(span(80 * 60000), "1 Std. 20 Min.");
});

test("table render_jobs: admins only, name and status checked, safe to run twice", async () => {
  const read = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");
  const ADMIN = "11111111-1111-1111-1111-111111111111", OTHER = "22222222-2222-2222-2222-222222222222";
  const db = new PGlite();
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage; create schema vault;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text) returns uuid language sql as $$ insert into vault.secrets (name, secret) values (new_name, new_secret) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text) returns void language sql as $$ update vault.secrets set secret = new_secret where id = secret_id $$;
create publication supabase_realtime;
create schema if not exists cron; create or replace function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
insert into auth.users values ('${ADMIN}', 'admin@qnh.test'), ('${OTHER}', 'other@qnh.test');`);
  await db.exec(read("20261013100000_social.sql"));
  await db.exec(`insert into public.qnh_admins (user_id) values ('${ADMIN}');`);
  await db.exec(read("20261029100000_render_jobs.sql"));
  await db.exec(read("20261029100000_render_jobs.sql"));
  const as = async (who, sql) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who ?? ""}', false); set role ${who ? "authenticated" : "anon"};`);
    try { return await db.query(sql); } finally { await db.exec("reset role;"); }
  };
  await as(ADMIN, "insert into render_jobs (name, status, position) values ('44_asi_reel_v3.ps1', 'queued', 0)");
  await as(ADMIN, "insert into render_jobs (name, status) values ('44_asi_reel_v3.ps1', 'running') on conflict (name) do update set status = excluded.status");
  assert.equal((await as(ADMIN, "select status from render_jobs")).rows[0].status, "running");
  await assert.rejects(as(ADMIN, "insert into render_jobs (name, status) values ('rm -rf.ps1', 'queued')"));
  await assert.rejects(as(ADMIN, "insert into render_jobs (name, status) values ('a.ps1', 'maybe')"));
  assert.equal((await as(OTHER, "select * from render_jobs")).rows.length, 0);
  await assert.rejects(as(OTHER, "insert into render_jobs (name, status) values ('b.ps1', 'queued')"));
  await assert.rejects(as(null, "select * from render_jobs"));
});
