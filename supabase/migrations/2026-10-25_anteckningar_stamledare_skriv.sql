-- Mötesanteckningar: stämledare (is_song_editor) får skriva, ändra och ta bort.
-- Admin har redan full rätt via meeting_notes_admin_all.

drop policy if exists meeting_notes_song_editor_all on public.meeting_notes;
create policy meeting_notes_song_editor_all on public.meeting_notes
  for all to authenticated
  using (public.is_song_editor())
  with check (public.is_song_editor());
