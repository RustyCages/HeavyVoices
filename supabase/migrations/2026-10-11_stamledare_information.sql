-- Stämledare får även redigera Information (körinfo-texter och filer i heavy-voices-filer).
-- Bygger på is_song_editor() = godkänd admin eller stämledare (se 2026-10-10_stamledare.sql).

drop policy if exists choir_info_admin_write on public.choir_info;
create policy choir_info_admin_write on public.choir_info for all
  using (public.is_song_editor()) with check (public.is_song_editor());

drop policy if exists filer_admin_insert on storage.objects;
create policy filer_admin_insert on storage.objects for insert
  with check (bucket_id = 'heavy-voices-filer' and public.is_song_editor());

drop policy if exists filer_admin_update on storage.objects;
create policy filer_admin_update on storage.objects for update
  using (bucket_id = 'heavy-voices-filer' and public.is_song_editor())
  with check (bucket_id = 'heavy-voices-filer' and public.is_song_editor());

drop policy if exists filer_admin_delete on storage.objects;
create policy filer_admin_delete on storage.objects for delete
  using (bucket_id = 'heavy-voices-filer' and public.is_song_editor());
