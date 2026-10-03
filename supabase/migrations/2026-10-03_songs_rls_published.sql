-- Dolda låtar (published = false) syns bara för admin.
-- OBS: approved_members_only är RESTRICTIVE (måste uppfyllas av alla) –
-- den ska stå kvar som is_approved_member(), annars stängs medlemmar ute.
-- Skrivrätt styrs av den permissiva songs_admin_write (bara admin).
alter policy songs_select_authenticated on public.songs
  using (public.is_admin() or (published and public.is_approved_member()));
alter policy songs_admin_write on public.songs
  using (public.is_admin()) with check (public.is_admin());
alter policy approved_members_only on public.songs
  using (public.is_approved_member()) with check (public.is_approved_member());
