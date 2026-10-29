// Miljonärsstegen – en spelare i heta stolen svarar på 15 allt svårare frågor (flerval på mobilen).
// Livlinor: 50/50, Fråga publiken (alla andra röstar på sina mobiler) och Byt fråga. Man kan stanna och ta med sig summan.
// Trygghetsnivåer efter fråga 5 och 10. Publiken kan tippa på varje fråga för skojs skull.
(function () {
  const G = (window.HVGames = window.HVGames || {});
  const LADDER = [100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 125000, 250000, 500000, 1000000];
  const SAFE = [4, 9];                       // index (fråga 5 och 10)
  const AUD_MS = 15000;
  const fmt = n => n.toLocaleString('sv-SE') + ' kr';
  const diffFor = i => i < 5 ? 'easy' : i < 10 ? 'medium' : 'hard';

  const host = (() => {
    let H, o, pool = null, poolKey = '', cats = [], phase = 'load', sid = 0, stopped = false, note = '';
    let seat = null, played = new Set(), step = 0, q = null, opts = [], correctIdx = -1, hidden = [], picked = null;
    let life = {}, aud = null, audVotes = new Map(), tips = new Map(), tm = null, nextT = null, result = null, rounds = 0;
    const el = id => document.getElementById(id);
    const catIds = o => o.theme === 'musik' ? QuizSources.THEMES.musik.slice() : QuizSources.THEMES.allm.concat('sport');
    function makePool(opts) {
      const key = catIds(opts).join() + '|' + (opts.lang || 'sv');
      if (pool && poolKey === key) return pool;
      if (pool) pool.stop();
      poolKey = key;
      pool = QuizSources.createPool({ cats: catIds(opts), lang: opts.lang || 'sv', hard: true, onStatus: s => { note = s.note || ''; QuizSources.lobbyNote(s); } });
      pool.load();
      return pool;
    }
    function lobby(opts, h) { H = h; o = opts; phase = 'load'; makePool(opts); }
    async function start(opts, h) {
      H = h; o = opts; stopped = false; phase = 'load'; sid = 0; played = new Set(); rounds = 0; seat = null;
      cats = catIds(o);
      H.el.innerHTML = `<div class="mj"><div id="mjMain"><div class="jt-load"><div class="spin"></div><h3>Hämtar och översätter frågor…</h3></div></div>
        <div class="side"><div class="mj-ladder" id="mjLadder"></div><div class="acts" id="mjActs"></div><div id="mjBoard"></div><p class="tb-credit">${H.esc(QuizSources.CREDIT)}</p></div></div>`;
      el('mjActs').addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (b) action(b.dataset.a); });
      H.sendState();
      makePool(o);
      await pool.load();
      if (stopped) return;
      if (note) H.toast('⚠️ ' + note, 6000);
      nextSeat();
    }
    function go(p) { phase = p; sid++; render(); H.sendState(); }
    function clear() { clearTimeout(nextT); if (tm) tm.stop(); tm = null; }
    function nextSeat() {
      clear();
      const max = o.seats || 0;
      const cand = H.online().filter(p => !played.has(p.pid));
      if (!cand.length || (max && rounds >= max)) { H.finish(); return; }
      seat = cand[Math.floor(Math.random() * cand.length)].pid;
      played.add(seat); rounds++;
      step = 0; life = { fifty: true, aud: true, swap: true }; result = null;
      go('intro');
      nextT = setTimeout(ask, 3500);
    }
    function takeQ(exceptId) {
      for (let k = 0; k < 8; k++) {
        const c = cats[Math.floor(Math.random() * cats.length)];
        const x = pool.take(c, exceptId, y => y.diff === diffFor(step) && (y.wrong || []).length >= 3);
        if (x && (x.wrong || []).length >= 3) return x;
      }
      return null;
    }
    function ask(exceptId) {
      clear();
      q = takeQ(exceptId);
      if (!q) { H.toast('Frågorna tog slut 😮', 3000); endSeat('stop'); return; }
      let all = [q.correct, ...q.wrong.slice(0, 3)];
      all = q.keepOrder ? all.sort((a, b) => (parseFloat(a) - parseFloat(b)) || String(a).localeCompare(b)) : H.shuffle(all);
      opts = all; correctIdx = all.indexOf(q.correct); hidden = []; picked = null; aud = null; audVotes = new Map(); tips = new Map();
      go('q');
    }
    function lockIn(i) {
      if (phase !== 'q' || hidden.includes(i)) return;
      picked = i; go('lock');
      nextT = setTimeout(() => {
        const ok = picked === correctIdx;
        tips.forEach((t, pid) => { if (pid !== seat && t === correctIdx) { const p = H.players.get(pid); if (p) p.score += 100; } });
        if (ok) {
          H.confetti(step >= 9 ? 160 : 70, false);
          result = { ok: true };
          go('reveal');
          if (step === LADDER.length - 1) { nextT = setTimeout(() => endSeat('win'), 3500); return; }
          nextT = setTimeout(() => { step++; ask(); }, 3500);
        } else { result = { ok: false }; go('reveal'); nextT = setTimeout(() => endSeat('wrong'), 4500); }
      }, step >= 4 ? 3000 : 1600);   // spänning
    }
    function endSeat(how) {
      clear();
      let won = 0;
      if (how === 'win') won = LADDER[LADDER.length - 1];
      else if (how === 'stop') won = step > 0 ? LADDER[step - 1] : 0;
      else { const safe = SAFE.filter(s => s < step); won = safe.length ? LADDER[safe[safe.length - 1]] : 0; }
      const p = H.players.get(seat); if (p) p.score += won;
      result = { how, won };
      H.msg({ k: 'end', pid: seat, how, won });
      if (how === 'win') H.confetti(300, true);
      go('over');
      nextT = setTimeout(nextSeat, 7000);
    }
    function useLife(k) {
      if (phase !== 'q' || !life[k]) return;
      life[k] = false;
      if (k === 'fifty') {
        const wrong = opts.map((_, i) => i).filter(i => i !== correctIdx);
        hidden = H.shuffle(wrong).slice(0, 2);
        H.toast('✂️ 50/50 – två fel svar borta', 2500); render(); H.sendState();
      } else if (k === 'swap') { H.toast('🔄 Ny fråga', 2000); ask(q.id); }
      else if (k === 'aud') {
        aud = { open: true, res: null }; audVotes = new Map();
        tm = H.timer(AUD_MS, f => { const b = el('mjTimer'); if (b) b.style.transform = `scaleX(${f})`; }, closeAud);
        render(); H.sendState();
        if (!H.online().some(p => p.pid !== seat)) closeAud();
      }
    }
    function closeAud() {
      if (!aud || !aud.open) return;
      if (tm) tm.stop(); tm = null;
      const n = opts.map(() => 0);
      audVotes.forEach(i => { if (n[i] != null) n[i]++; });
      let total = n.reduce((a, b) => a + b, 0);
      if (!total) {                         // ingen publik – "datorpublik" som oftast har rätt
        opts.forEach((_, i) => { if (!hidden.includes(i)) n[i] = i === correctIdx ? 45 + Math.floor(Math.random() * 30) : Math.floor(Math.random() * 25); });
        total = n.reduce((a, b) => a + b, 0);
      }
      aud = { open: false, res: n.map(v => Math.round(100 * v / total)) };
      render(); H.sendState();
    }
    function onAct(m) {
      if (stopped) return;
      if (m.pid === seat) {
        if (m.t === 'ans') lockIn(+m.i);
        else if (m.t === 'life') useLife(m.k);
        else if (m.t === 'stop' && phase === 'q') endSeat('stop');
        return;
      }
      if (m.t === 'vote' && aud && aud.open && !audVotes.has(m.pid)) { audVotes.set(m.pid, +m.i); render(); H.sendState(); if (H.online().filter(p => p.pid !== seat).every(p => audVotes.has(p.pid))) closeAud(); }
      else if (m.t === 'tip' && phase === 'q' && !tips.has(m.pid)) { tips.set(m.pid, +m.i); H.sendState(); render(); }
    }
    function onPresence() { if (seat && !(H.players.get(seat) || {}).on && ['q', 'intro'].includes(phase)) { H.toast(`${H.pname(seat)} lämnade stolen`, 3000); endSeat('stop'); } }
    function action(a) {
      if (a === 'bad' && phase === 'q') { QuizSources.block(q).then(ok => H.toast(ok ? '🚫 Frågan är spärrad' : '🚫 Frågan byttes', 2500)); ask(q.id); }
      else if (a === 'next' && phase === 'over') nextSeat();
      else if (a === 'end' && confirm('Avsluta och visa resultatet?')) H.finish();
      else if (a === 'audclose') closeAud();
    }
    function render() {
      if (!el('mjMain')) return;
      const name = pid => H.esc(H.pname(pid));
      el('mjLadder').innerHTML = LADDER.map((v, i) => `<div class="${i === step && seat ? 'cur' : ''} ${i < step ? 'done' : ''} ${SAFE.includes(i) ? 'safe' : ''}"><span>${i + 1}</span><b>${fmt(v)}</b></div>`).reverse().join('');
      H.board(el('mjBoard'), p => p.pid === seat ? { cls: 'act', icon: '💺' } : tips.has(p.pid) && phase === 'q' ? { icon: '🤞' } : {});
      let html = '', acts = '';
      const lifeRow = `<div class="mj-life">${[['fifty', '✂️ 50/50'], ['aud', '👥 Publiken'], ['swap', '🔄 Byt fråga']].map(([k, t]) => `<span class="${life[k] ? '' : 'used'}">${t}</span>`).join('')}</div>`;
      if (phase === 'intro') html = `<div class="mj-intro"><p class="gsub">I heta stolen</p><div class="winner">💺 ${name(seat)}</div><p class="gsub">15 frågor · ${fmt(LADDER[14])}</p></div>`;
      else if (['q', 'lock', 'reveal'].includes(phase) && q) {
        html = `<div class="mj-q"><div class="mj-who">💺 ${name(seat)} · fråga ${step + 1} för <b>${fmt(LADDER[step])}</b></div>${lifeRow}
          <div class="mj-text">${H.esc(q.q)}${q.lang === 'en' ? ' 🇬🇧' : ''}</div>
          <div class="mj-opts">${opts.map((t, i) => `<div class="mj-opt ${hidden.includes(i) ? 'gone' : ''} ${picked === i ? 'pick' : ''} ${phase === 'reveal' && i === correctIdx ? 'right' : ''} ${phase === 'reveal' && picked === i && i !== correctIdx ? 'wrong' : ''}"><i>${'ABCD'[i]}:</i> ${hidden.includes(i) ? '' : H.esc(t)}</div>`).join('')}</div>`;
        if (aud && aud.open) { html += `<div class="mj-aud"><b>👥 Publiken röstar på mobilen…</b> ${audVotes.size} röster<div class="timer"><div id="mjTimer"></div></div></div>`; acts += `<button type="button" class="btn-outline" data-a="audclose">Stäng röstningen</button>`; }
        if (aud && aud.res) html += `<div class="mj-bars">${aud.res.map((v, i) => `<div><i style="height:${Math.max(2, v)}%"></i><b>${v}%</b><span>${'ABCD'[i]}</span></div>`).join('')}</div>`;
        if (phase === 'lock') html += `<p class="gsub" style="text-align:center">Låst svar … 🥁</p>`;
        html += '</div>';
        if (phase === 'q') acts += `<button type="button" class="btn-outline" data-a="bad">🚫 Dålig fråga – byt</button>`;
      } else if (phase === 'over' && result) {
        const t = { win: '🏆 MILJONÄR!', stop: '🛑 Stannade', wrong: '❌ Fel svar' }[result.how];
        html = `<div class="mj-intro"><p class="gsub">${t}</p><div class="winner">${name(seat)}</div><p class="mj-won">${fmt(result.won)}</p>${q && result.how === 'wrong' ? `<p class="gsub">Rätt svar: <b>${H.esc(q.correct)}</b></p>` : ''}</div>`;
        acts = `<button type="button" class="btn-outline" data-a="next">⏭ Nästa spelare</button>`;
      }
      acts += `<button type="button" class="btn-outline" data-a="end">🏁 Avsluta</button>`;
      el('mjMain').innerHTML = html || el('mjMain').innerHTML;
      el('mjActs').innerHTML = acts;
    }
    function state() {
      const s = { phase, sid, seat, step, amount: LADDER[step], ladder: LADDER, life, hidden };
      if (q && ['q', 'lock', 'reveal'].includes(phase)) { s.q = { text: q.q, opts }; s.picked = picked; s.tipped = [...tips.keys()]; s.voted = [...audVotes.keys()]; }
      if (aud) { s.aud = { open: aud.open, res: aud.res }; if (aud.open && tm) { s.remainMs = tm.left; s.timeMs = AUD_MS; } }
      if (phase === 'reveal') { s.correctIdx = correctIdx; s.ok = result && result.ok; }
      if (phase === 'over' && result) Object.assign(s, { how: result.how, won: result.won, correct: q ? q.correct : '' });
      return s;
    }
    function stop() { stopped = true; clear(); }
    return { lobby, start, onAct, onPresence, state, stop };
  })();

  const player = (() => {
    let myTip = null, tipSid = -1;
    function key(s, me, pid) { return [s.phase, s.sid, (s.tipped || []).includes(pid), (s.voted || []).includes(pid), s.aud ? (s.aud.open ? 'o' : 'r') : '', (s.hidden || []).join()].join('|'); }
    function render(s, me, A) {
      const name = pid => ((s.players || []).find(p => p.pid === pid) || {}).name || '?';
      const inSeat = s.seat === A.pid;
      const head = `<div class="head"><span>💰 Miljonärsstegen</span><span class="w">${(me.score || 0).toLocaleString('sv-SE')} p</span></div>`;
      if (s.phase === 'load') { A.render(head + '<div class="center"><div class="spin"></div><p>Frågorna laddas…</p></div>'); return; }
      if (s.phase === 'intro') { A.render(head + `<div class="center"><div class="big">💺</div><h1>${inSeat ? 'Din tur i heta stolen!' : A.esc(name(s.seat))}</h1><p>${inSeat ? '15 frågor till miljonen. Lycka till!' : 'sitter i heta stolen – du är publik.'}</p></div>`); if (inSeat) A.vibrate([80, 60, 80]); return; }
      if (s.phase === 'over') {
        A.render(head + `<div class="center"><div class="big">${s.how === 'win' ? '🏆' : s.how === 'stop' ? '🛑' : '❌'}</div><h1>${inSeat ? (s.how === 'win' ? 'Miljonär!' : 'Du vann') : A.esc(name(s.seat))}</h1>
          <span class="pill">${s.won.toLocaleString('sv-SE')} kr</span>${s.how === 'wrong' ? `<p>Rätt svar: <b style="color:var(--accent)">${A.esc(s.correct)}</b></p>` : ''}</div>`);
        if (inSeat && s.won) A.confetti(s.how === 'win' ? 250 : 90, s.how === 'win');
        return;
      }
      if (!s.q) return;
      if (s.sid !== tipSid && s.phase === 'q' && !(s.tipped || []).includes(A.pid)) myTip = null;
      const amount = `<p style="text-align:center;margin:0 0 0.4rem;color:var(--text-muted)">Fråga ${s.step + 1} · <b style="color:var(--accent)">${s.amount.toLocaleString('sv-SE')} kr</b></p>`;
      const qbox = `<div class="qbox">${A.esc(s.q.text)}</div>`;
      const optBtns = (cls, dis) => `<div class="choices tb-ans ${cls}">${s.q.opts.map((t, i) => (s.hidden || []).includes(i) ? `<button type="button" disabled style="visibility:hidden">–</button>`
        : `<button type="button" data-i="${i}" ${dis ? 'disabled' : ''} class="${s.picked === i && inSeat ? 'sel' : ''} ${s.phase === 'reveal' && i === s.correctIdx ? 'mj-right' : ''}"><span class="ltr">${'ABCD'[i]}</span>${A.esc(t)}</button>`).join('')}</div>`;
      if (s.aud && s.aud.res && s.phase === 'q') var bars = `<div class="mj-bars small">${s.aud.res.map((v, i) => `<div><i style="height:${Math.max(2, v)}%"></i><b>${v}%</b><span>${'ABCD'[i]}</span></div>`).join('')}</div>`;
      if (inSeat) {
        if (s.phase === 'q') {
          A.render(head + amount + qbox + (bars || '') + (s.aud && s.aud.open ? '<p style="text-align:center">👥 Publiken röstar…</p>' : '') + optBtns('mj-seat', s.aud && s.aud.open) + `
            <div class="mj-lifebtns">${[['fifty', '✂️ 50/50'], ['aud', '👥 Publiken'], ['swap', '🔄 Byt']].map(([k, t]) => `<button type="button" class="btn-outline" data-k="${k}" ${s.life[k] && !(s.aud && s.aud.open) ? '' : 'disabled'}>${t}</button>`).join('')}
            <button type="button" class="btn-outline" id="mjStop">🛑 Stanna (${(s.step ? s.ladder[s.step - 1] : 0).toLocaleString('sv-SE')} kr)</button></div>`);
          let armed = null;
          document.querySelectorAll('.mj-seat button[data-i]').forEach(b => b.addEventListener('click', () => {
            const i = +b.dataset.i;
            if (armed !== i) { armed = i; document.querySelectorAll('.mj-seat button').forEach(x => x.classList.toggle('arm', x === b)); b.querySelector('.ltr').textContent = '?'; A.vibrate(15);
              const note = document.getElementById('mjNote'); if (note) note.textContent = 'Tryck igen för att låsa svaret'; return; }
            A.send('ans', { i }); A.vibrate(40);
            document.querySelectorAll('.mj-seat button').forEach(x => { x.disabled = true; x.classList.toggle('sel', x === b); });
          }));
          document.querySelector('.mj-seat').insertAdjacentHTML('afterend', '<p id="mjNote" style="text-align:center;margin:0.3rem 0;color:var(--text-muted);font-size:0.9rem">Tryck på ett svar – och en gång till för att låsa det</p>');
          document.querySelectorAll('.mj-lifebtns [data-k]').forEach(b => b.addEventListener('click', () => { A.send('life', { k: b.dataset.k }); b.disabled = true; }));
          A.$('mjStop').addEventListener('click', () => { if (confirm('Stanna och ta med dig summan?')) A.send('stop', {}); });
          return;
        }
        A.render(head + amount + qbox + optBtns('', true) + (s.phase === 'lock' ? '<p style="text-align:center">Låst svar … 🥁</p>' : `<p style="text-align:center;font-weight:700;color:${s.ok ? '#4ade80' : '#f87171'}">${s.ok ? '✅ Rätt!' : '❌ Fel'}</p>`));
        if (s.phase === 'reveal') { if (s.ok) { A.confetti(80, false); A.vibrate([60, 40, 60]); } else A.vibrate(400); }
        return;
      }
      // publiken
      if (s.aud && s.aud.open && s.phase === 'q') {
        const voted = (s.voted || []).includes(A.pid);
        A.render(head + A.timerBar(s) + `<p style="text-align:center;font-weight:700;color:var(--accent);margin:0 0 0.4rem">👥 Fråga publiken – hjälp ${A.esc(name(s.seat))}!</p>` + qbox + (voted ? '<div class="center" style="min-height:24dvh"><div class="big">🗳️</div><p>Röst lagd</p></div>' : optBtns('mj-vote', false)));
        document.querySelectorAll('.mj-vote button[data-i]').forEach(b => b.addEventListener('click', () => { A.send('vote', { i: +b.dataset.i }); A.vibrate(20); document.querySelectorAll('.mj-vote button').forEach(x => x.disabled = true); }));
        return;
      }
      const tipped = (s.tipped || []).includes(A.pid);
      const tipLine = s.phase === 'reveal' && myTip != null ? `<span class="pill">${myTip === s.correctIdx ? '🤞 Ditt tips var rätt: +100' : 'Ditt tips var fel'}</span>` : '';
      A.render(head + `<p style="text-align:center;margin:0 0 0.4rem;color:var(--text-muted)">💺 ${A.esc(name(s.seat))} · fråga ${s.step + 1} · ${s.amount.toLocaleString('sv-SE')} kr</p>` + qbox + (bars || '')
        + (s.phase === 'q' && !tipped ? `<p style="text-align:center;margin:0 0 0.4rem;color:var(--text-muted)">Tippa för +100 poäng:</p>` + optBtns('mj-tip', false) : optBtns('', true)) + `<div class="center" style="min-height:0;margin-top:0.6rem">${tipLine}</div>`);
      document.querySelectorAll('.mj-tip button[data-i]').forEach(b => b.addEventListener('click', () => { myTip = +b.dataset.i; tipSid = s.sid; A.send('tip', { i: myTip }); A.vibrate(20); document.querySelectorAll('.mj-tip button').forEach(x => { x.disabled = true; x.classList.toggle('sel', x === b); }); }));
      if (s.phase === 'reveal' && myTip != null && myTip === s.correctIdx) A.vibrate(40);
    }
    return { key, render };
  })();

  G.miljonar = {
    id: 'miljonar', emo: '💰', name: '💰 Miljonärsstegen', title: 'Miljonärs<span class="hot">stegen</span>', minPlayers: 1, bgMusic: false,
    desc: 'En i taget i heta stolen: 15 allt svårare frågor upp till miljonen. Livlinor: 50/50, fråga publiken (alla röstar på mobilen) och byt fråga.',
    opts: [
      { key: 'seats', label: 'Antal spelare i heta stolen', values: [[1, '1'], [3, '3'], [5, '5'], [0, 'Alla']], def: 3, help: 'De andra är publik – de kan tippa på varje fråga (+100 poäng) och röstar när livlinan används.' },
      { key: 'theme', label: 'Tema', values: [['allm', '🧠 Allmänbildning'], ['musik', '🤘 Musik']], def: 'allm' },
      { key: 'lang', label: 'Språk', values: [['sv', 'Svenska'], ['en', 'Engelska (original)']], def: 'sv' },
    ],
    host, player,
  };
})();
