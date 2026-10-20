-- QNH Core – Finanzen: costs & subscriptions and bills to pay. Safe to run more than once.
-- Admins only (is_qnh_admin()). Files (bill PDFs/photos) in the PRIVATE bucket "finance" – never public,
-- the cockpit shows them through short-lived signed URLs. Paying stays in e-banking: the cockpit only keeps
-- track (open → paid) and shows the payment data. No bank access, no card numbers.

-- ---------- costs & subscriptions ----------
create table if not exists public.fin_costs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 80),
  provider    text not null default '' check (char_length(provider) <= 80),
  scope       text not null default 'qnh' check (scope ~ '^[a-z0-9-]{2,30}$'),          -- qnh, downwind, leesidelab, …
  category    text not null default 'Software' check (char_length(category) between 1 and 40),
  amount      numeric(12, 2) not null check (amount >= 0 and amount < 10000000),
  currency    text not null default 'CHF' check (currency ~ '^[A-Z]{3}$'),
  interval    text not null default 'monthly' check (interval in ('monthly', 'quarterly', 'yearly', 'once')),
  next_due    date,                                                                      -- a renewal date (anchor); later ones are computed from it
  notice_days int not null default 0 check (notice_days between 0 and 365),             -- remind this many days before (to cancel in time)
  payment     text not null default '' check (char_length(payment) <= 60),             -- e.g. «Kreditkarte», «Rechnung», «LSV»
  url         text check (url is null or (url ~ '^https?://' and char_length(url) <= 500)), -- where to manage / cancel it
  note        text not null default '' check (char_length(note) <= 1000),
  active      boolean not null default true,
  ack_until   date,                                                                      -- «Behalten»: reminder done up to this renewal date
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- bills to pay ----------
create table if not exists public.fin_bills (
  id          uuid primary key default gen_random_uuid(),
  payee       text not null check (char_length(trim(payee)) between 1 and 120),
  amount      numeric(12, 2) check (amount is null or (amount >= 0 and amount < 10000000)), -- QR-bills may leave it open
  currency    text not null default 'CHF' check (currency ~ '^[A-Z]{3}$'),
  due_date    date,
  status      text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  paid_at     timestamptz,
  iban        text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  reference   text not null default '' check (char_length(reference) <= 40),            -- QR or creditor reference (RF…)
  message     text not null default '' check (char_length(message) <= 140),
  invoice_no  text not null default '' check (char_length(invoice_no) <= 40),
  scope       text not null default 'qnh' check (scope ~ '^[a-z0-9-]{2,30}$'),
  category    text not null default '' check (char_length(category) <= 40),
  cost_id     uuid references public.fin_costs (id) on delete set null,                -- bill of a known subscription
  file_path   text check (file_path is null or char_length(file_path) <= 300),         -- in bucket "finance"
  note        text not null default '' check (char_length(note) <= 1000),
  source      text not null default 'cockpit' check (source in ('cockpit', 'qr', 'claude')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists fin_bills_open_idx on public.fin_bills (status, due_date);

create or replace function public.fin_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_table_name = 'fin_bills' then
    if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then new.paid_at := coalesce(new.paid_at, now()); end if;
    if new.status <> 'paid' then new.paid_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists fin_costs_touch on public.fin_costs;
create trigger fin_costs_touch before insert or update on public.fin_costs for each row execute function public.fin_touch();
drop trigger if exists fin_bills_touch on public.fin_bills;
create trigger fin_bills_touch before insert or update on public.fin_bills for each row execute function public.fin_touch();

alter table public.fin_costs enable row level security;
alter table public.fin_bills enable row level security;
revoke all on public.fin_costs, public.fin_bills from anon, authenticated;
grant select, insert, update, delete on public.fin_costs, public.fin_bills to authenticated;
drop policy if exists "fin_costs: admins" on public.fin_costs;
create policy "fin_costs: admins" on public.fin_costs for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));
drop policy if exists "fin_bills: admins" on public.fin_bills;
create policy "fin_bills: admins" on public.fin_bills for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

do $$ begin
  alter publication supabase_realtime add table public.fin_bills;
exception when duplicate_object then null; end $$;

-- ---------- private bucket for bill files ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('finance', 'finance', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
  on conflict (id) do update set public = false;   -- stays private even if someone switched it
drop policy if exists "finance: admins read" on storage.objects;
create policy "finance: admins read" on storage.objects for select to authenticated
  using (bucket_id = 'finance' and (select public.is_qnh_admin()));
drop policy if exists "finance: admins upload" on storage.objects;
create policy "finance: admins upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'finance' and (select public.is_qnh_admin()));
drop policy if exists "finance: admins change" on storage.objects;
create policy "finance: admins change" on storage.objects for update to authenticated
  using (bucket_id = 'finance' and (select public.is_qnh_admin()));
drop policy if exists "finance: admins delete" on storage.objects;
create policy "finance: admins delete" on storage.objects for delete to authenticated
  using (bucket_id = 'finance' and (select public.is_qnh_admin()));

-- ---------- roadmap: recurring tasks and «Später» on «Heute» ----------
alter table public.roadmap_items add column if not exists repeat text
  check (repeat is null or repeat in ('weekly', 'monthly', 'quarterly', 'yearly'));
alter table public.roadmap_items add column if not exists snoozed_until date;   -- hidden on «Heute» until then
alter table public.roadmap_items add column if not exists last_done_at timestamptz; -- a recurring task was last done
-- day of the month a monthly/quarterly/yearly task stays on (31 = always the last day of the month), so the
-- date does not drift at month ends (31.3. → 30.6. → 30.9. → 31.12.); set from the due date chosen in the editor
alter table public.roadmap_items add column if not exists repeat_day smallint
  check (repeat_day is null or repeat_day between 1 and 31);
