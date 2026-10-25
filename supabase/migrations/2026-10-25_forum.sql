-- Stämgruppernas forum: inlägg per stämgrupp, ett svar per inlägg, bilagor i R2 (område "forum").
-- Synlighet: bara medlemmar i stämgruppen, samt stämledare och admin (is_song_editor()).
-- Bilagorna laddas upp till R2 via Edge Function r2-files, som kontrollerar åtkomst mot de här reglerna.

-- Hjälpfunktion: den inloggade medlemmens stämgrupp (null om ingen är vald)
create or replace function public.my_stamma()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select m.stamma from public.members m
  where m.id = auth.uid() and m.status = 'approved';
$$;

-- 1. Inlägg (svar har parent_id satt; ett svar kan inte få egna svar)
create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  stamma text not null check (stamma in ('Sopran', 'Alt', 'Tenor', 'Bas')),
  author_id uuid references public.members(id) on delete set null,
  parent_id uuid references public.forum_posts(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists forum_posts_stamma_idx on public.forum_posts (stamma, created_at);
create index if not exists forum_posts_parent_idx on public.forum_posts (parent_id);

-- 2. Bilagor: en rad per fil. path är den relativa R2-sökvägen "<post_id>/<filnamn>"
create table if not exists public.forum_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  path text not null unique,
  name text not null,
  size bigint,
  content_type text,
  created_at timestamptz not null default now()
);
create index if not exists forum_attachments_post_idx on public.forum_attachments (post_id);

alter table public.forum_posts enable row level security;
alter table public.forum_attachments enable row level security;

-- Inlägg: läsa
drop policy if exists forum_posts_select on public.forum_posts;
create policy forum_posts_select on public.forum_posts
  for select to authenticated
  using (
    public.is_song_editor()
    or (public.is_approved_member() and stamma = public.my_stamma())
  );

-- Inlägg: skriva. Man skriver bara i sin egen stämgrupp (stämledare och admin i alla).
-- Svar får bara ligga under ett huvudinlägg, och måste vara i samma stämgrupp.
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
          and p.stamma = forum_posts.stamma
      )
    )
  );

-- Inlägg: ändra och ta bort. Bara författaren, eller stämledare och admin.
drop policy if exists forum_posts_update on public.forum_posts;
create policy forum_posts_update on public.forum_posts
  for update to authenticated
  using (author_id = auth.uid() or public.is_song_editor())
  with check (author_id = auth.uid() or public.is_song_editor());

drop policy if exists forum_posts_delete on public.forum_posts;
create policy forum_posts_delete on public.forum_posts
  for delete to authenticated
  using (author_id = auth.uid() or public.is_song_editor());

-- Bilagor: gäller samma som inlägget de hör till (RLS på forum_posts slår igenom i subqueryn)
drop policy if exists forum_attachments_select on public.forum_attachments;
create policy forum_attachments_select on public.forum_attachments
  for select to authenticated
  using (exists (select 1 from public.forum_posts p where p.id = forum_attachments.post_id));

drop policy if exists forum_attachments_insert on public.forum_attachments;
create policy forum_attachments_insert on public.forum_attachments
  for insert to authenticated
  with check (exists (
    select 1 from public.forum_posts p
    where p.id = post_id and (p.author_id = auth.uid() or public.is_song_editor())
  ));

drop policy if exists forum_attachments_delete on public.forum_attachments;
create policy forum_attachments_delete on public.forum_attachments
  for delete to authenticated
  using (exists (
    select 1 from public.forum_posts p
    where p.id = post_id and (p.author_id = auth.uid() or public.is_song_editor())
  ));
