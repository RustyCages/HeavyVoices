-- Artist per låt (visas som liten grå rad under titeln i repertoar, spellista och admin → Låtar)
alter table public.songs add column if not exists artist text;

-- Verifiering:
-- select column_name from information_schema.columns where table_name = 'songs' and column_name = 'artist';
