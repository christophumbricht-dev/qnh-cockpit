-- «An Claude» (28.10.2026, Christoph: «ein Fenster im Cockpit, wo ich Anweisungen an dich geben kann, unabhängig von
-- Projekten, aber auch zu jedem Projekt separat»). Christoph writes an instruction, general or for one project; the
-- background run (scripts/studio-worker.mjs, docs/studio-worker.md) does the open ones first and answers here.
-- Admins only. Safe to run more than once.

create table if not exists public.claude_inbox (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null default 'general' check (scope ~ '^[a-z0-9-]{2,30}$'),     -- general | leesidelab | downwind | …
  body        text not null check (char_length(body) between 1 and 4000),
  status      text not null default 'open' check (status in ('open', 'doing', 'done', 'failed', 'cancelled')),
  reply       text check (reply is null or char_length(reply) <= 4000),               -- Claude's answer (German)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists claude_inbox_recent on public.claude_inbox (created_at desc);
create index if not exists claude_inbox_open on public.claude_inbox (status) where status in ('open', 'doing');

create or replace function public.claude_inbox_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists claude_inbox_touch on public.claude_inbox;
create trigger claude_inbox_touch before update on public.claude_inbox for each row execute function public.claude_inbox_touch();

alter table public.claude_inbox enable row level security;
revoke all on public.claude_inbox from anon, authenticated;
grant select, insert, update, delete on public.claude_inbox to authenticated;
drop policy if exists "claude_inbox: admins" on public.claude_inbox;
create policy "claude_inbox: admins" on public.claude_inbox for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

do $$ begin alter publication supabase_realtime add table public.claude_inbox; exception when duplicate_object then null; end $$;
