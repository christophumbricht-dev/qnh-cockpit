-- Render queue of the gaming PC (29.10.2026, Christoph: «im Cockpit die Claude-Warteschlange anzeigen: die letzten 24 h
-- abgeschlossen, was gerade wo läuft und was geplant ist»). One row per job file of C:\QNH\render\queue (the GPU queue
-- gpu_queue.ps1 runs them one after the other on the graphics card). The gaming PC writes (scripts/render-sync.mjs,
-- started by the render helper C:\QNH\render\helper.ps1, signed in as Christoph like the social import); the cockpit
-- page «An Claude» shows them next to the background runs (studio_jobs) and the instructions (claude_inbox).
-- Admins only. Finished jobs older than 30 days are deleted daily. Safe to run more than once.

create table if not exists public.render_jobs (
  name          text primary key check (name ~ '^[A-Za-z0-9._-]{1,80}\.ps1$'),     -- job file, e.g. 46_vog_reel_v2.ps1
  machine       text not null default 'gaming' check (machine ~ '^[a-z0-9-]{2,24}$'),
  title         text check (title is null or char_length(title) <= 300),         -- first comment line of the job
  status        text not null check (status in ('queued', 'paused', 'running', 'done', 'failed')),
  position      int check (position is null or position between 0 and 999),      -- order while waiting
  started_at    timestamptz,
  finished_at   timestamptz,
  result        text check (result is null or char_length(result) <= 300),       -- last DONE / FAILED line of the job
  frames        int check (frames is null or frames >= 0),                       -- pictures in the job's folder
  frames_10min  int check (frames_10min is null or frames_10min >= 0),           -- of those, written in the last 10 min
  last_frame_at timestamptz,
  seen_at       timestamptz not null default now()                               -- the gaming PC last reported this row
);
create index if not exists render_jobs_finished on public.render_jobs (finished_at desc);

alter table public.render_jobs enable row level security;
revoke all on public.render_jobs from anon, authenticated;
grant select, insert, update, delete on public.render_jobs to authenticated;
drop policy if exists "render_jobs: admins" on public.render_jobs;
create policy "render_jobs: admins" on public.render_jobs for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

do $$ begin alter publication supabase_realtime add table public.render_jobs; exception when duplicate_object then null; end $$;

select cron.schedule('render-jobs-cleanup', '23 3 * * *',
  $$ delete from public.render_jobs where finished_at < now() - interval '30 days' $$);
