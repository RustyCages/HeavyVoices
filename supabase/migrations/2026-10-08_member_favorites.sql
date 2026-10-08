-- Mina favoriter på Uppvärmningssidan: varje medlem sparar egna YouTube-klipp
-- (från kanalbläddringen eller körens egna videor). Privat – bara ägaren ser sina rader.
create table if not exists public.member_favorites (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null default auth.uid() references public.members(id) on delete cascade,
  youtube_id  text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title       text not null,
  start_sec   int not null default 0,
  created_at  timestamptz not null default now(),
  unique (member_id, youtube_id)
);
create index if not exists member_favorites_member_idx on public.member_favorites (member_id, created_at desc);
alter table public.member_favorites enable row level security;

create policy "member_favorites_select_own" on public.member_favorites for select to authenticated
  using (member_id = auth.uid());
create policy "member_favorites_insert_own" on public.member_favorites for insert to authenticated
  with check (member_id = auth.uid()
    and exists (select 1 from public.members m where m.id = auth.uid() and m.status = 'approved'));
create policy "member_favorites_delete_own" on public.member_favorites for delete to authenticated
  using (member_id = auth.uid());
