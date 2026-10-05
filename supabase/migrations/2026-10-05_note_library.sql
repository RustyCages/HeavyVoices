-- Notbibliotek: sparade notuppsättningar (från Röstövningens noteditor) som kan
-- hämtas in på valfri låt/stämma. Bara admin läser och skriver.
create table if not exists public.note_library (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  song_id     uuid references public.songs(id) on delete set null,
  song_title  text,
  stem_label  text,
  notes       jsonb not null,          -- [{ t: sek, d: sek, n: MIDI-nummer }]
  note_count  int not null default 0,
  created_by  uuid default auth.uid() references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.note_library enable row level security;

drop policy if exists "note_library_admin_all" on public.note_library;
create policy "note_library_admin_all" on public.note_library for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
