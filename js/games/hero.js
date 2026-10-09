// Rock Hero – Mobilspel à la Guitar Hero på körens egen repertoar. Noterna kommer från
// Röstövningens tonkurvor (song_pitch: edited_notes eller analysens noter). Storbilden spelar
// stämman + kompet; varje mobil har en egen notbana som synkas mot storbildens klocka och
// räknar poängen lokalt. Mobilerna skickar poängen till storbilden (topplista i realtid).
(function () {
  const G = (window.HVGames = window.HVGames || {});
  const LANE_COLORS = ['#22c55e', '#ef4444', '#facc15', '#3b82f6', '#f97316'];
  const DIFF = {
    1: { name: 'Lätt', lanes: 3, gap: 0.45, hold: 99, look: 2.3, win: 0.18 },
    2: { name: 'Medel', lanes: 4, gap: 0.26, hold: 0.8, look: 1.9, win: 0.16 },
    3: { name: 'Svår', lanes: 5, gap: 0.12, hold: 0.55, look: 1.55, win: 0.14 },
  };
  const FIXED_STEMS = [
    { col: 'stem_backtrack_path', label: 'Backtrack' }, { col: 'stem_sopran_path', label: 'Sopran' },
    { col: 'stem_alt_path', label: 'Alt' }, { col: 'stem_tenor_path', label: 'Tenor' }, { col: 'stem_bas_path', label: 'Bas' },
  ];
  const NOT_SING = /instrument|\bfull\b|backtrack|karaoke|playback|komp|backing|click|klick/i;
  const BACKING = /instrument|karaoke|playback|komp|backing/i;
  function stemsOf(s) {
    const labels = (s.stem_meta && s.stem_meta.labels) || {};
    const list = FIXED_STEMS.filter(f => s[f.col]).map(f => ({ key: f.col, label: labels[f.col] || f.label, path: s[f.col] }));
    (s.extra_stems || []).forEach(ex => list.push({ key: ex.id, label: labels[ex.id] || ex.label, path: ex.path }));
    return list;
  }
  // noter → notbana: konturen styr fältet (uppåt i tonhöjd = fält åt höger), täta noter slås ihop
  function buildChart(notes, diff) {
    const cfg = DIFF[diff] || DIFF[2];
    const src = (notes || []).filter(n => n && n.d >= 0.07 && n.n > 0).sort((a, b) => a.t - b.t);
    const out = [];
    let lane = Math.floor(cfg.lanes / 2), prev = null, lastT = -9;
    for (const n of src) {
      if (n.t - lastT < cfg.gap) continue;
      if (prev != null) {
        const d = n.n - prev;
        if (d) {
          lane += Math.sign(d) * (Math.abs(d) >= 5 && cfg.lanes > 3 ? 2 : 1);
          if (lane < 0) lane = Math.min(1, cfg.lanes - 1);
          if (lane >= cfg.lanes) lane = Math.max(0, cfg.lanes - 2);
        }
      }
      out.push([Math.round(n.t * 1000) / 1000, lane, n.d >= cfg.hold ? n.d : 0]);
      prev = n.n; lastT = n.t;
    }
    // hålltoner får inte gå in i nästa not
    for (let i = 0; i < out.length; i++) {
      if (!out[i][2]) continue;
      const nx = out[i + 1] ? out[i + 1][0] : Infinity;
      const d = Math.min(out[i][2], nx - out[i][0] - 0.15);
      out[i][2] = d >= 0.35 ? Math.round(d * 100) / 100 : 0;
    }
    return out;
  }

  // notbanan – samma ritning på storbilden och mobilen
  function drawHighway(cx, W, Hh, chart, now, st) {
    const L = chart.lanes, lw = W / L, hitY = Hh * 0.84, look = chart.look;
    cx.clearRect(0, 0, W, Hh);
    const bg = cx.createLinearGradient(0, 0, 0, Hh); bg.addColorStop(0, '#07080b'); bg.addColorStop(1, '#151821');
    cx.fillStyle = bg; cx.fillRect(0, 0, W, Hh);
    for (let i = 0; i < L; i++) {
      cx.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)'; cx.fillRect(i * lw, 0, lw, Hh);
      if (st && st.press && st.press[i] && performance.now() - st.press[i] < 120) { cx.fillStyle = LANE_COLORS[i] + '33'; cx.fillRect(i * lw, 0, lw, Hh); }
    }
    // taktlinjer som rör sig (känsla av fart)
    cx.strokeStyle = 'rgba(255,255,255,0.06)'; cx.lineWidth = 1;
    for (let k = Math.floor(now / 0.5); k < now / 0.5 + look * 2 + 1; k++) { const y = hitY - ((k * 0.5 - now) / look) * hitY; if (y > 0 && y < Hh) { cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke(); } }
    const r = Math.min(lw * 0.34, 26);
    // hitlinje
    for (let i = 0; i < L; i++) {
      cx.beginPath(); cx.arc(i * lw + lw / 2, hitY, r + 3, 0, 6.283);
      cx.strokeStyle = LANE_COLORS[i]; cx.lineWidth = 3; cx.stroke();
      cx.fillStyle = st && st.press && st.press[i] && performance.now() - st.press[i] < 120 ? LANE_COLORS[i] : 'rgba(0,0,0,0.55)'; cx.fill();
    }
    const notes = chart.notes;
    for (let i = st ? Math.max(0, st.ptr - 4) : 0; i < notes.length; i++) {
      const [t, l, d] = notes[i];
      if (t - now > look * 1.05) break;
      const jd = st && st.judged ? st.judged[i] : 0;
      const end = t + (d || 0);
      if (end < now - 0.3) continue;
      const x = l * lw + lw / 2, y = hitY - ((t - now) / look) * hitY;
      if (d) {
        const y2 = hitY - ((end - now) / look) * hitY;
        const held = st && st.holdIdx && st.holdIdx.has(i);
        cx.fillStyle = LANE_COLORS[l] + (held ? 'ff' : jd < 0 ? '33' : '88');
        cx.fillRect(x - r * 0.3, Math.max(0, y2), r * 0.6, Math.min(y, hitY) - Math.max(0, y2));
      }
      if (jd > 0) continue;   // träffad
      if (y > Hh + r) continue;
      cx.beginPath(); cx.arc(x, y, r, 0, 6.283);
      cx.fillStyle = jd < 0 ? 'rgba(120,120,120,0.5)' : LANE_COLORS[l]; cx.fill();
      cx.beginPath(); cx.arc(x, y, r * 0.45, 0, 6.283); cx.fillStyle = 'rgba(255,255,255,0.85)'; cx.fill();
    }
  }

  // ---------- storbilden ----------
  const host = (() => {
    let H, o, songs = [], pitchRows = [], selSong = null, selStem = null, phase = 'load', chart = null, chartId = '', ctx = null, bufLead = null, bufBack = null, nodes = [], when = 0, startPos = 0, endPos = 0, live = new Map(), ready = new Set(), clk = null, raf = 0, stopped = false, lastChartSend = 0, offLead = 0, offBack = 0, cv = null;
    const el = id => document.getElementById(id);
    async function setup(box) {
      box.innerHTML = '<div class="box"><h3>🎸 Låt</h3><p>Hämtar låtar med noter…</p></div>';
      try {
        const [pr, sr] = await Promise.all([supabaseClient.from('song_pitch').select('song_id, stem_key'), supabaseClient.from('songs').select('*').order('title')]);
        if (pr.error) throw pr.error;
        pitchRows = pr.data || []; songs = (sr.data || []).filter(s => pitchRows.some(r => r.song_id === s.id));
      } catch (e) { box.innerHTML = `<div class="box"><h3>🎸 Låt</h3><p>Kunde inte hämta låtar: ${H ? H.esc(e.message || e) : ''}</p></div>`; return; }
      if (!songs.length) { box.innerHTML = '<div class="box"><h3>🎸 Låt</h3><p>Inga låtar har noter än – analysera en stämma i Röstövningen först.</p></div>'; return; }
      box.innerHTML = `<div class="box"><h3>🎸 Låt</h3><select id="hrSong">${songs.map((s, i) => `<option value="${i}">${esc(s.title)}</option>`).join('')}</select>
        <h3 style="margin-top:0.9rem">Stämma att spela</h3><select id="hrStem"></select>
        <p>Noterna kommer från Röstövningens tonkurvor. Storbilden spelar stämman och kompet.</p></div>`;
      const fillStems = () => {
        selSong = songs[+el('hrSong').value];
        const keys = pitchRows.filter(r => r.song_id === selSong.id).map(r => r.stem_key);
        let list = stemsOf(selSong).filter(st => keys.includes(st.key));
        const sing = list.filter(st => !NOT_SING.test(st.label || '') && st.key !== 'stem_backtrack_path');
        if (sing.length) list = sing;
        el('hrStem').innerHTML = list.map((st, i) => `<option value="${esc(st.key)}">${esc(st.label)}</option>`).join('');
        const pref = list.find(st => /vocal|vokal|sång|lead|melodi/i.test(st.label || '')) || list[0];
        if (pref) el('hrStem').value = pref.key;
        selStem = pref || null;
      };
      el('hrSong').addEventListener('change', fillStems);
      el('hrStem').addEventListener('change', () => { selStem = stemsOf(selSong).find(st => st.key === el('hrStem').value) || null; });
      fillStems();
    }
    function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function canOpen() { if (!selSong || !selStem) { alert('Välj en låt med noter först.'); return false; } return true; }
    function lobby(opts, h) { H = h; o = opts; }
    async function loadBuf(path) {
      const { data, error } = await supabaseClient.storage.from('heavy-voices-stems').createSignedUrl(path, 3600);
      if (error) throw error;
      const r = await fetch(data.signedUrl); if (!r.ok) throw new Error('HTTP ' + r.status);
      return await ctx.decodeAudioData(await r.arrayBuffer());
    }
    async function start(opts, h) {
      H = h; o = opts; stopped = false; phase = 'load'; live = new Map(); ready = new Set(); chart = null;
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      try { await ctx.resume(); } catch (e) {}
      const song = selSong, st = selStem;
      H.el.innerHTML = `<div class="gstage"><div class="big-emo">🎸</div><h2 class="gtitle">${H.esc(song.title)}</h2><p class="text-muted" id="hrLoad">Laddar noter…</p></div>`;
      try {
        const { data, error } = await supabaseClient.from('song_pitch').select('stem_key, data').eq('song_id', song.id);
        if (error) throw error;
        const row = (data || []).find(r => r.stem_key === st.key);
        if (!row || !row.data) throw new Error('Stämman saknar noter');
        let notes = Array.isArray(row.data.edited_notes) && row.data.edited_notes.length ? row.data.edited_notes
          : (window.PitchAnalyze && PitchAnalyze.foldOctaves ? PitchAnalyze.foldOctaves(row.data) : row.data).notes;
        const c = DIFF[o.diff] || DIFF[2];
        chart = { id: String(Date.now()), lanes: c.lanes, look: c.look, win: c.win, title: song.title, stem: st.label, notes: buildChart(notes, o.diff) };
        if (chart.notes.length < 4) throw new Error('För få noter i stämman');
        chartId = chart.id;
        el('hrLoad').textContent = 'Laddar ljud…';
        const back = stemsOf(song).find(x => x.key === 'stem_backtrack_path') || stemsOf(song).find(x => x !== st && BACKING.test(x.label || ''));
        const offs = song.stem_offsets || {};
        offLead = (Number(offs[st.key]) || 0) / 1000; offBack = back ? (Number(offs[back.key]) || 0) / 1000 : 0;
        const [a, b] = await Promise.allSettled([loadBuf(st.path), back ? loadBuf(back.path) : Promise.resolve(null)]);
        bufLead = a.status === 'fulfilled' ? a.value : null; bufBack = b.status === 'fulfilled' ? b.value : null;
        if (!bufLead && !bufBack) throw new Error('Kunde inte ladda ljudet');
      } catch (e) {
        if (stopped) return;
        H.el.innerHTML = `<div class="gstage"><h2 class="gtitle">Det gick inte</h2><p class="text-muted">${H.esc(e.message || e)}</p></div>`; return;
      }
      if (stopped) return;
      phase = 'ready';
      const last = chart.notes[chart.notes.length - 1];
      const dur = (bufLead || bufBack).duration;
      startPos = Math.max(0, chart.notes[0][0] - 3.5);
      endPos = Math.min(last[0] + last[2] + 2.5, dur + (bufLead ? 0 : offLead));
      H.el.innerHTML = `<div class="game">
        <div class="gstage hero-stage">
          <div class="text-muted">${H.esc(chart.stem)} · ${DIFF[o.diff].name} · ${chart.notes.length} noter</div>
          <h2 class="gtitle">${H.esc(song.title)}</h2>
          <div class="hw-wrap"><canvas id="hrCv" width="600" height="700"></canvas><div class="gover" id="hrOver"></div></div>
          <div class="timer"><div id="hrProg" style="transform:scaleX(0)"></div></div>
          <div class="acts" style="justify-content:center"><button type="button" id="hrGo">▶ Starta låten</button><button type="button" class="btn-outline" id="hrStop" hidden>⏹ Avsluta låten</button></div>
        </div>
        <div class="side"><div class="box"><h3>🏆 Topplista</h3><div id="hrBoard"></div></div></div></div>`;
      cv = el('hrCv');
      el('hrOver').innerHTML = `<div><div class="big">Redo?</div><p>Mobilerna laddar notbanan – tryck Starta när alla är med.</p></div>`;
      el('hrGo').addEventListener('click', begin);
      el('hrStop').addEventListener('click', () => end());
      sendChart(true);
      renderBoard();
      H.sendState();
    }
    function sendChart(force) {
      if (!chart || (!force && performance.now() - lastChartSend < 1500)) return;
      lastChartSend = performance.now();
      H.msg({ k: 'chart', chart });
    }
    const songPos = () => startPos + (ctx.currentTime - when) - (ctx.outputLatency || ctx.baseLatency || 0);
    function begin() {
      if (phase !== 'ready') return;
      phase = 'count';
      el('hrGo').hidden = true; el('hrStop').hidden = false;
      const lead = 3.5;
      when = ctx.currentTime + lead;
      const add = (buf, inFile, gain) => {
        if (!buf || inFile >= buf.duration) return;
        const src = ctx.createBufferSource(); src.buffer = buf;
        const g = ctx.createGain(); g.gain.value = gain; src.connect(g); g.connect(ctx.destination);
        if (inFile >= 0) src.start(when, inFile); else src.start(when - inFile, 0);
        nodes.push(src);
      };
      add(bufLead, startPos, 0.95);
      add(bufBack, startPos + offLead - offBack, 0.85);
      clk = setInterval(() => { if (phase === 'count' || phase === 'play') H.msg({ k: 'clk', pos: Math.round(songPos() * 1000) / 1000, id: chartId }); }, 350);
      H.msg({ k: 'clk', pos: songPos(), id: chartId });
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
      H.sendState();
    }
    let lastBoard = 0;
    function loop() {
      if (stopped || !cv) return;
      const pos = songPos();
      if (phase === 'count' && pos >= startPos) { phase = 'play'; H.sendState(); }
      const ov = el('hrOver');
      if (phase === 'count') { ov.hidden = false; ov.innerHTML = `<div><div class="big">${Math.max(1, Math.ceil(startPos - pos))}</div></div>`; }
      else ov.hidden = true;
      const r = cv.getBoundingClientRect();
      if (cv.width !== Math.round(r.width * devicePixelRatio)) { cv.width = Math.round(r.width * devicePixelRatio); cv.height = Math.round(r.height * devicePixelRatio); }
      drawHighway(cv.getContext('2d'), cv.width, cv.height, chart, pos, null);
      const pb = el('hrProg'); if (pb) pb.style.transform = `scaleX(${Math.max(0, Math.min(1, (pos - startPos) / (endPos - startPos)))})`;
      if (performance.now() - lastBoard > 500) { lastBoard = performance.now(); renderBoard(); }
      if (pos >= endPos) { end(); return; }
      raf = requestAnimationFrame(loop);
    }
    function renderBoard() {
      const b = el('hrBoard'); if (!b) return;
      const rows = H.online().map(p => ({ p, l: live.get(p.pid) || { s: 0, c: 0, h: 0, n: 0 } })).sort((a, b) => b.l.s - a.l.s);
      b.innerHTML = '<div class="board">' + rows.map(({ p, l }, i) => `<div class="${l.c >= 10 ? 'ok' : ''}"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'}</span><span>${H.esc(p.name)} ${ready.has(p.pid) ? '' : '<small class="text-muted">⏳</small>'}</span><span>${l.c >= 10 ? '🔥' + l.c : l.n ? Math.round(100 * l.h / l.n) + '%' : ''}</span><b>${l.s}</b></div>`).join('') + '</div>';
    }
    function stopNodes() { nodes.forEach(n => { try { n.stop(); } catch (e) {} }); nodes = []; clearInterval(clk); clk = null; }
    function end() {
      if (phase !== 'play' && phase !== 'count') return;
      stopNodes(); cancelAnimationFrame(raf);
      phase = 'done';
      el('hrOver').hidden = false; el('hrOver').innerHTML = '<div><div class="big">🤘</div><p>Räknar poängen…</p></div>';
      el('hrStop').hidden = true;
      H.sendState();
      setTimeout(() => {
        if (stopped) return;
        live.forEach((l, pid) => { const p = H.players.get(pid); if (p) p.score = l.s; });
        H.finish();
      }, 3000);
    }
    function onAct(m) {
      if (m.t === 'needchart') sendChart(false);
      else if (m.t === 'ack' && m.id === chartId) { ready.add(m.pid); renderBoard(); }
      else if (m.t === 'sc' && m.id === chartId) { live.set(m.pid, { s: Math.max(0, Math.round(+m.s || 0)), c: +m.c || 0, h: +m.h || 0, n: +m.n || 0 }); ready.add(m.pid); }
    }
    function state() {
      return { phase, chartId, title: chart ? chart.title : selSong ? selSong.title : '', stem: chart ? chart.stem : '', diff: o ? DIFF[o.diff].name : '' };
    }
    function stop() { stopped = true; stopNodes(); cancelAnimationFrame(raf); }
    return { setup, canOpen, lobby, start, onAct, state, stop };
  })();

  // ---------- mobilen ----------
  const player = (() => {
    let chart = null, samples = [], off = null, lat = 0, st = null, raf = 0, sendT = 0, lastNeed = 0;
    try { lat = Number(localStorage.getItem('hv-hero-lat')) || 0; } catch (e) {}
    const setLat = v => { lat = Math.max(-300, Math.min(600, v)); try { localStorage.setItem('hv-hero-lat', String(lat)); } catch (e) {} };
    const now = () => off == null ? null : performance.now() / 1000 - off - lat / 1000;
    function key(s, me, pid) {
      const haveChart = chart && chart.id === s.chartId;
      return (s.phase === 'count' || s.phase === 'play' ? 'hw' : s.phase) + '|' + s.chartId + '|' + (haveChart ? 1 : 0);
    }
    function need(A) { if (performance.now() - lastNeed > 2000) { lastNeed = performance.now(); A.send('needchart', {}); } }
    function latBox() {
      return `<div class="latbox"><span>Ljudet från storbilden kommer efter noterna?</span>
        <div><button type="button" class="btn-outline" data-l="-20">−</button><b id="hrLat">${lat > 0 ? '+' : ''}${lat} ms</b><button type="button" class="btn-outline" data-l="20">+</button></div></div>`;
    }
    function wireLat(A) { document.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => { setLat(lat + +b.dataset.l); const e = A.$('hrLat'); if (e) e.textContent = (lat > 0 ? '+' : '') + lat + ' ms'; })); }
    function render(s, me, A) {
      const head = `<div class="head"><span>🎸 Rock Hero</span><span class="w">${A.esc(s.diff || '')}</span></div>`;
      const haveChart = chart && chart.id === s.chartId;
      if (s.phase === 'load') { A.render(head + `<div class="center"><div class="big">🎸</div><h1>${A.esc(s.title || '')}</h1><p>Storbilden laddar låten…</p><div class="spin"></div></div>`); return; }
      if (!haveChart && s.chartId) { need(A); A.render(head + '<div class="center"><div class="spin"></div><p>Hämtar notbanan…</p></div>'); return; }
      if (s.phase === 'ready') {
        A.render(head + `<div class="center"><div class="big">🎸</div><h1>${A.esc(chart.title)}</h1><span class="pill">${A.esc(chart.stem)} · ${chart.notes.length} noter</span>
          <p>Tryck i rätt fält när noten når ringen. Håll kvar på långa toner!</p>
          <div class="lanes-demo">${[...Array(chart.lanes)].map((_, i) => `<i style="background:${LANE_COLORS[i]}"></i>`).join('')}</div>
          <p>✅ Redo – vänta på att låten startar.</p>${latBox()}</div>`);
        wireLat(A);
        return;
      }
      if (s.phase === 'done') {
        if (st) A.send('sc', { id: chart.id, s: Math.round(st.score), c: st.combo, h: st.hits, n: st.judgedN, final: true });
        const pct = st && st.judgedN ? Math.round(100 * st.hits / chart.notes.length) : 0;
        A.render(head + `<div class="center"><div class="big">🤘</div><h1>${st ? Math.round(st.score) : 0} poäng</h1>
          <span class="pill">${pct}% träff · längsta kombo ${st ? st.maxCombo : 0}</span><p>Resultatet visas på storbilden.</p>${latBox()}</div>`);
        wireLat(A);
        return;
      }
      // notbanan
      const N = chart.notes.length;
      st = st && st.id === chart.id ? st : { id: chart.id, ptr: 0, judged: new Int8Array(N), score: 0, combo: 0, maxCombo: 0, hits: 0, judgedN: 0, press: new Array(chart.lanes).fill(0), holds: new Map(), holdIdx: new Set(), fx: '', fxT: 0 };
      A.render(`<div class="hero">
        <div class="hud"><b id="hrScore">0</b><span id="hrMult">x1</span><span id="hrCombo"></span></div>
        <div class="hw-wrap phone"><canvas id="hrCv"></canvas><div class="hrfx" id="hrFx"></div><div class="gover" id="hrCd" hidden></div></div></div>`);
      const cv = A.$('hrCv'), cx = cv.getContext('2d');
      const fit = () => { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * devicePixelRatio); cv.height = Math.round(r.height * devicePixelRatio); };
      fit(); window.addEventListener('resize', fit); A.onCleanup(() => window.removeEventListener('resize', fit));
      const mult = () => Math.min(4, 1 + Math.floor(st.combo / 10));
      const fx = (txt, cls) => { const e = A.$('hrFx'); if (!e) return; e.textContent = txt; e.className = 'hrfx ' + cls; void e.offsetWidth; e.classList.add('go'); };
      const press = (lane, pidKey) => {
        const t = now(); if (t == null || lane < 0 || lane >= chart.lanes) return;
        st.press[lane] = performance.now();
        const W = chart.win;
        let best = -1, bd = 1e9;
        for (let i = st.ptr; i < N; i++) {
          const nt = chart.notes[i]; if (nt[0] - t > W) break;
          if (st.judged[i] || nt[1] !== lane) continue;
          const d = Math.abs(nt[0] - t); if (d < bd) { bd = d; best = i; }
        }
        if (best < 0 || bd > W) return;
        const perfect = bd <= W * 0.45;
        st.judged[best] = perfect ? 2 : 1; st.judgedN++; st.hits++; st.combo++; st.maxCombo = Math.max(st.maxCombo, st.combo);
        st.score += (perfect ? 100 : 50) * mult();
        fx(perfect ? 'PERFEKT!' : 'BRA!', perfect ? 'pf' : 'ok');
        const nt = chart.notes[best];
        if (nt[2]) { st.holds.set(pidKey, { i: best, end: nt[0] + nt[2], last: t }); st.holdIdx.add(best); }
      };
      const release = pidKey => { const h = st.holds.get(pidKey); if (h) { st.holdIdx.delete(h.i); st.holds.delete(pidKey); } };
      cv.addEventListener('pointerdown', e => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        press(Math.floor(((e.clientX - r.left) / r.width) * chart.lanes), 'p' + e.pointerId);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => cv.addEventListener(ev, e => release('p' + e.pointerId)));
      const KEYS = ['a', 's', 'd', 'f', 'g'];
      const kd = e => { const i = KEYS.indexOf(e.key.toLowerCase()); if (i >= 0 && !e.repeat) press(i, 'k' + i); };
      const ku = e => { const i = KEYS.indexOf(e.key.toLowerCase()); if (i >= 0) release('k' + i); };
      window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
      A.onCleanup(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); });
      const loop = () => {
        const t = now();
        const cd = A.$('hrCd');
        if (t == null) { cd.hidden = false; cd.innerHTML = '<div><p>Synkar med storbilden…</p></div>'; raf = requestAnimationFrame(loop); return; }
        const first = chart.notes[0][0];
        if (A.state && A.state.phase === 'count' && first - t > 3.6) { cd.hidden = false; cd.innerHTML = '<div><div class="big">🎸</div></div>'; }
        else cd.hidden = true;
        // missade noter
        const W = chart.win;
        while (st.ptr < N && chart.notes[st.ptr][0] < t - W) {
          if (!st.judged[st.ptr]) { st.judged[st.ptr] = -1; st.judgedN++; if (st.combo >= 5) fx('MISS', 'miss'); st.combo = 0; }
          st.ptr++;
        }
        // hålltoner
        st.holds.forEach((h, k) => {
          const upto = Math.min(t, h.end);
          if (upto > h.last) { st.score += (upto - h.last) * 100 * mult(); h.last = upto; }
          if (t >= h.end) { st.holds.delete(k); st.holdIdx.delete(h.i); }
        });
        drawHighway(cx, cv.width, cv.height, chart, t, st);
        A.$('hrScore').textContent = Math.round(st.score);
        A.$('hrMult').textContent = 'x' + mult(); A.$('hrMult').className = 'm' + mult();
        A.$('hrCombo').textContent = st.combo >= 5 ? `🔥 ${st.combo}` : '';
        if (performance.now() - sendT > 1000) { sendT = performance.now(); A.send('sc', { id: chart.id, s: Math.round(st.score), c: st.combo, h: st.hits, n: st.judgedN }); }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      A.onCleanup(() => cancelAnimationFrame(raf));
    }
    function onMsg(m, A) {
      if (m.k === 'chart' && m.chart) {
        const isNew = !chart || chart.id !== m.chart.id;
        if (isNew) { chart = m.chart; st = null; samples = []; off = null; }
        A.send('ack', { id: chart.id });
        if (isNew) A.rerender();   // nyckeln ändras när notbanan finns → mobilen ritas om
      } else if (m.k === 'clk' && chart && m.id === chart.id) {
        // minsta (lokal tid − värdens position) = minst nätfördröjning
        const smp = performance.now() / 1000 - m.pos;
        if (off != null && Math.abs(smp - off) > 0.5) samples = [];
        samples.push(smp); if (samples.length > 14) samples.shift();
        off = Math.min(...samples);
      }
    }
    return { key, render, onMsg };
  })();

  G.hero = {
    id: 'hero', emo: '🎸', name: '🎸 Rock Hero', title: 'Rock <span class="hot">Hero</span>', minPlayers: 1, bgMusic: false,
    desc: 'Guitar Hero på er egen repertoar! Noterna från Röstövningen faller ner på mobilen – tryck i takt med musiken från storbilden.',
    opts: [{ key: 'diff', label: 'Svårighet', values: [[1, 'Lätt (3 fält)'], [2, 'Medel (4 fält)'], [3, 'Svår (5 fält)']], def: 2 }],
    host, player,
  };
})();
