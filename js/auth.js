// Delade auth-helpers. Kräver att supabase-config.js laddats först.

// Inloggade sidor får bredare layout på dator (se html.app-wide i style.css)
if (/^\/(admin|medlem)(\/|$)/.test(location.pathname)) document.documentElement.classList.add('app-wide');

async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  try { sessionStorage.removeItem('hvNoticeSeen'); sessionStorage.removeItem('hvIntroSeen'); } catch (e) {}
  return data;
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = '/';
}

async function getCurrentMember() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabaseClient
    .from('members')
    .select('id, name, role, status, stamledare')
    .eq('id', user.id)
    .single();

  if (error) return null;
  return data;
}

// Admin eller stämledare = får redigera låtar/stämspår (Repertoar, Studio, Röstövning)
function isSongEditor(m) { return !!m && (m.role === 'admin' || m.stamledare === true); }

// Anropa i toppen av admin/medlem-sidor. requiredRole: 'admin' | 'medlem' | null (valfri roll)
async function requireAuth(requiredRole = null) {
  const member = await getCurrentMember();

  if (!member) {
    // i en installerad app (t.ex. Bergsprängaren/Rock-TV) – kom tillbaka hit efter inloggningen
    try {
      if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) sessionStorage.setItem('hv-after-login', location.pathname + location.search);
    } catch (_) {}
    window.location.href = '/logga-in.html';
    return null;
  }

  if (member.status !== 'approved') {
    window.location.href = '/vantar.html';
    return null;
  }

  if (requiredRole === 'admin' && member.role !== 'admin') {
    window.location.href = '/medlem/';
    return null;
  }

  if (requiredRole === 'stamledare' && !isSongEditor(member)) {
    window.location.href = '/medlem/';
    return null;
  }

  showRoleStrip(member);
  showTabbar(member);
  return member;
}

// Stramt utseende (test): flikrad längst ner på mobil på de enklare medlemssidorna.
// Inte på Repertoar (spelaren ligger där), Röstövning, Studio, party eller inbäddade vyer.
function showTabbar(member) {
  try {
    if (document.documentElement.getAttribute('data-ui') !== 'stram') return;
    if (window.top !== window || /[?&]embed\b/.test(location.search)) return;
    const p = location.pathname;
    if (!/^\/medlem\/(index\.html)?$|^\/medlem\/(kalender|forum|info|uppvarmning|tonmatare)\.html$|^\/konto\.html$/.test(p)) return;
    if (document.querySelector('.ui-tabbar')) return;
    const home = member && member.role === 'admin' ? '/admin/' : '/medlem/';
    const ic = {
      home: '<path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
      ova: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
      cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
      more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
    };
    const tabs = [
      ['Hem', home, ic.home, /^\/medlem\/(index\.html)?$/.test(p) && !location.hash],
      ['Öva', '/medlem/repertoar.html?tab=repertoar', ic.ova, /uppvarmning|tonmatare/.test(p)],
      ['Kalender', '/medlem/kalender.html', ic.cal, /kalender/.test(p)],
      ['Mer', '/medlem/#mer', ic.more, /forum|info|konto/.test(p)]
    ];
    const add = () => {
      const nav = document.createElement('nav');
      nav.className = 'ui-tabbar';
      nav.setAttribute('aria-label', 'Huvudnavigering');
      nav.innerHTML = tabs.map(t => '<a href="' + t[1] + '"' + (t[3] ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t[2] + '</svg><span>' + t[0] + '</span></a>').join('');
      document.body.appendChild(nav);
      document.documentElement.classList.add('has-tabbar');
    };
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  } catch (_) {}
}

// Guldrand överst på alla sidor för admin och stämledare: "⚙ Adminläge · Namn".
// Visas inte i partyläget, i inbäddade vyer (iframe / ?embed) eller i fristående appfönster för party.
function showRoleStrip(member) {
  try {
    if (!member || !isSongEditor(member)) return;
    if (window.top !== window || /[?&]embed\b/.test(location.search) || /\/party/.test(location.pathname)) return;
    if (document.querySelector('.role-strip')) return;
    const add = () => {
      const a = document.createElement('a');
      a.className = 'role-strip';
      a.href = '/admin/';
      a.setAttribute('data-no-transition', '');
      a.title = 'Du är inloggad med ' + (member.role === 'admin' ? 'admin' : 'stämledar') + 'behörighet – tryck för att gå till adminsidan';
      const first = String(member.name || '').trim().split(/\s+/)[0];
      a.innerHTML = '<b>⚙ ' + (member.role === 'admin' ? 'Adminläge' : 'Stämledarläge') + '</b>' + (first ? '<span>· ' + first.replace(/[&<>"']/g, '') + '</span>' : '');
      document.body.prepend(a);
      document.documentElement.style.setProperty('--strip-h', a.offsetHeight + 'px');   // sticky-element på sidan hamnar under randen
    };
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  } catch (_) {}
}


// Mjuk utton vid sidbyte: tona ut sidan innan länken följs (inton sker i css/style.css)
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-no-transition')) return;
    var u;
    try { u = new URL(a.href, location.href); } catch (_) { return; }
    if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return;
    if (u.pathname === location.pathname && u.search === location.search) return; // bara #-hopp eller samma sida
    e.preventDefault();
    document.body.style.transition = 'opacity 0.22s ease-in';
    document.body.style.opacity = '0';
    var go = function () { location.href = u.href; };
    setTimeout(go, 230);
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { document.body.style.transition = ''; document.body.style.opacity = ''; }
  });
})();

// Temafärgade listor (select) på mobil – laddas på alla sidor som använder auth.js
(function () {
  if (window.__themeSelectLoaded) return; window.__themeSelectLoaded = true;
  var s = document.createElement('script'); s.src = '/js/theme-select.js'; s.defer = true;
  (document.head || document.documentElement).appendChild(s);
})();
