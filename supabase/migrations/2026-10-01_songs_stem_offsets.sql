-- Stämsynk: förskjutning per stämfil i millisekunder.
-- Nyckel = kolumnnamnet för fasta stämmor (t.ex. 'stem_sopran_path') eller extra_stems[].id.
-- Positivt värde = stämman spelas senare, negativt = tidigare.
alter table public.songs
  add column if not exists stem_offsets jsonb not null default '{}'::jsonb;
