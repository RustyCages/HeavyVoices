-- Admin bestämmer vilka låtar som syns för medlemmarna.
-- Befintliga låtar förblir synliga (default true); nya låtar från Admin → Låtar skapas som dolda.
alter table public.songs
  add column if not exists published boolean not null default true;
