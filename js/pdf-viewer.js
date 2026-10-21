// PDF-visare i sidan (pdf.js) med växling mellan vitt dokument och inverterad text på svart bakgrund.
// Används av medlem/repertoar.html: PdfViewer.open(url, titel, { onDownload }).
// Valet (ljus/mörk) sparas i webbläsaren (hv-pdf-dark).
(function (root) {
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  let libP = null, ov = null, doc = null, zoom = 1, renderToken = 0, dl = null, curUrl = null;
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  function loadLib() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (!libP) libP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = PDFJS;
      s.onload = () => { root.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; res(root.pdfjsLib); };
      s.onerror = () => { libP = null; rej(new Error('Kunde inte ladda PDF-visaren')); };
      document.head.appendChild(s);
    });
    return libP;
  }
  const ICON = {
    sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    dl: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    ext: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  };
  function build() {
    const st = document.createElement('style');
    st.textContent = `
      .pdfv { position:fixed; inset:0; z-index:3000; display:flex; flex-direction:column; background:#1b1d22; }
      .pdfv[hidden] { display:none; }
      .pdfv-bar { display:flex; align-items:center; gap:0.4rem; padding:calc(0.5rem + env(safe-area-inset-top,0px)) 0.6rem 0.5rem; background:#111317; border-bottom:1px solid rgba(255,255,255,0.08); }
      .pdfv-title { flex:1; min-width:0; font-weight:700; color:#f3f4f6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:0.95rem; }
      .pdfv-bar button { min-width:2.4rem; height:2.4rem; padding:0 0.6rem; border-radius:0.5rem; display:inline-flex; align-items:center; justify-content:center; gap:0.35rem; background:rgba(255,255,255,0.06); color:#f3f4f6; border:1px solid rgba(255,255,255,0.12); font-size:0.85rem; font-weight:600; }
      .pdfv-bar button[aria-pressed="true"] { color:#E5A968; border-color:#E5A968; }
      .pdfv-pages { flex:1; overflow:auto; -webkit-overflow-scrolling:touch; padding:0.8rem 0.5rem calc(1rem + env(safe-area-inset-bottom,0px)); }
      .pdfv-pages canvas { display:block; margin:0 auto 0.8rem; background:#fff; box-shadow:0 4px 18px rgba(0,0,0,0.5); max-width:none; }
      .pdfv.dark .pdfv-pages { background:#000; }
      .pdfv.dark .pdfv-pages canvas { filter:invert(1) hue-rotate(180deg); box-shadow:0 0 0 1px rgba(255,255,255,0.08); }
      .pdfv-msg { color:#9ca3af; text-align:center; padding:2rem 1rem; }
    `;
    document.head.appendChild(st);
    ov = document.createElement('div');
    ov.className = 'pdfv'; ov.hidden = true;
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="pdfv-bar">
        <span class="pdfv-title"></span>
        <button type="button" data-a="mode" title="Växla vitt dokument / svart bakgrund"></button>
        <button type="button" data-a="newtab" title="Öppna i ny flik" aria-label="Öppna i ny flik">${ICON.ext}</button>
        <button type="button" data-a="out" title="Mindre" aria-label="Mindre">−</button>
        <button type="button" data-a="in" title="Större" aria-label="Större">+</button>
        <button type="button" data-a="dl" title="Ladda ner" aria-label="Ladda ner">${ICON.dl}</button>
        <button type="button" data-a="close" title="Stäng" aria-label="Stäng">✕</button>
      </div><div class="pdfv-pages"></div>`;
    document.body.appendChild(ov);
    ov.querySelector('[data-a="mode"]').addEventListener('click', () => setDark(!ov.classList.contains('dark')));
    ov.querySelector('[data-a="newtab"]').addEventListener('click', () => { if (curUrl) window.open(curUrl, '_blank', 'noopener'); });
    ov.querySelector('[data-a="in"]').addEventListener('click', () => { zoom = Math.min(3, +(zoom + 0.25).toFixed(2)); render(); });
    ov.querySelector('[data-a="out"]').addEventListener('click', () => { zoom = Math.max(0.5, +(zoom - 0.25).toFixed(2)); render(); });
    ov.querySelector('[data-a="dl"]').addEventListener('click', () => { if (dl) dl(); });
    ov.querySelector('[data-a="close"]').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov && !ov.hidden) close(); });
    let rt = null; window.addEventListener('resize', () => { if (ov.hidden) return; placeAbovePlayer(); clearTimeout(rt); rt = setTimeout(render, 250); });
  }
  // Visaren ligger ovanför spelarlisten (om den syns) så att reglagen fortfarande går att nå
  function placeAbovePlayer() {
    const bar = document.getElementById('playerBar');
    const h = bar && !bar.classList.contains('hidden') ? bar.offsetHeight : 0;
    ov.style.bottom = h + 'px';
  }
  function setDark(on) {
    ov.classList.toggle('dark', on);
    const b = ov.querySelector('[data-a="mode"]');
    b.innerHTML = on ? `${ICON.moon}<span>Mörk</span>` : `${ICON.sun}<span>Vit</span>`;
    b.setAttribute('aria-pressed', String(on));
    store.set('hv-pdf-dark', on ? '1' : '0');
  }
  async function render() {
    if (!doc) return;
    const my = ++renderToken;
    const box = ov.querySelector('.pdfv-pages');
    const avail = Math.max(200, box.clientWidth - 16);
    const frag = document.createDocumentFragment(), canvases = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (my !== renderToken) return;
      const base = page.getViewport({ scale: 1 });
      const cssW = Math.min(avail, 900) * zoom;
      const vp = page.getViewport({ scale: (cssW / base.width) * (window.devicePixelRatio || 1) });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = cssW + 'px'; c.style.height = (cssW * base.height / base.width) + 'px';
      canvases.push([page, c, vp]); frag.appendChild(c);
    }
    box.innerHTML = ''; box.appendChild(frag);
    for (const [page, c, vp] of canvases) {
      if (my !== renderToken) return;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  }
  function close() {
    ov.hidden = true; renderToken++; document.documentElement.style.overflow = '';
    if (doc) { try { doc.destroy(); } catch (e) {} doc = null; }
  }
  async function open(url, title, opts = {}) {
    if (!ov) build();
    dl = opts.onDownload || null;
    curUrl = url;
    ov.querySelector('[data-a="dl"]').hidden = !dl;
    ov.querySelector('.pdfv-title').textContent = title || 'Dokument';
    setDark(store.get('hv-pdf-dark') === '1');
    zoom = 1;
    const box = ov.querySelector('.pdfv-pages');
    box.innerHTML = '<p class="pdfv-msg">Laddar dokumentet…</p>';
    placeAbovePlayer();
    ov.hidden = false; document.documentElement.style.overflow = 'hidden';
    try {
      const lib = await loadLib();
      if (doc) { try { doc.destroy(); } catch (e) {} }
      doc = await lib.getDocument({ url }).promise;
      await render();
    } catch (e) {
      box.innerHTML = `<p class="pdfv-msg">Kunde inte visa dokumentet här.<br><br><a href="${url}" target="_blank" rel="noopener" style="color:#E5A968">Öppna i ny flik</a></p>`;
    }
  }
  root.PdfViewer = { open, close };
})(window);
