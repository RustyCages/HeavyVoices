-- Mötesanteckningar kan göras synliga för alla godkända medlemmar (visible_to_members).
-- Admin och stämledare kan redan läsa och skriva alla anteckningar; bokare och inbjudna behåller sin läsrätt.

alter table public.meeting_notes add column if not exists visible_to_members boolean not null default false;

drop policy if exists meeting_notes_member_select on public.meeting_notes;
create policy meeting_notes_member_select on public.meeting_notes
  for select to authenticated
  using (visible_to_members = true and public.is_approved_member());
