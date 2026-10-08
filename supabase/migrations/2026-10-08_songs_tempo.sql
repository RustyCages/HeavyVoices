-- Tempo för Röstövningen: BPM, var första slaget (taktetta) ligger och taktart.
-- beat_offset är sekunder på låtens gemensamma tidslinje (samma som karaoke / stem_offsets).
-- Används för taktstreck i notbanan och klick (metronom). Admin synkar i Röstövning → 🥁 Tempo & klick.
alter table public.songs
  add column if not exists bpm           real,
  add column if not exists beat_offset   real not null default 0,
  add column if not exists beats_per_bar smallint not null default 4;
