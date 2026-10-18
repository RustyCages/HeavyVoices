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

  return member;
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
