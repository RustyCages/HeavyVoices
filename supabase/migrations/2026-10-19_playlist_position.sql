-- Spellistans ordning: en position per låt, så man kan flytta upp/ner i efterhand
-- utan att skapa en ny spellista. Befintliga rader numreras efter id (nuvarande ordning).
alter table public.playlist_songs add column if not exists position integer;

update public.playlist_songs p
set position = s.rn
from (
  select id, row_number() over (partition by playlist_id order by id) as rn
  from public.playlist_songs
) s
where p.id = s.id and p.position is null;

-- Verifiering (ska visa att alla rader har en position):
-- select count(*) as utan_position from public.playlist_songs where position is null;
