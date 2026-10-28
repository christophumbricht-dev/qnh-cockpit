-- Claude in the background (28.10.2026, Christoph: «alles vom Cockpit aus, du rechnest im Hintergrund»).
-- studio_jobs: one row per background run of Claude on the gaming PC. The cockpit button «Claude jetzt starten»
-- inserts a queued row; the gaming PC (scripts/studio-worker.mjs, every 5 min, and once a day at 08:00) claims it,
-- runs Claude headless and writes the outcome back.
-- studio_requests: questions Claude needs Christoph's answer to before acting, first of all every ElevenLabs
-- voicing (rule since 25.10.2026: ask with number of sentences and credits). Christoph answers in the cockpit.
-- Admins only. Safe to run more than once.

create table if not exists public.studio_jobs (
  id            uuid primary key default gen_random_uuid(),
  trigger       text not null default 'button' check (trigger in ('button', 'daily')),
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  note          text check (note is null or char_length(note) <= 500),        -- what Christoph wants (optional)
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  machine       text check (machine is null or char_length(machine) <= 40),
  summary       text check (summary is null or char_length(summary) <= 4000) -- Claude's short report (German)
);
create index if not exists studio_jobs_recent on public.studio_jobs (requested_at desc);
-- at most one waiting run: a second click while one waits does nothing
create unique index if not exists studio_jobs_one_queued on public.studio_jobs ((true)) where status = 'queued';

create table if not exists public.studio_requests (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid references public.studio_items (id) on delete set null,
  kind        text not null default 'voice' check (kind in ('voice', 'other')),
  title       text not null check (char_length(title) between 1 and 200),
  body        text not null default '' check (char_length(body) <= 4000),         -- the sentences, or the question
  sentences   int check (sentences is null or sentences between 0 and 500),
  credits     int check (credits is null or credits between 0 and 1000000),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'done')),
  answer      text check (answer is null or char_length(answer) <= 1000),          -- Christoph's note
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  done_at     timestamptz
);
create index if not exists studio_requests_open on public.studio_requests (status, created_at);

alter table public.studio_jobs enable row level security;
alter table public.studio_requests enable row level security;
revoke all on public.studio_jobs, public.studio_requests from anon, authenticated;
grant select, insert, update, delete on public.studio_jobs, public.studio_requests to authenticated;
drop policy if exists "studio_jobs: admins" on public.studio_jobs;
create policy "studio_jobs: admins" on public.studio_jobs for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));
drop policy if exists "studio_requests: admins" on public.studio_requests;
create policy "studio_requests: admins" on public.studio_requests for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

-- the cockpit shows a run and an answer as soon as they change; versions too (title choice on another device)
do $$ begin alter publication supabase_realtime add table public.studio_jobs; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.studio_requests; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.studio_versions; exception when duplicate_object then null; end $$;

-- old runs go after 90 days
select cron.schedule('studio-jobs-cleanup', '17 3 * * *',
  $$ delete from public.studio_jobs where requested_at < now() - interval '90 days' $$);
