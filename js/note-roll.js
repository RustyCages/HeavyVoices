// Rullande noter för karaoken i spelaren: noterna rullar in från höger mot ett spelhuvud.
//   'blocks' – notblock på tonhöjd (som i Röstövning), orden ovanför
//   'staff'  – notrader ritade från notblocken: klav, förtecken, nothuvuden på rätt linje,
//              hjälplinjer, ♯/♭, taktstreck om låten har tempo. Längden visas som avstånd + streck.
//   'score'  – riktig notskrift från notsättarens MusicXML (OpenSheetMusicDisplay, laddas vid behov)
//
//   const roll = NoteRoll.create(hostEl);
//   roll.setData({ notes, lyr, others: [{ notes, offset }], offset, bpm, beatOffset, beatsPerBar, key });
//   (notes/lyr i stämfilens tid, offset = stämmans förskjutning till låtens tid)
//   roll.setMode('blocks' | 'staff');
//   await roll.setScore({ xml, part, measures, offset });   // → mode 'score'
//   roll.render(songTime);   // varje bildruta
(function (root) {
  const OSMD_URL = 'https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.1.3/build/opensheetmusicdisplay.min.js';
  const ACCENT = '#E5A968';
  let osmdLoading = null;
  function loadOsmd() {
    if (root.opensheetmusicdisplay) return Promise.resolve();
    if (!osmdLoading) osmdLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = OSMD_URL; s.onload = () => res(); s.onerror = () => { osmdLoading = null; rej(new Error('Kunde inte ladda notvisaren')); };
      document.head.appendChild(s);
    });
    return osmdLoading;
  }

  // ---------- notnamn och notlinjer ----------
  // förtecken från tonart: antal kvintsteg (+ = ♯, − = ♭)
  const MAJ_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
  function keyFifths(key) {
    if (!key) return 0;
    const pc = key.minor ? (key.tonic + 3) % 12 : key.tonic;
    return MAJ_FIFTHS[pc] ?? 0;
  }
  const SHARP_NAMES = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];   // [bokstav C=0…B=6, ändring]
  const FLAT_NAMES = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];   // F C G D A E B / B E A D G C F
  function keyAlters(fifths) {
    const a = [0, 0, 0, 0, 0, 0, 0];
    if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach(l => { a[l] = 1; });
    if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach(l => { a[l] = -1; });
    return a;
  }
  // midi → { d: diatoniskt steg (C4 = 28), acc: tecken att rita (null/'♯'/'♭'/'♮') }
  function spell(n, fifths, alters) {
    const m = Math.round(n), pc = ((m % 12) + 12) % 12, oct = Math.floor(m / 12) - 1;
    const [l, alt] = (fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[pc];
    const d = oct * 7 + l;
    const acc = alt === alters[l] ? null : alt === 1 ? '♯' : alt === -1 ? '♭' : '♮';
    return { d, acc };
  }
  const D = (letter, oct) => oct * 7 + letter;   // diatoniskt steg
  // klav efter stämmans läge: diskant, diskant med 8 under (tenor) eller bas. bottom = understa linjen.
  function pickClef(notes) {
    const s = notes.map(x => x.n).sort((a, b) => a - b), med = s.length ? s[s.length >> 1] : 64;
    if (med >= 59) return { kind: 'G', bottom: D(2, 4), shift: 0 };     // E4
    if (med >= 52) return { kind: 'G8', bottom: D(2, 3), shift: 0 };    // E3 (skrivs en oktav upp)
    return { kind: 'F', bottom: D(4, 2), shift: 0 };                    // G2
  }

  function create(host) {
    const wrap = document.createElement('div');
    wrap.className = 'nroll';
    wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    const sc = document.createElement('div');   // notskrift (score)
    sc.style.cssText = 'position:absolute;inset:0;overflow:hidden;display:none;';
    const scIn = document.createElement('div');
    scIn.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;';
    const scHead = document.createElement('div');
    scHead.style.cssText = `position:absolute;top:6%;bottom:6%;width:2px;background:${ACCENT};box-shadow:0 0 10px ${ACCENT};opacity:0.85;pointer-events:none;`;
    sc.append(scIn, scHead);
    wrap.append(cv, sc);
    host.appendChild(wrap);
    const ctx = cv.getContext('2d');

    let data = { notes: [], lyr: [], others: [], offset: 0 };
    let mode = 'blocks', W = 0, H = 0, dpr = 1;
    let clef = null, fifths = 0, alters = keyAlters(0), spelled = [];
    let score = null;   // { osmd, map: [{ x, w, ents: [[q, x]] }], measures, offset, h, w }

    function resize() {
      dpr = Math.min(2, root.devicePixelRatio || 1);
      const r = wrap.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      fitScore();
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(wrap); else root.addEventListener('resize', resize);

    function setData(d) {
      data = { notes: [], lyr: [], others: [], offset: 0, ...d };
      data.notes = (data.notes || []).slice().sort((a, b) => a.t - b.t);
      data.lyr = (data.lyr || []).filter(b => b.w).slice().sort((a, b) => a.t - b.t);
      clef = pickClef(data.notes);
      fifths = keyFifths(data.key); alters = keyAlters(fifths);
      spelled = data.notes.map(x => spell(x.n, fifths, alters));
      data.others = (data.others || []).filter(o => o && o.notes && o.notes.length);
    }
    function setMode(m) {
      mode = m;
      sc.style.display = m === 'score' ? '' : 'none';
      cv.style.display = m === 'score' ? 'none' : '';
    }

    // ---------- gemensamt ----------
    const span = () => (W / dpr < 520 ? 6 : W / dpr < 900 ? 8 : 10);   // sekunder som syns
    const PH = 0.22;                                                // spelhuvudets läge (andel av bredden)
    function view(t) {
      const sp = span(), pps = W / sp, x0 = W * PH;
      return { pps, x0, a: t - PH * sp, b: t + (1 - PH) * sp, X: s => x0 + (s - t) * pps };
    }
    const fontPx = () => Math.round(Math.max(12, Math.min(26, H / dpr / 8, W / dpr / 20)) * dpr);
    // ord vid noterna: ordet hamnar där textrutan börjar
    function drawWords(t, v, yOf, below) {
      const fs = fontPx();
      ctx.font = `700 ${fs}px 'Roboto Condensed', 'DM Sans', sans-serif`;
      ctx.textBaseline = below ? 'top' : 'bottom';
      let lastEnd = -1e9, stagger = 0;
      data.lyr.forEach(b => {
        const s = b.t + data.offset;
        if (s + b.d < v.a - 1 || s > v.b + 1) return;
        const x = v.X(s), w = ctx.measureText(b.w).width;
        stagger = x < lastEnd + 6 * dpr ? (stagger + 1) % 2 : 0;
        lastEnd = Math.max(lastEnd, x + w);
        const on = t >= s && t < s + Math.max(b.d, 0.15), past = t >= s + b.d;
        ctx.fillStyle = on ? ACCENT : past ? 'rgba(229,169,104,0.55)' : 'rgba(255,255,255,0.88)';
        if (on) { ctx.shadowColor = 'rgba(229,169,104,0.6)'; ctx.shadowBlur = 10 * dpr; }
        const y = yOf(b, s) + (below ? 1 : -1) * stagger * fs * 1.05;
        ctx.fillText(b.w, x, y);
        ctx.shadowBlur = 0;
      });
    }
    function noteAt(s, list) {   // noten som låter vid tid s (i stämmans tid)
      for (const x of list) { if (x.t <= s + 0.03 && x.t + x.d > s) return x; if (x.t > s + 0.03) break; }
      return list.find(x => x.t >= s) || null;
    }
    function drawHead(v) {
      ctx.fillStyle = ACCENT; ctx.globalAlpha = 0.9;
      ctx.fillRect(Math.round(v.x0 - dpr), 0, Math.max(2, Math.round(2 * dpr)), H);
      ctx.globalAlpha = 1;
    }
    const colorFor = (t, s, e) => t >= e ? 'rgba(229,169,104,0.45)' : t >= s ? ACCENT : 'rgba(236,238,242,0.82)';

    // ---------- notblock ----------
    function renderBlocks(t) {
      const v = view(t), ns = data.notes;
      const all = ns.concat(...data.others.map(o => o.notes));
      const lo = Math.min(...all.map(x => x.n)) - 1.5, hi = Math.max(...all.map(x => x.n)) + 1.5;
      const top = fontPx() * 2.3, bot = 8 * dpr;
      const rng = Math.max(10, hi - lo), mid = (lo + hi) / 2;
      const y = n => top + (H - top - bot) * (0.5 - (n - mid) / rng);
      const bh = Math.max(6 * dpr, Math.min(18 * dpr, W / 40, (H - top - bot) / rng * 0.95));
      const rect = (x, yy, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, yy, w, h, r); else ctx.rect(x, yy, w, h); ctx.fill(); };
      data.others.forEach(o => {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        o.notes.forEach(x => { const s = x.t + (o.offset || 0); if (s + x.d < v.a || s > v.b) return; rect(v.X(s), y(x.n) - bh / 2, Math.max(2, x.d * v.pps - 2 * dpr), bh, bh / 2.5); });
      });
      ns.forEach(x => {
        const s = x.t + data.offset; if (s + x.d < v.a || s > v.b) return;
        ctx.fillStyle = colorFor(t, s, s + x.d);
        if (t >= s && t < s + x.d) { ctx.shadowColor = 'rgba(229,169,104,0.6)'; ctx.shadowBlur = 12 * dpr; }
        rect(v.X(s), y(x.n) - bh / 2, Math.max(3 * dpr, x.d * v.pps - 2 * dpr), bh, bh / 2.5);
        ctx.shadowBlur = 0;
      });
      drawHead(v);
      drawWords(t, v, (b) => { const x = noteAt(b.t, ns); return (x ? y(x.n) : top) - bh / 2 - 3 * dpr; }, false);
    }

    // ---------- notrader ----------
    function renderStaff(t) {
      const v = view(t), ns = data.notes;
      const fs = fontPx();
      const bottom = clef.bottom;
      const pos = spelled.map(sp => sp.d - bottom);   // 0 = understa linjen, 8 = översta
      const pmin = Math.min(-1, ...pos) - 1, pmax = Math.max(9, ...pos) + 1;
      const lyrH = data.lyr.length ? fs * 2.4 : fs * 0.5;
      const hg = Math.max(2.5 * dpr, Math.min(H / 15, W / 70, 9 * dpr, (H - lyrH - 6 * dpr) / (pmax - pmin)));   // halv linjeavstånd
      const yTop = 3 * dpr + (H - lyrH - 6 * dpr - (pmax - pmin) * hg) / 2;
      const Y = p => yTop + (pmax - p) * hg;
      const staffL = 0, staffR = W;
      // notlinjer
      ctx.strokeStyle = 'rgba(255,255,255,0.38)'; ctx.lineWidth = Math.max(1, dpr);
      for (let k = 0; k <= 8; k += 2) { const yy = Math.round(Y(k)) + 0.5; ctx.beginPath(); ctx.moveTo(staffL, yy); ctx.lineTo(staffR, yy); ctx.stroke(); }
      // taktstreck
      if (data.bpm > 0) {
        const bar = 60 / data.bpm * Math.max(1, data.beatsPerBar || 4), off = data.beatOffset || 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.32)';
        for (let k = Math.ceil((v.a - off) / bar); off + k * bar <= v.b; k++) {
          const xx = Math.round(v.X(off + k * bar)) + 0.5;
          ctx.beginPath(); ctx.moveTo(xx, Y(8)); ctx.lineTo(xx, Y(0)); ctx.stroke();
        }
      }
      // noter
      const rx = hg * 1.18, ry = hg * 0.86;
      ns.forEach((x, i) => {
        const s = x.t + data.offset; if (s + x.d < v.a - 0.5 || s > v.b) return;
        const p = pos[i], cx = v.X(s) + rx, cy = Y(p);
        const col = colorFor(t, s, s + x.d), on = t >= s && t < s + x.d;
        // hjälplinjer
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        for (let q = -2; q >= p; q -= 2) { ctx.beginPath(); ctx.moveTo(cx - rx * 1.7, Y(q)); ctx.lineTo(cx + rx * 1.7, Y(q)); ctx.stroke(); }
        for (let q = 10; q <= p; q += 2) { ctx.beginPath(); ctx.moveTo(cx - rx * 1.7, Y(q)); ctx.lineTo(cx + rx * 1.7, Y(q)); ctx.stroke(); }
        // längden: streck efter nothuvudet
        ctx.fillStyle = col; ctx.globalAlpha = 0.35;
        const len = x.d * v.pps - rx * 2.4;
        if (len > 2 * dpr) ctx.fillRect(cx + rx * 1.2, cy - hg * 0.22, len, hg * 0.44);
        ctx.globalAlpha = 1;
        if (on) { ctx.shadowColor = 'rgba(229,169,104,0.7)'; ctx.shadowBlur = 12 * dpr; }
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, -0.35, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        // skaft
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, 1.3 * dpr);
        ctx.beginPath();
        if (p < 4) { ctx.moveTo(cx + rx * 0.92, cy - ry * 0.3); ctx.lineTo(cx + rx * 0.92, cy - hg * 7); }
        else { ctx.moveTo(cx - rx * 0.92, cy + ry * 0.3); ctx.lineTo(cx - rx * 0.92, cy + hg * 7); }
        ctx.stroke(); ctx.lineWidth = Math.max(1, dpr);
        // ♯ ♭ ♮
        const acc = spelled[i].acc;
        if (acc) {
          ctx.font = `${Math.round(hg * 3.2)}px 'DM Sans', 'Segoe UI Symbol', 'Noto Sans Symbols 2', sans-serif`;
          ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
          ctx.fillText(acc, cx - rx * 1.25, cy + (acc === '♭' ? -hg * 0.45 : 0));
          ctx.textAlign = 'left';
        }
      });
      drawHead(v);
      // ord under notraden
      drawWords(t, v, () => Y(Math.min(-1, pmin + 1)) + fs * 0.25, true);
      // klav och förtecken i en fast ruta till vänster (noterna glider in under den)
      const kw = hg * 6 + Math.abs(fifths) * hg * 2.1;
      const g = ctx.createLinearGradient(0, 0, kw + 30 * dpr, 0);
      g.addColorStop(0, 'rgba(18,20,24,0.95)'); g.addColorStop(0.75, 'rgba(18,20,24,0.85)'); g.addColorStop(1, 'rgba(18,20,24,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, kw + 30 * dpr, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.38)';
      for (let k = 0; k <= 8; k += 2) { const yy = Math.round(Y(k)) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(kw + 10 * dpr, yy); ctx.stroke(); }
      ctx.fillStyle = 'rgba(236,238,242,0.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const clefFont = `'Noto Music', 'Bravura Text', 'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols 2', serif`;
      if (clef.kind === 'F') {
        ctx.font = `${Math.round(hg * 7.2)}px ${clefFont}`;
        ctx.fillText('𝄢', hg * 2.6, Y(6) + hg * 2.4);
      } else {
        ctx.font = `${Math.round(hg * 9.6)}px ${clefFont}`;
        ctx.fillText('𝄞', hg * 2.6, Y(2) + hg * 2.6);
        if (clef.kind === 'G8') { ctx.font = `700 ${Math.round(hg * 1.9)}px 'DM Sans', sans-serif`; ctx.fillText('8', hg * 2.7, Y(-3) + hg * 1.6); }
      }
      // förtecken
      if (fifths) {
        ctx.font = `${Math.round(hg * 3.2)}px 'DM Sans', 'Segoe UI Symbol', sans-serif`; ctx.textBaseline = 'middle';
        const order = fifths > 0 ? SHARP_ORDER : FLAT_ORDER, n = Math.abs(fifths);
        // läget för varje förtecken (bokstav → linje i den här klaven), inom notraden
        const refOct = fifths > 0 ? { G: [5, 5, 5, 5, 4, 5, 4], G8: [4, 4, 4, 4, 3, 4, 3], F: [3, 3, 3, 3, 2, 3, 2] } : { G: [4, 5, 4, 5, 4, 5, 4], G8: [3, 4, 3, 4, 3, 4, 3], F: [2, 3, 2, 3, 2, 3, 2] };
        for (let k = 0; k < n; k++) {
          const l = order[k], p = D(l, refOct[clef.kind][k]) - bottom;
          ctx.fillText(fifths > 0 ? '♯' : '♭', hg * 5.4 + k * hg * 2.1, Y(p) + (fifths < 0 ? -hg * 0.45 : 0));
        }
      }
      ctx.textAlign = 'left';
    }

    // ---------- riktig notskrift (MusicXML) ----------
    async function setScore(s) {
      await loadOsmd();
      scIn.innerHTML = '';
      const div = document.createElement('div');
      div.style.width = '2000px';
      scIn.appendChild(div);
      const OS = root.opensheetmusicdisplay;
      const osmd = new OS.OpenSheetMusicDisplay(div, {
        backend: 'svg', autoResize: false, drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false,
        drawCredits: false, drawPartNames: false, drawPartAbbreviations: false, drawMeasureNumbers: false,
        renderSingleHorizontalStaffline: true, autoGenerateMultipleRestMeasuresFromRestMeasures: false,
        defaultColorMusic: '#e8eaee', drawingParameters: 'compacttight',
      });
      await osmd.load(s.xml);
      const ins = osmd.Sheet.Instruments;
      ins.forEach((x, k) => { x.Visible = k === (s.part || 0); });
      osmd.render();
      const unit = 10 * (osmd.zoom || 1);
      const visIns = ins[s.part || 0];
      const map = osmd.GraphicSheet.MeasureList.map(row => {
        const m = (row || []).find(g => g && g.ParentStaff && g.ParentStaff.ParentInstrument === visIns) || (row || []).find(Boolean);
        if (!m) return null;
        const x = m.PositionAndShape.AbsolutePosition.x * unit, w = m.PositionAndShape.Size.width * unit;
        const ents = (m.staffEntries || []).map(se => [se.relInMeasureTimestamp.RealValue * 4, se.PositionAndShape.AbsolutePosition.x * unit]);
        return { x, w, ents };
      });
      const svg = div.querySelector('svg');
      const h = svg ? parseFloat(svg.getAttribute('height')) || svg.getBoundingClientRect().height : 200;
      const w = svg ? parseFloat(svg.getAttribute('width')) || 2000 : 2000;
      div.style.width = w + 'px';
      score = { osmd, map, measures: s.measures || [], offset: s.offset || 0, h, w, scale: 1 };
      setMode('score');
      resize();
    }
    function fitScore() {
      if (!score) return;
      // fyll höjden, men visa ändå ett par takter på smala skärmar (stående mobil i helskärm)
      score.scale = Math.max(0.35, Math.min(2.2, (H / dpr) * 0.96 / score.h, Math.max(0.6, (W / dpr) / 560)));
      scHead.style.left = Math.round(W / dpr * PH) + 'px';
    }
    function scoreX(ts) {
      const ms = score.measures;
      if (!ms.length) return 0;
      let k = 0;
      for (let i = 0; i < ms.length; i++) { if (ms[i].a <= ts) k = i; else break; }
      const e = ms[k], g = score.map[e.i];
      if (!g) return 0;
      if (ts < e.a) return g.x;
      const q = Math.max(0, Math.min(e.len, (ts - e.a) / Math.max(0.01, e.b - e.a) * e.len));
      // inom takten: mellan notpositionerna (taktens början → noterna → taktens slut)
      const pts = [[0, g.ents.length ? Math.min(g.x + 4, g.ents[0][1]) : g.x], ...g.ents, [e.len, g.x + g.w]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [q0, x0] = pts[i], [q1, x1] = pts[i + 1];
        if (q <= q1 || i === pts.length - 2) return x0 + (q1 > q0 ? (x1 - x0) * Math.max(0, Math.min(1, (q - q0) / (q1 - q0))) : 0);
      }
      return g.x;
    }
    function renderScore(t) {
      const x = scoreX(t - score.offset) * score.scale;
      const tx = W / dpr * PH - x, ty = Math.max(0, (H / dpr - score.h * score.scale) / 2);
      scIn.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${score.scale.toFixed(4)})`;
    }

    function render(t) {
      if (!W || !H) resize();
      if (mode === 'score') { if (score) renderScore(t); return; }
      ctx.clearRect(0, 0, W, H);
      if (!data.notes.length) return;
      if (mode === 'staff') renderStaff(t); else renderBlocks(t);
    }
    function destroy() { if (ro) ro.disconnect(); wrap.remove(); }
    return { setData, setMode, setScore, render, resize, destroy, get mode() { return mode; }, get hasScore() { return !!score; }, el: wrap };
  }

  root.NoteRoll = { create, loadOsmd };
})(window);
