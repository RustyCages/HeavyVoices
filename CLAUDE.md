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
Ingen `choir-[slug]`-prefixning (till skillnad från ChoirStudio).

- **Cloudflare R2** (bucket `heavy-voices`): stämmor (`stems/…`) och uppvärmningsvideor (`warmup/…`).
  `js/supabase-config.js` pekar om `supabaseClient.storage.from('heavy-voices-stems' | 'heavy-voices-warmup')`
  till Edge Function `r2-files`, med samma API som Supabase Storage. Sidorna anropar Storage som vanligt.
  Sökvägarna i databasen är relativa till bucketen, precis som förut.
  Skrivrätt: stems = admin eller stämledare, warmup = admin. Läsrätt: godkända medlemmar.
- **Supabase Storage**: `heavy-voices-noter`, `heavy-voices-filer`, `heavy-voices-recordings`.
  Undantag: Party Mode-media (`heavy-voices-stems/party/…` – fyrverkerivideor, smällar, intromusik) ligger kvar i
  Supabase Storage. Wrappern skickar sökvägar under `party/` dit. Töm alltså inte `party/` i stems-bucketen.
- R2-secrets i Supabase: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- `r2-migrate` kopierade befintliga filer (okt 2026). Gamla Supabase-bucketarna för stems/warmup töms när R2 är verifierat.

## Arbetsrutin (för alla verktyg/chattar)
Supabase-projekt: `scfudeyozwedohujsoua` ("heavy-voices").

**Databasändringar**
- Varje ändring i databasen skrivs som en fil i `supabase/migrations/`, namnad `YYYY-MM-DD_namn.sql`. Använd `drop policy if exists` före `create policy` så filen går att köra om.
- Kör SQL:en i Supabase SQL Editor (eller via verktyget `apply_migration` om det är godkänt). Verifiera med en SELECT.
- Pusha inte frontend som förutsätter en kolumn/policy förrän SQL:en är körd, annars kan inloggningen eller sidorna gå sönder.
- Edge Functions (`supabase/functions/*`) driftsätts separat från git. Ändrad kod gäller inte förrän den är deployad.

**Roller**
- `members.role`: `admin` eller `medlem`. Boolean `members.stamledare` ger stämledare (medlem + flagga).
- Hjälpfunktioner i RLS: `is_admin()`, `is_song_editor()` (admin eller stämledare), `is_approved_member()`.
- Stämledare har samma rättigheter som admin på Repertoar, Studio, Röstövning, Öva & spela, Information och Partyläget, men inte på Medlemmar, Kalender eller Medlemsvyn.
- I frontend: `requireAuth('admin' | 'stamledare')` i `js/auth.js`, och `isSongEditor(member)` för låtverktyg.

**Git och deploy**
- Pusha till `main` → heavyvoices.se (Cloudflare Pages). `dev` → dev.heavyvoices.se.
- Dra ner senaste `main` (`git pull --rebase`) före push. Flera chattar kan röra samma fil, t.ex. `admin/index.html`.
- Commit-meddelanden slutar med trailers för Claude-sessionen, se commit-historiken.

**Vanliga platser**
- Admin-meny: `admin/index.html`. Medlems-meny: `medlem/index.html`.
- Brevmallar ligger under Medlemmar (`admin/brevmallar.html`, tabell `letter_templates`).
- Information: `admin/info.html` och `medlem/info.html` (tabell `choir_info`, kolumnen `upcoming` för "På gång").
- Partyläget: `medlem/party*.html`, `js/party.js`, tabellerna `party_settings` och `party_videos`.

**Testning**
- Ingen byggprocess. Öppna sidan i webbläsaren, eller testa med Playwright mot Supabase-stubbar. Kontrollera JS med `node --check` på skriptdelen.

## Att göra
- [ ] Skapa Supabase-projekt, klistra in URL + anon key i js/supabase-config.js
- [ ] Skapa GitHub-repo, koppla Cloudflare Pages
- [ ] DNS: nameservers hos Loopia → Cloudflare
- [ ] Bygg ut admin/medlem-vyer med faktisk funktionalitet
