-- Social «Bei anderen»: comment suggestions for posts of other creators. Safe to run more than once.
-- Needs 20261013100000_social.sql and the cron function from 20261013100100_social_cron.sql.
--
-- Nothing here comments anywhere. Meta does not allow commenting on other accounts' posts through the API,
-- and the cockpit would not do it anyway. social-publish (op outreach) only READS public posts of watched
-- accounts and hashtags (Instagram API with Facebook Login: business discovery, hashtag search) and asks
-- Claude (Anthropic API) for a suggestion. Christoph copies it, posts it himself in the Instagram app and
-- marks it «Erledigt».
--
--   outreach_settings     one row: on/off, suggestions per day, monthly budget (USD), model, extra rules.
--                         OFF = the job does nothing at all: no Meta calls, no Anthropic costs.
--   outreach_watch        watched accounts (@name) and hashtags (#tag)
--   outreach_items        found posts and their suggestion, with the cost of each suggestion (tokens + USD)
--   outreach_cost_months  view: suggestions and USD per Swiss calendar month (Finanzen; admins via the table's RLS)
--   Vault secret meta_token_outreach = Facebook user token, entered by Christoph, read only by the function.

-- ---------- settings (exactly one row) ----------
create table if not exists public.outreach_settings (
  id                 boolean primary key default true check (id),
  enabled            boolean not null default false,
  daily_limit        int not null default 10 check (daily_limit between 1 and 30),
  monthly_budget_usd numeric(8, 2) not null default 10 check (monthly_budget_usd between 0 and 500),
  model              text not null default 'claude-sonnet-5-5'
                     check (model in ('claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5')),
  rules              text not null default '' check (char_length(rules) <= 2000),          -- extra rules for Claude
  -- written by the server only:
  ig_user_id         text check (ig_user_id is null or ig_user_id ~ '^[0-9]{5,30}$'),     -- our account, seen through Facebook Login
  ig_username        text not null default '' check (char_length(ig_username) <= 60),
  token_expires_at   timestamptz,                                                         -- null = unknown or never
  last_run_at        timestamptz,
  last_error         text check (last_error is null or char_length(last_error) <= 1000),
  run_lock_until     timestamptz,                                                         -- one run at a time (cron + «Jetzt suchen»)
  updated_at         timestamptz not null default now()
);
alter table public.outreach_settings add column if not exists run_lock_until timestamptz;
insert into public.outreach_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists outreach_settings_updated_at on public.outreach_settings;
create trigger outreach_settings_updated_at before update on public.outreach_settings
  for each row execute function public.qnh_touch_updated_at();

-- ---------- watch list ----------
create table if not exists public.outreach_watch (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('account', 'hashtag')),
  value           text not null,                     -- username without @ / hashtag without #, lower case
  active          boolean not null default true,
  -- written by the server only:
  hashtag_id      text check (hashtag_id is null or hashtag_id ~ '^[0-9]{3,40}$'),
  last_checked_at timestamptz,
  last_error      text check (last_error is null or char_length(last_error) <= 500),
  created_at      timestamptz not null default now(),
  unique (kind, value),
  constraint outreach_watch_value_check check (
    value = lower(value) and case kind
      when 'account' then value ~ '^[a-z0-9._]{1,30}$'
      else char_length(value) between 1 and 100 and value !~ '[[:space:]#@,;/]'
    end)
);

-- ---------- found posts + suggestions ----------
create table if not exists public.outreach_items (
  id             uuid primary key default gen_random_uuid(),
  watch_id       uuid references public.outreach_watch (id) on delete set null,
  source         text not null check (source in ('account', 'hashtag')),
  media_id       text not null unique check (media_id ~ '^[0-9_]{3,64}$'),
  username       text not null default '' check (char_length(username) <= 60),       -- empty for hashtag finds (Meta does not say)
  permalink      text check (permalink is null or (permalink ~ '^https://' and char_length(permalink) <= 500)),
  caption        text not null default '' check (char_length(caption) <= 2200),
  media_type     text not null default '' check (char_length(media_type) <= 30),
  image_url      text check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 2000)), -- expires at Meta after a few days
  posted_at      timestamptz,
  like_count     int,
  comments_count int,
  status         text not null default 'new'
                 check (status in ('new', 'proposed', 'done', 'dismissed', 'skipped', 'stale')),
  draft          text not null default '' check (char_length(draft) <= 2200),     -- the suggestion; Christoph may edit it
  alt_draft      text not null default '' check (char_length(alt_draft) <= 2200),
  reason         text not null default '' check (char_length(reason) <= 500),     -- why it fits (German, for Christoph)
  model          text not null default '' check (char_length(model) <= 60),
  input_tokens   int not null default 0 check (input_tokens >= 0),
  output_tokens  int not null default 0 check (output_tokens >= 0),
  cost_usd       numeric(10, 6) not null default 0 check (cost_usd >= 0),
  drafted_at     timestamptz,                                                     -- when Claude was asked (costs count from here)
  done_at        timestamptz,
  found_at       timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists outreach_items_status_idx on public.outreach_items (status, posted_at desc);
create index if not exists outreach_items_drafted_idx on public.outreach_items (drafted_at);

-- done_at follows the status. From the cockpit only «Vorschlag» ↔ «Erledigt» ↔ «Verworfen» and the text.
create or replace function public.outreach_items_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status = 'done' and old.status <> 'done' then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;
  if new.status is distinct from old.status
     and not (old.status in ('proposed', 'done', 'dismissed') and new.status in ('proposed', 'done', 'dismissed')) then
    raise exception 'Dieser Statuswechsel geht nur über den Server.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists outreach_items_guard on public.outreach_items;
create trigger outreach_items_guard before update on public.outreach_items
  for each row execute function public.outreach_items_guard();

-- ---------- costs per month (Finanzen) ----------
-- security_invoker: the view reads with the caller's rights, so the RLS of outreach_items applies (admins only).
create or replace view public.outreach_cost_months with (security_invoker = true) as
  select to_char(drafted_at at time zone 'Europe/Zurich', 'YYYY-MM') as month,
         count(*)::int as calls,
         count(*) filter (where status in ('proposed', 'done', 'dismissed'))::int as suggestions,
         coalesce(sum(cost_usd), 0)::numeric(12, 6) as usd
  from public.outreach_items
  where drafted_at is not null
  group by 1;

-- ---------- rights ----------
alter table public.outreach_settings enable row level security;
alter table public.outreach_watch enable row level security;
alter table public.outreach_items enable row level security;
revoke all on public.outreach_settings, public.outreach_watch, public.outreach_items, public.outreach_cost_months from anon, authenticated;
grant select on public.outreach_settings, public.outreach_watch, public.outreach_items, public.outreach_cost_months to authenticated;
grant update (enabled, daily_limit, monthly_budget_usd, model, rules) on public.outreach_settings to authenticated;
grant insert (kind, value, active), update (active), delete on public.outreach_watch to authenticated;
grant update (status, draft) on public.outreach_items to authenticated;   -- nothing else, column by column
grant select, insert, update, delete on public.outreach_settings, public.outreach_watch, public.outreach_items to service_role;
grant select on public.outreach_cost_months to service_role;

drop policy if exists "outreach_settings: admins read" on public.outreach_settings;
create policy "outreach_settings: admins read" on public.outreach_settings for select to authenticated
  using ((select public.is_qnh_admin()));
drop policy if exists "outreach_settings: admins change" on public.outreach_settings;
create policy "outreach_settings: admins change" on public.outreach_settings for update to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

drop policy if exists "outreach_watch: admins" on public.outreach_watch;
create policy "outreach_watch: admins" on public.outreach_watch for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

drop policy if exists "outreach_items: admins read" on public.outreach_items;
create policy "outreach_items: admins read" on public.outreach_items for select to authenticated
  using ((select public.is_qnh_admin()));
drop policy if exists "outreach_items: admins change" on public.outreach_items;
create policy "outreach_items: admins change" on public.outreach_items for update to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

-- ---------- Facebook token (Vault) – only the Edge Function reads or renews it ----------
create or replace function public.outreach_token()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'meta_token_outreach'
$$;
revoke all on function public.outreach_token() from public, anon, authenticated;
grant execute on function public.outreach_token() to service_role;

create or replace function public.outreach_store_token(p_token text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'meta_token_outreach';
  if v_id is null then perform vault.create_secret(p_token, 'meta_token_outreach');
  else perform vault.update_secret(v_id, p_token);
  end if;
  update public.outreach_settings set token_expires_at = p_expires_at where id;   -- Supabase refuses an UPDATE without WHERE
end $$;
revoke all on function public.outreach_store_token(text, timestamptz) from public, anon, authenticated;
grant execute on function public.outreach_store_token(text, timestamptz) to service_role;

do $$ begin
  alter publication supabase_realtime add table public.outreach_items;   -- new suggestions appear live
exception when duplicate_object then null; end $$;

-- twice a day (04:41 and 13:41 UTC = morning and afternoon in Switzerland). When switched off it returns at once.
select cron.schedule('social-outreach', '41 4,13 * * *', $$ select public.social_call('outreach') $$);
