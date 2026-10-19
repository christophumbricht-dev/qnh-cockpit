-- Social: location per post (Instagram location_id = ID of a Facebook Page of a real place).
-- Instagram accepts it for images, carousels and reels (not stories). Places are kept in a small list
-- so Christoph picks them instead of typing IDs. Approved posts: location is frozen like the content.

alter table public.social_posts add column if not exists location jsonb
  check (location is null or (jsonb_typeof(location) = 'object' and (location->>'id') ~ '^[0-9]{5,25}$'));

create table if not exists public.social_locations (
  id         uuid primary key default gen_random_uuid(),
  page_id    text not null unique check (page_id ~ '^[0-9]{5,25}$'),
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
alter table public.social_locations enable row level security;
revoke all on public.social_locations from anon, authenticated;
grant select, insert, update, delete on public.social_locations to authenticated;
grant select on public.social_locations to service_role;
drop policy if exists "social_locations: admins" on public.social_locations;
create policy "social_locations: admins" on public.social_locations for all to authenticated
  using ((select public.is_qnh_admin())) with check ((select public.is_qnh_admin()));

create or replace function public.social_posts_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then return new; end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Neue Beiträge sind immer Entwürfe.' using errcode = '42501'; end if;
    new.created_by := auth.uid();
    new.approved_at := null; new.approved_by := null; new.published_at := null;
    new.remote_container_id := null; new.remote_media_id := null; new.remote_comment_id := null; new.permalink := null;
    new.attempts := 0; new.last_error := null; new.media_deleted_at := null;
    return new;
  end if;

  -- the to-do note («what to do by hand on Instagram») stays editable in every status
  if (to_jsonb(new) - 'todo' - 'updated_at') = (to_jsonb(old) - 'todo' - 'updated_at') then return new; end if;

  -- fields only the server writes
  if (new.published_at, new.remote_container_id, new.remote_media_id, new.remote_comment_id, new.permalink, new.media_deleted_at, new.created_by, new.created_at)
     is distinct from (old.published_at, old.remote_container_id, old.remote_media_id, old.remote_comment_id, old.permalink, old.media_deleted_at, old.created_by, old.created_at) then
    raise exception 'Diese Felder setzt nur der Server.' using errcode = '42501';
  end if;
  if old.status in ('publishing', 'published') then
    raise exception 'Der Beitrag wird gerade oder wurde bereits veröffentlicht. Zum Wiederverwenden duplizieren.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (   (old.status in ('draft', 'failed') and new.status in ('approved', 'cancelled'))
            or (old.status = 'approved'           and new.status in ('draft', 'cancelled'))
            or (old.status in ('cancelled', 'failed') and new.status = 'draft')) then
      raise exception 'Statuswechsel % → % ist nicht erlaubt.', old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'approved' then
      if new.scheduled_at is null then raise exception 'Zum Freigeben braucht es einen Zeitpunkt.' using errcode = '23514'; end if;
      new.approved_at := now(); new.approved_by := auth.uid(); new.attempts := 0; new.last_error := null;
    else
      new.approved_at := null; new.approved_by := null;
    end if;
  else
    if old.status = 'approved'
       and (new.caption, new.first_comment, new.media, new.cover_path, new.kind, new.account_id, new.scheduled_at, new.location)
           is distinct from (old.caption, old.first_comment, old.media, old.cover_path, old.kind, old.account_id, old.scheduled_at, old.location) then
      raise exception 'Freigegebene Beiträge zuerst zurückziehen, dann ändern.' using errcode = '42501';
    end if;
    new.approved_at := old.approved_at; new.approved_by := old.approved_by;
    new.attempts := old.attempts; new.last_error := old.last_error;
  end if;
  return new;
end $$;
