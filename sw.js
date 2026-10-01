// Heavy Voices service worker – medvetet minimal.
// Den cachar INGENTING (så att nya versioner av sidan alltid syns direkt), den visar bara
// en vänlig sida när man öppnar appen utan nätverk. Krävs för att appen ska gå att installera.
const OFFLINE_HTML = `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ingen anslutning – Heavy Voices</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#121418;color:#f3f4f6;font-family:system-ui,sans-serif;text-align:center;padding:1.5rem}
h1{color:#E5A968;font-size:1.4rem}button{margin-top:1rem;background:#E5A968;color:#111317;border:0;
border-radius:.5rem;padding:.7rem 1.4rem;font-weight:600;font-size:1rem}</style></head>
<body><div><h1>Ingen internetanslutning</h1><p>Heavy Voices behöver nätet för att hämta låtar och kalender.</p>
<button onclick="location.reload()">Försök igen</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // allt annat (ljud, Supabase, bilder) går direkt till nätet
  event.respondWith(
    fetch(event.request).catch(() =>
      new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
  );
});
