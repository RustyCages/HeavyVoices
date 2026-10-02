-- Röstövning, steg 1: tonkurvor (pitch) per stämfil.
-- Egen tabell i stället för en kolumn i songs, eftersom medlemssidorna gör
-- select('*') på songs och kurvorna är för stora för att följa med varje gång.
--
-- stem_key = kolumnnamnet för fasta stämmor (t.ex. 'stem_tenor_path') eller extra_stems[].id
--            (samma nycklar som songs.stem_offsets / stem_meta).
-- data     = { v, hop, midi: [..], notes: [{t, d, n}], fmin, fmax, ... }
--            Tider är relativa ljudfilen — spelaren lägger på stem_offsets själv.
-- stem_path = vilken fil kurvan togs fram från, så vi ser om filen bytts ut sedan dess.

create table if not exists public.song_pitch (
  song_id    uuid not null references public.songs(id) on delete cascade,
  stem_key   text not null,
  stem_path  text,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (song_id, stem_key)
);

alter table public.song_pitch enable row level security;

-- Godkända medlemmar kan läsa
drop policy if exists "song_pitch_select_approved" on public.song_pitch;
create policy "song_pitch_select_approved" on public.song_pitch for select to authenticated
  using (exists (select 1 from public.members m where m.id = auth.uid() and m.status = 'approved'));

-- Bara admin skriver
drop policy if exists "song_pitch_admin_write" on public.song_pitch;
create policy "song_pitch_admin_write" on public.song_pitch for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
