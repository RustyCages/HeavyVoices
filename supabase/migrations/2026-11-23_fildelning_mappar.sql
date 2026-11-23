-- Fildelning som filutforskare (som Google Drive): mappar + delning per fil/mapp.
--
-- Regler:
--   * Ladda upp / skapa mappar: admin och stämledare (is_song_editor), bara i egna mappar.
--   * Se en fil/mapp: uppladdaren, de den delats med (direkt eller via en överordnad mapp), och admin (ser allt).
--     Stämledare får INGEN extra åtkomst – de ser bara egna filer och det som delats med dem.
--   * Dela / ändra delning: bara uppladdaren (mappens skapare). Inte ens admin.
--   * Byta namn / flytta: uppladdaren. Radera: uppladdaren eller admin.
--   * Mottagare: en medlem, en stämma, körledningen (admin + stämledare) eller alla godkända medlemmar.
--     Pausade/avslutade (status <> 'approved') ser ingenting – is_approved_member() krävs.
--
-- Bygger vidare på 2026-10-22_fildelning.sql (bucket heavy-voices-fildelning + tabell shared_files).
-- Gamla delningar (audience/recipients) flyttas över till file_shares. Nya filer raderas inte automatiskt
-- (expires_at = null); gamla filer behåller sitt datum.
-- Går att köra om: if not exists / drop policy if exists / create or replace.

-- ---------- 1. Mappar ----------
create table if not exists public.shared_folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0 and position('/' in name) = 0),
  parent_id  uuid references public.shared_folders(id) on delete cascade,
  owner      uuid references public.members(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists shared_folders_parent_idx on public.shared_folders(parent_id);
alter table public.shared_folders enable row level security;

-- ---------- 2. Filer: mapp, ingen tvingad livstid, audience valfri ----------
alter table public.shared_files add column if not exists folder_id uuid references public.shared_folders(id) on delete restrict;
create index if not exists shared_files_folder_idx on public.shared_files(folder_id);
alter table public.shared_files alter column expires_at drop not null;
alter table public.shared_files alter column expires_at drop default;
alter table public.shared_files alter column audience drop not null;
alter table public.shared_files alter column uploaded_by set default auth.uid();

-- ---------- 3. Delningar ----------
create table if not exists public.file_shares (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid references public.shared_files(id) on delete cascade,
  folder_id   uuid references public.shared_folders(id) on delete cascade,
  target_type text not null check (target_type in ('alla', 'korledning', 'stamma', 'medlem')),
  member_id   uuid references public.members(id) on delete cascade,
  stamma      text,
  created_at  timestamptz not null default now(),
  check ((file_id is null) <> (folder_id is null)),
  check ((target_type = 'medlem') = (member_id is not null)),
  check ((target_type = 'stamma') = (stamma is not null))
);
create unique index if not exists file_shares_uniq on public.file_shares
  (coalesce(file_id, folder_id), target_type, coalesce(member_id::text, stamma, ''));
create index if not exists file_shares_file_idx on public.file_shares(file_id);
create index if not exists file_shares_folder_idx on public.file_shares(folder_id);
alter table public.file_shares enable row level security;

-- Flytta över gamla delningar (bara första gången)
do $$
begin
  if not exists (select 1 from public.file_shares) then
    insert into public.file_shares (file_id, target_type)
      select id, audience from public.shared_files where audience in ('alla', 'korledning');
    insert into public.file_shares (file_id, target_type, member_id)
      select s.id, 'medlem', r.mid
      from public.shared_files s, unnest(s.recipients) as r(mid)
      where s.audience = 'valda' and exists (select 1 from public.members m where m.id = r.mid);
  end if;
end $$;

-- ---------- 4. Hjälpfunktioner (security definer – kringgår RLS internt) ----------
-- Mappen själv + alla mappar ovanför
create or replace function public.fd_folder_chain(p_folder uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  with recursive c(id, parent_id, depth) as (
    select id, parent_id, 0 from public.shared_folders where id = p_folder
    union all
    select f.id, f.parent_id, c.depth + 1 from public.shared_folders f join c on f.id = c.parent_id where c.depth < 50
  )
  select id from c;
$$;

-- Har filen/mappen (eller en mapp ovanför) delats med den inloggade?
create or replace function public.fd_shared_with_me(p_file uuid, p_folder uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_approved_member() and exists (
    select 1
    from public.file_shares s
    join public.members me on me.id = auth.uid()
    where ((p_file is not null and s.file_id = p_file)
           or s.folder_id in (select public.fd_folder_chain(p_folder)))
      and (   s.target_type = 'alla'
           or (s.target_type = 'korledning' and public.is_song_editor())
           or (s.target_type = 'medlem' and s.member_id = auth.uid())
           or (s.target_type = 'stamma' and s.stamma = me.stamma))
  );
$$;

-- Ägaren till en fil eller mapp
create or replace function public.fd_item_owner(p_file uuid, p_folder uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select case when p_file is not null
    then (select uploaded_by from public.shared_files where id = p_file)
    else (select owner from public.shared_folders where id = p_folder) end;
$$;

-- Är mappen min (för uppladdning/nya undermappar)? null = roten, alltid ok.
create or replace function public.fd_folder_is_mine(p_folder uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_folder is null or exists (select 1 from public.shared_folders where id = p_folder and owner = auth.uid());
$$;

-- Lagringsregler: får den inloggade läsa objektet / finns det någon rad för det?
create or replace function public.fd_can_read_path(p_path text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.shared_files f
    where f.path = p_path
      and (public.is_admin()
           or (f.uploaded_by = auth.uid() and public.is_approved_member())
           or public.fd_shared_with_me(f.id, f.folder_id))
  );
$$;


-- "Delat med mig": allt som delats med mig och som inte är mitt eget (admin-genvägen räknas inte)
create or replace function public.fd_shared_with_me_items()
returns table (kind text, id uuid)
language sql stable security definer set search_path = public
as $$
  select 'folder'::text, f.id from public.shared_folders f
   where f.owner is distinct from auth.uid() and public.fd_shared_with_me(null, f.id)
  union all
  select 'file'::text, s.id from public.shared_files s
   where s.uploaded_by is distinct from auth.uid() and public.fd_shared_with_me(s.id, s.folder_id);
$$;

-- Radera en mapp med allt innehåll. Returnerar filernas sökvägar så att sidan kan ta bort objekten i bucketen.
create or replace function public.fd_delete_folder(p_id uuid)
returns setof text
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner into v_owner from public.shared_folders where id = p_id;
  if not found then return; end if;
  if not (public.is_admin() or (v_owner = auth.uid() and public.is_song_editor())) then
    raise exception 'Saknar behörighet att radera mappen';
  end if;
  return query
    with recursive t(id) as (
      select p_id
      union all
      select f.id from public.shared_folders f join t on f.parent_id = t.id
    )
    delete from public.shared_files sf using t where sf.folder_id = t.id returning sf.path;
  delete from public.shared_folders where id = p_id;   -- undermappar och deras delningar följer med (cascade)
end;
$$;

revoke all on function public.fd_delete_folder(uuid) from public, anon;
grant execute on function public.fd_delete_folder(uuid) to authenticated;
grant execute on function public.fd_shared_with_me_items() to authenticated;

-- ---------- 5. RLS: mappar ----------
drop policy if exists shared_folders_select on public.shared_folders;
create policy shared_folders_select on public.shared_folders for select to authenticated
  using (public.is_admin()
         or (owner = auth.uid() and public.is_approved_member())
         or public.fd_shared_with_me(null, id));

drop policy if exists shared_folders_insert on public.shared_folders;
create policy shared_folders_insert on public.shared_folders for insert to authenticated
  with check (public.is_song_editor() and owner = auth.uid() and public.fd_folder_is_mine(parent_id));

drop policy if exists shared_folders_update on public.shared_folders;
create policy shared_folders_update on public.shared_folders for update to authenticated
  using (public.is_song_editor() and owner = auth.uid())
  with check (public.is_song_editor() and owner = auth.uid() and public.fd_folder_is_mine(parent_id) and parent_id is distinct from id);

drop policy if exists shared_folders_delete on public.shared_folders;
create policy shared_folders_delete on public.shared_folders for delete to authenticated
  using (public.is_admin() or (public.is_song_editor() and owner = auth.uid()));

-- ---------- 6. RLS: filer (ersätter de gamla policyerna) ----------
drop policy if exists shared_files_select on public.shared_files;
create policy shared_files_select on public.shared_files for select to authenticated
  using (public.is_admin()
         or (uploaded_by = auth.uid() and public.is_approved_member())
         or public.fd_shared_with_me(id, folder_id));

drop policy if exists shared_files_write on public.shared_files;     -- gammal "for all" för alla stämledare

drop policy if exists shared_files_insert on public.shared_files;
create policy shared_files_insert on public.shared_files for insert to authenticated
  with check (public.is_song_editor() and uploaded_by = auth.uid() and public.fd_folder_is_mine(folder_id));

drop policy if exists shared_files_update on public.shared_files;
create policy shared_files_update on public.shared_files for update to authenticated
  using (public.is_song_editor() and uploaded_by = auth.uid())
  with check (public.is_song_editor() and uploaded_by = auth.uid() and public.fd_folder_is_mine(folder_id));

drop policy if exists shared_files_delete on public.shared_files;
create policy shared_files_delete on public.shared_files for delete to authenticated
  using (public.is_admin() or (uploaded_by = auth.uid() and public.is_approved_member()));

-- path får inte ändras (objektet i bucketen flyttas aldrig – mappar finns bara i databasen)
revoke update on public.shared_files from authenticated;
grant update (name, folder_id) on public.shared_files to authenticated;

-- ---------- 7. RLS: delningar ----------
-- Se: ägaren (för Dela-dialogen) och admin. Skriva: bara ägaren.
drop policy if exists file_shares_select on public.file_shares;
create policy file_shares_select on public.file_shares for select to authenticated
  using (public.is_admin() or public.fd_item_owner(file_id, folder_id) = auth.uid());

drop policy if exists file_shares_insert on public.file_shares;
create policy file_shares_insert on public.file_shares for insert to authenticated
  with check (public.is_song_editor() and public.fd_item_owner(file_id, folder_id) = auth.uid());

drop policy if exists file_shares_delete on public.file_shares;
create policy file_shares_delete on public.file_shares for delete to authenticated
  using (public.is_song_editor() and public.fd_item_owner(file_id, folder_id) = auth.uid());

-- ---------- 8. Lagringen (bucket heavy-voices-fildelning) ----------
-- En tillåtande grundregel för bucketen (själva spärren ligger i de restriktiva reglerna nedan, som ANDas med den).
drop policy if exists fildelning_allow on storage.objects;
create policy fildelning_allow on storage.objects for all to authenticated
  using (bucket_id = 'heavy-voices-fildelning')
  with check (bucket_id = 'heavy-voices-fildelning');

-- Restriktiva regler. Ersätter reglerna från 2026-10-22.
drop policy if exists fildelning_restrict_select on storage.objects;
create policy fildelning_restrict_select on storage.objects
  as restrictive for select
  using (bucket_id <> 'heavy-voices-fildelning'
         or public.is_admin()
         or (owner_id = auth.uid()::text and public.is_approved_member())
         or public.fd_can_read_path(name));

drop policy if exists fildelning_restrict_insert on storage.objects;
create policy fildelning_restrict_insert on storage.objects
  as restrictive for insert
  with check (bucket_id <> 'heavy-voices-fildelning' or public.is_song_editor());

drop policy if exists fildelning_restrict_update on storage.objects;
create policy fildelning_restrict_update on storage.objects
  as restrictive for update
  using (bucket_id <> 'heavy-voices-fildelning' or public.is_admin())
  with check (bucket_id <> 'heavy-voices-fildelning' or public.is_admin());

-- Radera: admin eller den som laddade upp objektet
drop policy if exists fildelning_restrict_delete on storage.objects;
create policy fildelning_restrict_delete on storage.objects
  as restrictive for delete
  using (bucket_id <> 'heavy-voices-fildelning'
         or public.is_admin()
         or (owner_id = auth.uid()::text and public.is_approved_member()));

-- Kontroll efteråt:
-- select count(*) as mappar from public.shared_folders;
-- select target_type, count(*) from public.file_shares group by 1;
