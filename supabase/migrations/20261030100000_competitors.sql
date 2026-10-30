-- Social «Konkurrenz» (Christoph 30.10.2026): YouTube channels of other creators we learn from. Safe to run more than once.
-- Needs 20261013100000_social.sql (is_qnh_admin) and the daily cron 'social-stats' (20261019120000_social_stats.sql):
-- social-publish (op stats, or op competitors on «Jetzt holen») reads the PUBLIC numbers of their latest 50 videos
-- with the YouTube Data API and the token of our own channel. Nothing is downloaded, posted, liked or subscribed.
--
--   competitor_channels    watched channels (@handle from the cockpit), the channel numbers written by the server
--   competitor_videos      their latest videos: title, thumbnail, length, date, Short or not (up to 3 minutes)
--   competitor_video_days  views, likes, comments per video and day (growth: how fast a video gets its views)

create table if not exists public.competitor_channels (
  id              uuid primary key default gen_random_uuid(),
  handle          text not null unique check (handle ~ '^(@[A-Za-z0-9._-]{3,30}|UC[A-Za-z0-9_-]{22})$'),
  note            text not null default '' check (char_length(note) <= 300),     -- why we watch it (German, Christoph or Claude)
  active          boolean not null default true,
  -- written by the server only:
  channel_id      text check (channel_id is null or channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  title           text not null default '' check (char_length(title) <= 200),
  thumbnail_url   text check (thumbnail_url is null or (thumbnail_url ~ '^https://' and char_length(thumbnail_url) <= 1000)),
  subscribers     bigint,
  videos          bigint,
  views           bigint,
  last_checked_at timestamptz,
  last_error      text check (last_error is null or char_length(last_error) <= 500),
  created_at      timestamptz not null default now()
);

create table if not exists public.competitor_videos (
  video_id      text primary key check (video_id ~ '^[A-Za-z0-9_-]{5,20}$'),
  competitor_id uuid not null references public.competitor_channels (id) on delete cascade,
  title         text not null default '' check (char_length(title) <= 300),
  description   text not null default '' check (char_length(description) <= 5000),
  published_at  timestamptz,
  duration_s    int check (duration_s is null or duration_s >= 0),
  is_short      boolean not null default false,
  thumbnail_url text check (thumbnail_url is null or (thumbnail_url ~ '^https://' and char_length(thumbnail_url) <= 1000)),
  tags          text[] not null default '{}',
  first_seen_at timestamptz not null default now()
);
create index if not exists competitor_videos_channel_idx on public.competitor_videos (competitor_id, published_at desc);

create table if not exists public.competitor_video_days (
  video_id text not null references public.competitor_videos (video_id) on delete cascade,
  day      date not null,
  views    bigint,
  likes    bigint,
  comments bigint,
  primary key (video_id, day)
);

-- ---------- rights: admins read; the cockpit adds, pauses and removes channels; the rest only the server ----------
alter table public.competitor_channels enable row level security;
alter table public.competitor_videos enable row level security;
alter table public.competitor_video_days enable row level security;
revoke all on public.competitor_channels, public.competitor_videos, public.competitor_video_days from anon, authenticated;
grant select on public.competitor_channels, public.competitor_videos, public.competitor_video_days to authenticated;
grant insert (handle, note, active), update (note, active), delete on public.competitor_channels to authenticated;
grant select, insert, update, delete on public.competitor_channels, public.competitor_videos, public.competitor_video_days to service_role;

drop policy if exists "competitor_channels: admins" on public.competitor_channels;
create policy "competitor_channels: admins" on public.competitor_channels for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));
drop policy if exists "competitor_videos: admins read" on public.competitor_videos;
create policy "competitor_videos: admins read" on public.competitor_videos for select to authenticated
  using ((select public.is_qnh_admin()));
drop policy if exists "competitor_video_days: admins read" on public.competitor_video_days;
create policy "competitor_video_days: admins read" on public.competitor_video_days for select to authenticated
  using ((select public.is_qnh_admin()));

-- ---------- the first channels (Claude's proposal 30.10.2026, all checked on YouTube; Christoph adds or removes) ----------
insert into public.competitor_channels (handle, note) values
  ('@MentourPilot', 'Unfall-Dokus, lange Videos'),
  ('@MiniAirCrashInvestigation', 'Unfall-Dokus, Animation'),
  ('@GreenDotAviation', 'Unfall-Dokus, sehr erfolgreich'),
  ('@blancolirio', 'Allgemeine Luftfahrt, Unfälle kurz nach dem Ereignis'),
  ('@Disasterbreakdown', 'Unfall-Dokus, kleiner Kanal'),
  ('@AirSafetyInstitute', 'AOPA, Fallstudien Allgemeine Luftfahrt'),
  ('@TheFlightChannel', 'Unfälle im Simulator nachgestellt'),
  ('@Boldmethod', 'Erklärvideos für Piloten, Wetter und Instrumente'),
  ('@FLY8MA', 'Flugausbildung, Erklärvideos'),
  ('@FoundAndExplained', 'Erklärvideos Luftfahrt'),
  ('@Aviation101', 'Erklärvideos Luftfahrt'),
  ('@RealEngineering', 'Technik erklärt, auch Luftfahrt'),
  ('@flightchops', 'Allgemeine Luftfahrt, Lernen aus Flügen'),
  ('@74gear', 'Shorts aus dem Cockpit')
on conflict (handle) do nothing;
