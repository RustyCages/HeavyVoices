// Känner av om sidan visas på en mobil (liten skärm + pekskärm) och sätter klassen
// html.is-phone. Element med klassen .desktop-only döljs då, och element med
// .desktop-note (en kort förklaring) visas i stället. "Visa ändå" sparas på enheten, och "Dölj dem igen" tar bort valet.
//
//   <script src="/js/device.js"></script>   (i <head>, så att inget hinner blinka)
//   <div class="desktop-only">…verktyg för dator…</div>
//   <p class="desktop-note">Visas på dator. <button data-device-show>Visa ändå</button></p>
(function (root) {
  const KEY = 'hv-force-desktop';
  const html = document.documentElement;
  const st = document.createElement('style');
  st.textContent = `
  html.is-phone .desktop-only { display: none !important; }
  .desktop-note { display: none; }
  html.is-phone .desktop-note { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; margin: 0.6rem 0; padding: 0.5rem 0.7rem;
    border: 1px dashed var(--border, rgba(255,255,255,0.15)); border-radius: 0.5rem; font-size: 0.82rem; color: var(--text-muted, #9ca3af); }
  html.is-phone .desktop-note button { font-size: 0.78rem; padding: 0.25rem 0.6rem; }
  .desktop-hide { display: none; }
  html.phone-forced .desktop-hide { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; margin: 0.6rem 0; padding: 0.4rem 0.7rem;
    border: 1px dashed var(--border, rgba(255,255,255,0.15)); border-radius: 0.5rem; font-size: 0.8rem; color: var(--text-muted, #9ca3af); }
  html.phone-forced .desktop-hide button { font-size: 0.78rem; padding: 0.25rem 0.6rem; }`;
  document.head.appendChild(st);

  const forced = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const phoneLike = () => matchMedia('(max-width: 820px)').matches && matchMedia('(pointer: coarse)').matches;
  function update() {
    html.classList.toggle('is-phone', phoneLike() && !forced());
    html.classList.toggle('phone-forced', phoneLike() && forced());   // mobil där datorverktygen visas ändå → "Dölj igen"
  }
  // bredvid varje "visas bara på dator"-ruta: en ruta för att dölja verktygen igen (syns bara när de visas på mobil)
  function addHideNotes(rootEl) {
    (rootEl.querySelectorAll ? rootEl.querySelectorAll('.desktop-note') : []).forEach(n => {
      if (n._hideNote) return;
      const h = document.createElement('p'); n._hideNote = h;
      h.className = 'desktop-hide' + (n.classList.contains('admin-only') ? ' admin-only' : '');
      h.innerHTML = '🖥 Datorverktygen visas på mobilen. <button type="button" class="btn-outline" data-device-hide>Dölj dem igen</button>';
      // överst bland datorverktygen (före de .desktop-only-rader som står precis före rutan)
      let at = n; while (at.previousElementSibling && at.previousElementSibling.classList.contains('desktop-only')) at = at.previousElementSibling;
      at.before(h);
    });
  }
  const watch = () => {
    addHideNotes(document);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(x => { if (x.nodeType === 1) addHideNotes(x.parentNode || x); }))).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
  update();
  ['(max-width: 820px)', '(pointer: coarse)'].forEach(q => {
    const m = matchMedia(q);
    if (m.addEventListener) m.addEventListener('change', update); else if (m.addListener) m.addListener(update);
  });
  // "Visa ändå" – på mobilen, för den som vill
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-device-show]'); if (!b) return;
    try { localStorage.setItem(KEY, '1'); } catch (err) {}
    update();
    window.dispatchEvent(new Event('resize'));   // canvas och tidslinjer ritas om i rätt storlek
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-device-hide]')) return;
    try { localStorage.removeItem(KEY); } catch (err) {}
    update();
    window.dispatchEvent(new Event('resize'));
  });
  root.Device = {
    get isPhone() { return html.classList.contains('is-phone'); },
    reset() { try { localStorage.removeItem(KEY); } catch (e) {} update(); },
  };
})(window);
