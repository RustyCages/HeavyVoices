-- Studio: fortsätt där du var + ögonblicksbilder.
--  * recordings.draft      – osparade spår laddas upp automatiskt som privata utkast (rensas efter 30 dagar i Studio)
--  * studio_state          – senaste läget per medlem och låt (mixer, reverb, markörer, zoom, ordning …), ett JSON-objekt
--  * studio_snapshots      – namngivna ögonblicksbilder av läget, kan delas med körledningen (admin + stämledare) eller alla
-- "Körledningen" (visibility = 'leaders') betyder nu admin och stämledare, även för inspelningar.

-- ---------- utkast ----------
alter table public.recordings add column if not exists draft boolean not null default false;
alter table public.recordings drop constraint if exists recordings_draft_private;
alter table public.recordings add constraint recordings_draft_private check (not draft or visibility = 'private');

-- körledningen = admin + stämledare
drop policy if exists "recordings_select" on public.recordings;
create policy "recordings_select" on public.recordings for select to authenticated
  using (member_id = auth.uid()
         or (visibility in ('leaders', 'all') and public.is_song_editor())
         or (visibility = 'all' and public.is_approved_member()));
drop policy if exists "recordings_delete_own_or_admin" on public.recordings;
create policy "recordings_delete_own_or_admin" on public.recordings for delete to authenticated
  using (member_id = auth.uid() or (visibility in ('leaders', 'all') and public.is_song_editor()));
drop policy if exists "recordings_files_select" on storage.objects;
create policy "recordings_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'heavy-voices-recordings' and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from public.recordings r where r.path = name
                    and ((r.visibility in ('leaders', 'all') and public.is_song_editor()) or (r.visibility = 'all' and public.is_approved_member())))));
drop policy if exists "recordings_files_delete_own" on storage.objects;
create policy "recordings_files_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'heavy-voices-recordings' and ((storage.foldername(name))[1] = auth.uid()::text
         or (public.is_song_editor() and exists (select 1 from public.recordings r where r.path = name and r.visibility in ('leaders', 'all')))));

-- ---------- senaste läget ----------
create table if not exists public.studio_state (
  member_id  uuid not null default auth.uid() references public.members(id) on delete cascade,
  song_id    uuid not null references public.songs(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (member_id, song_id)
);
alter table public.studio_state enable row level security;
drop policy if exists "studio_state_own" on public.studio_state;
create policy "studio_state_own" on public.studio_state for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid() and public.is_approved_member());

-- ---------- ögonblicksbilder ----------
create table if not exists public.studio_snapshots (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null default auth.uid() references public.members(id) on delete cascade,
  song_id    uuid not null references public.songs(id) on delete cascade,
  name       text not null default 'Ögonblicksbild',
  visibility text not null default 'private' check (visibility in ('private', 'leaders', 'all')),
  state      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studio_snapshots_song_idx on public.studio_snapshots (song_id, created_at desc);
alter table public.studio_snapshots enable row level security;
drop policy if exists "studio_snapshots_select" on public.studio_snapshots;
create policy "studio_snapshots_select" on public.studio_snapshots for select to authenticated
  using (member_id = auth.uid()
         or (visibility in ('leaders', 'all') and public.is_song_editor())
         or (visibility = 'all' and public.is_approved_member()));
drop policy if exists "studio_snapshots_insert_own" on public.studio_snapshots;
create policy "studio_snapshots_insert_own" on public.studio_snapshots for insert to authenticated
  with check (member_id = auth.uid() and public.is_approved_member());
drop policy if exists "studio_snapshots_update_own" on public.studio_snapshots;
create policy "studio_snapshots_update_own" on public.studio_snapshots for update to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
drop policy if exists "studio_snapshots_delete_own" on public.studio_snapshots;
create policy "studio_snapshots_delete_own" on public.studio_snapshots for delete to authenticated
  using (member_id = auth.uid());
