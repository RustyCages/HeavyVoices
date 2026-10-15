// Gemensam tidslinje med vågformer – används av Stämsynk (admin) och Studio (medlemmar).
// Ritar staplade spår på låtens gemensamma tidslinje, med linjal, zoom, markörer,
// spelhuvud, dra-för-att-flytta (förskjutning) och dra-för-att-markera.
//
//   const tl = WaveTimeline.create(element, {
//     getTracks, getDuration, getPosition, isAudible(track), isActive(track),
//     onSeek(t), onOffset(track, ms, live), onActive(track), onSelection(sel),
//     renderHead(track, headEl),   // knappar/namn ovanför vågformen (sidans egna)
//     renderFoot(track, footEl),   // valfri rad under vågformen
//     getBeats(),                  // valfritt: { bpm, offset, bpb } ritar taktrutnät i spåren
//     onReorder(from, to),         // valfritt: handtag till vänster – dra spåret upp/ner (index i getTracks())
//   });
//   Spår: { key, color, clip:{sampleRate,channels}, peaks, offsetMs, locked? }  (locked = går inte att dra)
//   tl.render() bygger om raderna, tl.draw() ritar om, tl.tick() följer spelhuvudet.
(function (root) {
  const CSS = `
  .wt { position: relative; user-select: none; }
  .wt-ruler { display: block; width: 100%; height: 26px; cursor: pointer; border-bottom: 1px solid var(--border); touch-action: pan-y; }
  .wt-track { border: 2px solid transparent; border-bottom-color: var(--border); border-radius: 0.5rem; padding: 0 calc(0.5rem - 2px); margin: 2px -0.5rem; transition: border-color 0.15s, background 0.15s; }
  .wt-track.active { border-color: var(--accent, #E5A968); background: rgba(229,169,104,0.09); box-shadow: inset 4px 0 0 var(--accent, #E5A968), 0 0 0 3px rgba(229,169,104,0.12); }
  .wt-head::before { content: ''; flex: none; width: 0.6rem; height: 0.6rem; border-radius: 50%; border: 2px solid rgba(255,255,255,0.25); }
  .wt-track.active .wt-head::before { background: var(--accent, #E5A968); border-color: var(--accent, #E5A968); box-shadow: 0 0 8px rgba(229,169,104,0.8); }
  .wt-track.active .wt-head .t-name { color: var(--accent, #E5A968); }
  .wt-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.7rem; padding: 0.45rem 0.1rem 0.3rem; }
  .wt-wave { display: block; width: 100%; height: 72px; touch-action: pan-y; }   /* lodrätt drag med fingret rullar sidan */
  .wt.tool-pan .wt-wave { cursor: grab; }
  .wt.tool-pan .wt-wave.dragging { cursor: grabbing; }
  .wt.tool-move .wt-wave { cursor: ew-resize; }
  .wt.tool-move .wt-wave.locked { cursor: pointer; }
  .wt.tool-move .wt-wave.dragging { cursor: grabbing; }
  .wt.tool-select .wt-wave { cursor: text; }
  .wt-foot:empty { display: none; }
  .wt-track { position: relative; }
  .wt.reorder .wt-head { padding-left: 1.4rem; }
  .wt-grip { position: absolute; left: calc(0.5rem - 4px); top: 0.35rem; width: 1.1rem; height: 1.7rem; display: grid; place-items: center; border-radius: 0.3rem;
    color: var(--text-muted, #9ca3af); cursor: grab; touch-action: none; font-size: 0.95rem; line-height: 1; letter-spacing: -0.12em; opacity: 0.65; z-index: 2; }
  .wt-grip:hover { opacity: 1; background: rgba(255,255,255,0.08); color: var(--text, #fff); }
  .wt-track.dragging { z-index: 5; background: #1e2026; box-shadow: 0 10px 28px rgba(0,0,0,0.5); cursor: grabbing; }
  .wt-track.dragging .wt-grip { cursor: grabbing; opacity: 1; }
  .wt-drop { height: 3px; margin: -2px 0 -1px; border-radius: 2px; background: var(--accent, #E5A968); box-shadow: 0 0 8px rgba(229,169,104,0.8); }
  body.wt-reordering, body.wt-reordering * { cursor: grabbing !important; user-select: none; }
  .wt-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; box-shadow: 0 0 6px rgba(0,0,0,0.6); pointer-events: none; z-index: 3; }`;
  let cssDone = false;
  const fmt = (sec, tenths) => {
    const neg = sec < 0; sec = Math.abs(sec || 0);
    const m = Math.floor(sec / 60), s = sec % 60;
    return (neg ? '−' : '') + m + ':' + (tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0'));
  };
  const dur = t => t.clip ? t.clip.channels[0].length / t.clip.sampleRate : 0;
  const offS = t => (t.offsetMs || 0) / 1000;

  function create(rootEl, o) {
    if (!cssDone) { cssDone = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
    rootEl.classList.add('wt', 'tool-pan');
    if (o.onReorder) rootEl.classList.add('reorder');
    rootEl.innerHTML = '<canvas class="wt-ruler" title="Klicka för att hoppa, dra för att bläddra"></canvas><div class="wt-tracks"></div><div class="wt-playhead"></div>';
    const ruler = rootEl.querySelector('.wt-ruler'), tracksEl = rootEl.querySelector('.wt-tracks'), ph = rootEl.querySelector('.wt-playhead');
    const view = { t0: 0, pps: 20 };
    let tool = 'pan', sel = null;   // pan = inget verktyg valt: dra bläddrar i sidled
    let userNav = 0;                 // senast användaren bläddrade själv – då följer vyn inte spelhuvudet en stund
    const markers = [];
    const tracks = () => o.getTracks() || [];
    const audible = t => (o.isAudible ? o.isAudible(t) : true);
    const width = () => ruler.clientWidth || 600;
    const xOf = t => (t - view.t0) * view.pps, tOf = x => view.t0 + x / view.pps;

    function clampView() {
      const span = width() / view.pps, d = Math.max(o.getDuration(), span);
      view.t0 = Math.max(Math.min(view.t0, d - span * 0.5), -span * 0.1);
    }
    function sizeCanvas(c) {
      const dpr = window.devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      return dpr;
    }
    function drawRuler() {
      const dpr = sizeCanvas(ruler), ctx = ruler.getContext('2d'), W = ruler.width, H = ruler.height;
      ctx.clearRect(0, 0, W, H);
      const span = W / dpr / view.pps;
      const steps = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
      const step = steps.find(s => s * view.pps >= 70) || 300;
      ctx.font = `${10.5 * dpr}px DM Sans, sans-serif`; ctx.textBaseline = 'top';
      for (let t = Math.ceil(view.t0 / step) * step; t < view.t0 + span; t += step) {
        const x = xOf(t) * dpr;
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(Math.round(x), H * 0.55, 1, H * 0.45);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(step < 1 ? (t < 60 ? t.toFixed(step < 0.1 ? 2 : 1) + ' s' : fmt(t, true)) : fmt(t), x + 3 * dpr, 3 * dpr);
      }
      markers.forEach(m => { ctx.fillStyle = '#facc15'; ctx.fillText('⚑', xOf(m) * dpr - 4 * dpr, 12 * dpr); });
    }
    // valfritt taktrutnät: o.getBeats() → { bpm, offset (s), bpb } eller null. Taktstreck starkare än slag.
    function drawGrid(ctx, W, H, dpr) {
      const g = o.getBeats && o.getBeats(); if (!g || !(g.bpm >= 20)) return;
      const per = 60 / g.bpm, bpb = Math.max(1, g.bpb || 4), off = g.offset || 0, beatPx = per * view.pps;
      if (beatPx * bpb < 10) return;   // för utzoomat – rutnätet blir bara brus
      const end = view.t0 + W / dpr / view.pps;
      for (let k = Math.ceil((view.t0 - off) / per), n = 0; n < 20000; k++, n++) {
        const t = off + k * per; if (t > end) break;
        const bar = ((k % bpb) + bpb) % bpb === 0;
        if (!bar && beatPx < 8) continue;
        ctx.fillStyle = bar ? 'rgba(229,169,104,0.35)' : 'rgba(255,255,255,0.08)';
        ctx.fillRect(Math.round(xOf(t) * dpr), 0, Math.max(1, Math.round(dpr)), H);
      }
    }
    function drawTrack(tr) {
      const c = tr._canvas; if (!c || !c.isConnected) return;
      const dpr = sizeCanvas(c), ctx = c.getContext('2d'), W = c.width, H = c.height, mid = H / 2;
      const act = o.isActive && o.isActive(tr);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = act ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.015)'; ctx.fillRect(0, 0, W, H);
      const a = xOf(offS(tr)) * dpr, b = xOf(offS(tr) + dur(tr)) * dpr;
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(Math.max(0, a), 0, Math.min(W, b) - Math.max(0, a), H);
      drawGrid(ctx, W, H, dpr);
      if (sel && sel.track === tr) {
        const s0 = xOf(Math.min(sel.a, sel.b)) * dpr, s1 = xOf(Math.max(sel.a, sel.b)) * dpr;
        ctx.fillStyle = 'rgba(96,165,250,0.25)'; ctx.fillRect(s0, 0, s1 - s0, H);
        ctx.fillStyle = 'rgba(96,165,250,0.9)'; ctx.fillRect(s0, 0, dpr, H); ctx.fillRect(s1 - dpr, 0, dpr, H);
      }
      const p = tr.peaks;
      if (p && tr.clip) {
        const amp = (H / 2 - 3 * dpr) * 1.6 * (tr.gainView || 1);
        ctx.fillStyle = audible(tr) ? tr.color : 'rgba(255,255,255,0.18)';
        const secPerPx = 1 / (view.pps * dpr), direct = view.pps * dpr > p.rate;
        const ch0 = tr.clip.channels[0], ch1 = tr.clip.channels[1] || ch0, sr = tr.clip.sampleRate;
        for (let x = Math.max(0, Math.floor(a)); x < Math.min(W, Math.ceil(b)); x++) {
          const ft = view.t0 + x * secPerPx - offS(tr);
          if (ft < 0) continue;
          let lo = 0, hi = 0;
          if (direct) {
            const i0 = Math.floor(ft * sr), i1 = Math.max(i0 + 1, Math.floor((ft + secPerPx) * sr));
            for (let i = i0; i < i1 && i < ch0.length; i++) { const v = (ch0[i] + ch1[i]) * 0.5; if (v < lo) lo = v; if (v > hi) hi = v; }
          } else {
            const i0 = Math.floor(ft * p.rate), i1 = Math.max(i0 + 1, Math.floor((ft + secPerPx) * p.rate));
            for (let i = i0; i < i1 && i < p.min.length; i++) { if (p.min[i] < lo) lo = p.min[i]; if (p.max[i] > hi) hi = p.max[i]; }
          }
          const y0 = Math.max(1, mid - hi * amp), y1 = Math.min(H - 1, mid - lo * amp);
          ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
      } else if (tr.loadingText) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = `${12 * dpr}px DM Sans, sans-serif`; ctx.textBaseline = 'middle';
        ctx.fillText(tr.loadingText, 10 * dpr, mid);
      }
      const hint = typeof tr.hint === 'function' ? tr.hint() : tr.hint;   // t.ex. "Tomt spår – …"
      if (hint && !tr.loadingText) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `${12 * dpr}px DM Sans, sans-serif`; ctx.textBaseline = 'middle';
        ctx.fillText(hint, 10 * dpr, mid - 10 * dpr);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, mid, W, 1);
      markers.forEach(m => { ctx.fillStyle = 'rgba(250,204,21,0.6)'; ctx.fillRect(Math.round(xOf(m) * dpr), 0, dpr, H); });
      if (tr.liveUntil != null) {   // inspelning pågår: röd kant där den växer
        const x = xOf(tr.liveUntil) * dpr;
        ctx.fillStyle = '#ef4444'; ctx.fillRect(Math.round(x) - dpr, 0, 2 * dpr, H);
      }
    }
    function placePlayhead() {
      const x = xOf(o.getPosition());
      ph.style.display = x < 0 || x > width() ? 'none' : '';
      ph.style.left = (ruler.offsetLeft + x - 1) + 'px';
    }
    function draw() { drawRuler(); tracks().forEach(drawTrack); placePlayhead(); if (o.onView) o.onView(api); }

    function wire(tr, c) {
      let drag = null;
      c.addEventListener('pointerdown', e => {
        const r = c.getBoundingClientRect(), x = e.clientX - r.left;
        if (o.onActive) o.onActive(tr);
        drag = { x0: e.clientX, t: tOf(x), off: tr.offsetMs || 0, t0: view.t0, moved: false };
        if (tool === 'select') { sel = { track: tr, a: drag.t, b: drag.t }; if (o.onSelection) o.onSelection(sel); }
        c.setPointerCapture(e.pointerId); c.classList.add('dragging');
      });
      c.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x0;
        if (!drag.moved && Math.abs(dx) < 3) return;
        drag.moved = true;
        if (tool === 'pan') { view.t0 = drag.t0 - dx / view.pps; clampView(); userNav = performance.now(); draw(); }
        else if (tool === 'move') { if (!tr.locked && o.onOffset) o.onOffset(tr, Math.round(drag.off + dx / view.pps * 1000), true); }
        else { const r = c.getBoundingClientRect(); sel.b = tOf(e.clientX - r.left); drawTrack(tr); if (o.onSelection) o.onSelection(sel); }
      });
      const end = () => {
        if (!drag) return;
        const d = drag; drag = null; c.classList.remove('dragging');
        if (!d.moved) { if (tool === 'select') { sel = null; if (o.onSelection) o.onSelection(null); drawTrack(tr); } o.onSeek(d.t); return; }
        if (tool === 'move' && !tr.locked && o.onOffset) o.onOffset(tr, tr.offsetMs, false);
      };
      c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    }
    function render() {
      tracksEl.innerHTML = '';
      tracks().forEach(tr => {
        const row = document.createElement('div');
        row.className = 'wt-track' + (o.isActive && o.isActive(tr) ? ' active' : '');
        row.innerHTML = '<div class="wt-head"></div><canvas class="wt-wave"></canvas><div class="wt-foot"></div>';
        const c = row.querySelector('canvas');
        c.classList.toggle('locked', !!tr.locked);
        tr._canvas = c; tr._row = row;
        if (o.renderHead) o.renderHead(tr, row.querySelector('.wt-head'));
        if (o.renderFoot) o.renderFoot(tr, row.querySelector('.wt-foot'));
        wire(tr, c);
        if (o.onReorder) wireGrip(tr, row);
        tracksEl.appendChild(row);
      });
      requestAnimationFrame(draw);
    }
    // dra i handtaget: raden följer pekaren, en guldlinje visar var den hamnar
    function wireGrip(tr, row) {
      const g = document.createElement('span');
      g.className = 'wt-grip'; g.innerHTML = '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>'; g.title = 'Dra för att flytta spåret upp eller ner';
      g.setAttribute('aria-label', 'Flytta spåret'); row.appendChild(g);
      let d = null;
      g.addEventListener('pointerdown', e => {
        if (e.button) return;
        e.preventDefault(); g.setPointerCapture(e.pointerId);
        const rows = [...tracksEl.children].filter(r => r.classList.contains('wt-track'));
        d = { y: e.clientY, from: rows.indexOf(row), to: null, rows, line: document.createElement('div'), scroll: 0, raf: 0 };
        d.line.className = 'wt-drop';
        row.classList.add('dragging'); document.body.classList.add('wt-reordering');
      });
      const place = () => {
        const mid = row.getBoundingClientRect(), cy = mid.top + mid.height / 2;
        let to = d.rows.length;   // index bland de andra raderna där den ska in
        const others = d.rows.filter(r => r !== row);
        for (let i = 0; i < others.length; i++) { const b = others[i].getBoundingClientRect(); if (cy < b.top + b.height / 2) { to = i; break; } }
        if (to > others.length) to = others.length;
        d.to = to;
        if (to < others.length) others[to].before(d.line); else others[others.length - 1].after(d.line);
      };
      const autoScroll = () => {
        if (!d) return;
        if (d.scroll) { window.scrollBy(0, d.scroll); d.y -= d.scroll; row.style.transform = `translateY(${d.lastY - d.y}px)`; place(); }
        d.raf = requestAnimationFrame(autoScroll);
      };
      g.addEventListener('pointermove', e => {
        if (!d) return;
        d.lastY = e.clientY;
        row.style.transform = `translateY(${e.clientY - d.y}px)`;
        d.scroll = e.clientY < 70 ? -12 : e.clientY > innerHeight - 70 ? 12 : 0;
        if (!d.raf) d.raf = requestAnimationFrame(autoScroll);
        place();
      });
      const end = () => {
        if (!d) return;
        const { from, to, line, raf } = d; d = null;
        cancelAnimationFrame(raf); line.remove();
        row.classList.remove('dragging'); row.style.transform = ''; document.body.classList.remove('wt-reordering');
        if (to != null && to !== from) o.onReorder(from, to);
      };
      g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    }
    function setActiveRow() { tracks().forEach(tr => { if (tr._row) tr._row.classList.toggle('active', !!(o.isActive && o.isActive(tr))); drawTrack(tr); }); }

    // linjalen: klick = hoppa, dra = bläddra
    { let d = null;
      ruler.addEventListener('pointerdown', e => { d = { x: e.clientX, t0: view.t0, moved: false }; ruler.setPointerCapture(e.pointerId); });
      ruler.addEventListener('pointermove', e => {
        if (!d) return; const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 4) return;
        d.moved = true; view.t0 = d.t0 - dx / view.pps; clampView(); userNav = performance.now(); draw();
      });
      ruler.addEventListener('pointerup', e => { if (d && !d.moved) o.onSeek(tOf(e.clientX - ruler.getBoundingClientRect().left)); d = null; });
    }
    // hjul: Ctrl/⌘ = zoom runt pekaren, sidled (eller Shift) = bläddra
    rootEl.addEventListener('wheel', e => {
      const x = e.clientX - ruler.getBoundingClientRect().left;
      if (e.ctrlKey || e.metaKey) {
        // stegvis: ett hack på hjulet ≈ 20 %, styrplattans nyp blir mjukt – samlas ihop per bildruta så att
        // många snabba händelser (smidig rullning) inte zoomar ända in/ut på en gång
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
        wheelZoom.dy += Math.max(-120, Math.min(120, e.deltaY * unit)); wheelZoom.x = x;
        if (!wheelZoom.raf) wheelZoom.raf = requestAnimationFrame(() => {
          const f = Math.max(0.8, Math.min(1.25, Math.pow(2, -wheelZoom.dy / 320)));
          wheelZoom.dy = 0; wheelZoom.raf = 0; zoom(f, wheelZoom.x);
        });
      }
      else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        // ett hack på mushjulet = en lagom bit (aldrig mer än en femtedel av vyn), oavsett webbläsarens enhet
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width() : 1;
        const px = Math.max(-width() / 5, Math.min(width() / 5, (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit));
        view.t0 += px / view.pps; clampView(); userNav = performance.now(); draw();
      }
    }, { passive: false });
    window.addEventListener('resize', () => draw());

    const wheelZoom = { dy: 0, x: 0, raf: 0 };
    const MAX_PPS = 4000;
    const minPps = () => Math.max(2, (width() - 10) / ((o.getDuration() || 10) * 1.02) * 0.5);   // längst ut: halva låten till marginal
    function zoom(f, aroundX) { zoomTo(view.pps * f, aroundX); }
    function zoomTo(pps, aroundX) {
      const ax = aroundX ?? xOf(o.getPosition()), at = tOf(ax);
      view.pps = Math.max(minPps(), Math.min(MAX_PPS, pps));
      view.t0 = at - ax / view.pps; clampView(); draw();
    }
    function fit() { const d = o.getDuration() || 10; view.pps = Math.max(2, (width() - 10) / (d * 1.02)); view.t0 = 0; draw(); }
    function spanLabel() {
      const span = width() / view.pps;
      return span >= 60 ? Math.round(span / 6) / 10 + ' min' : (span >= 10 ? Math.round(span) : span.toFixed(1)) + ' s';
    }
    // följ spelhuvudet: bläddra en sida när det går utanför
    function tick(playing) {
      const p = o.getPosition(), span = width() / view.pps;
      const browsing = performance.now() - userNav < 4000;   // låt användaren titta i lugn och ro
      if (playing && !browsing && (p > view.t0 + span * 0.95 || p < view.t0)) { view.t0 = p - span * 0.05; draw(); }
      placePlayhead();
    }
    function setTool(t) { tool = t || 'pan'; ['pan', 'move', 'select'].forEach(k => rootEl.classList.toggle('tool-' + k, tool === k)); }
    const api = {
      el: rootEl, view, markers, render, draw, drawTrack, setActiveRow, zoom, zoomTo, minPps, maxPps: MAX_PPS, fit, tick, setTool, spanLabel, xOf, tOf,
      get tool() { return tool; },
      get selection() { return sel; },
      set selection(s) { sel = s; tracks().forEach(drawTrack); },
      addMarker(t) { markers.push(t); draw(); },
    };
    return api;
  }
  root.WaveTimeline = { create, fmt };
})(window);
