-- 2026-11-17_webhook_secret_vault.sql
-- Webhook-hemligheten till notify-new-member låg hårdkodad i triggerfunktionerna och var ett
-- tangentbordsmönster (lätt att gissa). Den flyttas till Supabase Vault och byts ut.
--
-- ORDNING (annars slutar notismejlen fungera en stund):
--   1. Skapa en ny slumpsträng, t.ex.:  openssl rand -hex 32
--   2. Kör raden nedan med den nya strängen (en gång):
--        select vault.create_secret('<NY_SLUMPSTRÄNG>', 'notify_webhook_secret');
--   3. Kör resten av den här filen.
--   4. Sätt samma sträng som secret WEBHOOK_SECRET på Edge Functions (Dashboard → Edge Functions → Secrets).

create or replace function public.notify_new_member()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $function$
begin
  if new.status = 'pending' then
    perform net.http_post(
      url     := 'https://scfudeyozwedohujsoua.supabase.co/functions/v1/notify-new-member',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_webhook_secret')
                 ),
      body    := jsonb_build_object('type', 'INSERT', 'table', 'members', 'schema', 'public', 'record', to_jsonb(new))
    );
  end if;
  return new;
end;
$function$;

create or replace function public.notify_member_approved()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $function$
begin
  if old.status = 'pending' and new.status = 'approved' then
    perform net.http_post(
      url     := 'https://scfudeyozwedohujsoua.supabase.co/functions/v1/notify-new-member',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_webhook_secret')
                 ),
      body    := jsonb_build_object('type', 'UPDATE', 'table', 'members', 'schema', 'public',
                                    'record', to_jsonb(new), 'old_record', to_jsonb(old))
    );
  end if;
  return new;
end;
$function$;

revoke execute on function public.notify_new_member() from public, anon, authenticated;
revoke execute on function public.notify_member_approved() from public, anon, authenticated;
