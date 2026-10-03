-- Dolda låtar (published = false) syns bara för admin.
-- Täpper samtidigt till: approved_members_only gav alla godkända medlemmar
-- skrivrätt, och songs_select_authenticated gav även ej godkända konton läsrätt.
-- (ALTER i stället för DROP/CREATE – samma effekt, policynamnen behålls.)
alter policy songs_select_authenticated on public.songs
  using (public.is_admin() or (published and public.is_approved_member()));
alter policy approved_members_only on public.songs
  using (public.is_admin()) with check (public.is_admin());
alter policy songs_admin_write on public.songs
  using (public.is_admin()) with check (public.is_admin());
