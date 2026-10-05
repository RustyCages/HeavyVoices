-- Party Mode (medlem/party.html): dold festsida med karaoke, YouTube-karaoke och rockquiz.
-- Admin kommer alltid åt den. Medlemmar först när admin slagit på members_enabled.

create table if not exists public.party_settings (
  id              int primary key default 1 check (id = 1),   -- en enda rad
  members_enabled boolean not null default false,
  updated_at      timestamptz not null default now()
);
insert into public.party_settings (id) values (1) on conflict (id) do nothing;

alter table public.party_settings enable row level security;

drop policy if exists "party_settings_select_approved" on public.party_settings;
create policy "party_settings_select_approved" on public.party_settings for select to authenticated
  using (exists (select 1 from public.members m where m.id = auth.uid() and m.status = 'approved'));

drop policy if exists "party_settings_admin_write" on public.party_settings;
create policy "party_settings_admin_write" on public.party_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Sparade YouTube-karaokevideor ("Vår karaokelista")
create table if not exists public.party_videos (
  id          uuid primary key default gen_random_uuid(),
  youtube_id  text not null,
  title       text not null,
  channel     text,
  added_by    uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists party_videos_youtube_id_key on public.party_videos (youtube_id);

alter table public.party_videos enable row level security;

-- Läsa: admin alltid, medlemmar när Party Mode är öppnat för dem
drop policy if exists "party_videos_select" on public.party_videos;
create policy "party_videos_select" on public.party_videos for select to authenticated
  using (public.is_admin() or (
    exists (select 1 from public.members m where m.id = auth.uid() and m.status = 'approved')
    and exists (select 1 from public.party_settings s where s.id = 1 and s.members_enabled)
  ));

drop policy if exists "party_videos_admin_write" on public.party_videos;
create policy "party_videos_admin_write" on public.party_videos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
