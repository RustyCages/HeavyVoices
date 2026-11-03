-- Inkorg för info@heavyvoices.se, bara för admin.
-- Inkommande mejl: Cloudflare-workern forward-info-mail skickar en kopia av varje mejl till
-- Edge Function inbox-receive, som tolkar det och sparar en rad här (bilagor i R2 under inbox/…).
-- Utgående svar: Edge Function inbox-send skickar via Resend och sparar en rad med direction = 'out'.
-- Klienten (admin/inkorg.html) läser, markerar som läst, flyttar mellan mappar och tar bort – men skapar aldrig rader själv.
-- Kör om säkert: if not exists / drop policy if exists.

create table if not exists public.inbox_messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null,                     -- = id för första mejlet i tråden
  direction    text not null default 'in' check (direction in ('in', 'out')),
  message_id   text unique,                       -- Message-ID-huvudet, för att koppla svar till rätt tråd
  in_reply_to  text,
  refs         text,                              -- References-huvudet (mellanslagsseparerat)
  from_email   text,
  from_name    text,
  to_email     text,
  cc           text,
  subject      text,
  text_body    text,
  html_body    text,
  attachments  jsonb not null default '[]',       -- [{ path, name, size, type }], path relativ till R2-området "inbox"
  folder       text not null default 'inkorg' check (folder in ('inkorg', 'arkiv', 'skrap')),
  is_read      boolean not null default false,
  sent_by      uuid references public.members(id) on delete set null,   -- admin som skickade ett svar
  created_at   timestamptz not null default now()
);
create index if not exists inbox_messages_thread_idx on public.inbox_messages (thread_id, created_at);
create index if not exists inbox_messages_folder_idx on public.inbox_messages (folder, created_at desc);

alter table public.inbox_messages enable row level security;

drop policy if exists inbox_messages_select on public.inbox_messages;
create policy inbox_messages_select on public.inbox_messages
  for select to authenticated using (public.is_admin());

drop policy if exists inbox_messages_update on public.inbox_messages;
create policy inbox_messages_update on public.inbox_messages
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists inbox_messages_delete on public.inbox_messages;
create policy inbox_messages_delete on public.inbox_messages
  for delete to authenticated using (public.is_admin());

-- Ingen insert-policy: bara Edge Functions (service role) skapar rader.

-- Verifiera:
-- select count(*) from public.inbox_messages;
