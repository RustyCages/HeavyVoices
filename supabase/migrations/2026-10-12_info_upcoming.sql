-- "På gång" på Information blir redigerbart: lista med {title, text, url} i choir_info.upcoming.
-- Skrivrättigheter ärvs från choir_info_admin_write (admin + stämledare).
alter table public.choir_info add column if not exists upcoming jsonb not null default '[]'::jsonb;

update public.choir_info
set upcoming = '[{"title":"Röstövning (demo)","text":"Sjung din stämma mot en notbana och se direkt om du träffar tonen","url":"/medlem/demo/Rost-demo.html"}]'::jsonb
where id = 1 and upcoming = '[]'::jsonb;
