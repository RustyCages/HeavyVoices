# Heavy Voices — projektkontext

## Vad detta är
Fristående webbplats + medlemsportal för kören **Heavy Voices**.
Domän: heavyvoices.se (Loopia, DNS via Cloudflare).

**Viktigt:** Detta är INTE en tenant i ChoirStudio. Helt separat repo, eget
Supabase-projekt, egen Cloudflare Pages-deploy. Single-tenant — bara EN kör,
alltså ingen `choir_slug`-routing eller per-choir-isolering någonstans i
koden. Om du (Claude Code) ser dig frestad att lägga till multi-tenant-logik:
gör det inte, det är en medveten förenkling jämfört med ChoirStudio.

## Stack
- Vanilla JS, inga bundlers, inga npm-beroenden i frontend (single-file-stil
  per vy, samma mönster som choir-mixer-online.html i ChoirStudio)
- Supabase: Auth, Postgres, Storage, RLS, Edge Functions vid behov
- Cloudflare Pages för hosting, GitHub Actions för deploy
  - main → heavyvoices.se
  - dev → dev.heavyvoices.se

## Struktur
```
/                   Publik landningssida (om kören, kontakt, spelningar)
/admin/             Admin-vy (låst bakom auth, roll=admin)
/medlem/            Medlemsvy (låst bakom auth, roll=medlem eller admin)
/js/                Delad JS (supabase-config.js, auth-helpers)
/css/               Delad styling
/supabase/          SQL-scheman, RLS-policies, Edge Functions
```

## Databas (planerad)
- `members` — id, email, name, role ('admin' | 'medlem'), created_at
- `songs` — samma kolumnmönster som ChoirStudio: lyrics_plain, lyrics_lrc,
  lyrics_lrc_words
- `setlists` — om SetlistStudio-funktionen återanvänds senare

RLS: enkel rollcheck (admin/medlem), INGEN `get_my_choir_role()`-funktion
behövs eftersom det bara finns en kör.

## Storage
En bucket: `heavy-voices-stems`. Ingen `choir-[slug]`-prefixning
(till skillnad från ChoirStudio).

## Att göra
- [ ] Skapa Supabase-projekt, klistra in URL + anon key i js/supabase-config.js
- [ ] Skapa GitHub-repo, koppla Cloudflare Pages
- [ ] DNS: nameservers hos Loopia → Cloudflare
- [ ] Bygg ut admin/medlem-vyer med faktisk funktionalitet
