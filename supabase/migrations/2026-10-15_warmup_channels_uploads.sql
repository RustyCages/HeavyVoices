-- Uppvärmning (medlem/uppvarmning.html):
--  1) YouTube-kanaler för "Bläddra i kanalen …"-knapparna – admin lägger till/tar bort på sidan
--  2) Egna uppladdade videofiler (utanför YouTube) i bucket heavy-voices-warmup
-- Går att köra om.

-- ---------- 1. kanaler ----------
create table if not exists public.warmup_channels (
  id          uuid primary key default gen_random_uuid(),
  channel_id  text not null unique check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  name        text not null,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.warmup_channels enable row level security;

drop policy if exists "warmup_channels_select_approved" on public.warmup_channels;
create policy "warmup_channels_select_approved" on public.warmup_channels for select to authenticated
  using (public.is_approved_member());
drop policy if exists "warmup_channels_admin_all" on public.warmup_channels;
create policy "warmup_channels_admin_all" on public.warmup_channels for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- de två kanalerna som tidigare var hårdkodade
insert into public.warmup_channels (channel_id, name, position) values
  ('UCbAHuHgj0RjadzpDzZ0OWVA', 'Aussie Vocal Coach', 0),
  ('UCYvO0FPpDlJA8S5n9elvQuw', 'Singeo', 1)
on conflict (channel_id) do nothing;

-- ---------- 2. egna videofiler ----------
alter table public.warmup_videos alter column youtube_id drop not null;
alter table public.warmup_videos
  add column if not exists video_path text,   -- fil i heavy-voices-warmup
  add column if not exists thumb_path text;   -- miniatyrbild (jpg) i samma bucket
alter table public.warmup_videos drop constraint if exists warmup_videos_source_chk;
alter table public.warmup_videos add constraint warmup_videos_source_chk
  check (youtube_id is not null or video_path is not null);

insert into storage.buckets (id, name, public) values ('heavy-voices-warmup', 'heavy-voices-warmup', false)
  on conflict (id) do nothing;

drop policy if exists "warmup_files_select_approved" on storage.objects;
create policy "warmup_files_select_approved" on storage.objects for select to authenticated
  using (bucket_id = 'heavy-voices-warmup' and public.is_approved_member());
drop policy if exists "warmup_files_admin_insert" on storage.objects;
create policy "warmup_files_admin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'heavy-voices-warmup' and public.is_admin());
drop policy if exists "warmup_files_admin_update" on storage.objects;
create policy "warmup_files_admin_update" on storage.objects for update to authenticated
  using (bucket_id = 'heavy-voices-warmup' and public.is_admin());
drop policy if exists "warmup_files_admin_delete" on storage.objects;
create policy "warmup_files_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'heavy-voices-warmup' and public.is_admin());

-- Kontroll:
-- select channel_id, name, position from public.warmup_channels order by position;
-- select column_name, is_nullable from information_schema.columns where table_name = 'warmup_videos';
