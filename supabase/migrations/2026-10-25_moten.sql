-- Mötesbokare: alla godkända medlemmar kan boka möten, välja inbjudna och få svarsknappar i mejlet.
-- Kör om filen är säker: if not exists / drop policy if exists.

-- 1. Händelser: vem som bokade, och länken till videomötet
alter table public.events add column if not exists created_by uuid references public.members(id) on delete set null;
alter table public.events add column if not exists meeting_url text;

-- 2. Inbjudningar: en rad per inbjuden medlem, med en hemlig token som används i svarslänken i mejlet
create table if not exists public.meeting_invites (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  token       uuid not null unique default gen_random_uuid(),
  response    text check (response in ('ja', 'nej', 'kanske')),
  responded_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (event_id, member_id)
);

alter table public.meeting_invites enable row level security;

-- Läsa: den inbjudna själv, bokaren av mötet, och admin
drop policy if exists meeting_invites_select on public.meeting_invites;
create policy meeting_invites_select on public.meeting_invites
  for select to authenticated
  using (
    member_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.events e where e.id = event_id and e.created_by = auth.uid())
  );

-- Skriva rader direkt: bara admin. Vanliga bokningar går via Edge Function "meeting-invite" (service role).
drop policy if exists meeting_invites_admin_write on public.meeting_invites;
create policy meeting_invites_admin_write on public.meeting_invites
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3. Händelser: godkända medlemmar får skapa, ändra och ta bort SINA egna möten (event_type = 'mote').
-- Befintlig policy events_admin_write (admin får allt) ligger kvar oförändrad.
drop policy if exists events_member_mote_insert on public.events;
create policy events_member_mote_insert on public.events
  for insert to authenticated
  with check (
    public.is_approved_member()
    and event_type = 'mote'
    and created_by = auth.uid()
  );

drop policy if exists events_member_mote_update on public.events;
create policy events_member_mote_update on public.events
  for update to authenticated
  using (public.is_approved_member() and event_type = 'mote' and created_by = auth.uid())
  with check (public.is_approved_member() and event_type = 'mote' and created_by = auth.uid());

drop policy if exists events_member_mote_delete on public.events;
create policy events_member_mote_delete on public.events
  for delete to authenticated
  using (public.is_approved_member() and event_type = 'mote' and created_by = auth.uid());
