-- Brevmall som skickas automatiskt när en medlem godkänns (pending → approved).
-- Högst en mall åt gången. Ingen vald = inget välkomstmejl.
-- Läses av Edge Function notify-new-member.
alter table public.letter_templates
  add column if not exists send_on_approval boolean not null default false;

-- När en mall väljs avmarkeras övriga (så att admin-sidan bara behöver spara en rad)
create or replace function public.letter_templates_single_approval()
returns trigger language plpgsql as $$
begin
  if new.send_on_approval then
    update public.letter_templates set send_on_approval = false
     where send_on_approval and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists letter_templates_single_approval on public.letter_templates;
create trigger letter_templates_single_approval
  before insert or update of send_on_approval on public.letter_templates
  for each row when (new.send_on_approval)
  execute function public.letter_templates_single_approval();

-- Extra skydd: aldrig två valda samtidigt
create unique index if not exists letter_templates_one_on_approval
  on public.letter_templates ((true)) where send_on_approval;

-- Behåll nuvarande beteende: välkomstmallen är vald från början
update public.letter_templates set send_on_approval = true
 where id = (select id from public.letter_templates where name = 'Välkommen ny medlem' order by updated_at desc limit 1)
   and not exists (select 1 from public.letter_templates where send_on_approval);
