-- 2026-11-22_hemsida.sql
-- Publik info-sajt (info.heavyvoices.se): sidor och nyheter som utvalda medlemmar (redaktörer) redigerar.
--   • members.redaktor   – flagga som ger rätt att redigera hemsidan (admin har det alltid)
--   • site_pages         – sidor (Om kören, Kontakt …). slug 'start' = introtexten på startsidan
--   • site_posts         – nyheter
--   • bucket heavy-voices-hemsida – publika bilder till sidor/nyheter
-- Besökare (anon) ser bara publicerat innehåll. Går att köra om.

begin;

-- 1. Redaktörsflagga
alter table public.members add column if not exists redaktor boolean not null default false;
grant select (redaktor) on public.members to authenticated;

create or replace function public.is_site_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_approved_member() and exists (
    select 1 from public.members m where m.id = auth.uid() and m.redaktor));
$$;
revoke execute on function public.is_site_editor() from public, anon;
grant execute on function public.is_site_editor() to authenticated;

-- 2. Sidor
create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  title text not null,
  body_html text not null default '',
  sort int not null default 100,
  show_in_menu boolean not null default true,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members(id) on delete set null
);

-- 3. Nyheter
create table if not exists public.site_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  title text not null,
  excerpt text,
  body_html text not null default '',
  image_url text,
  published boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.members(id) on delete set null,
  updated_by uuid references public.members(id) on delete set null
);
create index if not exists site_posts_pub_idx on public.site_posts (published, published_at desc);

alter table public.site_pages enable row level security;
alter table public.site_posts enable row level security;

grant select on public.site_pages, public.site_posts to anon, authenticated;
grant insert, update, delete on public.site_pages, public.site_posts to authenticated;

drop policy if exists site_pages_read on public.site_pages;
create policy site_pages_read on public.site_pages for select
  using (published or public.is_site_editor());
drop policy if exists site_pages_write on public.site_pages;
create policy site_pages_write on public.site_pages for all to authenticated
  using (public.is_site_editor()) with check (public.is_site_editor());

drop policy if exists site_posts_read on public.site_posts;
create policy site_posts_read on public.site_posts for select
  using ((published and published_at <= now()) or public.is_site_editor());
drop policy if exists site_posts_write on public.site_posts;
create policy site_posts_write on public.site_posts for all to authenticated
  using (public.is_site_editor()) with check (public.is_site_editor());

-- 4. Startsidans introtext (opublicerad tills någon fyller i den)
insert into public.site_pages (slug, title, body_html, sort, show_in_menu, published)
values ('start', 'Heavy Voices', '<p>Heavy Voices är en rockkör i Stockholm.</p>', 0, false, false)
on conflict (slug) do nothing;

-- 5. Bildbucket (publik läsning, skrivning för redaktörer)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('heavy-voices-hemsida', 'heavy-voices-hemsida', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists hemsida_editor_write on storage.objects;
create policy hemsida_editor_write on storage.objects for all to authenticated
  using (bucket_id = 'heavy-voices-hemsida' and public.is_site_editor())
  with check (bucket_id = 'heavy-voices-hemsida' and public.is_site_editor());

commit;

-- Verifiering:
--   select slug, published from site_pages;                         → raden 'start'
--   (som anon) await sb.from('site_pages').select('*')              → tom lista tills något publiceras
