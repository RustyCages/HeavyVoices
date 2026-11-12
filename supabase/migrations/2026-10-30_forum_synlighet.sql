-- Forum: trådskaparen väljer vem som ser tråden.
--   'alla'       = alla godkända medlemmar (som förut)
--   'korledning' = stämledare och admin (is_song_editor()), plus trådskaparen
--   'valda'      = bara trådskaparen och de medlemmar som står i recipients
-- Svar ärver trådens synlighet. Bilagor följer med automatiskt, eftersom forum_attachments
-- och Edge Function r2-files (nedladdning) kontrollerar åtkomst via forum_posts.
-- Kör om säkert: if not exists / drop ... if exists.

alter table public.forum_posts add column if not exists visibility text not null default 'alla';
alter table public.forum_posts add column if not exists recipients uuid[] not null default '{}';

alter table public.forum_posts drop constraint if exists forum_posts_visibility_check;
alter table public.forum_posts add constraint forum_posts_visibility_check
  check (visibility in ('alla', 'korledning', 'valda'));

-- 'valda' kräver minst en mottagare
alter table public.forum_posts drop constraint if exists forum_posts_recipients_check;
alter table public.forum_posts add constraint forum_posts_recipients_check
  check (visibility <> 'valda' or cardinality(recipients) > 0);

-- Får den inloggade se tråden? security definer så att policyn kan läsa forum_posts utan rekursion.
create or replace function public.forum_can_see(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_approved_member() and exists (
    select 1 from public.forum_posts t
    where t.id = p_thread
      and t.parent_id is null
      and (
        t.author_id = auth.uid()
        or t.visibility = 'alla'
        or (t.visibility = 'korledning' and public.is_song_editor())
        or (t.visibility = 'valda' and auth.uid() = any(t.recipients))
      )
  );
$$;

-- Läsa: tråden själv, eller ett svar i en tråd man får se
drop policy if exists forum_posts_select on public.forum_posts;
create policy forum_posts_select on public.forum_posts
  for select to authenticated
  using (public.forum_can_see(coalesce(parent_id, id)));

-- Skriva: nya trådar fritt, svar bara i trådar man får se. Svar har alltid standardsynlighet
-- (den ignoreras – tråden bestämmer).
drop policy if exists forum_posts_insert on public.forum_posts;
create policy forum_posts_insert on public.forum_posts
  for insert to authenticated
  with check (
    public.is_approved_member()
    and author_id = auth.uid()
    and (
      parent_id is null
      or (
        visibility = 'alla'
        and cardinality(recipients) = 0
        and public.forum_can_see(parent_id)
        and exists (
          select 1 from public.forum_posts p
          where p.id = forum_posts.parent_id and p.parent_id is null
        )
      )
    )
  );

-- Ändra/ta bort: som förut, men bara på inlägg man faktiskt får se
drop policy if exists forum_posts_update on public.forum_posts;
create policy forum_posts_update on public.forum_posts
  for update to authenticated
  using (public.forum_can_see(coalesce(parent_id, id)) and (author_id = auth.uid() or public.is_song_editor()))
  with check (author_id = auth.uid() or public.is_song_editor());

drop policy if exists forum_posts_delete on public.forum_posts;
create policy forum_posts_delete on public.forum_posts
  for delete to authenticated
  using (public.forum_can_see(coalesce(parent_id, id)) and (author_id = auth.uid() or public.is_song_editor()));

-- Verifiera:
-- select visibility, count(*) from public.forum_posts where parent_id is null group by 1;
