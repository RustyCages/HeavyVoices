-- Inbjudna medlemmar (även de som tackat nej) kan läsa mötesanteckningarna i efterhand.
-- Att skriva, ändra och ta bort är fortfarande bara för admin (meeting_notes_admin_all).

drop policy if exists meeting_notes_invitee_select on public.meeting_notes;
create policy meeting_notes_invitee_select on public.meeting_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.meeting_invites mi
      where mi.event_id = meeting_notes.event_id
        and mi.member_id = auth.uid()
    )
  );
