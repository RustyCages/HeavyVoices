-- Frågesporter: sparade svenska översättningar + körens egen frågebank.
-- Används av js/quiz-sources.js (Tårtbitarna, rockquizen) och Edge Function "translate-quiz".
-- Kör om filen är säker: if not exists / drop policy if exists.

-- 1. Översättningar. En rad per originalfråga (hash av fråga + svar). Skrivs bara av Edge Function (service role).
create table if not exists public.quiz_translations (
  id           uuid primary key default gen_random_uuid(),
  source       text not null default 'otdb',            -- otdb | tta | rock | annat
  source_hash  text not null unique,                    -- sha-256 av originalfråga + rätt svar + fel svar
  question_en  text not null,
  question_sv  text not null,
  correct_sv   text not null,
  wrong_sv     jsonb not null default '[]'::jsonb,       -- felaktiga alternativ på svenska
  category     text,
  blocked      boolean not null default false,          -- admin/stämledare spärrar en dålig fråga
  created_at   timestamptz not null default now()
);

alter table public.quiz_translations enable row level security;

drop policy if exists quiz_translations_select on public.quiz_translations;
create policy quiz_translations_select on public.quiz_translations
  for select to authenticated
  using (public.is_approved_member());

-- Spärra/ändra en översättning: admin eller stämledare
drop policy if exists quiz_translations_editor_update on public.quiz_translations;
create policy quiz_translations_editor_update on public.quiz_translations
  for update to authenticated
  using (public.is_song_editor())
  with check (public.is_song_editor());

drop policy if exists quiz_translations_editor_delete on public.quiz_translations;
create policy quiz_translations_editor_delete on public.quiz_translations
  for delete to authenticated
  using (public.is_song_editor());

-- 2. Egen frågebank på svenska
create table if not exists public.quiz_questions (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('geo', 'film', 'hist', 'konst', 'vet', 'sport', 'rock', 'kor')),
  question    text not null,
  correct     text not null,
  wrong       jsonb not null default '[]'::jsonb,         -- 0–3 fel svar (tomt = bara "säg svaret högt")
  difficulty  text not null default 'medel' check (difficulty in ('latt', 'medel', 'svar')),
  active      boolean not null default true,
  created_by  uuid references public.members(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.quiz_questions enable row level security;

drop policy if exists quiz_questions_select on public.quiz_questions;
create policy quiz_questions_select on public.quiz_questions
  for select to authenticated
  using (public.is_approved_member());

drop policy if exists quiz_questions_editor_write on public.quiz_questions;
create policy quiz_questions_editor_write on public.quiz_questions
  for all to authenticated
  using (public.is_song_editor())
  with check (public.is_song_editor());

create index if not exists quiz_questions_category_idx on public.quiz_questions (category) where active;

-- 3. Musiktemat i Tårtbitarna: genrer som kategorier i egen frågebank
alter table public.quiz_questions drop constraint if exists quiz_questions_category_check;
alter table public.quiz_questions add constraint quiz_questions_category_check
  check (category in ('geo', 'film', 'hist', 'konst', 'vet', 'sport', 'rock', 'kor', 'klassisk', 'hardrock', 'metal', 'punk'));
