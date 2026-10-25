-- Rechner: how busy the gaming PC and the laptop are and what their electricity costs (Finanzen → «Rechner»).
-- machines: one row per computer with the power estimate (watts at rest / extra at full CPU / extra at full GPU).
-- machine_samples: one measurement every 5 minutes from scripts/machine-heartbeat.mjs (uploaded in batches,
-- signed in as Christoph like the social import). power_settings: one row, the electricity price (null = not known yet).
-- Admins only. Samples older than 400 days are deleted daily.

create table if not exists public.machines (
  id          text primary key check (id ~ '^[a-z0-9-]{2,24}$'),
  name        text not null check (char_length(name) between 1 and 60),
  idle_w      real not null default 50 check (idle_w between 0 and 2000),
  cpu_w       real not null default 50 check (cpu_w between 0 and 2000),
  gpu_w       real not null default 0 check (gpu_w between 0 and 2000),
  note        text check (note is null or char_length(note) <= 500),
  sort        int not null default 0
);

create table if not exists public.machine_samples (
  id          bigint generated always as identity primary key,
  machine     text not null references public.machines (id) on delete cascade,
  at          timestamptz not null,
  cpu         real check (cpu between 0 and 100),
  gpu         real check (gpu between 0 and 100),
  gpu_watts   real check (gpu_watts between 0 and 2000),   -- measured by nvidia-smi, if the card reports it
  ram         real check (ram between 0 and 100),
  disk_free_gb real check (disk_free_gb >= 0),
  on_battery  boolean,
  jobs        text[] not null default '{}' check (cardinality(jobs) <= 20),  -- heavy programs running (blender, ffmpeg, python …)
  unique (machine, at)
);
create index if not exists machine_samples_at on public.machine_samples (machine, at desc);

create table if not exists public.power_settings (
  id          boolean primary key default true check (id),
  price_chf_kwh numeric(6, 4) check (price_chf_kwh is null or price_chf_kwh between 0 and 5),
  updated_at  timestamptz not null default now()
);
insert into public.power_settings (id) values (true) on conflict do nothing;

-- starting values (estimates, editable): gaming PC = Ryzen 5 5600X (65 W TDP) + GTX 970 (145 W board power, its
-- draw is measured by nvidia-smi and replaces the GPU estimate); laptop = Surface Book 2, i7-8650U (15 W) + GTX 1050
insert into public.machines (id, name, idle_w, cpu_w, gpu_w, note, sort) values
  ('gaming', 'Gaming-PC', 45, 65, 145, 'Schätzung ohne Grafikkarte: Ruhe 45 W, CPU voll +65 W. Die GTX 970 misst ihren Verbrauch selbst (nvidia-smi).', 1),
  ('laptop', 'Laptop (Surface Book 2)', 10, 20, 40, 'Schätzung: Ruhe 10 W, CPU voll +20 W, GTX 1050 voll +40 W. Im Akkubetrieb zählt kein Netzstrom.', 2)
on conflict (id) do nothing;

alter table public.machines enable row level security;
alter table public.machine_samples enable row level security;
alter table public.power_settings enable row level security;
revoke all on public.machines, public.machine_samples, public.power_settings from anon, authenticated;
grant select, insert, update, delete on public.machines, public.machine_samples to authenticated;
grant select, update on public.power_settings to authenticated;
drop policy if exists "machines: admins" on public.machines;
create policy "machines: admins" on public.machines for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));
drop policy if exists "machine_samples: admins" on public.machine_samples;
create policy "machine_samples: admins" on public.machine_samples for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));
drop policy if exists "power_settings: admins" on public.power_settings;
create policy "power_settings: admins" on public.power_settings for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

-- per machine and hour (the cockpit loads 31 days of these instead of ~18'000 samples). «busy» = a heavy program
-- runs, or CPU ≥ 40 % or GPU ≥ 30 % (same rule as isBusy in src/finance/machines.js).
create or replace view public.machine_hours with (security_invoker = true) as
select machine, date_trunc('hour', at) as hour,
       count(*)::int as n,
       (count(*) filter (where on_battery))::int as n_battery,
       (count(*) filter (where cardinality(jobs) > 0 or cpu >= 40 or gpu >= 30))::int as n_busy,
       avg(cpu)::real as cpu, avg(gpu)::real as gpu, avg(gpu_watts)::real as gpu_watts
from public.machine_samples
group by machine, date_trunc('hour', at);
grant select on public.machine_hours to authenticated;

select cron.schedule('machine-samples-cleanup', '51 2 * * *',
  $$ delete from public.machine_samples where at < now() - interval '400 days' $$);
