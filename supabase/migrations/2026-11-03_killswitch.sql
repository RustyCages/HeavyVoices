-- Nödstopp (killswitch): admin kan stänga sajten för alla utom admin, direkt.
--  • Tabell site_status (en rad, id = 1). Läses av alla (även utloggade) – Cloudflare-mellanlagret
--    (functions/_middleware.js) och sidorna (js/supabase-config.js) kollar den.
--  • När sajten är stängd svarar is_approved_member() och is_song_editor() false för alla utom admin,
--    så att all medlemsdata som skyddas av dem blir otillgänglig även om någon går förbi sidorna.
-- Kör om filen är säker.

create table if not exists public.site_status (
  id         int primary key default 1 check (id = 1),
  closed     boolean not null default false,
  message    text,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.members(id) on delete set null
);
insert into public.site_status (id, closed) values (1, false) on conflict (id) do nothing;

alter table public.site_status enable row level security;

drop policy if exists site_status_read on public.site_status;
create policy site_status_read on public.site_status
  for select to anon, authenticated
  using (true);

drop policy if exists site_status_admin_update on public.site_status;
create policy site_status_admin_update on public.site_status
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Är sajten stängd? (security definer så att den fungerar i alla policies)
create or replace function public.site_closed()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select closed from public.site_status where id = 1), false);
$$;

-- Medlem: godkänd OCH (sajten öppen ELLER admin)
create or replace function public.is_approved_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.status = 'approved'
      and (not public.site_closed() or m.role = 'admin')
  );
$$;

-- Låtredaktör (admin eller stämledare): stämledare stängs ute när sajten är stängd
create or replace function public.is_song_editor()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.status = 'approved'
      and (m.role = 'admin' or (m.stamledare and not public.site_closed()))
  );
$$;
