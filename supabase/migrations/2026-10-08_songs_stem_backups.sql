-- Säkerhetskopior av stämfiler som redigerats i Stämsynk (klipp, tystnad, tempo).
-- { "<stämnyckel>": [ { "path": "...", "at": "2026-10-08T…", "offsetMs": 120, "note": "…" }, … ] }
-- Nyckel = kolumnnamn för fasta stämmor (t.ex. stem_sopran_path) eller id i extra_stems.
-- Filerna ligger kvar i heavy-voices-stems och kan återställas från Stämsynk.
alter table public.songs add column if not exists stem_backups jsonb not null default '{}'::jsonb;
