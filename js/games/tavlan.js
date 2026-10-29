// Frågetavlan – Jeopardy-format. Storbilden visar en tavla med kategorier × poäng (100–500).
// Den som har turen väljer ruta på mobilen, alla trycker in på sin buzzer – snabbast svarar (flerval på mobilen).
// Rätt = +poängen och du väljer nästa. Fel = −poängen och de andra får trycka in igen.
// Frågor: js/quiz-sources.js (översatta till svenska).
(function () {
  const G = (window.HVGames = window.HVGames || {});
  const VALUES = [100, 200, 300, 400, 500];
  const DIFF = { 100: 'easy', 200: 'easy', 300: 'medium', 400: 'hard', 500: 'hard' };
  const BUZZ_MS = 15000, ANSWER_MS = 12000, READ_MS = 2500;

  const host = (() => {
    let H, o, pool = null, poolKey = '', cats = [], tiles = [], chooser = null, phase = 'load', sid = 0;
    let cur = null, buzzer = null, locked = new Set(), opts = null, correctIdx = -1, answered = null, result = null;
    let tm = null, nextT = null, stopped = false, note = '', showAns = false;
    const el = id => document.getElementById(id);
    const catIds = o => o.theme === 'musik' ? QuizSources.THEMES.musik.slice() : QuizSources.THEMES.allm.concat('sport');
    function makePool(opts) {
      const key = catIds(opts).join() + '|' + (opts.lang || 'sv');
      if (pool && poolKey === key) return pool;
      if (pool) pool.stop();
      poolKey = key;
      pool = QuizSources.createPool({ cats: catIds(opts), lang: opts.lang || 'sv', hard: true, onStatus: s => { note = s.note || ''; QuizSources.lobbyNote(s); if (phase === 'load' && el('jtMain')) el('jtMain').innerHTML = loadingHTML(s); } });
      pool.load();
      return pool;
    }
    const loadingHTML = s => `<div class="jt-load"><div class="spin"></div><h3>Hämtar och översätter frågor…</h3>${s ? `<p class="gsub">${Object.values(s.counts || {}).reduce((a, b) => a + b, 0)} frågor klara</p>` : ''}</div>`;
    function lobby(opts, h) { H = h; o = opts; phase = 'load'; makePool(opts); }
    async function start(opts, h) {
      H = h; o = opts; stopped = false; phase = 'load'; sid = 0; result = null; cur = null;
      cats = catIds(o).map(id => QuizSources.CATS[id]);
      H.el.innerHTML = `<div class="jt"><div id="jtMain">${loadingHTML()}</div><div class="side"><div id="jtTurn"></div><div id="jtBoard"></div><div class="acts" id="jtActs"></div><p class="tb-credit">${H.esc(QuizSources.CREDIT)}</p></div></div>`;
      el('jtActs').addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (b) action(b.dataset.a); });
      H.sendState();
      makePool(o);
      await pool.load();
      if (stopped) return;
      if (note) H.toast('⚠️ ' + note, 6000);
      // 5 frågor per kategori, lätta frågor på låga poäng och svåra på höga
      tiles = [];
      cats.forEach((c, ci) => VALUES.forEach((v, vi) => {
        let q = null;
        for (let k = 0; k < 4 && !q; k++) { q = pool.take(c.id, null, x => x.diff === DIFF[v]); if (q && !(q.wrong || []).length && o.mode !== 'oral') { q = null; } }
        tiles.push({ ci, vi, v, q, used: !q });
      }));
      const on = H.order.filter(pid => (H.players.get(pid) || {}).on);
      chooser = on[Math.floor(Math.random() * on.length)] || null;
      go('pick');
    }
    function go(p) { phase = p; sid++; render(); H.sendState(); }
    const left = () => tiles.filter(t => !t.used);
    function clear() { clearTimeout(nextT); if (tm) tm.stop(); tm = null; }
    function pick(i) {
      const t = tiles[i]; if (phase !== 'pick' || !t || t.used) return;
      t.used = true; cur = t; buzzer = null; locked = new Set(); answered = null; result = null;
      const q = t.q;
      if (q.wrong && q.wrong.length && o.mode !== 'oral') {
        let all = [q.correct, ...q.wrong.slice(0, 3)];
        all = q.keepOrder ? all.sort((a, b) => (parseFloat(a) - parseFloat(b)) || String(a).localeCompare(b)) : H.shuffle(all);
        opts = all; correctIdx = all.indexOf(q.correct);
      } else { opts = null; correctIdx = -1; }
      go('read');
      nextT = setTimeout(openBuzz, READ_MS);
    }
    function openBuzz() {
      if (stopped || phase === 'reveal') return;
      if (H.online().every(p => locked.has(p.pid))) { reveal(); return; }
      buzzer = null;
      tm = H.timer(BUZZ_MS, f => { const b = el('jtTimer'); if (b) b.style.transform = `scaleX(${f})`; }, () => reveal());
      go('buzz');
    }
    function onAct(m) {
      if (stopped) return;
      if (m.t === 'pick' && m.pid === chooser) pick(+m.i);
      else if (m.t === 'buzz' && phase === 'buzz' && !locked.has(m.pid) && H.players.has(m.pid)) {
        if (tm) tm.stop(); buzzer = m.pid;
        H.msg({ k: 'buzz', pid: m.pid });
        if (opts) tm = H.timer(ANSWER_MS, f => { const b = el('jtTimer'); if (b) b.style.transform = `scaleX(${f})`; }, () => judge(false));
        else tm = null;
        showAns = false;
        go('answer');
      } else if (m.t === 'ans' && phase === 'answer' && m.pid === buzzer && opts) { answered = +m.i; judge(answered === correctIdx); }
    }
    function judge(ok) {
      if (phase !== 'answer' || !buzzer) return;
      clear();
      const p = H.players.get(buzzer), v = cur.v;
      if (ok) {
        if (p) p.score += v;
        chooser = buzzer; result = { ok: true, pid: buzzer, v };
        H.msg({ k: 'res', pid: buzzer, ok: true, v }); H.confetti(80, false);
        go('reveal'); nextT = setTimeout(next, 4500);
      } else {
        if (p) p.score -= v;
        locked.add(buzzer);
        H.msg({ k: 'res', pid: buzzer, ok: false, v });
        H.toast(`❌ ${H.pname(buzzer)} – fel (−${v})`, 2500);
        if (H.online().every(x => locked.has(x.pid))) { result = { ok: false }; go('reveal'); nextT = setTimeout(next, 5000); return; }
        openBuzz();
      }
    }
    function reveal() { clear(); result = result || { ok: false, none: !locked.size }; go('reveal'); nextT = setTimeout(next, 5000); }
    function next() {
      clear(); cur = null; result = null;
      if (!left().length) { H.finish(); return; }
      if (!(H.players.get(chooser) || {}).on) { const on = H.online(); chooser = on.length ? on[0].pid : null; }
      go('pick');
    }
    function action(a) {
      if (a === 'show') { showAns = true; render(); }
      else if (a === 'ok') judge(true);
      else if (a === 'no') judge(false);
      else if (a === 'skip') { if (phase === 'reveal') next(); else if (phase !== 'pick') reveal(); }
      else if (a === 'bad' && cur && (phase === 'read' || phase === 'buzz')) {
        QuizSources.block(cur.q).then(ok => H.toast(ok ? '🚫 Frågan är spärrad' : '🚫 Hoppar över frågan', 2500));
        clear(); cur.q = null; cur = null; go('pick');
      } else if (a === 'end' && confirm('Avsluta och visa resultatet?')) H.finish();
    }
    function onPresence() {
      if (phase === 'pick' && !(H.players.get(chooser) || {}).on) { const on = H.online(); chooser = on.length ? on[0].pid : null; render(); H.sendState(); }
      if (phase === 'answer' && !(H.players.get(buzzer) || {}).on) judge(false);
    }
    function render() {
      if (!el('jtMain')) return;
      const name = pid => H.esc(H.pname(pid));
      H.board(el('jtBoard'), p => p.pid === buzzer && phase === 'answer' ? { cls: 'act', icon: '⚡' } : p.pid === chooser && phase === 'pick' ? { cls: 'act', icon: '👉' } : locked.has(p.pid) ? { icon: '🔒' } : {});
      let acts = '';
      if (phase === 'pick' || !cur) {
        el('jtTurn').innerHTML = chooser ? `<div class="jt-who">👉 <b>${name(chooser)}</b> väljer fråga</div>` : '';
        el('jtMain').innerHTML = `<div class="jt-grid" style="--cols:${cats.length}">${cats.map(c => `<div class="jt-cat" style="--cc:${c.color}">${c.emo}<br>${H.esc(c.name)}</div>`).join('')}
          ${VALUES.map((v, vi) => cats.map((c, ci) => { const t = tiles.find(x => x.ci === ci && x.vi === vi); return `<button type="button" class="jt-tile" data-i="${tiles.indexOf(t)}" ${t.used ? 'disabled' : ''}>${t.used ? '' : v}</button>`; }).join('')).join('')}</div>`;
        el('jtMain').querySelectorAll('.jt-tile').forEach(b => b.addEventListener('click', () => pick(+b.dataset.i)));
        acts = `<button type="button" class="btn-outline" data-a="end">🏁 Avsluta här</button>`;
      } else {
        const c = cats[cur.ci], q = cur.q;
        el('jtTurn').innerHTML = `<div class="jt-who">${phase === 'answer' ? `⚡ <b>${name(buzzer)}</b> svarar` : phase === 'reveal' ? '' : '⚡ Tryck in på mobilen!'}</div>`;
        let html = `<div class="tb-q jt-q" style="--cc:${c.color}"><div class="tb-cat">${c.emo} ${H.esc(c.name)} · ${cur.v} poäng${q.lang === 'en' ? ' · 🇬🇧' : ''}</div><div class="tb-text">${H.esc(q.q)}</div>`;
        if (opts && phase !== 'read' && phase !== 'buzz') html += `<div class="opts tb-opts">${opts.map((t, i) => `<div class="opt ${phase === 'reveal' && i === correctIdx ? 'tb-right' : ''} ${phase === 'reveal' && i === answered && i !== correctIdx ? 'tb-wrong' : ''}"><span class="ltr">${'ABCD'[i]}</span>${H.esc(t)}</div>`).join('')}</div>`;
        if (phase === 'read') html += `<p class="gsub">Läs frågan … buzzern öppnar strax</p>`;
        if (phase === 'buzz' || (phase === 'answer' && opts)) html += `<div class="timer"><div id="jtTimer"></div></div>`;
        if (phase === 'answer' && !opts) { if (showAns) html += `<p class="gsub">Rätt svar: <b>${H.esc(q.correct)}</b></p>`; else acts += `<button type="button" class="btn-outline" data-a="show">👁 Visa svaret</button>`; acts += `<button type="button" class="judge ok" data-a="ok">✅ Rätt</button><button type="button" class="judge no" data-a="no">❌ Fel</button>`; }
        if (phase === 'reveal') html += `<div class="tb-res ${result && result.ok ? 'ok' : 'no'}">${result && result.ok ? `✅ ${name(result.pid)} +${result.v}` : result && result.none ? `Ingen tryckte in – rätt svar: <b>${H.esc(q.correct)}</b>` : `Rätt svar: <b>${H.esc(q.correct)}</b>`}</div>`;
        html += '</div>';
        el('jtMain').innerHTML = html;
        if (phase === 'read' || phase === 'buzz') acts += `<button type="button" class="btn-outline" data-a="bad">🚫 Dålig fråga</button>`;
        acts += `<button type="button" class="btn-outline" data-a="skip">⏭ ${phase === 'reveal' ? 'Nästa' : 'Visa svaret'}</button>`;
      }
      el('jtActs').innerHTML = acts;
    }
    function state() {
      const s = { phase, sid, chooser, buzzer, locked: [...locked], cats: cats.map(c => ({ name: c.name, emo: c.emo, color: c.color })) };
      if (phase === 'pick') s.tiles = tiles.map(t => t.used ? 0 : t.v);
      if (cur && cur.q) {
        s.q = { text: cur.q.q, v: cur.v, cat: cur.ci, opts: phase === 'answer' || phase === 'reveal' ? opts : null, oral: !opts };
        if (tm) { s.remainMs = tm.left; s.timeMs = phase === 'answer' ? ANSWER_MS : BUZZ_MS; }
        if (phase === 'reveal') Object.assign(s, { correct: cur.q.correct, correctIdx, answered, ok: !!(result && result.ok), winner: result && result.pid });
      }
      return s;
    }
    function stop() { stopped = true; clear(); }
    return { lobby, start, onAct, onPresence, state, stop };
  })();

  const player = (() => {
    function key(s, me, pid) { return [s.phase, s.sid].join('|'); }
    function render(s, me, A) {
      const name = pid => ((s.players || []).find(p => p.pid === pid) || {}).name || '?';
      const head = `<div class="head"><span>🟦 Frågetavlan</span><span class="w">${me.score || 0} p</span></div>`;
      if (s.phase === 'load') { A.render(head + '<div class="center"><div class="spin"></div><p>Frågorna laddas…</p></div>'); return; }
      if (s.phase === 'pick') {
        if (s.chooser !== A.pid) { A.render(head + `<div class="center"><div class="big">👉</div><h1>${A.esc(name(s.chooser))}</h1><p>väljer fråga…</p></div>`); return; }
        const cols = s.cats.length;
        A.render(head + `<p style="text-align:center;margin:0 0 0.6rem;color:var(--accent);font-weight:700">Din tur – välj kategori och poäng!</p>
          <div class="jt-grid jt-mob" style="--cols:${cols}">${s.cats.map(c => `<div class="jt-cat" style="--cc:${c.color}">${c.emo}<br>${A.esc(c.name)}</div>`).join('')}
          ${[0, 1, 2, 3, 4].map(vi => s.cats.map((c, ci) => { const i = ci * 5 + vi, v = s.tiles[i]; return `<button type="button" class="jt-tile" data-i="${i}" ${v ? '' : 'disabled'}>${v || ''}</button>`; }).join('')).join('')}</div>`);
        A.vibrate([60, 40, 60]);
        document.querySelectorAll('.jt-tile').forEach(b => b.addEventListener('click', () => { A.send('pick', { i: +b.dataset.i }); A.render(head + '<div class="center"><div class="spin"></div></div>'); }));
        return;
      }
      if (!s.q) return;
      const c = s.cats[s.q.cat];
      const qbox = `<div class="qbox tb-qbox" style="--cc:${c.color}"><small>${c.emo} ${A.esc(c.name)} · ${s.q.v} p</small><br>${A.esc(s.q.text)}</div>`;
      if (s.phase === 'read' || s.phase === 'buzz') {
        const lockedMe = (s.locked || []).includes(A.pid);
        A.render(head + (s.phase === 'buzz' ? A.timerBar(s) : '') + qbox + `<div class="center" style="min-height:42dvh">
          <button type="button" class="buzzer" id="bz" ${s.phase !== 'buzz' || lockedMe ? 'disabled' : ''}>${lockedMe ? '🔒' : s.phase === 'read' ? '…' : 'BUZZ!'}</button>
          <p>${lockedMe ? 'Du svarade fel – utelåst på den här frågan.' : s.phase === 'read' ? 'Läs frågan – buzzern öppnar strax' : 'Tryck när du vet!'}</p></div>`);
        const b = A.$('bz');
        if (s.phase === 'buzz' && !lockedMe) b.addEventListener('pointerdown', e => { e.preventDefault(); if (b.disabled) return; b.disabled = true; b.classList.add('hit'); b.textContent = '⏳'; A.send('buzz', {}); A.vibrate(60); });
        return;
      }
      if (s.phase === 'answer') {
        if (s.buzzer !== A.pid) { A.render(head + qbox + `<div class="center" style="min-height:36dvh"><div class="big">⚡</div><h1>${A.esc(name(s.buzzer))}</h1><p>svarar…</p></div>`); return; }
        if (s.q.oral) { A.render(head + qbox + `<div class="center" style="min-height:36dvh"><div class="big">🎤</div><h1>Svara högt!</h1><p>Frågeledaren dömer.</p></div>`); return; }
        A.render(head + A.timerBar(s) + qbox + `<p style="text-align:center;margin:0 0 0.5rem;font-weight:700;color:var(--accent)">Du var snabbast – välj svar!</p>
          <div class="choices tb-ans">${s.q.opts.map((t, i) => `<button type="button" data-i="${i}"><span class="ltr">${'ABCD'[i]}</span>${A.esc(t)}</button>`).join('')}</div>`);
        document.querySelectorAll('.tb-ans button').forEach(b => b.addEventListener('click', () => { A.send('ans', { i: +b.dataset.i }); document.querySelectorAll('.tb-ans button').forEach(x => { x.disabled = true; x.classList.toggle('sel', x === b); }); A.vibrate(25); }));
        return;
      }
      if (s.phase === 'reveal') {
        const mine = s.winner === A.pid;
        A.render(head + qbox + `<div class="center" style="min-height:36dvh"><div class="big">${mine ? '✅' : (s.locked || []).includes(A.pid) ? '❌' : '💡'}</div>
          <p>Rätt svar</p><div class="word">${A.esc(s.correct)}</div>${mine ? `<span class="pill">+${s.q.v} – du väljer nästa!</span>` : ''}</div>`);
        if (mine) { A.confetti(90, false); A.vibrate([60, 40, 60]); }
      }
    }
    function onMsg(m, A) { if (m.k === 'res' && m.pid === A.pid && !m.ok) A.vibrate(300); }
    return { key, render, onMsg };
  })();

  G.tavlan = {
    id: 'tavlan', emo: '🟦', name: '🟦 Frågetavlan', title: 'Fråge<span class="hot">tavlan</span>', minPlayers: 2, bgMusic: false,
    desc: 'Jeopardy-tavla på storbilden! Välj kategori och poäng, alla trycker in på mobilen – snabbast svarar. Fel svar kostar poäng.',
    opts: [
      { key: 'theme', label: 'Tema', values: [['allm', '🧠 Allmänbildning'], ['musik', '🤘 Musik']], def: 'allm', help: 'Allmänbildning: 6 kategorier. Musik: Klassisk rock, Hårdrock, Metal och Punk.' },
      { key: 'mode', label: 'Svar', values: [['mc', 'Flerval på mobilen'], ['oral', 'Svara högt']], def: 'mc', help: 'Svara högt: den som trycker in säger svaret, frågeledaren trycker Rätt/Fel.' },
      { key: 'lang', label: 'Språk', values: [['sv', 'Svenska'], ['en', 'Engelska (original)']], def: 'sv' },
    ],
    host, player,
  };
})();
