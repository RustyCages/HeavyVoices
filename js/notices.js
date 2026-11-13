// Popup-meddelanden som admin styr från admin/meddelanden.html (tabellen site_notices).
// Visas som en ruta ovanpå sidan; vilka sidor, vem som ser dem och hur ofta bestäms per meddelande.
// Laddas av auth.js. På inloggade sidor startas det av requireAuth; på inloggningssidan startar det själv.
(function () {
  const PAGES = {
    '/logga-in.html': 'logga-in',
    '/medlem/': 'medlem-hem', '/medlem/index.html': 'medlem-hem',
    '/medlem/kalender.html': 'kalender', '/medlem/forum.html': 'forum', '/medlem/repertoar.html': 'repertoar',
    '/medlem/rostovning.html': 'rostovning', '/medlem/studio.html': 'studio', '/medlem/info.html': 'info'
  };
  const TONES = { info: '#E5A968', varning: '#facc15', viktigt: '#ef4444' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bodyHtml = t => String(t || '').split(/\n{2,}/).map(p => '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>').filter(p => p !== '<p></p>').join('');

  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    const st = document.createElement('style');
    st.textContent = `
      .hvn-back { opacity: 0; transition: opacity 0.35s ease; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
      .hvn-back.show { opacity: 1; }
      .hvn-box { background: var(--bg, #121418); color: var(--text, #f3f4f6); border: 1px solid var(--border, rgba(255,255,255,0.08)); border-top: 4px solid var(--hvn, #E5A968); border-radius: 1rem; max-width: 440px; width: 100%; max-height: 90vh; overflow-y: auto; padding: 1.5rem 1.4rem 1.2rem; box-shadow: 0 20px 60px rgba(0,0,0,0.5); transform: translateY(14px) scale(0.96); transition: transform 0.4s cubic-bezier(.2,.8,.2,1); }
      .hvn-back.show .hvn-box { transform: none; }
      .hvn-box h3 { margin: 0 0 0.7rem; font-size: 1.35rem; }
      .hvn-box p { margin: 0 0 0.8rem; color: var(--text-muted, #9ca3af); font-size: 1rem; line-height: 1.5; }
      .hvn-box button { width: 100%; justify-content: center; margin-top: 0.4rem; padding: 0.7rem 1rem; border: 0; border-radius: 0.6rem; background: var(--hvn, #E5A968); color: #111317; font-weight: 700; font-size: 1rem; cursor: pointer; }
      .hvn-box button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      .hvn-count { margin: 0.7rem 0 0; font-size: 0.8rem; text-align: center; color: var(--text-muted, #9ca3af); }
      @media (prefers-reduced-motion: reduce) { .hvn-back, .hvn-box { transition: none; } }`;
    document.head.appendChild(st);
  }

  // visar ett meddelande; löser sig när det stängts
  function showOne(n, idx, total) {
    css();
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'hvn-back';
      wrap.style.setProperty('--hvn', TONES[n.tone] || TONES.info);
      wrap.innerHTML = `<div class="hvn-box" role="dialog" aria-modal="true" aria-labelledby="hvnTitle">
        <h3 id="hvnTitle">${n.icon ? esc(n.icon) + ' ' : ''}${esc(n.title)}</h3>
        ${bodyHtml(n.body)}
        <button type="button" id="hvnOk">${esc(n.button_text || 'Uppfattat!')}</button>
        ${total > 1 ? `<p class="hvn-count">${idx + 1} av ${total}</p>` : ''}
      </div>`;
      const close = () => { document.removeEventListener('keydown', onKey); wrap.classList.remove('show'); setTimeout(() => { wrap.remove(); resolve(); }, 350); };
      const onKey = e => { if (e.key === 'Escape') close(); };
      wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
      wrap.querySelector('#hvnOk').addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('show')));
      wrap.querySelector('#hvnOk').focus();
    });
  }

  const seenKey = n => 'hv-notice-' + n.id + '-' + n.updated_at;
  function alreadySeen(n) {
    try {
      if (n.frequency === 'once') return !!localStorage.getItem(seenKey(n));
      if (n.frequency === 'session') return !!sessionStorage.getItem('hv-notice-s-' + n.id + '-' + n.updated_at);
    } catch (e) {}
    return false;
  }
  function markSeen(n) {
    try {
      if (n.frequency === 'once') localStorage.setItem(seenKey(n), '1');
      else if (n.frequency === 'session') sessionStorage.setItem('hv-notice-s-' + n.id + '-' + n.updated_at, '1');
    } catch (e) {}
  }

  let started = false;
  async function run(member) {
    if (started) return;
    const page = PAGES[location.pathname];
    if (!page || !window.supabaseClient) return;
    if (window.top !== window || /[?&]embed\b/.test(location.search)) return;
    started = true;
    try {
      const { data, error } = await window.supabaseClient.from('site_notices')
        .select('id, title, body, icon, tone, button_text, pages, audience, frequency, updated_at, sort_order, created_at')
        .contains('pages', [page]).order('sort_order').order('created_at');
      if (error || !data) return;
      const isAdmin = !!(member && member.role === 'admin');
      const list = data.filter(n => (n.audience !== 'medlemmar' || !isAdmin) && !alreadySeen(n));
      if (list.length && document.documentElement.classList.contains('intro')) await new Promise(r => setTimeout(r, 2600));   // vänta ut startanimationen
      for (let i = 0; i < list.length; i++) { markSeen(list[i]); await showOne(list[i], i, list.length); }
    } catch (e) { /* meddelanden är aldrig viktigare än sidan */ }
  }

  window.HVNotices = { run, preview: n => showOne(n, 0, 1), pages: PAGES };
  document.addEventListener('hv-member', e => run(e.detail));
  if (window.__hvNoticeMember) run(window.__hvNoticeMember);
  else if (location.pathname === '/logga-in.html') {
    const go = () => run(null);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();
