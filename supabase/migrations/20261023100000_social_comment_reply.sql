-- Social: a prepared answer below our own first comment, sent automatically some hours after publishing.
-- Example: the first comment asks a quiz question, the answer follows 4 hours later as a reply.
-- Christoph approves the answer together with the post (frozen when approved like the content); the server
-- sends it at most once (first_comment_reply_status: null = not yet, sending → sent | failed).
--
-- Quiz: when somebody answers the question correctly (one of the keywords in quiz_answer), the server answers
-- with one of Christoph's prepared texts (quiz_correct_replies) – no free text, no AI. At most one per person
-- and post (social_quiz_replies), only within 72 h after publishing. Everything else in other people's
-- comments stays Christoph's click in «Kommentare».

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
  add column if not exists first_comment_reply_error text,
  -- quiz: keywords that make an answer correct, and the prepared answers to it (one is picked at random)
  add column if not exists quiz_answer text[] not null default '{}'
    check (cardinality(quiz_answer) <= 20 and char_length(array_to_string(quiz_answer, '')) <= 1000),
  add column if not exists quiz_correct_replies text[] not null default '{}'
    check (cardinality(quiz_correct_replies) <= 5 and char_length(array_to_string(quiz_correct_replies, '')) <= 2000);

-- automatic answers to correct quiz answers: one per person and post (the unique key is the claim)
create table if not exists public.social_quiz_replies (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references public.social_posts(id) on delete cascade,
  author          text not null check (author = lower(author) and char_length(author) between 1 and 200),
  comment_id      uuid references public.social_comments(id) on delete set null,
  reply_text      text not null default '',
  reply_remote_id text,
  status          text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error           text,
  created_at      timestamptz not null default now(),
  unique (post_id, author)
);
alter table public.social_quiz_replies enable row level security;
revoke all on public.social_quiz_replies from anon, authenticated;
grant select on public.social_quiz_replies to authenticated;
grant select, insert, update, delete on public.social_quiz_replies to service_role;
drop policy if exists "social_quiz_replies: admins read" on public.social_quiz_replies;
create policy "social_quiz_replies: admins read" on public.social_quiz_replies for select to authenticated
  using ((select public.is_qnh_admin()));

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
      if (cardinality(new.quiz_answer) > 0) <> (cardinality(new.quiz_correct_replies) > 0) then
        raise exception 'Ein Quiz braucht Stichwörter für die richtige Lösung und mindestens eine vorbereitete Antwort.' using errcode = '23514';
      end if;
      if cardinality(new.quiz_answer) > 0 and btrim(new.first_comment) = '' then
        raise exception 'Ein Quiz braucht die Frage im ersten Kommentar.' using errcode = '23514';
      end if;
      new.approved_at := now(); new.approved_by := auth.uid(); new.attempts := 0; new.last_error := null;
    else
      new.approved_at := null; new.approved_by := null;
    end if;
  else
    if old.status = 'approved'
       and (new.caption, new.first_comment, new.media, new.cover_path, new.kind, new.account_id, new.scheduled_at, new.location, new.title, new.ai_generated,
            new.first_comment_reply, new.first_comment_reply_after_hours, new.quiz_answer, new.quiz_correct_replies)
           is distinct from (old.caption, old.first_comment, old.media, old.cover_path, old.kind, old.account_id, old.scheduled_at, old.location, old.title, old.ai_generated,
            old.first_comment_reply, old.first_comment_reply_after_hours, old.quiz_answer, old.quiz_correct_replies) then
      raise exception 'Freigegebene Beiträge zuerst zurückziehen, dann ändern.' using errcode = '42501';
    end if;
    new.approved_at := old.approved_at; new.approved_by := old.approved_by;
    new.attempts := old.attempts; new.last_error := old.last_error;
  end if;
  return new;
end $$;
