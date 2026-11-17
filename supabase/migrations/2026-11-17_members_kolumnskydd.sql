-- 2026-11-17_members_kolumnskydd.sql
-- Säkerhetsgranskning #7: e-post, avgifter och reaktiveringsnoteringar ska bara synas för admin.
--
-- Idag får alla godkända medlemmar läsa HELA members-tabellen (behövs för namn i forum,
-- möten, studio m.m.). Lösning: kolumnbehörighet i stället för radbehörighet.
--   • Alla inloggade får läsa de ofarliga kolumnerna (namn, stämma, roll …) som förut.
--   • email, fee_paid, fee_paid_at, invited_by, reactivation_note går bara att läsa
--     via vyn members_admin, som bara returnerar rader för admin.
--   • has_email (ny, beräknad) talar om ATT någon har e-post, utan att visa adressen.
-- Skrivningar påverkas inte (RLS: bara admin får ändra i members).
--
-- Frontend som måste gå ut SAMTIDIGT (annars går Medlemmar/Brevmallar sönder):
--   admin/medlemmar.html, admin/brevmallar.html, admin/kalender.html
-- Kör SQL:en först, pusha sedan frontend direkt efter.

begin;

-- 1. Beräknad kolumn: har medlemmen en e-postadress? (används av anteckningsutskicket i admin/kalender)
alter table public.members
  add column if not exists has_email boolean
  generated always as (email is not null and email <> '') stored;

-- 2. Kolumnbehörighet: bara de ofarliga kolumnerna är läsbara direkt
revoke select on public.members from anon, authenticated;
grant select (id, name, role, status, stamma, stamledare, created_at, reactivation_requested_at, has_email)
  on public.members to authenticated;
-- (insert/update/delete-behörigheterna lämnas orörda – RLS släpper bara igenom admin)

-- 3. Vy för admin med alla kolumner. Vyn körs med ägarens rättigheter, men where-villkoret
--    gör att den är tom för alla som inte är admin.
drop view if exists public.members_admin;
create view public.members_admin with (security_barrier = true) as
  select m.* from public.members m where public.is_admin();
revoke all on public.members_admin from public, anon, authenticated;
grant select on public.members_admin to authenticated;

-- 4. "Nollställ alla avgifter" filtrerade på fee_paid, vilket kräver läsrätt på kolumnen.
--    Nu en funktion som bara admin får köra.
create or replace function public.admin_reset_fees()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Kräver admin-behörighet'; end if;
  update public.members set fee_paid = false, fee_paid_at = null where fee_paid;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.admin_reset_fees() from public, anon;
grant execute on function public.admin_reset_fees() to authenticated;

commit;

-- Verifiering (som testmedlem i webbläsarkonsolen):
--   await supabaseClient.from('members').select('email').limit(1)        → fel: permission denied
--   await supabaseClient.from('members_admin').select('email').limit(1)  → tom lista
--   await supabaseClient.from('members').select('id, name, stamma')       → fungerar som förut
-- Som admin: Medlemmar-sidan visar e-post och avgifter som vanligt.
