-- Heavy Voices — grundschema
-- Single-tenant: ingen choir_slug/choir_id någonstans, bara en kör.

-- ============================================================
-- MEMBERS
-- ============================================================
create table members (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('admin', 'medlem')) default 'medlem',
  created_at timestamptz not null default now()
);

alter table members enable row level security;

-- Alla inloggade medlemmar kan se medlemslistan
create policy "members_select_authenticated"
  on members for select
  using (auth.role() = 'authenticated');

-- Bara admin kan lägga till/ändra/ta bort medlemmar
create policy "members_admin_write"
  on members for all
  using (
    exists (select 1 from members m where m.id = auth.uid() and m.role = 'admin')
  );

-- ============================================================
-- SONGS
-- ============================================================
create table songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  lyrics_plain text,
  lyrics_lrc text,
  lyrics_lrc_words jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table songs enable row level security;

create policy "songs_select_authenticated"
  on songs for select
  using (auth.role() = 'authenticated');

create policy "songs_admin_write"
  on songs for all
  using (
    exists (select 1 from members m where m.id = auth.uid() and m.role = 'admin')
  );

-- ============================================================
-- SETLISTS (valfritt, om SetlistStudio-funktionen återanvänds)
-- ============================================================
create table setlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  song_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table setlists enable row level security;

create policy "setlists_select_authenticated"
  on setlists for select
  using (auth.role() = 'authenticated');

create policy "setlists_admin_write"
  on setlists for all
  using (
    exists (select 1 from members m where m.id = auth.uid() and m.role = 'admin')
  );

-- ============================================================
-- STORAGE
-- ============================================================
-- Skapa bucket 'heavy-voices-stems' via dashboard eller:
-- insert into storage.buckets (id, name, public) values ('heavy-voices-stems', 'heavy-voices-stems', false);
--
-- Exempel-policy: inloggade medlemmar kan läsa, bara admin kan skriva
-- create policy "stems_select_authenticated" on storage.objects for select
--   using (bucket_id = 'heavy-voices-stems' and auth.role() = 'authenticated');
-- create policy "stems_admin_write" on storage.objects for all
--   using (
--     bucket_id = 'heavy-voices-stems'
--     and exists (select 1 from members m where m.id = auth.uid() and m.role = 'admin')
--   );
