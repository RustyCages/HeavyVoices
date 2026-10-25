-- Mötesanteckningar: läsrätt för stämledare (alla anteckningar) och för bokaren (sina egna möten).
-- Skriva, ändra och ta bort är fortfarande bara för admin (meeting_notes_admin_all).
-- Utskick sker via Edge Function "send-meeting-notes", som kontrollerar mottagarna.

drop policy if exists meeting_notes_song_editor_select on public.meeting_notes;
create policy meeting_notes_song_editor_select on public.meeting_notes
  for select to authenticated
  using (public.is_song_editor());

drop policy if exists meeting_notes_booker_select on public.meeting_notes;
create policy meeting_notes_booker_select on public.meeting_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = meeting_notes.event_id
        and e.created_by = auth.uid()
    )
  );
