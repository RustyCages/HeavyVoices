-- Medlem kan markera att hen inte kan närvara på en händelse (separat från närvaro/incheckning).
create table if not exists public.event_absences (
  event_id   uuid not null references public.events(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, member_id)
);

alter table public.event_absences enable row level security;

drop policy if exists event_absences_select on public.event_absences;
create policy event_absences_select on public.event_absences for select to authenticated
  using (member_id = auth.uid() or public.is_admin());

drop policy if exists event_absences_insert_own on public.event_absences;
create policy event_absences_insert_own on public.event_absences for insert to authenticated
  with check (member_id = auth.uid() and public.is_approved_member());

drop policy if exists event_absences_delete_own on public.event_absences;
create policy event_absences_delete_own on public.event_absences for delete to authenticated
  using (member_id = auth.uid() or public.is_admin());
