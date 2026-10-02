-- Närvarocheck: medlemmar checkar in på dagens händelse från medlemssidan.
-- events.id-typen läses av automatiskt (uuid eller bigint) så att främmande nyckeln stämmer.
do $$
declare id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into id_type
  from pg_attribute a
  where a.attrelid = 'public.events'::regclass and a.attname = 'id';

  execute format($f$
    create table if not exists public.attendance (
      event_id      %s not null references public.events(id) on delete cascade,
      member_id     uuid not null references public.members(id) on delete cascade,
      checked_in_at timestamptz not null default now(),
      checked_by    uuid references public.members(id) on delete set null, -- satt om admin markerade närvaron
      primary key (event_id, member_id)
    )$f$, id_type);
end $$;

alter table public.attendance enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.id = auth.uid() and m.role = 'admin');
$$;

-- Medlem: se sina egna incheckningar
drop policy if exists "attendance_select_own" on public.attendance;
create policy "attendance_select_own" on public.attendance for select to authenticated
  using (member_id = auth.uid() or public.is_admin());

-- Medlem: checka in sig själv, bara på en händelse som är idag (svensk tid) och bara som godkänd medlem
drop policy if exists "attendance_insert_self_today" on public.attendance;
create policy "attendance_insert_self_today" on public.attendance for insert to authenticated
  with check (
    member_id = auth.uid()
    and checked_by is null
    and exists (select 1 from public.members m where m.id = auth.uid() and m.status = 'approved')
    and exists (
      select 1 from public.events e
      where e.id = event_id
        and e.event_date = (now() at time zone 'Europe/Stockholm')::date
    )
  );

-- Admin: markera / ta bort närvaro för vem som helst
drop policy if exists "attendance_admin_insert" on public.attendance;
create policy "attendance_admin_insert" on public.attendance for insert to authenticated
  with check (public.is_admin());

drop policy if exists "attendance_admin_delete" on public.attendance;
create policy "attendance_admin_delete" on public.attendance for delete to authenticated
  using (public.is_admin());
