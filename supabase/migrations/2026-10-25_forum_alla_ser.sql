-- Forum: alla godkända medlemmar ser alla inlägg. Varje inlägg visar vilken stämma som skrev det.
-- Skrivning är oförändrad: man skriver med sin egen stämma (stämledare och admin i alla).
-- Svar får nu ligga under vilket huvudinlägg som helst, oavsett stämma.

drop policy if exists forum_posts_select on public.forum_posts;
create policy forum_posts_select on public.forum_posts
  for select to authenticated
  using (public.is_approved_member());

drop policy if exists forum_posts_insert on public.forum_posts;
create policy forum_posts_insert on public.forum_posts
  for insert to authenticated
  with check (
    public.is_approved_member()
    and author_id = auth.uid()
    and (public.is_song_editor() or stamma = public.my_stamma())
    and (
      parent_id is null
      or exists (
        select 1 from public.forum_posts p
        where p.id = parent_id
          and p.parent_id is null
      )
    )
  );
