// Digital Studio tables (migration 20261028100000_studio.sql) in PGlite: admins only, checks, cascade.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

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
insert into auth.users values ('${ADMIN}', 'admin@qnh.test'), ('${OTHER}', 'other@qnh.test');
`);
await db.exec(read("20261013100000_social.sql"));
await db.exec(`insert into public.qnh_admins (user_id) values ('${ADMIN}');`);
await db.exec(read("20261028100000_studio.sql"));
await db.exec(read("20261028100000_studio.sql"));   // safe to run twice

async function as(who, sql) {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who && who !== "service" ? who : ""}', false); set role ${role};`);
  try { return await db.query(sql); } finally { await db.exec("reset role;"); }
}
const newItem = async () => (await as(ADMIN, `insert into studio_items (channel, format, title, day) values ('leesidelab/youtube', 'video_long', 'Föhn', '2026-11-08') returning id`)).rows[0].id;

test("only admins see and write studio rows; anon and others see nothing", async () => {
  const id = await newItem();
  assert.equal((await as(ADMIN, "select count(*)::int n from studio_items")).rows[0].n >= 1, true);
  assert.equal((await as(OTHER, "select count(*)::int n from studio_items")).rows[0].n, 0);
  await assert.rejects(as(null, "select * from studio_items"));
  await assert.rejects(as(OTHER, `insert into studio_markers (item_id, version, body) values ('${id}', 1, 'x')`));
});

test("versions are unique per item, markers carry time, scene and spot; deleting the item removes them", async () => {
  const id = await newItem();
  await as(ADMIN, `insert into studio_versions (item_id, version, source, scenes, fps, duration) values ('${id}', 1, '{"kind":"r2","key":"studio/foehn/v1/video.mp4"}', '[{"id":"intro","label":"Intro","start":0,"end":28}]', 30, 337)`);
  await assert.rejects(as(ADMIN, `insert into studio_versions (item_id, version) values ('${id}', 1)`));
  await as(ADMIN, `insert into studio_markers (item_id, version, at, scene_id, offset_s, x, y, category, body) values ('${id}', 1, 12.5, 'intro', 12.5, 40, 60, 'picture', 'Text zu klein')`);
  await assert.rejects(as(ADMIN, `insert into studio_markers (item_id, version, x, body) values ('${id}', 1, 140, 'x')`));
  await assert.rejects(as(ADMIN, `insert into studio_markers (item_id, version, body, status) values ('${id}', 1, 'x', 'maybe')`));
  await as(ADMIN, `delete from studio_items where id='${id}'`);
  assert.equal((await as(ADMIN, `select count(*)::int n from studio_markers where item_id='${id}'`)).rows[0].n, 0);
});

test("channel and format are checked", async () => {
  await assert.rejects(as(ADMIN, "insert into studio_items (channel, format) values ('leesidelab', 'reel')"));
  await assert.rejects(as(ADMIN, "insert into studio_items (channel, format) values ('leesidelab/instagram', 'movie')"));
});
