// Temafärgad väljare för <select> på mobil/pekskärm.
// Telefonens egen lista (vit ruta med radioknappar) går inte att färga, så på pekskärmar
// öppnas i stället ett eget ark i sidans tema. Värdet sätts på den riktiga <select>:en och
// 'input' + 'change' skickas som vanligt – sidornas kod märker ingen skillnad.
// Undantag: <select multiple>, size > 1, och select med data-native.
(function () {
  if (window.__themeSelect) return; window.__themeSelect = true;
  const touch = () => matchMedia('(pointer: coarse)').matches;

  const css = document.createElement('style');
  css.textContent = `
  .ts-back { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.55); display: flex; align-items: flex-end; justify-content: center;
    opacity: 0; transition: opacity 0.16s ease; }
  .ts-back.open { opacity: 1; }
  .ts-sheet { width: min(560px, 100%); max-height: min(70vh, 560px); display: flex; flex-direction: column; overflow: hidden;
    background: #1b1f27; border: 1px solid rgba(255,255,255,0.1); border-bottom: 0; border-radius: 1rem 1rem 0 0;
    box-shadow: 0 -12px 40px rgba(0,0,0,0.6); transform: translateY(24px); transition: transform 0.18s ease;
    padding-bottom: env(safe-area-inset-bottom, 0px); font-family: 'DM Sans', system-ui, sans-serif; color: #f3f4f6; }
  .ts-back.open .ts-sheet { transform: none; }
  .ts-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.85rem 1.1rem 0.7rem;
    border-bottom: 1px solid rgba(255,255,255,0.08); font-family: 'Roboto Condensed', sans-serif; font-weight: 700; letter-spacing: 0.04em;
    text-transform: uppercase; font-size: 0.85rem; color: #9ca3af; }
  .ts-head button { background: none; border: 0; color: #9ca3af; font-size: 1.3rem; line-height: 1; padding: 0.2rem 0.4rem; cursor: pointer; box-shadow: none; }
  .ts-list { overflow-y: auto; overscroll-behavior: contain; padding: 0.3rem 0 0.5rem; }
  .ts-group { padding: 0.7rem 1.1rem 0.25rem; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #E5A968; }
  .ts-opt { display: flex; align-items: center; gap: 0.8rem; width: 100%; text-align: left; background: none; border: 0; border-radius: 0;
    color: #f3f4f6; font: inherit; font-size: 1.05rem; padding: 0.85rem 1.1rem; cursor: pointer; box-shadow: none; min-height: 3rem; }
  .ts-opt + .ts-opt { border-top: 1px solid rgba(255,255,255,0.05); }
  .ts-opt:active { background: rgba(229,169,104,0.12); }
  .ts-opt .ts-t { flex: 1; min-width: 0; }
  .ts-opt .ts-r { flex: none; width: 1.25rem; height: 1.25rem; border-radius: 50%; border: 2px solid rgba(255,255,255,0.35); display: grid; place-items: center; }
  .ts-opt.sel { color: #E5A968; font-weight: 600; background: rgba(229,169,104,0.08); }
  .ts-opt.sel .ts-r { border-color: #E5A968; }
  .ts-opt.sel .ts-r::after { content: ''; width: 0.62rem; height: 0.62rem; border-radius: 50%; background: #E5A968; }
  .ts-opt:disabled { color: #6b7280; cursor: default; }`;
  document.head.appendChild(css);

  const skip = s => !s || s.multiple || s.size > 1 || s.disabled || s.hasAttribute('data-native');

  // rubrik: etiketten som hör till listan (utan själva listans text)
  function titleFor(sel) {
    let t = sel.getAttribute('aria-label') || '';
    if (!t) {
      const lab = (sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`)) || sel.closest('label');
      if (lab) {
        const c = lab.cloneNode(true);
        c.querySelectorAll('select, input, textarea, button, small').forEach(x => x.remove());
        t = c.textContent.replace(/\s+/g, ' ').trim();
      }
    }
    return t || sel.title || 'Välj';
  }

  let open = null;
  function close() {
    if (!open) return;
    const o = open; open = null;
    o.back.classList.remove('open');
    setTimeout(() => o.back.remove(), 170);
    document.removeEventListener('keydown', onKey, true);
    if (history.state && history.state.__ts) history.back();
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  window.addEventListener('popstate', () => { if (open) { const o = open; open = null; o.back.classList.remove('open'); setTimeout(() => o.back.remove(), 170); } });

  function show(sel) {
    if (open) close();
    const back = document.createElement('div'); back.className = 'ts-back';
    const sheet = document.createElement('div'); sheet.className = 'ts-sheet'; sheet.setAttribute('role', 'listbox');
    const head = document.createElement('div'); head.className = 'ts-head';
    head.innerHTML = '<span></span><button type="button" aria-label="Stäng">✕</button>';
    head.firstChild.textContent = titleFor(sel);
    const list = document.createElement('div'); list.className = 'ts-list';
    let selBtn = null;
    const addOpt = (opt) => {
      if (opt.hidden) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ts-opt' + (opt.selected ? ' sel' : '');
      b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(opt.selected));
      b.disabled = opt.disabled;
      b.innerHTML = '<span class="ts-t"></span><span class="ts-r"></span>';
      b.firstChild.textContent = opt.textContent;
      b.addEventListener('click', () => {
        const changed = sel.value !== opt.value || sel.selectedIndex !== opt.index;
        sel.selectedIndex = opt.index;
        close();
        if (changed) {
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      if (opt.selected) selBtn = b;
      list.appendChild(b);
    };
    [...sel.children].forEach(ch => {
      if (ch.tagName === 'OPTGROUP') {
        const g = document.createElement('div'); g.className = 'ts-group'; g.textContent = ch.label; list.appendChild(g);
        [...ch.children].forEach(addOpt);
      } else if (ch.tagName === 'OPTION') addOpt(ch);
    });
    sheet.append(head, list); back.appendChild(sheet); document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    head.querySelector('button').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    try { history.pushState({ __ts: true }, ''); } catch (e) {}   // telefonens bakåt-knapp stänger arket
    open = { back, sel };
    requestAnimationFrame(() => { back.classList.add('open'); if (selBtn) selBtn.scrollIntoView({ block: 'center' }); });
  }

  // pekskärm: ta över trycket på listan innan telefonens egen lista öppnas
  let start = null;
  document.addEventListener('touchstart', e => {
    const s = e.target.closest && e.target.closest('select');
    start = s && !skip(s) && touch() ? { s, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true, capture: true });
  document.addEventListener('touchend', e => {
    if (!start) return;
    const t = e.changedTouches[0], st = start; start = null;
    if (Math.abs(t.clientX - st.x) > 10 || Math.abs(t.clientY - st.y) > 10) return;   // det var en scroll
    e.preventDefault();   // ingen inbyggd lista
    st.s.blur();
    show(st.s);
  }, { passive: false, capture: true });
  // säkerhetsnät (t.ex. penna/mus på pekskärm): mousedown öppnar också arket
  document.addEventListener('mousedown', e => {
    const s = e.target.closest && e.target.closest('select');
    if (!s || skip(s) || !touch()) return;
    e.preventDefault(); show(s);
  }, true);
})();
