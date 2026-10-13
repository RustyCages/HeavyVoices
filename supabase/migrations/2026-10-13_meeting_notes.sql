-- Mötesanteckningar (talat till text i webbläsaren) kopplade till kalenderhändelser. Endast admin.
create table if not exists public.meeting_notes (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references public.events(id) on delete cascade,
  body        text not null default '',
  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists meeting_notes_event_idx on public.meeting_notes (event_id, created_at desc);

alter table public.meeting_notes enable row level security;

drop policy if exists meeting_notes_admin_all on public.meeting_notes;
create policy meeting_notes_admin_all on public.meeting_notes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
