-- Social: a prepared answer below our own first comment, sent automatically some hours after publishing.
-- Example: the first comment asks a quiz question, the answer follows 4 hours later as a reply.
-- Christoph approves the answer together with the post (frozen when approved like the content); the server
-- sends it at most once (first_comment_reply_status: null = not yet, sending → sent | failed).
-- Answers to comments of other people are never automatic – that stays Christoph's click in «Kommentare».

alter table public.social_posts
  add column if not exists first_comment_reply text not null default ''
    check (char_length(first_comment_reply) <= 2200),
  add column if not exists first_comment_reply_after_hours numeric(4,1) not null default 4
    check (first_comment_reply_after_hours >= 0.5 and first_comment_reply_after_hours <= 72),
  -- server fields (service_role only)
  add column if not exists first_comment_reply_status text
    check (first_comment_reply_status in ('sending', 'sent', 'failed')),
  add column if not exists first_comment_reply_id text,
  add column if not exists first_comment_reply_sent_at timestamptz,
  add column if not exists first_comment_reply_error text;

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
    new.first_comment_reply_status := null; new.first_comment_reply_id := null;
    new.first_comment_reply_sent_at := null; new.first_comment_reply_error := null;
    return new;
  end if;

  -- the to-do note («what to do by hand») stays editable in every status
  if (to_jsonb(new) - 'todo' - 'updated_at') = (to_jsonb(old) - 'todo' - 'updated_at') then return new; end if;

  -- fields only the server writes
  if (new.published_at, new.remote_container_id, new.remote_media_id, new.remote_comment_id, new.permalink, new.media_deleted_at, new.created_by, new.created_at,
      new.first_comment_reply_status, new.first_comment_reply_id, new.first_comment_reply_sent_at, new.first_comment_reply_error)
     is distinct from (old.published_at, old.remote_container_id, old.remote_media_id, old.remote_comment_id, old.permalink, old.media_deleted_at, old.created_by, old.created_at,
      old.first_comment_reply_status, old.first_comment_reply_id, old.first_comment_reply_sent_at, old.first_comment_reply_error) then
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
      if new.first_comment_reply <> '' and btrim(new.first_comment) = '' then
        raise exception 'Eine Antwort braucht einen ersten Kommentar, unter dem sie stehen kann.' using errcode = '23514';
      end if;
      new.approved_at := now(); new.approved_by := auth.uid(); new.attempts := 0; new.last_error := null;
    else
      new.approved_at := null; new.approved_by := null;
    end if;
  else
    if old.status = 'approved'
       and (new.caption, new.first_comment, new.media, new.cover_path, new.kind, new.account_id, new.scheduled_at, new.location, new.title, new.ai_generated,
            new.first_comment_reply, new.first_comment_reply_after_hours)
           is distinct from (old.caption, old.first_comment, old.media, old.cover_path, old.kind, old.account_id, old.scheduled_at, old.location, old.title, old.ai_generated,
            old.first_comment_reply, old.first_comment_reply_after_hours) then
      raise exception 'Freigegebene Beiträge zuerst zurückziehen, dann ändern.' using errcode = '42501';
    end if;
    new.approved_at := old.approved_at; new.approved_by := old.approved_by;
    new.attempts := old.attempts; new.last_error := old.last_error;
  end if;
  return new;
end $$;
