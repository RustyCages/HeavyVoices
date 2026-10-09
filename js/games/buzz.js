// Snabbaste fingret – Mobilspel. Storbilden spelar ett klipp, alla har en stor buzzer på mobilen.
// Först att trycka svarar högt; frågeledaren trycker Rätt/Fel. Fel = −50 och utelåst på den låten.
(function () {
  const G = (window.HVGames = window.HVGames || {});

  // ---------- storbilden ----------
  const host = (() => {
    let H, o, feed = null, song = null, num = 0, phase = 'load', audio = null, tm = null, buzzer = null, locked = new Set(), stopped = false, nextT = null, answerT = null, result = '';
    const el = id => document.getElementById(id);
    function lobby(opts, h) { H = h; o = opts; if (!feed) feed = PartyMusic.createFeed({ noYear: true, parallel: 2, ahead: 3 }); feed.warm(3); }
    function start(opts, h) {
      H = h; o = opts; stopped = false; num = 0;
      if (!feed) feed = PartyMusic.createFeed({ noYear: true, parallel: 2, ahead: 3 });
      H.el.innerHTML = `<div class="game">
        <div class="gstage">
          <div class="text-muted" id="bzNum"></div>
          <div class="vinyl" id="bzVinyl"></div>
          <h2 class="gtitle" id="bzTitle"></h2>
          <div class="gsub" id="bzSub"></div>
          <div class="timer"><div id="bzTimer"></div></div>
          <div class="acts" id="bzJudge" style="justify-content:center" hidden>
            <button type="button" class="judge ok" data-v="150">✅ Låt + artist <small>+150</small></button>
            <button type="button" class="judge half" data-v="75">☑️ Bara en av dem <small>+75</small></button>
            <button type="button" class="judge no" data-v="-50">❌ Fel <small>−50</small></button>
          </div>
          <div class="acts" style="justify-content:center"><button type="button" class="btn-outline" id="bzSkip">⏭ Visa svaret / nästa</button></div>
        </div>
        <div class="side"><div id="bzBoard"></div></div></div>`;
      el('bzJudge').querySelectorAll('button').forEach(b => b.addEventListener('click', () => judge(+b.dataset.v)));
      el('bzSkip').addEventListener('click', () => { if (phase === 'reveal') next(); else reveal(''); });
      next();
    }
    function board() { H.board(el('bzBoard'), p => p.pid === buzzer ? { cls: 'act', icon: '⚡' } : locked.has(p.pid) ? { icon: '🔒' } : {}); }
    function stopAudio() { if (audio) { audio.pause(); audio.removeAttribute('src'); try { audio.load(); } catch (e) {} audio = null; } if (tm) tm.stop(); tm = null; }
    async function next() {
      clearTimeout(nextT); clearTimeout(answerT); stopAudio();
      if (stopped) return;
      num++;
      if (num > o.songs) { H.finish(); return; }
      phase = 'load'; buzzer = null; locked = new Set(); song = null; result = '';
      el('bzNum').textContent = `Låt ${num} av ${o.songs}`;
      el('bzTitle').textContent = 'Laddar nästa låt…'; el('bzSub').textContent = '';
      el('bzJudge').hidden = true; board(); H.sendState();
      try { song = await feed.next(); } catch (e) { if (!stopped) { el('bzTitle').textContent = 'Hittade inga låtar'; el('bzSub').textContent = 'Kontrollera nätet.'; } return; }
      if (stopped) return;
      phase = 'listen';
      el('bzTitle').textContent = 'Tryck på buzzern när du vet! ⚡'; el('bzSub').textContent = 'Låt och artist';
      el('bzVinyl').classList.add('spin');
      audio = new Audio(song.url);
      audio.addEventListener('error', () => { if (phase === 'listen' || phase === 'answer') { H.toast('Klippet gick inte att spela – nästa låt'); num--; next(); } }, { once: true });
      audio.play().catch(() => {});
      tm = H.timer(o.clip * 1000, f => { const b = el('bzTimer'); if (b) b.style.transform = `scaleX(${f})`; }, () => reveal('⏰ Ingen hann!'));
      H.sendState();
    }
    function onAct(m) {
      if (m.t !== 'buzz' || phase !== 'listen' || locked.has(m.pid) || !H.players.has(m.pid)) return;
      phase = 'answer'; buzzer = m.pid;
      if (tm) tm.pause(); if (audio) audio.pause();
      el('bzVinyl').classList.remove('spin');
      el('bzTitle').innerHTML = `⚡ <span style="color:var(--accent)">${H.esc(H.pname(m.pid))}</span>!`;
      el('bzSub').textContent = 'Säg låten och artisten högt…';
      el('bzJudge').hidden = false;
      H.msg({ k: 'buzz', pid: m.pid });
      board(); H.sendState();
    }
    function judge(v) {
      if (phase !== 'answer' || !buzzer) return;
      const p = H.players.get(buzzer);
      el('bzJudge').hidden = true;
      if (v > 0) {
        if (p) p.score += v;
        H.confetti(90, false);
        H.msg({ k: 'judge', pid: buzzer, v });
        reveal(`✅ ${H.pname(buzzer)} +${v}`);
      } else {
        if (p) p.score = Math.max(0, p.score + v);
        locked.add(buzzer);
        H.msg({ k: 'judge', pid: buzzer, v });
        H.toast(`❌ ${H.pname(buzzer)} – fel! Musiken fortsätter`, 2500);
        buzzer = null; phase = 'listen';
        if (H.online().every(x => locked.has(x.pid))) { reveal('Alla har gissat fel 😅'); return; }
        el('bzTitle').textContent = 'Tryck på buzzern när du vet! ⚡'; el('bzSub').textContent = 'Låt och artist';
        el('bzVinyl').classList.add('spin');
        if (tm) tm.resume(); if (audio) audio.play().catch(() => {});
        board(); H.sendState();
      }
    }
    function reveal(txt) {
      if (!song || phase === 'reveal') return;
      clearTimeout(answerT);
      if (tm) tm.stop(); tm = null;
      if (audio) audio.play().catch(() => {});   // låt klippet spela vidare medan svaret visas
      phase = 'reveal'; result = txt || ''; buzzer = null;
      el('bzJudge').hidden = true; el('bzVinyl').classList.add('spin');
      el('bzTitle').textContent = song.title; el('bzSub').textContent = song.artist + (result ? ' · ' + result : '');
      board(); H.sendState();
      nextT = setTimeout(next, 6000);
    }
    function state() {
      return { phase, turn: num, total: o.songs, buzzer, locked: [...locked], result,
        song: phase === 'reveal' && song ? [song.title, song.artist] : null,
        remainMs: phase === 'listen' && tm ? tm.left : null, timeMs: o.clip * 1000 };
    }
    function stop() { stopped = true; clearTimeout(nextT); clearTimeout(answerT); stopAudio(); feed = null; }
    return { lobby, start, onAct, state, stop };
  })();

  // ---------- mobilen ----------
  const player = (() => {
    function key(s, me, pid) { return [s.phase, s.turn, s.buzzer, (s.locked || []).includes(pid)].join('|'); }
    function render(s, me, A) {
      const bn = ((s.players || []).find(p => p.pid === s.buzzer) || {}).name || '';
      const head = `<div class="head"><span>⚡ Snabbaste fingret</span><span class="w">Låt ${s.turn}/${s.total}</span></div>`;
      if (s.phase === 'load') { A.render(head + '<div class="center"><div class="spin"></div><p>Nästa låt laddas…</p></div>'); return; }
      if (s.phase === 'reveal') {
        A.render(head + `<div class="center"><p>Låten var</p><div class="word">${A.esc(s.song ? s.song[0] : '')}</div><p>${A.esc(s.song ? s.song[1] : '')}</p>
          ${s.result ? `<span class="pill">${A.esc(s.result)}</span>` : ''}<span class="pill">Du har ${me.score || 0} p</span></div>`);
        return;
      }
      if (s.phase === 'answer') {
        if (s.buzzer === A.pid) A.render(head + `<div class="center"><div class="big">🎤</div><h1>Du var snabbast!</h1><p>Säg låten och artisten högt!</p><div class="fb" id="bzFb"></div></div>`);
        else A.render(head + `<div class="center"><div class="big">⚡</div><h1>${A.esc(bn)}</h1><p>var snabbast och svarar…</p></div>`);
        return;
      }
      const locked = (s.locked || []).includes(A.pid);
      A.render(head + `${A.timerBar(s)}<div class="center" style="min-height:62dvh">
        <button type="button" class="buzzer" id="bz" ${locked ? 'disabled' : ''}>${locked ? '🔒' : 'BUZZ!'}</button>
        <p>${locked ? 'Fel svar – du är utelåst på den här låten.' : 'Tryck när du vet låten!'}</p></div>`);
      const b = A.$('bz');
      if (!locked) b.addEventListener('pointerdown', e => { e.preventDefault(); if (b.disabled) return; b.disabled = true; b.classList.add('hit'); b.textContent = '⏳'; A.send('buzz', {}); A.vibrate(60); });
    }
    function onMsg(m, A) {
      if (m.k === 'judge' && m.pid === A.pid) {
        if (m.v > 0) { A.confetti(120, false); A.vibrate([60, 40, 60]); }
        else A.vibrate(300);
        const fb = A.$('bzFb'); if (fb) { fb.className = 'fb ' + (m.v > 0 ? 'ok' : 'near'); fb.textContent = m.v > 0 ? `✅ Rätt! +${m.v}` : `❌ Fel – ${m.v}`; }
      }
    }
    return { key, render, onMsg };
  })();

  G.buzz = {
    id: 'buzz', emo: '⚡', name: '⚡ Snabbaste fingret', title: 'Snabbaste <span class="hot">fingret</span>', minPlayers: 1, bgMusic: false,
    desc: 'Storbilden spelar en låt – alla har en stor buzzer på mobilen. Först att trycka säger låt och artist högt, frågeledaren dömer.',
    opts: [
      { key: 'songs', label: 'Antal låtar', values: [[10, '10'], [15, '15'], [20, '20']], def: 10 },
      { key: 'clip', label: 'Tid per låt', values: [[20, '20 s'], [30, '30 s']], def: 30 },
    ],
    host, player,
  };
})();
