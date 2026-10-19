// Runs supabase/migrations/*_social.sql in PGlite (Postgres in WASM) with minimal Supabase stand-ins
// (auth, storage, vault) and checks the rules: only admins, nothing approves itself, tokens stay server-side.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(new URL("../supabase/migrations/20261013100000_social.sql", import.meta.url), "utf8");
const SQL2 = readFileSync(new URL("../supabase/migrations/20261014100000_roadmap_hangar.sql", import.meta.url), "utf8");
const SQL3 = readFileSync(new URL("../supabase/migrations/20261014120000_social_todo.sql", import.meta.url), "utf8");
const SQL4 = readFileSync(new URL("../supabase/migrations/20261019100000_social_location.sql", import.meta.url), "utf8");
const SQL5 = readFileSync(new URL("../supabase/migrations/20261019120000_social_stats.sql", import.meta.url), "utf8");
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
await db.exec(SQL);
await db.exec(SQL); // Christoph may paste it twice
await db.exec(SQL2);
await db.exec(SQL2);
await db.exec(SQL3);
await db.exec(SQL3);
await db.exec(SQL4);
await db.exec(SQL4);
await db.exec("create schema if not exists cron; create or replace function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;");
await db.exec(SQL5);
await db.exec(SQL5);
await db.exec(`
insert into qnh_admins (user_id) values ('${ADMIN}');
insert into social_accounts (id, app_id, platform, remote_id, handle, token_name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'downwind', 'instagram', '1789', 'flydownwind', 'meta_token_downwind_instagram');
select vault.create_secret('TOKEN-ONE', 'meta_token_downwind_instagram');
`);
const ACC = "aaaaaaaa-0000-0000-0000-000000000001";

async function as(who, sql) {
  const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who && who !== "service" ? who : ""}', false); set role ${role};`);
  try { return await db.query(sql); } finally { await db.exec("reset role;"); }
}
const newPost = async (extra = "") =>
  (await as(ADMIN, `insert into social_posts (account_id, kind, caption, media${extra ? ", " + extra.split("=")[0] : ""})
    values ('${ACC}', 'image', 'Hello', '[{"path":"a/1.jpg","type":"image/jpeg"}]'${extra ? ", " + extra.split("=").slice(1).join("=") : ""}) returning id`)).rows[0].id;

test("only admins see accounts and posts; anon sees nothing", async () => {
  assert.equal((await as(ADMIN, "select count(*)::int n from social_accounts")).rows[0].n, 1);
  assert.equal((await as(OTHER, "select count(*)::int n from social_accounts")).rows[0].n, 0);
  await assert.rejects(as(null, "select * from social_accounts"));
  await assert.rejects(as(OTHER, `insert into social_posts (account_id, kind) values ('${ACC}', 'image')`));
});

test("new posts are always drafts", async () => {
  await assert.rejects(newPost("status='approved'"), /Entwürfe/);
  const id = await newPost();
  const r = await as(ADMIN, `select status, created_by from social_posts where id='${id}'`);
  assert.equal(r.rows[0].status, "draft");
  assert.equal(r.rows[0].created_by, ADMIN);
});

test("approving needs a time, records who approved, freezes the content", async () => {
  const id = await newPost();
  await assert.rejects(as(ADMIN, `update social_posts set status='approved' where id='${id}'`));
  await as(ADMIN, `update social_posts set status='approved', scheduled_at=now() + interval '1 day' where id='${id}'`);
  const r = await as(ADMIN, `select status, approved_by, approved_at from social_posts where id='${id}'`);
  assert.equal(r.rows[0].status, "approved");
  assert.equal(r.rows[0].approved_by, ADMIN);
  assert.ok(r.rows[0].approved_at);
  await assert.rejects(as(ADMIN, `update social_posts set caption='changed' where id='${id}'`), /zurückziehen/);
  await as(ADMIN, `update social_posts set status='draft' where id='${id}'`); // withdraw
  await as(ADMIN, `update social_posts set caption='changed' where id='${id}'`);
  assert.equal((await as(ADMIN, `select approved_by from social_posts where id='${id}'`)).rows[0].approved_by, null);
});

test("the cockpit cannot fake server fields or jump to published", async () => {
  const id = await newPost();
  await assert.rejects(as(ADMIN, `update social_posts set status='published' where id='${id}'`), /nicht erlaubt/);
  await assert.rejects(as(ADMIN, `update social_posts set permalink='https://x' where id='${id}'`), /Server/);
  await assert.rejects(as(ADMIN, `update social_posts set approved_by='${ADMIN}', approved_at=now() where id='${id}'`).then(async () => {
    const r = await as(ADMIN, `select approved_by from social_posts where id='${id}'`);
    if (r.rows[0].approved_by === null) throw new Error("ignored, as it should be");
  }), /ignored/);
});

test("drafts can be deleted, approved posts not", async () => {
  const id = await newPost();
  await as(ADMIN, `update social_posts set status='approved', scheduled_at=now() where id='${id}'`);
  assert.equal((await as(ADMIN, `delete from social_posts where id='${id}' returning id`)).rows.length, 0);
  const d = await newPost();
  assert.equal((await as(ADMIN, `delete from social_posts where id='${d}' returning id`)).rows.length, 1);
});

test("claim: only the server, only due posts, atomically; resume does not count as attempt", async () => {
  await db.exec("delete from social_posts");
  const due = await newPost(), later = await newPost();
  await as(ADMIN, `update social_posts set status='approved', scheduled_at=now() - interval '1 minute' where id='${due}'`);
  await as(ADMIN, `update social_posts set status='approved', scheduled_at=now() + interval '1 hour' where id='${later}'`);
  await assert.rejects(as(ADMIN, "select * from social_claim()"));
  const r = await as("service", "select id, status, attempts from social_claim()");
  assert.deepEqual(r.rows.map((x) => [x.id, x.status, x.attempts]), [[due, "publishing", 1]]);
  assert.equal((await as("service", "select count(*)::int n from social_claim()")).rows[0].n, 0); // already taken
  // updated_at is reset by the trigger, so simulate an old run directly
  await db.exec(`alter table social_posts disable trigger social_posts_updated_at; update social_posts set updated_at = now() - interval '10 minutes' where id='${due}'; alter table social_posts enable trigger social_posts_updated_at;`);
  const again = await as("service", "select attempts from social_claim()");
  assert.equal(again.rows[0].attempts, 1);
});

test("tokens: only the server reads them; refresh writes Vault and the expiry", async () => {
  await assert.rejects(as(ADMIN, `select social_token('${ACC}')`));
  await assert.rejects(as(null, `select social_token('${ACC}')`));
  assert.equal((await as("service", `select social_token('${ACC}') t`)).rows[0].t, "TOKEN-ONE");
  await as("service", `select social_store_token('${ACC}', 'TOKEN-TWO', now() + interval '60 days')`);
  assert.equal((await as("service", `select social_token('${ACC}') t`)).rows[0].t, "TOKEN-TWO");
  assert.ok((await as(ADMIN, "select token_expires_at from social_accounts")).rows[0].token_expires_at);
  const cols = (await db.query("select column_name from information_schema.columns where table_name='social_accounts'")).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /^(token|access_token|secret)$/.test(c)), "no token column");
});

test("the Edge Function (service_role) may update posts and read accounts directly", async () => {
  const id = await newPost();
  await as("service", `update social_posts set status='published', remote_media_id='M1', permalink='https://x' where id='${id}'`);
  assert.equal((await as(ADMIN, `select status from social_posts where id='${id}'`)).rows[0].status, "published");
  assert.equal((await as("service", "select count(*)::int n from social_accounts")).rows[0].n, 1);
});

test("storage: only admins upload to social-media", async () => {
  await as(ADMIN, "insert into storage.objects (bucket_id, name) values ('social-media', 'x/1.jpg')");
  await assert.rejects(as(OTHER, "insert into storage.objects (bucket_id, name) values ('social-media', 'x/2.jpg')"));
  assert.equal((await db.query("select public from storage.buckets where id='social-media'")).rows[0].public, true);
});

test("roadmap: only admins; done_at follows the status; Claude items marked", async () => {
  await assert.rejects(as(OTHER, "insert into roadmap_items (title) values ('x')"));
  assert.equal((await as(OTHER, "select count(*)::int n from roadmap_items")).rows[0].n, 0);
  const id = (await as(ADMIN, "insert into roadmap_items (scope, title, source) values ('downwind', 'Bundle-ID umstellen', 'claude') returning id")).rows[0].id;
  await as(ADMIN, `update roadmap_items set status='done' where id='${id}'`);
  assert.ok((await as(ADMIN, `select done_at from roadmap_items where id='${id}'`)).rows[0].done_at);
  await as(ADMIN, `update roadmap_items set status='next' where id='${id}'`);
  assert.equal((await as(ADMIN, `select done_at from roadmap_items where id='${id}'`)).rows[0].done_at, null);
  await assert.rejects(as(ADMIN, "insert into roadmap_items (scope, title) values ('Bad Scope!', 'x')"));
});

test("hangar: seeded once, admins only, only http(s) links", async () => {
  const n = (await as(ADMIN, "select count(*)::int n from hangar_links")).rows[0].n;
  assert.ok(n >= 10);
  assert.equal((await as(OTHER, "select count(*)::int n from hangar_links")).rows[0].n, 0);
  await assert.rejects(as(ADMIN, "insert into hangar_links (title, url) values ('x', 'javascript:alert(1)')"));
});

test("todo note: editable in every status, everything else stays locked after publishing", async () => {
  const id = await newPost();
  await as(ADMIN, `update social_posts set todo='Story am Vortag' where id='${id}'`);
  await as(ADMIN, `update social_posts set status='approved', scheduled_at=now() + interval '1 day' where id='${id}'`);
  await as(ADMIN, `update social_posts set todo='Story am Vortag ✓' where id='${id}'`);
  await as("service", `update social_posts set status='published', published_at=now() where id='${id}'`);
  await as(ADMIN, `update social_posts set todo='Jürg markieren' where id='${id}'`);
  assert.equal((await as(ADMIN, `select todo from social_posts where id='${id}'`)).rows[0].todo, "Jürg markieren");
  await assert.rejects(as(ADMIN, `update social_posts set caption='x', todo='y' where id='${id}'`), /veröffentlicht/);
  await assert.rejects(as(ADMIN, `update social_posts set status='draft', todo='y' where id='${id}'`), /veröffentlicht/);
  await assert.rejects(as(ADMIN, `update social_posts set todo=repeat('x', 2001) where id='${id}'`));
});

test("location: saved places for admins only; frozen once approved; todo still editable", async () => {
  await as(ADMIN, "insert into social_locations (page_id, name) values ('112233445566', 'Flugplatz Birrfeld')");
  assert.equal((await as(OTHER, "select count(*)::int n from social_locations")).rows[0].n, 0);
  await assert.rejects(as(ADMIN, "insert into social_locations (page_id, name) values ('birrfeld', 'x')"));
  const id = await newPost();
  await as(ADMIN, `update social_posts set location='{"id":"112233445566","name":"Flugplatz Birrfeld"}' where id='${id}'`);
  await assert.rejects(as(ADMIN, `update social_posts set location='{"id":"abc"}' where id='${id}'`));
  await as(ADMIN, `update social_posts set status='approved', scheduled_at=now() + interval '1 day' where id='${id}'`);
  await assert.rejects(as(ADMIN, `update social_posts set location=null where id='${id}'`), /zurückziehen/);
  await as(ADMIN, `update social_posts set todo='ok' where id='${id}'`);
});

test("stats: only the server writes, admins read", async () => {
  await as("service", `insert into social_account_stats (account_id, day, metrics) values ('${ACC}', '2026-10-19', '{"followers_count": 7}')`);
  await as("service", `insert into social_media_stats (media_id, day, account_id, kind, metrics) values ('17900000000000001', '2026-10-19', '${ACC}', 'REELS', '{"views": 120}')`);
  assert.equal((await as(ADMIN, "select metrics->>'views' v from social_media_stats")).rows[0].v, "120");
  assert.equal((await as(OTHER, "select count(*)::int n from social_account_stats")).rows[0].n, 0);
  await assert.rejects(as(ADMIN, `insert into social_account_stats (account_id, day) values ('${ACC}', '2026-10-20')`));
});
