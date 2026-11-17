-- 2026-11-17_sakerhet_rls.sql
-- Säkerhetsgranskning: stänger skrivhål och läshål i RLS.
--
-- Grundfelet: policyerna "approved_members_only*" var tänkta som en SPÄRR (bara godkända medlemmar),
-- men skapades som PERMISSIVE. Permissiva policyer OR:as ihop, så de blev i stället en GENERELL
-- RÄTTIGHET: alla godkända medlemmar fick skriva/radera i songs, events, choir_info, setlists,
-- andras playlists och i storage-bucketarna noter/filer/stems.
-- Samtidigt gav "*_select_authenticated" läsrätt åt ALLA inloggade (även pending/ended/pausade).
--
-- Lösningen: gör spärrarna RESTRICTIVE (AND:as med övriga policyer). Då behålls avsikten,
-- rättigheterna kommer bara från de riktiga policyerna (admin/stämledare/egen rad).
--
-- Kör i Supabase SQL Editor. Filen går att köra om.

begin;

-- ---------- 1. Låtar, setlistor, spellistor ----------
drop policy if exists approved_members_only on public.songs;
drop policy if exists songs_gate on public.songs;
create policy songs_gate on public.songs as restrictive for all to authenticated
  using (public.is_approved_member()) with check (public.is_approved_member());

drop policy if exists approved_members_only on public.setlists;
drop policy if exists setlists_gate on public.setlists;
create policy setlists_gate on public.setlists as restrictive for all to authenticated
  using (public.is_approved_member()) with check (public.is_approved_member());

drop policy if exists approved_members_only on public.playlists;
drop policy if exists playlists_gate on public.playlists;
create policy playlists_gate on public.playlists as restrictive for all to authenticated
  using (public.is_approved_member()) with check (public.is_approved_member());

drop policy if exists approved_members_only on public.playlist_songs;
drop policy if exists playlist_songs_gate on public.playlist_songs;
create policy playlist_songs_gate on public.playlist_songs as restrictive for all to authenticated
  using (public.is_approved_member()) with check (public.is_approved_member());

-- ---------- 2. Kalender och Information (pausade får läsa, bara godkända får skriva) ----------
drop policy if exists approved_members_only_sel on public.events;
drop policy if exists approved_members_only_ins on public.events;
drop policy if exists approved_members_only_upd on public.events;
drop policy if exists approved_members_only_del on public.events;
drop policy if exists events_gate_sel on public.events;
drop policy if exists events_gate_ins on public.events;
drop policy if exists events_gate_upd on public.events;
drop policy if exists events_gate_del on public.events;
create policy events_gate_sel on public.events as restrictive for select to authenticated
  using (public.is_active_or_paused());
create policy events_gate_ins on public.events as restrictive for insert to authenticated
  with check (public.is_approved_member());
create policy events_gate_upd on public.events as restrictive for update to authenticated
  using (public.is_approved_member()) with check (public.is_approved_member());
create policy events_gate_del on public.events as restrictive for delete to authenticated
  using (public.is_approved_member());

drop policy if exists approved_members_only_sel on public.choir_info;
drop policy if exists approved_members_only_ins on public.choir_info;
drop policy if exists approved_members_only_upd on public.choir_info;
drop policy if exists approved_members_only_del on public.choir_info;
drop policy if exists choir_info_gate_sel on public.choir_info;
drop policy if exists choir_info_gate_ins on public.choir_info;
drop policy if exists choir_info_gate_upd on public.choir_info;
drop policy if exists choir_info_gate_del on public.choir_info;
create policy choir_info_gate_sel on public.choir_info as restrictive for select to authenticated
  using (public.is_active_or_paused());
create policy choir_info_gate_ins on public.choir_info as restrictive for insert to authenticated
  with check (public.is_approved_member());
create policy choir_info_gate_upd on public.choir_info as restrictive for update to authenticated
  using (public.is_approved_member()) with check (public.is_approved_member());
create policy choir_info_gate_del on public.choir_info as restrictive for delete to authenticated
  using (public.is_approved_member());

-- ---------- 3. Medlemsregistret: bara godkända ser andra, alla ser sig själva ----------
drop policy if exists approved_members_only on public.members;
drop policy if exists members_gate_sel on public.members;
create policy members_gate_sel on public.members as restrictive for select to authenticated
  using (public.is_approved_member() or id = auth.uid());

-- ---------- 4. Storage: noter / filer / stems (party/) ----------
drop policy if exists approved_members_only_files on storage.objects;
drop policy if exists storage_gate_approved on storage.objects;
create policy storage_gate_approved on storage.objects as restrictive for all to authenticated
  using (bucket_id <> all (array['heavy-voices-stems','heavy-voices-noter','heavy-voices-filer'])
         or public.is_approved_member())
  with check (bucket_id <> all (array['heavy-voices-stems','heavy-voices-noter','heavy-voices-filer'])
         or public.is_approved_member());

-- ---------- 5. Forum: ett svar får inte flyttas in i en tråd man inte ser ----------
drop policy if exists forum_posts_update on public.forum_posts;
create policy forum_posts_update on public.forum_posts for update to authenticated
  using (public.forum_can_see(coalesce(parent_id, id)) and (author_id = auth.uid() or public.is_song_editor()))
  with check (public.forum_can_see(coalesce(parent_id, id)) and (author_id = auth.uid() or public.is_song_editor()));

-- ---------- 6. Härdning av funktioner ----------
alter function public.letter_templates_single_approval() set search_path = public;
alter function public.clear_reactivation_on_status_change() set search_path = public;
alter function public.site_notices_touch() set search_path = public;

revoke execute on function public.notify_new_member() from public, anon, authenticated;
revoke execute on function public.notify_member_approved() from public, anon, authenticated;

commit;

-- ---------- Verifiering (ska ge 0 rader) ----------
-- Permissiva policyer som ger skrivrätt bara på is_approved_member():
-- select tablename, policyname, cmd, permissive, qual from pg_policies
--  where schemaname in ('public','storage') and permissive = 'PERMISSIVE'
--    and cmd in ('ALL','INSERT','UPDATE','DELETE')
--    and coalesce(qual, with_check) in ('is_approved_member()', '((bucket_id <> ALL (ARRAY[''heavy-voices-stems''::text, ''heavy-voices-noter''::text, ''heavy-voices-filer''::text])) OR is_approved_member())');
