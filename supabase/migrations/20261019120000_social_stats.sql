-- Social statistics: one row per account and day, one row per Instagram media item and day (values as Instagram
-- reports them on that day; media values are lifetime totals, so the rows show the growth). metrics = jsonb so
-- renamed or new Instagram metrics need no schema change. Written by social-publish (op "stats", service_role),
-- read by admins (cockpit «Statistik», npm run social -- stats). Needs the cron function from 20261013100100.

create table if not exists public.social_account_stats (
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  day        date not null,
  metrics    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (account_id, day)
);

create table if not exists public.social_media_stats (
  media_id   text not null check (media_id ~ '^[0-9]{5,40}$'),
  day        date not null,
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  kind       text not null default 'FEED',      -- FEED, CAROUSEL, REELS, STORY
  permalink  text,
  caption    text not null default '',
  posted_at  timestamptz,
  metrics    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (media_id, day)
);
create index if not exists social_media_stats_account_day on public.social_media_stats (account_id, day);

alter table public.social_account_stats enable row level security;
alter table public.social_media_stats enable row level security;
revoke all on public.social_account_stats, public.social_media_stats from anon, authenticated;
grant select on public.social_account_stats, public.social_media_stats to authenticated;
grant select, insert, update, delete on public.social_account_stats, public.social_media_stats to service_role;
drop policy if exists "social_account_stats: admins read" on public.social_account_stats;
create policy "social_account_stats: admins read" on public.social_account_stats for select to authenticated using ((select public.is_qnh_admin()));
drop policy if exists "social_media_stats: admins read" on public.social_media_stats;
create policy "social_media_stats: admins read" on public.social_media_stats for select to authenticated using ((select public.is_qnh_admin()));

-- daily 04:23 UTC (≈ 05:23/06:23 Swiss time), after Instagram has settled the previous day
select cron.schedule('social-stats', '23 4 * * *', $$ select public.social_call('stats') $$);
