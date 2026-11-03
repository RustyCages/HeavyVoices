// Nödstopp (killswitch) för heavyvoices.se – Cloudflare Pages Function som körs före varje sida.
//  • Mjukt läge: admin trycker "Stäng sajten" i adminvyn → site_status.closed = true i Supabase.
//    Alla sidor visar då stängt-sidan, utom inloggning och /admin/ (så att admin kan öppna igen).
//  • Hårt läge: miljövariabeln SITE_CLOSED = 1 i Cloudflare Pages (Settings → Variables) stänger
//    ALLA sidor, även admin – för nödlägen när Supabase inte går att lita på. Kräver ny deploy.
// Om Supabase inte svarar hålls sajten öppen (fail open), så att ett Supabase-avbrott inte stänger sajten.
const SUPABASE_URL = 'https://scfudeyozwedohujsoua.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lQf4A7LCOH42d_Di-B7oiw_1JzB_2sh';
// sidor som alltid går att nå i mjukt läge
const OPEN = /^\/(admin(\/|$)|logga-in|aterstall-losenord|satt-losenord|stangd)(\.html)?/;

let memo = { at: 0, closed: false };
async function softClosed() {
  if (Date.now() - memo.at < 3000) return memo.closed;   // max 3 s gammalt svar
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/site_status?id=eq.1&select=closed`, {
      headers: { apikey: SUPABASE_KEY, Accept: 'application/json' },
    });
    if (r.ok) { const j = await r.json(); memo = { at: Date.now(), closed: !!(j[0] && j[0].closed) }; }
    else memo = { at: Date.now(), closed: memo.closed };
  } catch (e) { memo = { at: Date.now(), closed: memo.closed }; }
  return memo.closed;
}

const FALLBACK = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stängt – Heavy Voices</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121418;color:#f3f4f6;
font-family:system-ui,sans-serif;text-align:center;padding:1.5rem}h1{color:#E5A968}</style></head>
<body><div><h1>Heavy Voices är tillfälligt stängt</h1><p>Försök igen senare.</p></div></body></html>`;

async function closedPage(ctx, url) {
  let body = FALLBACK;
  try {
    let r = await ctx.env.ASSETS.fetch(new URL('/stangd', url));
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) r = await ctx.env.ASSETS.fetch(new URL(r.headers.get('location'), url));
    if (r.ok) body = await r.text();
  } catch (e) {}
  return new Response(body, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '600' } });
}

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  const p = url.pathname;
  const last = p.split('/').pop();
  const isPage = (ctx.request.method === 'GET' || ctx.request.method === 'HEAD') && (p.endsWith('/') || last.endsWith('.html') || !last.includes('.'));
  if (!isPage) return ctx.next();                       // bilder, skript, ljud m.m. går alltid igenom
  const hard = /^(1|true|ja|yes)$/i.test(String(ctx.env.SITE_CLOSED || ''));
  if (hard) return /^\/stangd(\.html)?$/.test(p) ? ctx.next() : closedPage(ctx, url);
  if (OPEN.test(p)) return ctx.next();
  if (await softClosed()) return closedPage(ctx, url);
  const res = await ctx.next();
  return res;
}
