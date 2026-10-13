-- QNH Core – social media posts with approval (cockpit tab "Social"). Safe to run more than once.
-- Apply only in the Supabase project "QNH Core" (not in an app project).
--
--   qnh_admins        who may use the cockpit here (set only in the SQL editor – never from the cockpit)
--   social_accounts   one row per app + platform (e.g. downwind / instagram). NO tokens in this table:
--                     the Meta token lives in Supabase Vault under token_name; only the Edge Function reads it.
--   social_posts      drafts → approved (only by an admin, needs a time) → publishing → published | failed
--   bucket social-media  public read (Meta fetches the files by URL), write only for admins;
--                     files of published posts are deleted after 14 days by the cleanup job, the permalink stays.

-- ---------- admins ----------
create table if not exists public.qnh_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.qnh_admins enable row level security;
revoke all on public.qnh_admins from anon, authenticated;

create or replace function public.is_qnh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.qnh_admins a where a.user_id = (select auth.uid()))
$$;
revoke all on function public.is_qnh_admin() from public, anon;
grant execute on function public.is_qnh_admin() to authenticated;

create or replace function public.qnh_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- accounts ----------
create table if not exists public.social_accounts (
  id                 uuid primary key default gen_random_uuid(),
  app_id             text not null check (app_id ~ '^[a-z0-9-]{2,30}$'),            -- downwind, secondseat, …
  platform           text not null check (platform in ('instagram', 'facebook')),
  remote_id          text not null check (char_length(remote_id) between 1 and 64), -- Instagram user id / Facebook page id
  handle             text not null default '' check (char_length(handle) <= 60),
  token_name         text not null check (token_name ~ '^meta_token_[a-z0-9_]{2,60}$'), -- name of the Vault secret
  token_expires_at   timestamptz,
  token_refreshed_at timestamptz,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (app_id, platform)
);
alter table public.social_accounts enable row level security;
revoke all on public.social_accounts from anon, authenticated;
grant select on public.social_accounts to authenticated;
drop policy if exists "social_accounts: admins read" on public.social_accounts;
create policy "social_accounts: admins read" on public.social_accounts for select to authenticated using ((select public.is_qnh_admin()));

-- ---------- posts ----------
create table if not exists public.social_posts (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.social_accounts (id) on delete restrict,
  kind                text not null check (kind in ('image', 'carousel', 'reel', 'story')),
  caption             text not null default '' check (char_length(caption) <= 2200),
  first_comment       text not null default '' check (char_length(first_comment) <= 2200),
  media               jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 10), -- [{path, type, alt, width, height, duration}]
  cover_path          text check (cover_path is null or char_length(cover_path) <= 300),
  status              text not null default 'draft'
                      check (status in ('draft', 'approved', 'publishing', 'published', 'failed', 'cancelled')),
  scheduled_at        timestamptz,
  approved_at         timestamptz,
  approved_by         uuid references auth.users (id) on delete set null,
  published_at        timestamptz,
  remote_container_id text,
  remote_media_id     text,
  permalink           text,
  attempts            int not null default 0,
  last_error          text check (last_error is null or char_length(last_error) <= 1000),
  media_deleted_at    timestamptz,
  source              text not null default 'editor' check (source in ('editor', 'package', 'duplicate')),
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint social_posts_time_when_approved check (status not in ('approved', 'publishing') or scheduled_at is not null)
);
create index if not exists social_posts_due_idx on public.social_posts (status, scheduled_at);

drop trigger if exists social_posts_updated_at on public.social_posts;
create trigger social_posts_updated_at before update on public.social_posts
  for each row execute function public.qnh_touch_updated_at();

-- Guard for changes from the cockpit (role authenticated). The Edge Function (service_role) and the
-- SQL editor (postgres) are not restricted. Nothing approves itself: only an admin's update does.
create or replace function public.social_posts_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Neue Beiträge sind immer Entwürfe.' using errcode = '42501'; end if;
    new.created_by := auth.uid();
    new.approved_at := null; new.approved_by := null; new.published_at := null;
    new.remote_container_id := null; new.remote_media_id := null; new.permalink := null;
    new.attempts := 0; new.last_error := null; new.media_deleted_at := null;
    return new;
  end if;

  -- fields only the server writes
  if (new.published_at, new.remote_container_id, new.remote_media_id, new.permalink, new.media_deleted_at, new.created_by, new.created_at)
     is distinct from (old.published_at, old.remote_container_id, old.remote_media_id, old.permalink, old.media_deleted_at, old.created_by, old.created_at) then
    raise exception 'Diese Felder setzt nur der Server.' using errcode = '42501';
  end if;
  if old.status in ('publishing', 'published') then
    raise exception 'Der Beitrag wird gerade oder wurde bereits veröffentlicht. Zum Wiederverwenden duplizieren.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (   (old.status in ('draft', 'failed') and new.status in ('approved', 'cancelled'))
            or (old.status = 'approved'           and new.status in ('draft', 'cancelled'))
            or (old.status in ('cancelled', 'failed') and new.status = 'draft')) then
      raise exception 'Statuswechsel % → % ist nicht erlaubt.', old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'approved' then
      if new.scheduled_at is null then raise exception 'Zum Freigeben braucht es einen Zeitpunkt.' using errcode = '23514'; end if;
      new.approved_at := now(); new.approved_by := auth.uid(); new.attempts := 0; new.last_error := null;
    else
      new.approved_at := null; new.approved_by := null;
    end if;
  else
    if old.status = 'approved'
       and (new.caption, new.first_comment, new.media, new.cover_path, new.kind, new.account_id, new.scheduled_at)
           is distinct from (old.caption, old.first_comment, old.media, old.cover_path, old.kind, old.account_id, old.scheduled_at) then
      raise exception 'Freigegebene Beiträge zuerst zurückziehen, dann ändern.' using errcode = '42501';
    end if;
    new.approved_at := old.approved_at; new.approved_by := old.approved_by;
    new.attempts := old.attempts; new.last_error := old.last_error;
  end if;
  return new;
end $$;
drop trigger if exists social_posts_guard on public.social_posts;
create trigger social_posts_guard before insert or update on public.social_posts
  for each row execute function public.social_posts_guard();

alter table public.social_posts enable row level security;
revoke all on public.social_posts from anon, authenticated;
grant select, insert, update, delete on public.social_posts to authenticated;
drop policy if exists "social_posts: admins read" on public.social_posts;
create policy "social_posts: admins read" on public.social_posts for select to authenticated using ((select public.is_qnh_admin()));
drop policy if exists "social_posts: admins add" on public.social_posts;
create policy "social_posts: admins add" on public.social_posts for insert to authenticated with check ((select public.is_qnh_admin()));
drop policy if exists "social_posts: admins change" on public.social_posts;
create policy "social_posts: admins change" on public.social_posts for update to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));
drop policy if exists "social_posts: admins delete drafts" on public.social_posts;
create policy "social_posts: admins delete drafts" on public.social_posts for delete to authenticated
  using ((select public.is_qnh_admin()) and status in ('draft', 'cancelled'));

do $$ begin
  alter publication supabase_realtime add table public.social_posts;   -- live status in the cockpit
exception when duplicate_object then null; end $$;

-- ---------- server-only functions (Edge Function with the service_role key) ----------

-- Picks due posts atomically (approved and due, or a publishing run that was interrupted, e.g. a video
-- that was still processing) and marks them publishing. A resumed run does not count as a new attempt.
create or replace function public.social_claim(p_post_id uuid default null, p_limit int default 5)
returns setof public.social_posts language plpgsql security definer set search_path = '' as $$
begin
  return query
    update public.social_posts p
       set status = 'publishing',
           attempts = p.attempts + case when p.status = 'approved' then 1 else 0 end
     where p.id in (
       select q.id from public.social_posts q
       join public.social_accounts a on a.id = q.account_id and a.active
       where (p_post_id is null or q.id = p_post_id)
         and ((q.status = 'approved' and q.scheduled_at <= now())
              or (q.status = 'publishing' and q.updated_at < now() - interval '5 minutes'))
       order by q.scheduled_at
       limit least(greatest(coalesce(p_limit, 5), 1), 20)
       for update of q skip locked)
    returning p.*;
end $$;
revoke all on function public.social_claim(uuid, int) from public, anon, authenticated;
grant execute on function public.social_claim(uuid, int) to service_role;

-- The account's Meta token from Vault. Never callable from the cockpit or the apps.
create or replace function public.social_token(p_account_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  join public.social_accounts a on a.token_name = s.name
  where a.id = p_account_id
$$;
revoke all on function public.social_token(uuid) from public, anon, authenticated;
grant execute on function public.social_token(uuid) to service_role;

-- Writes a refreshed token back to Vault (weekly refresh job).
create or replace function public.social_store_token(p_account_id uuid, p_token text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text; v_id uuid;
begin
  select token_name into v_name from public.social_accounts where id = p_account_id;
  if v_name is null then raise exception 'Unknown social account'; end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then perform vault.create_secret(p_token, v_name);
  else perform vault.update_secret(v_id, p_token);
  end if;
  update public.social_accounts set token_expires_at = p_expires_at, token_refreshed_at = now() where id = p_account_id;
end $$;
revoke all on function public.social_store_token(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.social_store_token(uuid, text, timestamptz) to service_role;

-- ---------- storage ----------
-- 50 MB per file is the limit of the Supabase free plan (longer Reels need a smaller file or a paid plan).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('social-media', 'social-media', true, 52428800, array['image/jpeg', 'video/mp4', 'video/quicktime'])
  on conflict (id) do nothing;
drop policy if exists "social-media: admins read" on storage.objects;
create policy "social-media: admins read" on storage.objects for select to authenticated
  using (bucket_id = 'social-media' and (select public.is_qnh_admin()));
drop policy if exists "social-media: admins upload" on storage.objects;
create policy "social-media: admins upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'social-media' and (select public.is_qnh_admin()));
drop policy if exists "social-media: admins change" on storage.objects;
create policy "social-media: admins change" on storage.objects for update to authenticated
  using (bucket_id = 'social-media' and (select public.is_qnh_admin()));
drop policy if exists "social-media: admins delete" on storage.objects;
create policy "social-media: admins delete" on storage.objects for delete to authenticated
  using (bucket_id = 'social-media' and (select public.is_qnh_admin()));
