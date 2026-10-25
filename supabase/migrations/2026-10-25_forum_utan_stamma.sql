-- Forum: stämma krävs inte för att skriva. Inlägg utan stämma är tillåtna och visas utan stämmenamn.

alter table public.forum_posts alter column stamma drop not null;

alter table public.forum_posts drop constraint if exists forum_posts_stamma_check;
alter table public.forum_posts add constraint forum_posts_stamma_check
  check (stamma is null or stamma in ('Sopran', 'Alt', 'Tenor', 'Bas'));

drop policy if exists forum_posts_insert on public.forum_posts;
create policy forum_posts_insert on public.forum_posts
  for insert to authenticated
  with check (
    public.is_approved_member()
    and author_id = auth.uid()
    and (
      parent_id is null
      or exists (
        select 1 from public.forum_posts p
        where p.id = forum_posts.parent_id
          and p.parent_id is null
      )
    )
  );
