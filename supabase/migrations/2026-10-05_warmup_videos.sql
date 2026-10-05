-- Uppvärmningsvideor (YouTube) för medlemssidan medlem/uppvarmning.html
create table if not exists public.warmup_videos (
  id          uuid primary key default gen_random_uuid(),
  youtube_id  text not null,
  title       text not null,
  description text,
  category    text not null default 'Uppvärmning',
  voice       text,                      -- null = alla stämmor, annars 'sopran' | 'alt' | 'tenor' | 'bas'
  start_sec   int not null default 0,    -- starta videon här (från ?t= i länken)
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.warmup_videos enable row level security;

create policy "warmup_videos_select_approved" on public.warmup_videos for select to authenticated
  using (exists (select 1 from public.members m where m.id = auth.uid() and m.status = 'approved'));
create policy "warmup_videos_admin_all" on public.warmup_videos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Egen videofil som bakgrund i Röstövningens notbana (fil i heavy-voices-stems)
alter table public.songs
  add column if not exists bg_video_path   text,
  add column if not exists bg_video_offset real not null default 0;   -- sekunder: videotid = låttid + offset
