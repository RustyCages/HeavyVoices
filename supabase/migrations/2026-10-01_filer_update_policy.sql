-- Filutforskaren: flytta/byta namn använder storage.move(), som kräver UPDATE (+ SELECT) på storage.objects.
-- Ofarlig att köra även om en "for all"-policy redan finns — policies OR:as ihop.
drop policy if exists "filer_admin_update" on storage.objects;
create policy "filer_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'heavy-voices-filer'
    and exists (select 1 from public.members m where m.id = auth.uid() and m.role = 'admin')
  )
  with check (
    bucket_id = 'heavy-voices-filer'
    and exists (select 1 from public.members m where m.id = auth.uid() and m.role = 'admin')
  );
