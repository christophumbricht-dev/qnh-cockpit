-- QNH Core – scheduled jobs for social media. Apply AFTER the two Vault secrets exist (docs/social-setup.md):
--   qnh_project_url     e.g. https://<project-ref>.supabase.co
--   social_cron_secret  a long random string; the same value is set as Edge Function secret SOCIAL_CRON_SECRET
-- Safe to run more than once (cron.schedule replaces a job with the same name).

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.social_call(p_op text)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'qnh_project_url') || '/functions/v1/social-publish',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'social_cron_secret')),
    body := jsonb_build_object('op', p_op),
    timeout_milliseconds := 150000)
$$;
revoke all on function public.social_call(text) from public, anon, authenticated;

select cron.schedule('social-publish',        '*/10 * * * *', $$ select public.social_call('publish') $$);
select cron.schedule('social-refresh-tokens', '17 3 * * 1',   $$ select public.social_call('refresh-tokens') $$);  -- Mondays 03:17 UTC
select cron.schedule('social-cleanup',        '43 2 * * *',   $$ select public.social_call('cleanup') $$);         -- daily 02:43 UTC
