-- Studio: inspelningar som medlemmar och admin sjunger in mot en låt.
-- Filen ligger i bucketen heavy-voices-recordings under <medlems-id>/<inspelnings-id>.mp3
-- offset_ms = var inspelningen börjar på låtens gemensamma tidslinje (samma som stem_offsets).
create table if not exists public.recordings (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  song_id     uuid references public.songs(id) on delete set null,
  title       text not null default 'Inspelning',
  path        text not null,
  duration    real not null default 0,
  offset_ms   int  not null default 0,
  visibility  text not null default 'private' check (visibility in ('private', 'leaders', 'all')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists recordings_song_idx on public.recordings (song_id, created_at desc);
create index if not exists recordings_member_idx on public.recordings (member_id, created_at desc);
alter table public.recordings enable row level security;

-- egna alltid; delade med körledningen syns för admin; delade med alla syns för godkända medlemmar
create policy "recordings_select" on public.recordings for select to authenticated
  using (member_id = auth.uid()
         or (visibility in ('leaders', 'all') and public.is_admin())
         or (visibility = 'all' and public.is_approved_member()));
create policy "recordings_insert_own" on public.recordings for insert to authenticated
  with check (member_id = auth.uid() and public.is_approved_member());
create policy "recordings_update_own" on public.recordings for update to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy "recordings_delete_own_or_admin" on public.recordings for delete to authenticated
  using (member_id = auth.uid() or (visibility in ('leaders', 'all') and public.is_admin()));

insert into storage.buckets (id, name, public) values ('heavy-voices-recordings', 'heavy-voices-recordings', false)
  on conflict (id) do nothing;

-- skriva/ändra/ta bort: bara i sin egen mapp
create policy "recordings_files_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'heavy-voices-recordings' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved_member());
create policy "recordings_files_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'heavy-voices-recordings' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "recordings_files_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'heavy-voices-recordings' and ((storage.foldername(name))[1] = auth.uid()::text
         or (public.is_admin() and exists (select 1 from public.recordings r where r.path = name and r.visibility in ('leaders', 'all')))));
-- läsa: egna filer, eller filer vars inspelning man får se
create policy "recordings_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'heavy-voices-recordings' and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (select 1 from public.recordings r where r.path = name
                    and ((r.visibility in ('leaders', 'all') and public.is_admin()) or (r.visibility = 'all' and public.is_approved_member())))));
