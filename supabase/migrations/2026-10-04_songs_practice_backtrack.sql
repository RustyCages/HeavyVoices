-- Admin bestämmer per låt om backtracket får användas i Röstövning (medlemsvyn).
-- Default true = som tidigare. Admin kan stänga av per låt under Admin → Låtar → Stämfiler.
alter table public.songs
  add column if not exists practice_backtrack boolean not null default true;
