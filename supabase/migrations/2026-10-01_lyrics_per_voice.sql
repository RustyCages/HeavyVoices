-- Karaoke/sångtext per stämma.
-- Nycklar: 'sopran', 'alt', 'tenor', 'bas'. Saknas en stämma används den gemensamma
-- lyrics_lrc / lyrics_plain som förut.
alter table public.songs
  add column if not exists lyrics_lrc_voices   jsonb not null default '{}'::jsonb,
  add column if not exists lyrics_plain_voices jsonb not null default '{}'::jsonb;
