-- Social posts: to-do note per post – what Christoph still does by hand in the Instagram app
-- (stories with stickers, tagging, location, ads). Comes from post.json "todo" or is typed in the cockpit.
-- Not published anywhere. Editable in every status, also after publishing.

alter table public.social_posts add column if not exists todo text not null default ''
  check (char_length(todo) <= 2000);

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
       and (new.caption, new.first_comment, new.media, new.cover_path, new.kind, new.account_id, new.scheduled_at)
           is distinct from (old.caption, old.first_comment, old.media, old.cover_path, old.kind, old.account_id, old.scheduled_at) then
      raise exception 'Freigegebene Beiträge zuerst zurückziehen, dann ändern.' using errcode = '42501';
    end if;
    new.approved_at := old.approved_at; new.approved_by := old.approved_by;
    new.attempts := old.attempts; new.last_error := old.last_error;
  end if;
  return new;
end $$;
