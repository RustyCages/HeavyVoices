// Vem i rummet …? – Mobilspel. "Vem skulle mest troligt …" – alla röstar på någon i sällskapet.
// Poäng till dig som röstade som de flesta (+100). Den som får flest röster blir rundans 👑.
(function () {
  const G = (window.HVGames = window.HVGames || {});

  // ---------- storbilden ----------
  const host = (() => {
    let H, o, prompts = [], prompt = '', num = 0, phase = 'vote', tm = null, votes = new Map(), cands = [], stopped = false, nextT = null, top = [], crowns = {}, gain = {};
    const el = id => document.getElementById(id);
    function start(opts, h) {
      H = h; o = opts; stopped = false; num = 0; crowns = {};
      prompts = H.shuffle(window.WHO_PROMPTS || ['vinna det här spelet']);
      H.el.innerHTML = `<div class="game">
        <div class="gstage">
          <div class="text-muted" id="whNum"></div>
          <div class="gsub" style="margin:0">Vem i rummet skulle mest troligt …</div>
          <h2 class="gq" id="whQ"></h2>
          <div class="timer"><div id="whTimer"></div></div>
          <div id="whMain"></div>
          <div class="acts" style="justify-content:center"><button type="button" class="btn-outline" id="whNext">⏭ Vidare</button></div>
        </div>
        <div class="side"><div id="whBoard"></div></div></div>`;
      el('whNext').addEventListener('click', () => { if (phase === 'vote') reveal(); else next(); });
      next();
    }
    function next() {
      clearTimeout(nextT);
      if (stopped) return;
      num++;
      if (num > o.rounds) { H.finish(); return; }
      prompt = prompts[(num - 1) % prompts.length];
      votes = new Map(); top = []; gain = {};
      cands = H.online().map(p => p.pid);
      phase = 'vote';
      el('whNum').textContent = `Runda ${num} av ${o.rounds}`;
      el('whQ').textContent = prompt + '?';
      renderVoting();
      if (tm) tm.stop();
      tm = H.timer(o.time * 1000, f => { const b = el('whTimer'); if (b) b.style.transform = `scaleX(${f})`; }, reveal);
      H.board(el('whBoard'));
      H.sendState();
    }
    function renderVoting() {
      el('whMain').innerHTML = `<p class="gsub">🗳️ Rösta på mobilen!</p><div class="chips">${H.online().map(p => `<span class="${votes.has(p.pid) ? 'on' : ''}">${votes.has(p.pid) ? '✅' : '⏳'} ${H.esc(p.name)}</span>`).join('')}</div>`;
    }
    function onAct(m) {
      if (m.t !== 'vote' || phase !== 'vote' || !H.players.has(m.pid) || !cands.includes(m.id)) return;
      votes.set(m.pid, m.id);
      renderVoting(); H.sendState();
      if (H.online().every(p => votes.has(p.pid))) setTimeout(reveal, 600);
    }
    function reveal() {
      if (phase !== 'vote') return;
      if (tm) tm.stop();
      phase = 'reveal';
      const count = {};
      votes.forEach(id => { count[id] = (count[id] || 0) + 1; });
      const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]);
      const max = ranked.length ? ranked[0][1] : 0;
      top = ranked.filter(r => r[1] === max).map(r => r[0]);
      top.forEach(pid => { crowns[pid] = (crowns[pid] || 0) + 1; });
      votes.forEach((id, pid) => { if (top.includes(id)) { gain[pid] = 100; const p = H.players.get(pid); if (p) p.score += 100; } });
      el('whMain').innerHTML = top.length ? `<div class="crown">👑 ${top.map(pid => H.esc(H.pname(pid))).join(' & ')}</div>
        <div class="bars">${ranked.map(([pid, n]) => `<div><span>${H.esc(H.pname(pid))}</span><i style="--w:${Math.round(100 * n / max)}%"></i><b>${n}</b></div>`).join('')}</div>`
        : '<p class="gsub">Ingen röstade 🤷</p>';
      H.board(el('whBoard'), p => gain[p.pid] ? { cls: 'ok', icon: '+100' } : top.includes(p.pid) ? { icon: '👑' } : {});
      if (top.length) H.confetti(80, false);
      H.sendState();
      nextT = setTimeout(next, 8000);
    }
    function state() {
      return { phase, turn: num, total: o.rounds, prompt, cands: phase === 'vote' ? cands : null, done: [...votes.keys()],
        top: phase === 'reveal' ? top : null, gain: phase === 'reveal' ? gain : null,
        remainMs: phase === 'vote' && tm ? tm.left : null, timeMs: o.time * 1000 };
    }
    function stop() { stopped = true; clearTimeout(nextT); if (tm) tm.stop(); }
    return { start, onAct, state, stop };
  })();

  // ---------- mobilen ----------
  const player = (() => {
    function key(s, me, pid) { return [s.phase, s.turn, (s.done || []).includes(pid)].join('|'); }
    function render(s, me, A) {
      const name = pid => ((s.players || []).find(p => p.pid === pid) || {}).name || '?';
      const head = `<div class="head"><span>👀 Vem i rummet…?</span><span class="w">${s.turn}/${s.total}</span></div>`;
      const q = `<div class="qbox"><small>Vem skulle mest troligt …</small><br>${A.esc(s.prompt)}?</div>`;
      if (s.phase === 'vote') {
        if ((s.done || []).includes(A.pid)) { A.render(head + q + '<div class="center" style="min-height:40dvh"><div class="big">🗳️</div><h1>Röst lagd</h1><p>Vänta på de andra…</p></div>'); return; }
        A.render(head + A.timerBar(s) + q + `<div class="choices who">${(s.cands || []).map(pid => `<button type="button" data-id="${pid}">${A.esc(name(pid))}${pid === A.pid ? ' (du)' : ''}</button>`).join('')}</div>`);
        document.querySelectorAll('.choices button').forEach(b => b.addEventListener('click', () => { A.send('vote', { id: b.dataset.id }); document.querySelectorAll('.choices button').forEach(x => { x.disabled = true; x.classList.toggle('sel', x === b); }); A.vibrate(20); }));
        return;
      }
      const top = s.top || [], g = (s.gain || {})[A.pid];
      A.render(head + q + `<div class="center" style="min-height:40dvh"><div class="big">👑</div><h1>${A.esc(top.map(name).join(' & ') || 'Ingen')}</h1>
        ${top.includes(A.pid) ? '<p>Det är du! 😎</p>' : ''}<span class="pill">${g ? '+100 – du röstade som de flesta!' : 'Inga poäng den här gången'}</span></div>`);
      if (top.includes(A.pid)) A.confetti(100, false);
    }
    return { key, render };
  })();

  G.who = {
    id: 'who', emo: '👀', name: '👀 Vem i rummet…?', title: 'Vem i <span class="hot">rummet…?</span>', minPlayers: 3, bgMusic: true,
    desc: '"Vem skulle mest troligt …" – alla röstar på någon i sällskapet. Rösta som de flesta så får du poäng!',
    opts: [
      { key: 'rounds', label: 'Antal rundor', values: [[8, '8'], [12, '12'], [16, '16']], def: 8 },
      { key: 'time', label: 'Tid att rösta', values: [[20, '20 s'], [30, '30 s']], def: 20 },
    ],
    host, player,
  };
})();
