-- Stämledare: en flagga på members som ger redigeringsrätt för låtar/stämspår
-- (Repertoar, Studio, Röstövning) men INTE för medlemmar, kalender, information m.m.

alter table public.members add column if not exists stamledare boolean not null default false;

create or replace function public.is_song_editor()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from members m
    where m.id = auth.uid() and m.status = 'approved' and (m.role = 'admin' or m.stamledare)
  );
$$;

-- låtar
drop policy if exists songs_admin_write on public.songs;
create policy songs_admin_write on public.songs for all
  using (public.is_song_editor()) with check (public.is_song_editor());

drop policy if exists songs_select_authenticated on public.songs;
create policy songs_select_authenticated on public.songs for select
  using (public.is_song_editor() or (published and public.is_approved_member()));

-- tonkurvor / analyser
drop policy if exists song_pitch_admin_write on public.song_pitch;
create policy song_pitch_admin_write on public.song_pitch for all
  using (public.is_song_editor()) with check (public.is_song_editor());

-- notbibliotek (används i noteditorn)
drop policy if exists note_library_admin_all on public.note_library;
create policy note_library_admin_all on public.note_library for all
  using (public.is_song_editor()) with check (public.is_song_editor());

-- lagring: stämfiler och noter/texter
drop policy if exists stems_admin_write on storage.objects;
create policy stems_admin_write on storage.objects for all
  using (bucket_id = 'heavy-voices-stems' and public.is_song_editor())
  with check (bucket_id = 'heavy-voices-stems' and public.is_song_editor());

drop policy if exists noter_admin_write on storage.objects;
create policy noter_admin_write on storage.objects for all
  using (bucket_id = 'heavy-voices-noter' and public.is_song_editor())
  with check (bucket_id = 'heavy-voices-noter' and public.is_song_editor());
