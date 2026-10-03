-- Dolda låtar (published = false) syns bara för admin.
-- Ersätter tidigare policies: approved_members_only (gav alla godkända
-- medlemmar skrivrätt) och songs_select_authenticated (gav även ej
-- godkända konton läsrätt).
drop policy if exists approved_members_only on public.songs;
drop policy if exists songs_select_authenticated on public.songs;
drop policy if exists songs_admin_write on public.songs;

create policy songs_select on public.songs
  for select to authenticated
  using (public.is_admin() or (published and public.is_approved_member()));

create policy songs_admin_write on public.songs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
