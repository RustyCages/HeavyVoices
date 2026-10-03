-- Sparade röstövningar (Sjung med) så medlemmar kan följa sin utveckling.
create table if not exists public.practice_sessions (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null default auth.uid() references public.members(id) on delete cascade,
  song_id      uuid not null references public.songs(id) on delete cascade,
  stem_key     text not null,
  stem_label   text,
  hit_pct      smallint not null,          -- träff i % av tiden i noterna
  notes_ok     integer not null,           -- noter med minst 60 % rätt
  notes_done   integer not null,           -- sjungna noter
  notes_total  integer,                    -- noter i stämman
  sung_seconds numeric(7,1),
  tolerance    smallint,                   -- marginal i cent
  created_at   timestamptz not null default now()
);
create index if not exists practice_sessions_member_idx on public.practice_sessions (member_id, created_at desc);

alter table public.practice_sessions enable row level security;

create policy practice_select on public.practice_sessions
  for select to authenticated
  using (member_id = auth.uid() or public.is_admin());

create policy practice_insert on public.practice_sessions
  for insert to authenticated
  with check (member_id = auth.uid() and public.is_approved_member());

create policy practice_delete on public.practice_sessions
  for delete to authenticated
  using (member_id = auth.uid());
