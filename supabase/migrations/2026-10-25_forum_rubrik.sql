-- Forum: varje huvudinlägg (tråd) får en rubrik. Svar saknar rubrik.
-- Rubriken bestämmer vad tråden handlar om.

alter table public.forum_posts add column if not exists title text;

alter table public.forum_posts drop constraint if exists forum_posts_title_check;
alter table public.forum_posts add constraint forum_posts_title_check
  check (title is null or char_length(title) between 1 and 150);

alter table public.forum_posts drop constraint if exists forum_posts_title_required_check;
alter table public.forum_posts add constraint forum_posts_title_required_check
  check (parent_id is not null or title is not null);
