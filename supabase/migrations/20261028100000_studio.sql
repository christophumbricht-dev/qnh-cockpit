-- Digital Studio (28.10.2026, Christoph: every post is looked at twice at most): review with markers.
-- studio_items: one per post under review (channel, format, working title, day, status, current version, social post).
-- studio_versions: each version of the post (media source, scenes, fps, duration, meta, content hash).
-- studio_markers: Christoph's markers (time or page, scene + offset, spot in the picture, target, category, text) and
-- what Claude did with them (status, note, scope of the rule that came out of it).
-- Media of long videos: Cloudflare R2 (key in studio_versions.source, signed by the function studio-media), short
-- ones: the Social bucket; a local file on the PC is the fallback. Admins only. Safe to run more than once.

create table if not exists public.studio_items (
  id              uuid primary key default gen_random_uuid(),
  channel         text not null check (channel ~ '^[a-z0-9-]{2,30}/(instagram|youtube|facebook)$'),   -- leesidelab/youtube
  format          text not null check (format in ('video_long', 'reel', 'short', 'carousel', 'image', 'story')),
  title           text not null default '' check (char_length(title) <= 200),
  slug            text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9._-]{1,80}$'),             -- package folder / studio/<slug>
  day             date,
  status          text not null default 'review1' check (status in ('review1', 'work', 'review2', 'approved')),
  current_version int not null default 1 check (current_version >= 1),
  social_post_id  uuid references public.social_posts (id) on delete set null,
  approved_hash   text check (approved_hash is null or char_length(approved_hash) <= 80),             -- approved before the draft existed
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists studio_items_day on public.studio_items (day);
create unique index if not exists studio_items_post on public.studio_items (social_post_id) where social_post_id is not null;

create table if not exists public.studio_versions (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.studio_items (id) on delete cascade,
  version     int not null check (version >= 1),
  source      jsonb not null default '{}'::jsonb,   -- { kind: storage|r2|local, path|key|name, still?, pages?: [paths] }
  scenes      jsonb not null default '[]'::jsonb,   -- [{ id, label, start, end }] seconds
  fps         real check (fps is null or fps between 1 and 120),
  duration    real check (duration is null or duration >= 0),
  meta        jsonb not null default '{}'::jsonb,   -- titles, thumbnails, caption, description, chapters, shorts, assumptions
  hash        text check (hash is null or char_length(hash) <= 80),
  created_at  timestamptz not null default now(),
  unique (item_id, version)
);

create table if not exists public.studio_markers (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.studio_items (id) on delete cascade,
  version       int not null check (version >= 1),        -- the version it was set on
  at            real check (at is null or at >= 0),        -- seconds (video)
  page          int check (page is null or page >= 0),     -- 0-based (carousel)
  scene_id      text check (scene_id is null or char_length(scene_id) <= 60),
  offset_s      real,                                      -- seconds after the scene start
  x             real check (x is null or x between 0 and 100),   -- percent of the picture
  y             real check (y is null or y between 0 and 100),
  target        text not null default 'medium' check (target in ('medium', 'caption', 'title', 'description', 'first_comment', 'quiz', 'thumbnail', 'general')),
  category      text not null default 'other' check (category in ('picture', 'sound', 'text', 'fact', 'other')),
  body          text not null check (char_length(body) between 1 and 2000),
  status        text not null default 'draft' check (status in ('draft', 'open', 'done', 'rejected', 'ok', 'not_yet')),
  note          text check (note is null or char_length(note) <= 2000),          -- Claude: what changed / why not
  scope         text check (scope is null or scope in ('post', 'channel', 'all')),
  rule          text check (rule is null or char_length(rule) <= 500),            -- the rule in Abnahme-Regeln.md
  done_version  int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists studio_markers_item on public.studio_markers (item_id, version);

create or replace function public.studio_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists studio_items_touch on public.studio_items;
create trigger studio_items_touch before update on public.studio_items for each row execute function public.studio_touch();
drop trigger if exists studio_markers_touch on public.studio_markers;
create trigger studio_markers_touch before update on public.studio_markers for each row execute function public.studio_touch();

alter table public.studio_items enable row level security;
alter table public.studio_versions enable row level security;
alter table public.studio_markers enable row level security;
revoke all on public.studio_items, public.studio_versions, public.studio_markers from anon, authenticated;
grant select, insert, update, delete on public.studio_items, public.studio_versions, public.studio_markers to authenticated;
drop policy if exists "studio_items: admins" on public.studio_items;
create policy "studio_items: admins" on public.studio_items for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));
drop policy if exists "studio_versions: admins" on public.studio_versions;
create policy "studio_versions: admins" on public.studio_versions for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));
drop policy if exists "studio_markers: admins" on public.studio_markers;
create policy "studio_markers: admins" on public.studio_markers for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

-- the cockpit reloads when a chat resolves a marker or a new version arrives
do $$ begin alter publication supabase_realtime add table public.studio_items; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.studio_markers; exception when duplicate_object then null; end $$;
