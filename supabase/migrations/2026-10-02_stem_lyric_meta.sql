-- Eget namn och ordning på stämfiler (ljud) och stämtexter (dokument) per låt.
-- { "order": ["stem_sopran_path", "<extra-id>", ...], "labels": { "stem_sopran_path": "Sopran 1" } }
alter table public.songs
  add column if not exists stem_meta  jsonb not null default '{}'::jsonb,
  add column if not exists lyric_meta jsonb not null default '{}'::jsonb;
