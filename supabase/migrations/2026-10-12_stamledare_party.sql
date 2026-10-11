-- Stämledare får Partyläget: alltid åtkomst, kan hantera karaokelistan och slå på/av för medlemmar.
drop policy if exists "party_settings_admin_write" on public.party_settings;
create policy "party_settings_admin_write" on public.party_settings for all to authenticated
  using (public.is_song_editor()) with check (public.is_song_editor());

drop policy if exists "party_videos_select" on public.party_videos;
create policy "party_videos_select" on public.party_videos for select to authenticated
  using (public.is_song_editor() or (
    exists (select 1 from public.members m where m.id = auth.uid() and m.status = 'approved')
    and exists (select 1 from public.party_settings s where s.id = 1 and s.members_enabled)
  ));

drop policy if exists "party_videos_admin_write" on public.party_videos;
create policy "party_videos_admin_write" on public.party_videos for all to authenticated
  using (public.is_song_editor()) with check (public.is_song_editor());
