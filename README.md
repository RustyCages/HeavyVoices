# Heavy Voices

Webbplats och medlemsportal för kören Heavy Voices.

Fristående projekt (inte en del av ChoirStudio) — eget Supabase-projekt,
egen Cloudflare Pages-deploy, single-tenant.

## Setup

1. Skapa ett Supabase-projekt och fyll i `js/supabase-config.js`
2. Kör SQL-schemat i `supabase/schema.sql`
3. `wrangler pages project create heavy-voices` (eller via Cloudflare-dashboarden)
4. Koppla GitHub-repot till Cloudflare Pages-projektet
5. Peka heavyvoices.se DNS mot Cloudflare (nameserver-byte hos Loopia)

Se `CLAUDE.md` för fullständig projektkontext.
