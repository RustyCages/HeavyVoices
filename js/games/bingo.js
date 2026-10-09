// Låtbingo – Mobilspel. Alla får en bingobricka med låttitlar på mobilen, storbilden spelar
// 20–30 s-klipp (PartyMusic). Känner du igen låten kryssar du den; hel rad/kolumn/diagonal = BINGO.
// Värden kontrollerar att alla låtar på raden verkligen har spelats.
(function () {
  const G = (window.HVGames = window.HVGames || {});
  const lines = n => {
    const L = [];
    for (let r = 0; r < n; r++) L.push([...Array(n)].map((_, c) => r * n + c));
    for (let c = 0; c < n; c++) L.push([...Array(n)].map((_, r) => r * n + c));
    L.push([...Array(n)].map((_, i) => i * n + i));
    L.push([...Array(n)].map((_, i) => i * n + (n - 1 - i)));
    return L;
  };
  const POINTS = [300, 200, 120, 80];

  // ---------- storbilden ----------
  const host = (() => {
    let H, o, feed = null, pool = [], cards = {}, played = [], cur = -1, seq = [], phase = 'load', audio = null, tm = null, winners = [], auto = true, nextT = null, stopped = false, bingoNow = null;
    const need = size => size === 3 ? 18 : 28;
    function el(id) { return document.getElementById(id); }
    function lobby(opts, h) {
      H = h; o = opts;
      if (!feed) feed = PartyMusic.createFeed({ noYear: true, parallel: 3, ahead: 0 });
      feed.warm(need(o.size));     // börja hämta låtar medan spelarna går med
    }
    function cardFor(pid) {
      if (!cards[pid]) cards[pid] = H.shuffle(pool.map((_, i) => i)).slice(0, o.size * o.size);
      return cards[pid];
    }
    async function start(opts, h) {
      H = h; o = opts; stopped = false;
      winners = []; played = []; cur = -1; cards = {}; bingoNow = null; phase = 'load';
      H.el.innerHTML = `<div class="gstage"><div class="vinyl spin"></div><h2 class="gtitle">Hämtar låtar…</h2><p class="text-muted" id="bgLoad">0 / ${need(o.size)}</p></div>`;
      if (!feed) feed = PartyMusic.createFeed({ noYear: true, parallel: 3, ahead: 0 });
      const got = await feed.take(need(o.size), (k, n) => { const e = el('bgLoad'); if (e) e.textContent = `${k} / ${n}`; });
      if (stopped) return;
      pool = got;
      if (pool.length < o.size * o.size + 2) {
        H.el.innerHTML = `<div class="gstage"><h2 class="gtitle">Kunde inte hämta låtar</h2><p class="text-muted">Fick bara ${pool.length} låtar – kontrollera nätet och försök igen.</p></div>`;
        feed = null; return;
      }
      feed = null;   // nästa omgång hämtar nya låtar
      H.online().forEach(p => cardFor(p.pid));
      seq = H.shuffle(pool.map((_, i) => i));
      H.el.innerHTML = `<div class="game">
        <div class="gstage">
          <div class="text-muted" id="bgNum"></div>
          <div class="vinyl" id="bgVinyl"></div>
          <h2 class="gtitle" id="bgTitle"></h2>
          <div class="gsub" id="bgSub"></div>
          <div class="timer"><div id="bgTimer"></div></div>
          <div class="acts" style="justify-content:center"><button type="button" class="btn-outline" id="bgPause">⏸ Paus</button><button type="button" class="btn-outline" id="bgNext">⏭ Nästa låt</button>
            <label class="chk"><input type="checkbox" id="bgAuto" checked> Nästa låt automatiskt</label></div>
          <div class="gover" id="bgOver" hidden></div>
        </div>
        <div class="side">
          <div class="box"><h3>🏆 Bingo</h3><div id="bgWin" class="text-muted">Ingen ännu – spela ${o.winners === 1 ? 'tills första bingot' : `tills ${o.winners} bingon`}.</div></div>
          <div class="box"><h3>🎵 Spelade låtar</h3><div class="played" id="bgPlayed"></div></div>
        </div></div>`;
      el('bgPause').addEventListener('click', togglePause);
      el('bgNext').addEventListener('click', () => { if (phase === 'play') reveal(); else if (phase === 'reveal') next(); });
      el('bgAuto').addEventListener('change', e => { auto = e.target.checked; if (auto && phase === 'reveal' && !nextT) nextT = setTimeout(next, 3500); });
      auto = true;
      next();
    }
    function togglePause() {
      if (!tm || phase !== 'play') return;
      if (tm.running) { tm.pause(); if (audio) audio.pause(); el('bgPause').textContent = '▶ Fortsätt'; el('bgVinyl').classList.remove('spin'); }
      else { tm.resume(); if (audio) audio.play().catch(() => {}); el('bgPause').textContent = '⏸ Paus'; el('bgVinyl').classList.add('spin'); }
    }
    function stopAudio() { if (audio) { audio.pause(); audio.removeAttribute('src'); try { audio.load(); } catch (e) {} audio = null; } if (tm) tm.stop(); tm = null; }
    function next() {
      clearTimeout(nextT); nextT = null; stopAudio();
      if (stopped) return;
      cur++;
      if (cur >= seq.length) { H.toast('Alla låtar är spelade!'); H.finish(); return; }
      const idx = seq[cur], s = pool[idx];
      played.push(idx); phase = 'play';
      el('bgNum').textContent = `Låt ${cur + 1} av ${seq.length}`;
      el('bgTitle').textContent = 'Vilken låt är det här? 🤔';
      el('bgSub').textContent = 'Kryssa den på brickan om du har den!';
      el('bgVinyl').classList.add('spin'); el('bgPause').textContent = '⏸ Paus';
      audio = new Audio(s.url); audio.volume = 1;
      audio.addEventListener('error', () => { if (phase === 'play' && pool[seq[cur]] === s) { H.toast('Klippet gick inte att spela – nästa låt'); reveal(); } }, { once: true });
      audio.play().catch(() => H.toast('Tryck ▶ om ljudet inte startar'));
      tm = H.timer(o.clip * 1000, f => { const b = el('bgTimer'); if (b) b.style.transform = `scaleX(${f})`; }, reveal);
      H.sendState();
    }
    function reveal() {
      if (phase !== 'play') return;
      const s = pool[seq[cur]];
      stopAudio(); phase = 'reveal';
      el('bgVinyl').classList.remove('spin');
      el('bgTitle').textContent = s.title; el('bgSub').textContent = s.artist;
      el('bgPlayed').insertAdjacentHTML('afterbegin', `<div><b>${H.esc(s.title)}</b> <span>${H.esc(s.artist)}</span></div>`);
      if (auto) nextT = setTimeout(next, 3500);
      H.sendState();
    }
    function onAct(m) {
      if (m.t !== 'bingo' || !['play', 'reveal'].includes(phase)) return;
      if (winners.includes(m.pid) || bingoNow) return;
      const card = cards[m.pid]; if (!card) return;
      const marked = new Set((m.cells || []).map(Number));
      const done = new Set(played);
      const ok = lines(o.size).some(L => L.every(c => marked.has(c) && done.has(card[c])));
      const p = H.players.get(m.pid);
      if (!ok) { H.msg({ k: 'bingo', pid: m.pid, ok: false }); H.toast(`❌ Falskt bingo från ${H.pname(m.pid)}!`); return; }
      winners.push(m.pid);
      const pts = POINTS[winners.length - 1] || 50;
      if (p) p.score += pts;
      H.msg({ k: 'bingo', pid: m.pid, ok: true, place: winners.length, pts });
      const wasPlaying = phase === 'play' && tm && tm.running;
      if (tm) tm.pause(); if (audio) audio.pause(); clearTimeout(nextT); nextT = null;
      bingoNow = m.pid;
      const ov = el('bgOver'); ov.hidden = false;
      ov.innerHTML = `<div><div class="big">BINGO!</div><div class="who">${H.esc(H.pname(m.pid))}</div><p>+${pts} poäng</p></div>`;
      el('bgWin').innerHTML = winners.map((w, i) => `<div>${['🥇', '🥈', '🥉'][i] || '🎉'} <b>${H.esc(H.pname(w))}</b></div>`).join('');
      H.confetti(220, true);
      H.sendState();
      setTimeout(() => {
        if (stopped) return;
        bingoNow = null; ov.hidden = true;
        if (winners.length >= o.winners || winners.length >= H.online().length) { H.finish(); return; }
        if (wasPlaying) { tm.resume(); audio && audio.play().catch(() => {}); }
        else if (phase === 'reveal') next();
        H.sendState();
      }, 5500);
    }
    function onPresence() { if (pool.length) H.online().forEach(p => cardFor(p.pid)); }
    function state() {
      return {
        phase, turn: cur + 1, total: seq.length, size: o.size,
        pool: phase === 'load' ? [] : pool.map(s => [s.title, s.artist]),
        cards, winners, bingo: bingoNow,
        song: phase === 'reveal' && pool[seq[cur]] ? [pool[seq[cur]].title, pool[seq[cur]].artist] : null,
        remainMs: phase === 'play' && tm ? tm.left : null, timeMs: o.clip * 1000,
      };
    }
    function stop() { stopped = true; clearTimeout(nextT); stopAudio(); }
    return { lobby, start, onAct, onPresence, state, stop };
  })();

  // ---------- mobilen ----------
  const player = (() => {
    let marks = new Set(), markKey = '', myCard = null;
    const loadMarks = (A, card) => {
      const k = 'hv-bingo-' + A.code + '-' + card.join('.');
      if (k !== markKey) { markKey = k; try { marks = new Set(JSON.parse(A.store.get(k) || '[]')); } catch (e) { marks = new Set(); } }
    };
    const saveMarks = A => A.store.set(markKey, JSON.stringify([...marks]));
    const hasLine = n => lines(n).some(L => L.every(c => marks.has(c)));
    function key(s, me, pid) {
      // brickan ritas bara om när den byts – låtbyten uppdateras via update()
      const c = (s.cards || {})[pid];
      return s.phase === 'load' ? 'load' : 'card' + (c ? c.join('.') : '-') + '|' + (s.pool || []).length;
    }
    function render(s, me, A) {
      const card = (s.cards || {})[A.pid];
      if (s.phase === 'load' || !card || !(s.pool || []).length) {
        A.render(`<div class="center"><div class="big">🎟️</div><h1>Låtbingo</h1><p>${s.phase === 'load' ? 'Storbilden hämtar låtar…' : 'Din bricka kommer strax…'}</p><div class="spin"></div></div>`);
        return;
      }
      myCard = card; loadMarks(A, card);
      const n = s.size || 4;
      A.render(`<div class="head"><span>🎟️ Låtbingo</span><span class="w" id="bnNum"></span></div>
        <div class="timer"><div id="bnBar"></div></div>
        <div class="bcard n${n}" id="bnCard">${card.map((i, c) => { const t = s.pool[i] || ['?', '']; return `<button type="button" data-c="${c}" class="${marks.has(c) ? 'on' : ''}"><b>${A.esc(t[0])}</b><small>${A.esc(t[1])}</small></button>`; }).join('')}</div>
        <div class="fb" id="bnFb"></div>
        <button type="button" class="bigbtn bingo-btn" id="bnGo" disabled>🎉 BINGO!</button>
        <p class="text-muted" style="text-align:center;font-size:0.8rem;margin:0.5rem 0 0">Kryssa låtar du hör. Hel rad, kolumn eller diagonal = tryck BINGO!</p>`);
      A.$('bnCard').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const c = +b.dataset.c;
        if (marks.has(c)) marks.delete(c); else { marks.add(c); A.vibrate(15); }
        b.classList.toggle('on', marks.has(c)); saveMarks(A); upd(A.state, A);
      }));
      A.$('bnGo').addEventListener('click', () => {
        A.send('bingo', { cells: [...marks] });
        const fb = A.$('bnFb'); fb.className = 'fb'; fb.textContent = '⏳ Kollar din bricka…';
      });
      let raf = 0, dl = null, dlKey = '';
      const tick = () => {
        const st = A.state, bar = A.$('bnBar'); if (!bar) return;
        if (st && st.phase === 'play' && st.remainMs != null) {
          const k = st.turn + '';
          if (k !== dlKey) { dlKey = k; dl = performance.now() + st.remainMs; }
          bar.style.transform = `scaleX(${Math.max(0, dl - performance.now()) / (st.timeMs || 1)})`;
        } else bar.style.transform = 'scaleX(0)';
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      A.onCleanup(() => cancelAnimationFrame(raf));
      upd(s, A);
    }
    function upd(s, A) {
      if (!s) return;
      const num = A.$('bnNum'); if (!num) return;
      const won = (s.winners || []).includes(A.pid);
      num.textContent = s.phase === 'reveal' && s.song ? `${s.turn}. ${s.song[0]}` : `Låt ${s.turn} av ${s.total}`;
      const go = A.$('bnGo');
      go.disabled = won || !hasLine(s.size || 4) || !!s.bingo;
      if (won) go.textContent = '🏆 Du har BINGO!';
      const fb = A.$('bnFb');
      if (s.bingo && s.bingo !== A.pid && fb && !fb.dataset.lock) { const w = (s.players || []).find(p => p.pid === s.bingo); fb.className = 'fb ok'; fb.textContent = `🎉 ${w ? w.name : 'Någon'} fick BINGO!`; }
      else if (fb && !s.bingo && !fb.dataset.lock && /fick BINGO/.test(fb.textContent)) fb.textContent = '';
    }
    function onMsg(m, A) {
      if (m.k !== 'bingo' || m.pid !== A.pid) return;
      const fb = A.$('bnFb'); if (!fb) return;
      fb.dataset.lock = '1'; setTimeout(() => { delete fb.dataset.lock; }, 5000);
      if (m.ok) { fb.className = 'fb ok'; fb.textContent = `🏆 BINGO! Du kom ${m.place}:a · +${m.pts} poäng`; A.celebrate(); A.vibrate([80, 40, 80, 40, 200]); }
      else { fb.className = 'fb near'; fb.textContent = '❌ Falskt bingo – minst en låt på raden har inte spelats än.'; A.vibrate(300); const c = A.$('bnCard'); if (c) { c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); } }
      upd(A.state, A);
    }
    return { key, render, update: (s, me, A) => upd(s, A), onMsg };
  })();

  G.bingo = {
    id: 'bingo', emo: '🎟️', name: '🎟️ Låtbingo', title: 'Låt<span class="hot">bingo</span>', minPlayers: 1, bgMusic: false,
    desc: 'Alla får en bingobricka med låttitlar på mobilen. Storbilden spelar klipp – känner du igen låten kryssar du den. Hel rad = BINGO!',
    opts: [
      { key: 'size', label: 'Brickans storlek', values: [[3, '3 × 3'], [4, '4 × 4']], def: 4, help: '3 × 3 går fortare.' },
      { key: 'clip', label: 'Tid per låt', values: [[15, '15 s'], [20, '20 s'], [30, '30 s']], def: 20 },
      { key: 'winners', label: 'Spela tills', values: [[1, '1 bingo'], [2, '2 bingon'], [3, '3 bingon']], def: 2 },
    ],
    host, player,
  };
})();
