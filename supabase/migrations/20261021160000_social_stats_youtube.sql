-- Statistics for YouTube: video ids contain letters, digits, - and _ (Instagram media ids are numeric).
alter table public.social_media_stats drop constraint if exists social_media_stats_media_id_check;
alter table public.social_media_stats add constraint social_media_stats_media_id_check check (media_id ~ '^[A-Za-z0-9_-]{5,40}$');
