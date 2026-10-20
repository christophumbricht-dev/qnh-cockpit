-- Social: comment inbox (Instagram + YouTube) and YouTube channels as accounts. Safe to run more than once.
-- Needs 20261013100000_social.sql and the cron function from 20261013100100_social_cron.sql.
--
--   social_accounts   now also platform 'youtube' (remote_id = channel id UC…). Its Google refresh token lives in
--                     Vault under google_token_<app>_youtube – written by social-publish (op youtube-connect), never shown.
--   social_comments   comments on our own posts/videos, fetched by social-publish (op comments, every 15 min).
--                     Admins read them and may change only `status` (new ↔ done) and `draft` (a reply suggestion,
--                     e.g. from Claude). Replying, hiding and deleting go through the Edge Function – always a click.

-- ---------- accounts: YouTube ----------
alter table public.social_accounts drop constraint if exists social_accounts_platform_check;
alter table public.social_accounts add constraint social_accounts_platform_check
  check (platform in ('instagram', 'facebook', 'youtube'));
alter table public.social_accounts drop constraint if exists social_accounts_token_name_check;
alter table public.social_accounts add constraint social_accounts_token_name_check
  check (token_name ~ '^(meta|google)_token_[a-z0-9_]{2,60}$');
grant insert on public.social_accounts to service_role;   -- «YouTube verbinden» creates the account row

-- ---------- comments ----------
create table if not exists public.social_comments (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.social_accounts (id) on delete cascade,
  remote_id        text not null check (char_length(remote_id) between 1 and 120),          -- comment id on the platform
  parent_remote_id text check (parent_remote_id is null or char_length(parent_remote_id) between 1 and 120), -- set for replies
  media_id         text not null check (char_length(media_id) between 1 and 64),            -- Instagram media id / YouTube video id
  media_title      text not null default '' check (char_length(media_title) <= 300),        -- first line of the post, for context
  media_permalink  text check (media_permalink is null or char_length(media_permalink) <= 500),
  author           text not null default '' check (char_length(author) <= 200),
  author_url       text check (author_url is null or char_length(author_url) <= 500),
  body             text not null default '' check (char_length(body) <= 10000),
  posted_at        timestamptz,
  like_count       int not null default 0,
  own              boolean not null default false,   -- written by our account (a reply, the first comment)
  held             boolean not null default false,   -- YouTube holds it for review (often spam)
  status           text not null default 'new' check (status in ('new', 'done', 'hidden')),
  draft            text not null default '' check (char_length(draft) <= 2200), -- reply suggestion, never sent by itself
  replied_at       timestamptz,
  deleted_at       timestamptz,                      -- gone on the platform
  fetched_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, remote_id)
);
create index if not exists social_comments_open_idx on public.social_comments (status, posted_at desc);
create index if not exists social_comments_media_idx on public.social_comments (account_id, media_id);

drop trigger if exists social_comments_updated_at on public.social_comments;
create trigger social_comments_updated_at before update on public.social_comments
  for each row execute function public.qnh_touch_updated_at();

-- The cockpit (role authenticated) may only switch between «offen» and «erledigt» and edit the draft.
-- Hidden/shown is the platform's state: only the Edge Function changes it (after Instagram/YouTube said yes).
create or replace function public.social_comments_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;
  if new.status is distinct from old.status and not (old.status in ('new', 'done') and new.status in ('new', 'done')) then
    raise exception 'Aus- und Einblenden geht nur über den Knopf im Cockpit (Instagram/YouTube).' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists social_comments_guard on public.social_comments;
create trigger social_comments_guard before update on public.social_comments
  for each row execute function public.social_comments_guard();

alter table public.social_comments enable row level security;
revoke all on public.social_comments from anon, authenticated;
grant select on public.social_comments to authenticated;
grant update (status, draft) on public.social_comments to authenticated;   -- nothing else, column by column
grant select, insert, update, delete on public.social_comments to service_role;
drop policy if exists "social_comments: admins read" on public.social_comments;
create policy "social_comments: admins read" on public.social_comments for select to authenticated
  using ((select public.is_qnh_admin()));
drop policy if exists "social_comments: admins change" on public.social_comments;
create policy "social_comments: admins change" on public.social_comments for update to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

do $$ begin
  alter publication supabase_realtime add table public.social_comments;   -- new comments appear live
exception when duplicate_object then null; end $$;

-- every 15 minutes: fetch new comments (Instagram: only posts whose comment count changed; YouTube: ~2 quota units)
select cron.schedule('social-comments', '*/15 * * * *', $$ select public.social_call('comments') $$);
