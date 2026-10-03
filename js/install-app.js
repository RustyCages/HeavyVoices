// "Installera appen"-knapp för Heavy Voices.
// Lägg <div data-install-app></div> där knappen ska synas och inkludera
// <script src="/js/install-app.js" defer></script>. Skriptet:
//  - lägger till manifest/ikoner i <head> om de saknas och registrerar service workern
//  - Android/Chrome/Edge: knappen öppnar systemets egen installationsruta (ett tryck)
//  - iPhone/iPad: knappen visar en kort guide (Dela → Lägg till på hemskärmen) – Apple tillåter inget annat
//  - döljer knappen när sidan redan körs som installerad app
(function () {
  // ---------- Head-taggar (om sidan inte redan har dem) ----------
  const head = document.head;
  function ensure(selector, create) { if (!head.querySelector(selector)) head.appendChild(create()); }
  function el(tag, attrs) { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; }
  ensure('link[rel="icon"][sizes="32x32"]', () => el('link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icons/favicon-32.png' }));
  ensure('link[rel="icon"][sizes="96x96"]', () => el('link', { rel: 'icon', type: 'image/png', sizes: '96x96', href: '/icons/favicon-96.png' }));
  ensure('link[rel="manifest"]', () => el('link', { rel: 'manifest', href: '/manifest.webmanifest' }));
  ensure('meta[name="theme-color"]', () => el('meta', { name: 'theme-color', content: '#121418' }));
  ensure('link[rel="apple-touch-icon"]', () => el('link', { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }));
  ensure('meta[name="apple-mobile-web-app-capable"]', () => el('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }));
  ensure('meta[name="apple-mobile-web-app-title"]', () => el('meta', { name: 'apple-mobile-web-app-title', content: 'Heavy Voices' }));
  ensure('meta[name="apple-mobile-web-app-status-bar-style"]', () => el('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }));

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  // ---------- Vilken miljö? ----------
  const ua = navigator.userAgent;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isInAppBrowser = /FBAN|FBAV|Instagram|Messenger|Line\/|Snapchat/i.test(ua); // kan inte installera härifrån
  const isIOSChrome = isIOS && /CriOS/.test(ua);

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // visa vår egen knapp i stället för webbläsarens banner
    deferredPrompt = e;
    render();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; render(); });

  // ---------- Stil ----------
  const style = document.createElement('style');
  style.textContent = `
    .install-app-btn { display:inline-flex; align-items:center; gap:0.5rem; }
    .install-app-btn svg { width:18px; height:18px; }
    .ia-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:2000; display:flex; align-items:flex-end; justify-content:center; padding:1rem; }
    .ia-sheet { background:var(--bg, #121418); color:var(--text, #f3f4f6); border:1px solid var(--border, rgba(255,255,255,0.08)); border-radius:1rem; width:100%; max-width:420px; padding:1.25rem 1.25rem 1rem; box-shadow:0 10px 40px rgba(0,0,0,0.6); margin-bottom:env(safe-area-inset-bottom, 0); }
    .ia-sheet h3 { margin:0 0 0.25rem; font-size:1.2rem; }
    .ia-sheet p { margin:0.25rem 0 0.9rem; color:var(--text-muted, #9ca3af); font-size:0.9rem; }
    .ia-steps { list-style:none; padding:0; margin:0 0 1rem; counter-reset:step; }
    .ia-steps li { counter-increment:step; display:flex; align-items:center; gap:0.75rem; padding:0.6rem 0; border-top:1px solid var(--border, rgba(255,255,255,0.08)); font-size:0.95rem; }
    .ia-steps li:first-child { border-top:none; }
    .ia-steps li::before { content:counter(step); flex-shrink:0; width:1.6rem; height:1.6rem; border-radius:50%; background:var(--accent, #E5A968); color:#111317; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:0.85rem; }
    .ia-ico { display:inline-flex; vertical-align:middle; color:#0a84ff; }
    .ia-ico svg { width:20px; height:20px; }
    .ia-close { width:100%; justify-content:center; }
    .ia-arrow { text-align:center; font-size:1.6rem; color:var(--accent, #E5A968); animation:ia-bounce 1.2s ease-in-out infinite; margin-top:0.3rem; }
    @keyframes ia-bounce { 0%,100% { transform:translateY(0); } 50% { transform:translateY(6px); } }
    @media (prefers-reduced-motion: reduce) { .ia-arrow { animation:none; } }
  `;
  head.appendChild(style);

  const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 7v8M8.5 11.5 12 15l3.5-3.5"/></svg>';
  const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
  const ICON_ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
  const ICON_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

  // ---------- Guide-ruta ----------
  function showGuide() {
    let title = 'Installera Heavy Voices', intro, steps, arrow = false;
    if (isInAppBrowser) {
      intro = 'Du har öppnat sidan inuti en annan app. Öppna den i telefonens vanliga webbläsare först:';
      steps = [
        `Tryck på menyn (${ICON_DOTS.replace('<svg', '<svg width="16" height="16"')} eller …) i hörnet`,
        `Välj <strong>Öppna i webbläsare</strong> (Safari/Chrome)`,
        'Tryck på <strong>Installera appen</strong> igen där',
      ];
    } else if (isIOS) {
      intro = 'Så lägger du Heavy Voices som en app på hemskärmen – tar 10 sekunder:';
      steps = [
        `Tryck på <span class="ia-ico">${ICON_SHARE}</span> <strong>Dela</strong> ${isIOSChrome ? 'uppe till höger i adressfältet' : 'i verktygsraden längst ner'}`,
        `Scrolla ner och välj <span class="ia-ico">${ICON_ADD}</span> <strong>Lägg till på hemskärmen</strong>`,
        'Tryck <strong>Lägg till</strong> uppe till höger – klart!',
      ];
      arrow = !isIOSChrome; // Safari: Dela-knappen sitter oftast längst ner
    } else if (isAndroid) {
      intro = 'Installera via webbläsarens meny:';
      steps = [
        `Tryck på menyn <span class="ia-ico" style="color:inherit">${ICON_DOTS}</span> uppe till höger`,
        'Välj <strong>Installera app</strong> eller <strong>Lägg till på startskärmen</strong>',
        'Bekräfta med <strong>Installera</strong>',
      ];
    } else {
      intro = 'Leta efter installera-ikonen i adressfältet (Chrome/Edge), eller öppna sidan på mobilen och tryck på Installera appen där.';
      steps = [];
    }
    const wrap = document.createElement('div');
    wrap.className = 'ia-backdrop';
    wrap.innerHTML = `
      <div class="ia-sheet" role="dialog" aria-modal="true" aria-label="${title}">
        <h3>${title}</h3>
        <p>${intro}</p>
        ${steps.length ? `<ol class="ia-steps">${steps.map(s => `<li><span>${s}</span></li>`).join('')}</ol>` : ''}
        <button type="button" class="btn-outline ia-close">Stäng</button>
        ${arrow ? '<div class="ia-arrow" aria-hidden="true">↓</div>' : ''}
      </div>`;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('.ia-close').addEventListener('click', close);
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
    document.body.appendChild(wrap);
  }

  async function onClick() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome !== 'accepted') render(); // knappen kan användas igen (med guide)
      return;
    }
    showGuide();
  }

  // ---------- Rendera knappar ----------
  function render() {
    const show = !isStandalone() && (deferredPrompt || isIOS || isAndroid || isInAppBrowser);
    document.querySelectorAll('[data-install-app]').forEach(slot => {
      slot.hidden = !show;
      if (!show) { slot.innerHTML = ''; return; }
      if (!slot.querySelector('.install-app-btn')) {
        const label = slot.getAttribute('data-install-app') || 'Installera appen';
        slot.innerHTML = `<button type="button" class="btn-outline install-app-btn">${ICON_DOWNLOAD}<span>${label}</span></button>`;
        slot.querySelector('button').addEventListener('click', onClick);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', render);
})();
