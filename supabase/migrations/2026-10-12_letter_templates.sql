-- Brevmallar (admin): återanvändbara texter med platshållare som {fornamn}, {namn}, {stamma}.
create table if not exists public.letter_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subject    text not null default '',
  body       text not null default '',
  updated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.letter_templates enable row level security;

drop policy if exists letter_templates_admin_all on public.letter_templates;
create policy letter_templates_admin_all on public.letter_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
