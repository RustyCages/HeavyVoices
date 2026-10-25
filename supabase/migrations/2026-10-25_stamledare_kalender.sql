-- Stämledare får redigera kalendern (repetitioner, konserter och övrigt), precis som admin.
-- Möten (event_type 'mote') är medlemmarnas egna: de bokas och avbokas av bokaren, så att inbjudna
-- får rätt mejl. Medlemslistan och mötesanteckningar (meeting_notes) är fortfarande bara för admin.
-- Bygger på is_song_editor() = godkänd admin eller stämledare (se 2026-10-10_stamledare.sql).

drop policy if exists events_song_editor_all on public.events;
create policy events_song_editor_all on public.events
  for all to authenticated
  using (public.is_song_editor() and event_type <> 'mote')
  with check (public.is_song_editor() and event_type <> 'mote');
