-- Fildelning: filer som delas till alla medlemmar, till körledningen (admin + stämledare) eller till valda medlemmar.
-- Filerna ligger i en egen privat bucket och raderas automatiskt 30 dagar efter uppladdning (se purge-funktionen nedan).
-- Kör om filen är säker: allt använder if not exists / drop policy if exists / on conflict.

-- 1. Bucket
insert into storage.buckets (id, name, public)
values ('heavy-voices-fildelning', 'heavy-voices-fildelning', false)
on conflict (id) do nothing;

-- 2. Metadata om varje delad fil
create table if not exists public.shared_files (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,                       -- objektnamnet i bucketen
  name        text not null,                              -- originalfilnamnet (åäö bevarade) som visas
  size        bigint,
  mime        text,
  audience    text not null check (audience in ('alla', 'korledning', 'valda')),
  recipients  uuid[] not null default '{}',               -- används när audience = 'valda'
  uploaded_by uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days')
);

alter table public.shared_files enable row level security;

drop policy if exists shared_files_select on public.shared_files;
create policy shared_files_select on public.shared_files
  for select to authenticated
  using (
    public.is_song_editor()
    or (
      public.is_approved_member()
      and (audience = 'alla' or (audience = 'valda' and auth.uid() = any(recipients)))
    )
  );

drop policy if exists shared_files_write on public.shared_files;
create policy shared_files_write on public.shared_files
  for all to authenticated
  using (public.is_song_editor())
  with check (public.is_song_editor());

-- 3. Storage-regler för bucketen.
-- Lagringens befintliga policy "approved_members_only_files" släpper igenom alla inloggade för buckets som inte står i listan,
-- så här läggs restriktiva regler (som ANDas med den) som släpper in bara rätt personer.
drop policy if exists fildelning_restrict_select on storage.objects;
create policy fildelning_restrict_select on storage.objects
  as restrictive for select
  using (
    bucket_id <> 'heavy-voices-fildelning'
    or public.is_song_editor()
    or exists (
      select 1 from public.shared_files s
      where s.path = objects.name
        and public.is_approved_member()
        and (s.audience = 'alla' or (s.audience = 'valda' and auth.uid() = any(s.recipients)))
    )
  );

drop policy if exists fildelning_restrict_insert on storage.objects;
create policy fildelning_restrict_insert on storage.objects
  as restrictive for insert
  with check (bucket_id <> 'heavy-voices-fildelning' or public.is_song_editor());

drop policy if exists fildelning_restrict_update on storage.objects;
create policy fildelning_restrict_update on storage.objects
  as restrictive for update
  using (bucket_id <> 'heavy-voices-fildelning' or public.is_song_editor())
  with check (bucket_id <> 'heavy-voices-fildelning' or public.is_song_editor());

drop policy if exists fildelning_restrict_delete on storage.objects;
create policy fildelning_restrict_delete on storage.objects
  as restrictive for delete
  using (bucket_id <> 'heavy-voices-fildelning' or public.is_song_editor());

-- 4. Rensning: tar bort filer och rader som gått ut. Körs av pg_cron varje natt (se nedan).
create or replace function public.purge_expired_shared_files()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  n integer;
begin
  delete from storage.objects o
  using public.shared_files s
  where o.bucket_id = 'heavy-voices-fildelning'
    and o.name = s.path
    and s.expires_at < now();
  get diagnostics n = row_count;

  delete from public.shared_files where expires_at < now();
  return n;
end;
$$;

revoke all on function public.purge_expired_shared_files() from public, anon, authenticated;
