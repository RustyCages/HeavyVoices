-- Kalender: sluttid och återkommande händelser
alter table public.events
  add column if not exists end_time  time,
  add column if not exists series_id uuid;

create index if not exists events_series_id_idx on public.events (series_id);
