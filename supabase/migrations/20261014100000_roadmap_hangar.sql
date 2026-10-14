-- QNH Core – roadmap per app and the "Hangar" (quick links). Safe to run more than once.
-- Admins only (is_qnh_admin()). Roadmap items come from the cockpit (Christoph) or from Claude
-- (scripts/roadmap.mjs, signed in as Christoph's admin account; source = 'claude').

-- ---------- roadmap ----------
create table if not exists public.roadmap_items (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null default 'qnh' check (scope ~ '^[a-z0-9-]{2,30}$'), -- qnh, downwind, secondseat, …
  title       text not null check (char_length(trim(title)) between 1 and 200),
  body        text not null default '' check (char_length(body) <= 4000),
  status      text not null default 'idea' check (status in ('idea', 'next', 'doing', 'done')),
  due         date,
  sort        int not null default 0,
  source      text not null default 'cockpit' check (source in ('cockpit', 'claude')),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists roadmap_items_scope_idx on public.roadmap_items (scope, status, sort);

create or replace function public.roadmap_items_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists roadmap_items_touch on public.roadmap_items;
create trigger roadmap_items_touch before insert or update on public.roadmap_items
  for each row execute function public.roadmap_items_touch();

alter table public.roadmap_items enable row level security;
revoke all on public.roadmap_items from anon, authenticated;
grant select, insert, update, delete on public.roadmap_items to authenticated;
drop policy if exists "roadmap: admins" on public.roadmap_items;
create policy "roadmap: admins" on public.roadmap_items for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

do $$ begin
  alter publication supabase_realtime add table public.roadmap_items;
exception when duplicate_object then null; end $$;

-- ---------- hangar (quick links) ----------
create table if not exists public.hangar_links (
  id          uuid primary key default gen_random_uuid(),
  grp         text not null default 'Allgemein' check (char_length(grp) between 1 and 40),
  title       text not null check (char_length(trim(title)) between 1 and 80),
  url         text not null check (url ~ '^https?://' and char_length(url) <= 500),
  note        text not null default '' check (char_length(note) <= 200),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  unique (url)
);
alter table public.hangar_links enable row level security;
revoke all on public.hangar_links from anon, authenticated;
grant select, insert, update, delete on public.hangar_links to authenticated;
drop policy if exists "hangar: admins" on public.hangar_links;
create policy "hangar: admins" on public.hangar_links for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

-- starting set (only public URLs; edit or delete in the cockpit)
insert into public.hangar_links (grp, title, url, note, sort) values
  ('Ablage',     'kDrive',               'https://kdrive.infomaniak.com',                         'Präsentationen, Verträge, Belege', 10),
  ('Ablage',     'Infomaniak Manager',   'https://manager.infomaniak.com',                        'Domain, DNS, E-Mail', 20),
  ('Webseiten',  'setqnh.ch',            'https://setqnh.ch',                                     'Firmen-Website', 10),
  ('Webseiten',  'flydownwind.ch',       'https://flydownwind.ch',                                'Downwind-Website', 20),
  ('Entwicklung','GitHub',               'https://github.com/christophumbricht-dev',              'Alle Repositories', 10),
  ('Entwicklung','Codemagic',            'https://codemagic.io/apps',                             'iOS-Builds', 20),
  ('Entwicklung','Supabase',             'https://supabase.com/dashboard/projects',               'Datenbanken (Downwind, QNH Core)', 30),
  ('Apple',      'App Store Connect',    'https://appstoreconnect.apple.com',                     'Apps, TestFlight, Bewertungen', 10),
  ('Apple',      'Apple Developer',      'https://developer.apple.com/account',                   'Zertifikate, IDs, Mitgliedschaft', 20),
  ('Social',     'Meta for Developers',  'https://developers.facebook.com/apps',                  'App «QNH Cockpit», Instagram-Token', 10),
  ('Social',     'Instagram @fly_downwind', 'https://www.instagram.com/fly_downwind',             '', 20)
on conflict (url) do nothing;
