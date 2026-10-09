// Racet – Mobilspel. Alla kör samtidigt: tryck vänster–höger om vartannat så fort du kan
// (eller vippa mobilen fram och tillbaka). Bilarna kör på storbilden. Ett eller tre heat.
(function () {
  const G = (window.HVGames = window.HVGames || {});
  const PTS = [100, 75, 55, 40, 30, 20, 15, 10, 5];
  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#e5e7eb', '#f43f5e', '#14b8a6'];
  const CARS = ['🏎️', '🚗', '🚙', '🛻', '🚕', '🏍️', '🚓', '🚐'];

  // ---------- storbilden ----------
  const host = (() => {
    let H, o, heat = 0, phase = 'grid', target = 60, prog = new Map(), shown = new Map(), fin = [], tGo = 0, tm = null, raf = 0, stopped = false, nextT = null, endT = null, lanes = [], tStart = 0;
    const el = id => document.getElementById(id);
    function start(opts, h) {
      H = h; o = opts; stopped = false; heat = 0;
      target = Math.round((o.len || 60) * (o.mode === 'tilt' ? 0.45 : 1));
      H.el.innerHTML = `<div class="rgame">
        <div class="rhead"><h2 class="gtitle" id="rcTitle"></h2><div class="rcount" id="rcCount"></div></div>
        <div class="track" id="rcTrack"></div>
        <div class="acts" style="justify-content:center"><button type="button" class="btn-outline" id="rcNext">⏭ Vidare</button></div>
        <div id="rcBoard" class="rboard"></div></div>`;
      el('rcNext').addEventListener('click', () => { if (phase === 'race') endHeat(); else if (phase === 'heat') nextHeat(); else if (phase === 'grid') go(); });
      nextHeat();
    }
    function nextHeat() {
      clearTimeout(nextT); clearTimeout(endT);
      if (stopped) return;
      heat++;
      if (heat > o.heats) { H.finish(); return; }
      phase = 'grid'; fin = []; prog = new Map(); shown = new Map();
      lanes = H.online().map(p => p.pid);
      el('rcTitle').textContent = o.heats > 1 ? `Heat ${heat} av ${o.heats}` : 'Racet';
      buildTrack();
      H.board(el('rcBoard'));
      if (tm) tm.stop();
      tm = H.timer(8000, (f, left) => { el('rcCount').textContent = left > 3000 ? (o.mode === 'tilt' ? 'Håll mobilen redo att vippa!' : 'Fingrarna redo!') : String(Math.ceil(left / 1000)); }, go);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
      H.sendState();
    }
    function buildTrack() {
      const tr = el('rcTrack');
      tr.style.setProperty('--n', Math.max(lanes.length, 1));
      tr.innerHTML = lanes.map((pid, i) => `<div class="lane" style="--c:${COLORS[i % COLORS.length]}"><span class="lname">${H.esc(H.pname(pid))}</span><span class="car" id="car-${i}"><span>${CARS[i % CARS.length]}</span></span><span class="place" id="pl-${i}"></span></div>`).join('') + '<div class="flag"></div>';
    }
    function go() {
      if (phase !== 'grid') return;
      if (tm) tm.stop();
      phase = 'race'; tGo = performance.now(); tStart = Date.now();
      el('rcCount').textContent = 'KÖR! 🏁';
      setTimeout(() => { if (phase === 'race') el('rcCount').textContent = ''; }, 1200);
      endT = setTimeout(endHeat, 120000);
      H.sendState();
    }
    function loop() {
      lanes.forEach((pid, i) => {
        const want = (prog.get(pid) || 0) / target;
        const cur = shown.get(pid) || 0, next = cur + (want - cur) * 0.25;
        shown.set(pid, next);
        const c = document.getElementById('car-' + i);
        if (c) c.style.left = (1 + Math.min(1, next) * 87) + '%';
      });
      raf = requestAnimationFrame(loop);
    }
    function onAct(m) {
      if (m.t !== 'prog' || phase !== 'race' || !lanes.includes(m.pid)) return;
      const n = Math.min(target, Math.max(prog.get(m.pid) || 0, Number(m.n) || 0));
      prog.set(m.pid, n);
      if (n >= target && !fin.some(f => f.pid === m.pid)) {
        const ms = performance.now() - tGo;
        fin.push({ pid: m.pid, ms });
        const place = fin.length, i = lanes.indexOf(m.pid);
        const pl = document.getElementById('pl-' + i); if (pl) pl.textContent = `${['🥇', '🥈', '🥉'][place - 1] || place + '.'} ${(ms / 1000).toFixed(1)} s`;
        H.msg({ k: 'fin', pid: m.pid, place, ms });
        if (place === 1) { H.confetti(120, false); clearTimeout(endT); endT = setTimeout(endHeat, 20000); }
        H.sendState();
        if (lanes.every(pid => fin.some(f => f.pid === pid) || !(H.players.get(pid) || {}).on)) setTimeout(endHeat, 1200);
      }
    }
    function endHeat() {
      if (phase !== 'race') return;
      clearTimeout(endT);
      phase = 'heat';
      // de som inte kom i mål placeras efter hur långt de kom
      const rest = lanes.filter(pid => !fin.some(f => f.pid === pid)).sort((a, b) => (prog.get(b) || 0) - (prog.get(a) || 0));
      const order = fin.map(f => f.pid).concat(rest);
      order.forEach((pid, i) => { const p = H.players.get(pid); if (p && (fin.some(f => f.pid === pid) || (prog.get(pid) || 0) > 0)) p.score += PTS[i] || 5; });
      el('rcCount').textContent = `🏆 ${H.pname(order[0])} vinner heatet!`;
      H.board(el('rcBoard'));
      H.sendState();
      nextT = setTimeout(nextHeat, heat >= o.heats ? 4000 : 7000);
    }
    function state() {
      return { phase, turn: heat, total: o.heats, mode: o.mode, target, lanes,
        fin: fin.map((f, i) => [f.pid, i + 1, Math.round(f.ms)]),
        remainMs: phase === 'grid' && tm ? tm.left : null, timeMs: 8000 };
    }
    function stop() { stopped = true; clearTimeout(nextT); clearTimeout(endT); cancelAnimationFrame(raf); if (tm) tm.stop(); }
    return { start, onAct, state, stop };
  })();

  // ---------- mobilen ----------
  const player = (() => {
    let tiltOk = false;
    function key(s, me, pid) { return [s.phase, s.turn, (s.fin || []).some(f => f[0] === pid)].join('|'); }
    function render(s, me, A) {
      const head = `<div class="head"><span>🏁 Racet</span><span class="w">${s.total > 1 ? `Heat ${s.turn}/${s.total}` : ''}</span></div>`;
      const inRace = (s.lanes || []).includes(A.pid);
      const myFin = (s.fin || []).find(f => f[0] === A.pid);
      if (!inRace) { A.render(head + '<div class="center"><div class="big">🍿</div><h1>Titta på storbilden</h1><p>Du kommer med i nästa heat.</p></div>'); return; }
      if (s.phase === 'grid') {
        const tilt = s.mode === 'tilt';
        A.render(head + `<div class="center"><div class="big">🚦</div><h1 id="rcCd">Gör dig redo!</h1>
          <p>${tilt ? 'Vippa mobilen höger–vänster så snabbt du kan när det blir grönt.' : 'Tryck VÄNSTER och HÖGER om vartannat så snabbt du kan!'}</p>
          ${tilt && !tiltOk ? '<button type="button" class="bigbtn" id="rcTilt">📱 Aktivera lutning</button>' : ''}</div>`);
        const btn = A.$('rcTilt');
        if (btn) btn.addEventListener('click', async () => {
          try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { btn.textContent = 'Nekad – du kör med knappar'; return; } } } catch (e) {}
          tiltOk = true; btn.textContent = '✅ Lutning på'; btn.disabled = true;
        });
        const dl = performance.now() + (s.remainMs || 0);
        let raf = 0;
        const t = () => { const h = A.$('rcCd'); if (!h) return; const left = dl - performance.now(); if (left < 3000) h.textContent = left > 0 ? String(Math.ceil(left / 1000)) : 'KÖR!'; raf = requestAnimationFrame(t); };
        raf = requestAnimationFrame(t); A.onCleanup(() => cancelAnimationFrame(raf));
        return;
      }
      if (s.phase === 'heat' || myFin) {
        const f = myFin;
        A.render(head + `<div class="center"><div class="big">${f ? ['🥇', '🥈', '🥉'][f[1] - 1] || '🏁' : '🏁'}</div><h1>${f ? `Du kom ${f[1]}:a!` : s.phase === 'heat' ? 'Heatet är slut' : ''}</h1>
          ${f ? `<span class="pill">${(f[2] / 1000).toFixed(1)} s</span>` : ''}<p>${s.phase === 'heat' ? 'Nästa heat strax…' : 'Heja på de andra! 📣'}</p></div>`);
        if (f && f[1] === 1) A.confetti(150, false);
        return;
      }
      // racet pågår
      let n = 0, lastSide = '', sent = 0, sendT = null;
      let unit = 1;   // knappar i vipp-läget räknas som en knappt halv vipp (vippa är långsammare)
      const bump = () => {
        n = Math.round((n + unit) * 100) / 100; const bar = A.$('rcBar'); if (bar) bar.style.transform = `scaleX(${Math.min(1, n / s.target)})`;
        if (!sendT) sendT = setTimeout(() => { sendT = null; if (n !== sent) { sent = n; A.send('prog', { n }); } }, 90);
        if (n >= s.target) { clearTimeout(sendT); sendT = null; A.send('prog', { n }); A.vibrate([50, 30, 120]); }
      };
      const useTilt = s.mode === 'tilt' && tiltOk;
      A.render(head + `<div class="timer"><div id="rcBar" style="transform:scaleX(0)"></div></div>
        ${useTilt ? `<div class="center tiltzone"><div class="tiltcar" id="rcTc">🏎️</div><h1>VIPPA!</h1><p>Vinkla mobilen höger–vänster om vartannat</p><button type="button" class="btn-outline" id="rcBtns">Använd knappar i stället</button></div>`
          : `<div class="pedals"><button type="button" data-s="L">◀<br>VÄNSTER</button><button type="button" data-s="R">HÖGER<br>▶</button></div>`}`);
      A.$('rcBar').style.transform = 'scaleX(0)';
      const wireButtons = () => document.querySelectorAll('.pedals button').forEach(b => b.addEventListener('pointerdown', e => {
        e.preventDefault();
        b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
        if (b.dataset.s === lastSide) return;   // måste vara vartannat
        lastSide = b.dataset.s; bump();
      }));
      if (!useTilt) { if (s.mode === 'tilt') unit = 0.45; wireButtons(); return; }
      let side = '';
      const onOri = e => {
        const g = e.gamma; if (g == null) return;
        const tc = A.$('rcTc'); if (tc) tc.style.transform = `rotate(${Math.max(-45, Math.min(45, g))}deg)`;
        const now = g > 20 ? 'R' : g < -20 ? 'L' : '';
        if (now && now !== side) { side = now; bump(); }
      };
      window.addEventListener('deviceorientation', onOri);
      A.onCleanup(() => window.removeEventListener('deviceorientation', onOri));
      A.$('rcBtns').addEventListener('click', () => {
        window.removeEventListener('deviceorientation', onOri);
        A.$('screen').querySelector('.tiltzone').outerHTML = '<div class="pedals"><button type="button" data-s="L">◀<br>VÄNSTER</button><button type="button" data-s="R">HÖGER<br>▶</button></div>';
        unit = 0.45; wireButtons();
      });
    }
    return { key, render };
  })();

  G.race = {
    id: 'race', emo: '🏁', name: '🏁 Racet', title: 'Rac<span class="hot">et</span>', minPlayers: 1, bgMusic: true,
    desc: 'Alla kör samtidigt! Tryck vänster–höger om vartannat så fort du kan – eller vippa mobilen. Bilarna kör på storbilden.',
    opts: [
      { key: 'mode', label: 'Styrning', values: [['tap', '👆 Trycka'], ['tilt', '📱 Vippa mobilen']], def: 'tap', help: 'Vippa: mobilen frågar om lov att använda rörelsesensorn. Saknas den blir det knappar.' },
      { key: 'len', label: 'Banans längd', values: [[40, 'Kort'], [70, 'Mellan'], [110, 'Lång']], def: 70 },
      { key: 'heats', label: 'Antal heat', values: [[1, '1'], [3, '3'], [5, '5']], def: 3 },
    ],
    host, player,
  };
})();
