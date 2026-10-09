// Bluffen – Mobilspel. En rockfråga visas, alla skriver ett påhittat men trovärdigt svar.
// Sedan röstar alla på det svar de tror är rätt. +100 för rätt svar, +50 för varje spelare du lurar.
(function () {
  const G = (window.HVGames = window.HVGames || {});
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9åäö]+/g, ' ').trim();

  // ---------- storbilden ----------
  const host = (() => {
    let H, o, qs = [], loading = null, q = null, num = 0, phase = 'load', tm = null, lies = new Map(), votes = new Map(), options = [], deltas = {}, stopped = false, nextT = null, seen = new Set();
    const el = id => document.getElementById(id);
    async function fetchQs(n) {
      const [gen, ot] = await Promise.allSettled([PartyMusic.makeRockQuestions(n + 4, [...seen]), PartyMusic.openTriviaRock(n, [...seen])]);
      const all = [].concat(gen.status === 'fulfilled' ? gen.value : [], ot.status === 'fulfilled' ? ot.value : [])
        .filter(x => !/\bINTE\b/.test(x.text) && String(x.correct).length <= 40 && !seen.has(x.id));
      return PartyMusic.shuffle(all);
    }
    function lobby(opts, h) { H = h; o = opts; if (!loading && qs.length < o.rounds) loading = fetchQs(o.rounds).then(r => { qs = qs.concat(r); }).catch(() => {}).finally(() => { loading = null; }); }
    async function start(opts, h) {
      H = h; o = opts; stopped = false; num = 0; phase = 'load';
      H.el.innerHTML = `<div class="gstage"><div class="big-emo">🤥</div><h2 class="gtitle">Hämtar frågor…</h2></div>`;
      if (loading) await loading;
      if (qs.length < o.rounds) { try { qs = qs.concat(await fetchQs(o.rounds)); } catch (e) {} }
      if (stopped) return;
      if (!qs.length) { H.el.innerHTML = `<div class="gstage"><h2 class="gtitle">Kunde inte hämta frågor</h2><p class="text-muted">Kontrollera nätet och försök igen.</p></div>`; return; }
      H.el.innerHTML = `<div class="game">
        <div class="gstage">
          <div class="text-muted" id="blNum"></div>
          <h2 class="gq" id="blQ"></h2>
          <div class="timer"><div id="blTimer"></div></div>
          <div id="blMain"></div>
          <div class="acts" style="justify-content:center"><button type="button" class="btn-outline" id="blNext">⏭ Vidare</button></div>
        </div>
        <div class="side"><div id="blBoard"></div></div></div>`;
      el('blNext').addEventListener('click', () => { if (phase === 'write') toVote(); else if (phase === 'vote') toReveal(); else if (phase === 'reveal') next(); });
      next();
    }
    function board(mark) { H.board(el('blBoard'), mark); }
    function timer(ms, end) { if (tm) tm.stop(); tm = H.timer(ms, f => { const b = el('blTimer'); if (b) b.style.transform = `scaleX(${f})`; }, end); }
    function next() {
      clearTimeout(nextT);
      if (stopped) return;
      num++;
      q = qs.shift();
      if (num > o.rounds || !q) { H.finish(); return; }
      seen.add(q.id);
      lies = new Map(); votes = new Map(); options = []; deltas = {};
      phase = 'write';
      el('blNum').textContent = `Fråga ${num} av ${o.rounds}`;
      el('blQ').textContent = q.text;
      el('blMain').innerHTML = `<p class="gsub">✍️ Skriv ett påhittat svar på mobilen – så trovärdigt att de andra går på det!</p><div class="chips" id="blDone"></div>`;
      renderDone();
      timer(o.write * 1000, toVote);
      board(p => lies.has(p.pid) ? { icon: '✍️' } : {});
      H.sendState();
    }
    function renderDone() {
      const box = el('blDone'); if (!box) return;
      const set = phase === 'write' ? lies : votes;
      box.innerHTML = H.online().map(p => `<span class="${set.has(p.pid) ? 'on' : ''}">${set.has(p.pid) ? '✅' : '⏳'} ${H.esc(p.name)}</span>`).join('');
    }
    function onAct(m) {
      const p = H.players.get(m.pid); if (!p) return;
      if (m.t === 'lie' && phase === 'write') {
        const text = String(m.text || '').trim().slice(0, 40), n = norm(text);
        if (!n) return;
        if (n === norm(q.correct)) { H.msg({ k: 'lie', pid: m.pid, ok: false }); return; }
        lies.set(m.pid, { text, n });
        H.msg({ k: 'lie', pid: m.pid, ok: true });
        renderDone(); board(x => lies.has(x.pid) ? { icon: '✍️' } : {}); H.sendState();
        if (H.online().every(x => lies.has(x.pid))) setTimeout(toVote, 700);
      } else if (m.t === 'vote' && phase === 'vote') {
        const opt = options.find(x => x.id === m.id);
        if (!opt || opt.by.includes(m.pid) || votes.has(m.pid)) return;
        votes.set(m.pid, opt.id);
        renderDone(); H.sendState();
        if (H.online().every(x => votes.has(x.pid) || !canVote(x.pid))) setTimeout(toReveal, 700);
      }
    }
    const canVote = pid => options.some(x => !x.by.includes(pid));
    function toVote() {
      if (phase !== 'write') return;
      // samma bluff från flera slås ihop; fyll på med husets bluffar så att det blir minst fyra svar
      const byN = new Map();
      lies.forEach((l, pid) => { if (!byN.has(l.n)) byN.set(l.n, { id: 'L' + byN.size, text: l.text, by: [] }); byN.get(l.n).by.push(pid); });
      options = [{ id: 'T', text: q.correct, by: [], truth: true }, ...byN.values()];
      const wrong = H.shuffle((q.options || []).filter(x => x !== q.correct));
      for (const w of wrong) { if (options.length >= 4) break; if (![...byN.keys()].includes(norm(w))) options.push({ id: 'H' + options.length, text: w, by: [], house: true }); }
      options = H.shuffle(options);
      phase = 'vote';
      el('blMain').innerHTML = `<div class="opts">${options.map((x, i) => `<div class="opt"><span class="ltr">${'ABCDEFGHIJKLMNOP'[i]}</span>${H.esc(x.text)}</div>`).join('')}</div>
        <p class="gsub">🗳️ Rösta på mobilen – vilket svar är det riktiga?</p><div class="chips" id="blDone"></div>`;
      renderDone();
      timer(o.vote * 1000, toReveal);
      board(); H.sendState();
    }
    function toReveal() {
      if (phase !== 'vote') return;
      if (tm) tm.stop();
      phase = 'reveal'; deltas = {};
      const add = (pid, v) => { deltas[pid] = (deltas[pid] || 0) + v; const p = H.players.get(pid); if (p) p.score += v; };
      votes.forEach((id, pid) => {
        const opt = options.find(x => x.id === id); if (!opt) return;
        if (opt.truth) add(pid, 100); else opt.by.forEach(a => add(a, 50));
      });
      const voters = id => [...votes.entries()].filter(([, v]) => v === id).map(([pid]) => H.pname(pid));
      const order = options.slice().sort((a, b) => (a.truth ? 1 : 0) - (b.truth ? 1 : 0));
      el('blMain').innerHTML = `<div class="opts rev">${order.map(x => `<div class="opt ${x.truth ? 'truth' : ''}">
          <div><b>${H.esc(x.text)}</b> ${x.truth ? '<span class="tag ok">✅ RÄTT SVAR</span>' : x.house ? '<span class="tag">🏠 husets bluff</span>' : `<span class="tag">🤥 ${H.esc(x.by.map(H.pname).join(' & '))}s bluff</span>`}</div>
          <div class="voters">${voters(x.id).map(n => `<span>${H.esc(n)}</span>`).join('') || '<span class="none">ingen</span>'}</div></div>`).join('')}</div>
        ${q.fact ? `<p class="gsub">${H.esc(q.fact)}</p>` : ''}`;
      board(p => deltas[p.pid] ? { cls: 'ok', icon: '+' + deltas[p.pid] } : {});
      const fooled = [...votes.values()].filter(id => id !== 'T' && !id.startsWith('H')).length;
      if (fooled) H.confetti(60, false);
      H.sendState();
      nextT = setTimeout(next, 9000);
    }
    function state() {
      return { phase, turn: num, total: o.rounds, q: q ? q.text : '',
        done: phase === 'write' ? [...lies.keys()] : phase === 'vote' ? [...votes.keys()] : [],
        options: phase === 'vote' || phase === 'reveal' ? options.map(x => ({ id: x.id, text: x.text })) : null,
        truth: phase === 'reveal' && q ? q.correct : null, deltas: phase === 'reveal' ? deltas : null,
        mine: phase === 'vote' ? Object.fromEntries(options.filter(x => x.by.length).flatMap(x => x.by.map(pid => [pid, x.id]))) : null,
        remainMs: tm && (phase === 'write' || phase === 'vote') ? tm.left : null, timeMs: (phase === 'vote' ? o.vote : o.write) * 1000 };
    }
    function stop() { stopped = true; clearTimeout(nextT); if (tm) tm.stop(); }
    return { lobby, start, onAct, state, stop };
  })();

  // ---------- mobilen ----------
  const player = (() => {
    function key(s, me, pid) { return [s.phase, s.turn, (s.done || []).includes(pid)].join('|'); }
    function render(s, me, A) {
      const head = `<div class="head"><span>🤥 Bluffen</span><span class="w">${s.turn ? `Fråga ${s.turn}/${s.total}` : ''}</span></div>`;
      const qbox = `<div class="qbox">${A.esc(s.q || '')}</div>`;
      const done = (s.done || []).includes(A.pid);
      if (s.phase === 'load') { A.render(head + '<div class="center"><div class="spin"></div><p>Frågorna hämtas…</p></div>'); return; }
      if (s.phase === 'write') {
        if (done) { A.render(head + qbox + '<div class="center" style="min-height:40dvh"><div class="big">✅</div><h1>Bluff inskickad</h1><p>Vänta på de andra…</p></div>'); return; }
        A.render(head + A.timerBar(s) + qbox + `<p class="text-muted" style="text-align:center;margin:0.6rem 0">Hitta på ett svar som låter rätt:</p>
          <form class="guess" id="blf"><input id="blIn" maxlength="40" placeholder="Ditt bluffsvar…" autocomplete="off" enterkeyhint="send"><button type="submit">➤</button></form>
          <div class="fb" id="blFb"></div>`);
        A.$('blf').addEventListener('submit', e => { e.preventDefault(); const v = A.$('blIn').value.trim(); if (!v) return; A.send('lie', { text: v }); A.$('blFb').className = 'fb'; A.$('blFb').textContent = '⏳'; });
        return;
      }
      if (s.phase === 'vote') {
        const mine = (s.mine || {})[A.pid];
        const opts = (s.options || []).filter(x => x.id !== mine);
        if (done) { A.render(head + qbox + '<div class="center" style="min-height:40dvh"><div class="big">🗳️</div><h1>Röst lagd</h1><p>Vänta på de andra…</p></div>'); return; }
        A.render(head + A.timerBar(s) + qbox + `<p class="text-muted" style="text-align:center;margin:0.6rem 0">Vilket svar är det riktiga?</p>
          <div class="choices">${opts.map(x => `<button type="button" data-id="${x.id}">${A.esc(x.text)}</button>`).join('')}</div>`);
        document.querySelectorAll('.choices button').forEach(b => b.addEventListener('click', () => { A.send('vote', { id: b.dataset.id }); document.querySelectorAll('.choices button').forEach(x => { x.disabled = true; x.classList.toggle('sel', x === b); }); A.vibrate(20); }));
        return;
      }
      if (s.phase === 'reveal') {
        const d = (s.deltas || {})[A.pid] || 0;
        A.render(head + qbox + `<div class="center" style="min-height:40dvh"><p>Rätt svar</p><div class="word">${A.esc(s.truth || '')}</div>
          <span class="pill">${d ? `+${d} poäng 🎉` : 'Inga poäng den här gången'}</span><p>Se storbilden – vem lurade vem?</p></div>`);
        if (d) A.confetti(80, false);
      }
    }
    function onMsg(m, A) {
      if (m.k !== 'lie' || m.pid !== A.pid || m.ok) return;
      const fb = A.$('blFb'); if (fb) { fb.className = 'fb near'; fb.textContent = '😅 Det där är faktiskt rätt svar! Hitta på något annat.'; }
    }
    return { key, render, onMsg };
  })();

  G.bluff = {
    id: 'bluff', emo: '🤥', name: '🤥 Bluffen', title: 'Bluff<span class="hot">en</span>', minPlayers: 2, bgMusic: true,
    desc: 'En klurig rockfråga – alla hittar på ett trovärdigt svar på mobilen. Sedan röstar alla på det de tror är rätt. Lura de andra!',
    opts: [
      { key: 'rounds', label: 'Antal frågor', values: [[5, '5'], [8, '8'], [10, '10']], def: 5 },
      { key: 'write', label: 'Tid att bluffa', values: [[45, '45 s'], [60, '60 s'], [90, '90 s']], def: 60 },
      { key: 'vote', label: 'Tid att rösta', values: [[20, '20 s'], [30, '30 s']], def: 20 },
    ],
    host, player,
  };
})();
