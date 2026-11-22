// info.heavyvoices.se → mappen /info/ i huvudsajten (Workern "heavy-voices").
// Fristående Worker med en service binding (SITE) till heavy-voices, så att huvudsajten inte behöver ändras.
//   info.heavyvoices.se/            → heavy-voices /info/
//   info.heavyvoices.se/info.css    → heavy-voices /info/info.css
// Bara /info/ nås härifrån – resten av sajten (medlem, admin …) går inte att öppna via subdomänen.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
    let path = url.pathname.replace(/\/{2,}/g, '/');
    if (path === '/info' || path.startsWith('/info/')) path = path.slice(5) || '/';   // gamla länkar med /info/ i adressen
    if (/(^|\/)\.\.(\/|$)/.test(path)) return new Response('Bad Request', { status: 400 });
    const target = new URL('https://heavyvoices.se/info' + path + url.search);
    const res = await env.SITE.fetch(new Request(target, { method: request.method, headers: request.headers, redirect: 'manual' }));
    const out = new Response(res.body, res);
    const loc = res.headers.get('location');
    if (loc) {   // t.ex. /info/index.html → /info/ : skriv om till subdomänens adresser
      const l = new URL(loc, target);
      if (l.hostname === 'heavyvoices.se' && (l.pathname === '/info' || l.pathname.startsWith('/info/'))) {
        out.headers.set('location', (l.pathname.slice(5) || '/') + l.search);
      }
    }
    out.headers.set('X-Robots-Tag', 'all');
    return out;
  },
};
