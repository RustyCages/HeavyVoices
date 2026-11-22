// Heavy Voices – publik info-sajt. Läser bara publicerade sidor och nyheter (RLS släpper inget annat till besökare).
// Ingen inloggning här: innehållet redigeras i admin (heavyvoices.se/admin/hemsida.html).
// Adresser:  ./            startsida (introtext + senaste nyheterna)
//            ?nyheter      alla nyheter
//            ?n=<slug>     en nyhet
//            ?s=<slug>     en sida
(function () {
  'use strict';
  var SUPABASE_URL = 'https://scfudeyozwedohujsoua.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_lQf4A7LCOH42d_Di-B7oiw_1JzB_2sh';
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  var view = document.getElementById('view');
  var loading = document.getElementById('loading');
  document.getElementById('year').textContent = new Date().getFullYear();

  var menuBtn = document.getElementById('menuBtn'), nav = document.getElementById('nav');
  menuBtn.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(d) { try { return new Date(d).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' }); } catch (e) { return ''; } }
  function safeUrl(u) { return /^https:\/\//i.test(u || '') ? u : ''; }

  // Rensa HTML från redigeraren: bara ofarliga taggar, YouTube/Vimeo-iframes tillåts
  if (window.DOMPurify) {
    DOMPurify.addHook('uponSanitizeElement', function (node, data) {
      if (data.tagName === 'iframe') {
        var src = node.getAttribute('src') || '';
        if (!/^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(src)) node.parentNode && node.parentNode.removeChild(node);
      }
    });
    DOMPurify.addHook('afterSanitizeAttributes', function (node) {
      if (node.tagName === 'A' && node.getAttribute('href') && /^https?:/i.test(node.getAttribute('href'))) {
        node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  function clean(html) {
    if (!window.DOMPurify) return esc(String(html || '').replace(/<[^>]*>/g, ' '));
    return DOMPurify.sanitize(html || '', {
      ADD_TAGS: ['iframe'], ADD_ATTR: ['allowfullscreen', 'frameborder', 'target', 'data-list'],
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'script'], FORBID_ATTR: ['style']
    });
  }

  function setTitle(t) { document.title = t ? t + ' – Heavy Voices' : 'Heavy Voices – rockkör i Stockholm'; }
  function setCurrent(key) {
    nav.querySelectorAll('a').forEach(function (a) { if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  function done(html) { loading.hidden = true; view.innerHTML = html; nav.classList.remove('open'); window.scrollTo(0, 0); }
  function fail(msg) { done('<div class="article"><h1>Hoppsan</h1><p>' + esc(msg) + '</p><a href="./">Till startsidan</a></div>'); }

  function postCard(p) {
    var img = safeUrl(p.image_url);
    return '<a class="post-card" href="?n=' + encodeURIComponent(p.slug) + '">' +
      (img ? '<div class="img" style="background-image:url(\'' + esc(img).replace(/'/g, '%27') + '\')" role="img" aria-label=""></div>' : '') +
      '<div class="body"><span class="date">' + esc(fmtDate(p.published_at)) + '</span><h3>' + esc(p.title) + '</h3>' +
      (p.excerpt ? '<p>' + esc(p.excerpt) + '</p>' : '') + '</div></a>';
  }

  async function loadMenu() {
    var r = await sb.from('site_pages').select('slug, title').eq('published', true).eq('show_in_menu', true).neq('slug', 'start').order('sort').order('title');
    if (r.error || !r.data) return;
    document.getElementById('navPages').innerHTML = r.data.map(function (p) {
      return '<a href="?s=' + encodeURIComponent(p.slug) + '" data-nav="s:' + esc(p.slug) + '">' + esc(p.title) + '</a>';
    }).join('');
  }

  async function showStart() {
    setTitle(''); setCurrent('start');
    var res = await Promise.all([
      sb.from('site_pages').select('title, body_html').eq('slug', 'start').eq('published', true).maybeSingle(),
      sb.from('site_posts').select('slug, title, excerpt, image_url, published_at').eq('published', true).lte('published_at', new Date().toISOString()).order('published_at', { ascending: false }).limit(6)
    ]);
    var start = res[0].data, posts = res[1].data || [];
    var html = '<section class="hero"><picture><source srcset="img/logo.webp" type="image/webp"><img class="logo" src="img/logo.png" alt="Heavy Voices" width="640" height="493"></picture>' +
      (start ? '<div class="intro content">' + clean(start.body_html) + '</div>' : '') + '</section>';
    html += '<h2>Nyheter</h2>' + (posts.length ? '<div class="posts">' + posts.map(postCard).join('') + '</div>' + (posts.length >= 6 ? '<a class="more" href="?nyheter">Alla nyheter →</a>' : '') : '<p class="muted">Inga nyheter än.</p>');
    done(html);
  }

  async function showNewsList() {
    setTitle('Nyheter'); setCurrent('nyheter');
    var r = await sb.from('site_posts').select('slug, title, excerpt, image_url, published_at').eq('published', true).lte('published_at', new Date().toISOString()).order('published_at', { ascending: false }).limit(200);
    if (r.error) return fail('Nyheterna kunde inte hämtas just nu.');
    done('<h1>Nyheter</h1>' + (r.data.length ? '<div class="posts">' + r.data.map(postCard).join('') + '</div>' : '<p class="muted">Inga nyheter än.</p>'));
  }

  async function showPost(slug) {
    setCurrent('nyheter');
    var r = await sb.from('site_posts').select('title, excerpt, body_html, image_url, published_at').eq('slug', slug).eq('published', true).maybeSingle();
    if (r.error || !r.data) return fail('Nyheten finns inte (längre).');
    var p = r.data, img = safeUrl(p.image_url);
    setTitle(p.title);
    done('<a class="back" href="?nyheter">← Alla nyheter</a><article class="article">' +
      (img ? '<img class="cover" src="' + esc(img) + '" alt="">' : '') +
      '<span class="date">' + esc(fmtDate(p.published_at)) + '</span><h1>' + esc(p.title) + '</h1>' +
      '<div class="content">' + clean(p.body_html) + '</div></article>');
  }

  async function showPage(slug) {
    setCurrent('s:' + slug);
    var r = await sb.from('site_pages').select('title, body_html').eq('slug', slug).eq('published', true).maybeSingle();
    if (r.error || !r.data) return fail('Sidan finns inte.');
    setTitle(r.data.title);
    done('<article class="article"><h1>' + esc(r.data.title) + '</h1><div class="content">' + clean(r.data.body_html) + '</div></article>');
  }

  function route() {
    var q = new URLSearchParams(location.search);
    var p;
    if (q.get('n')) p = showPost(q.get('n'));
    else if (q.get('s')) p = (q.get('s') === 'start' ? showStart() : showPage(q.get('s')));
    else if (q.has('nyheter')) p = showNewsList();
    else p = showStart();
    p.catch(function () { fail('Något gick fel. Försök igen om en stund.'); });
  }

  loadMenu().then(function () { var q = new URLSearchParams(location.search); setCurrent(q.get('s') ? 's:' + q.get('s') : q.get('n') || q.has('nyheter') ? 'nyheter' : 'start'); });
  route();
})();
