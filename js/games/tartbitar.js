// Tårtbitarna – frågesport med spelbräde. Storbilden visar hjulbrädet, varje spelare styr sin pjäs från mobilen:
// slå tärningen, välj ruta, svara. Rätt svar på ett högkvarter ger en tårtbit; samla alla och ta dig in till mitten.
// Frågor: js/quiz-sources.js (The Trivia API, Open Trivia DB, Wikidata, egen frågebank, repertoaren) – översatta till svenska.
(function () {
  const G = (window.HVGames = window.HVGames || {});
  const PCOL = ['#ffffff', '#f43f5e', '#22d3ee', '#a3e635', '#facc15', '#c084fc', '#fb923c', '#94a3b8'];
  const MAXP = 8;
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const die = (v, cls) => `<span class="die ${cls || ''}">${[...Array(9)].map((_, i) => `<i class="${v && PIPS[v].includes(i) ? 'p' : ''}"></i>`).join('')}</span>`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- brädet: K kategorier → ring med K×6 rutor, K ekrar à 4 rutor, mitten ----------
  // ring 0…RING-1 (högkvarter på 0, 6, 12 …, "slå igen" mitt emellan), ekrar RING…, mitten HUB.
  // K = 6 (allmänbildning) eller 4 (musik). Sätts med setK() innan brädet används.
  let K = 6, RING = 36, HUB = 60, RING_OFF, SPOKE_OFF;
  function setK(k) {
    K = k; RING = K * 6; HUB = RING + K * 4;
    RING_OFF = K >= 6 ? { 1: 1, 2: 3, 4: 4, 5: 2 } : { 1: 1, 2: 2, 4: 3, 5: 2 };
    SPOKE_OFF = K >= 6 ? [2, 4, 1, 5] : [2, 3, 1, 2];
  }
  setK(6);
  const spoke = (k, j) => RING + k * 4 + j;
  function info(n) {
    if (n === HUB) return { type: 'hub' };
    if (n < RING) {
      const k = Math.floor(n / 6), p = n % 6;
      if (p === 0) return { type: 'hq', cat: k };
      if (p === 3) return { type: 'again' };
      return { type: 'sq', cat: (k + RING_OFF[p]) % K };
    }
    const k = Math.floor((n - RING) / 4), j = (n - RING) % 4;
    return { type: 'sq', cat: (k + SPOKE_OFF[j]) % K };
  }
  function nb(n) {
    if (n === HUB) return [...Array(K).keys()].map(k => spoke(k, 3));
    if (n < RING) { const a = [(n + 1) % RING, (n + RING - 1) % RING]; if (n % 6 === 0) a.push(spoke(n / 6, 0)); return a; }
    const k = Math.floor((n - RING) / 4), j = (n - RING) % 4;
    return [j === 0 ? k * 6 : spoke(k, j - 1), j === 3 ? HUB : spoke(k, j + 1)];
  }
  // alla rutor man kan landa på med exakt "steps" steg (utan att gå tillbaka samma väg)
  function reach(from, steps) {
    const res = new Map();
    (function go(n, path, vis) {
      if (path.length === steps) { if (!res.has(n)) res.set(n, path.slice()); return; }
      for (const m of nb(n)) if (!vis.has(m)) { vis.add(m); path.push(m); go(m, path, vis); path.pop(); vis.delete(m); }
    })(from, [], new Set([from]));
    return res;
  }
  const C = 500, RAD = Math.PI / 180;
  const polar = (r, a) => [C + r * Math.cos(a * RAD), C + r * Math.sin(a * RAD)];
  const ringAng = i => -90 + i * 360 / RING, spokeAng = k => -90 + k * 360 / K, SPOKE_R = [345, 272, 199, 126];
  const half = () => 180 / RING;   // halva rutans bredd i grader
  function pos(n) {
    if (n === HUB) return [C, C];
    if (n < RING) return polar(n % 6 === 0 ? 428 : 430, ringAng(n));
    const k = Math.floor((n - RING) / 4), j = (n - RING) % 4;
    return polar(SPOKE_R[j], spokeAng(k));
  }
  function sector(r0, r1, a0, a1) {
    const [x0, y0] = polar(r1, a0), [x1, y1] = polar(r1, a1), [x2, y2] = polar(r0, a1), [x3, y3] = polar(r0, a0);
    return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r1},${r1} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} A${r0},${r0} 0 0 0 ${x3.toFixed(1)},${y3.toFixed(1)} Z`;
  }
  function boardSVG(cats) {
    const col = i => cats[i].color, emo = i => cats[i].emo;
    let sq = '';
    for (let n = 0; n < RING; n++) {
      const t = info(n), a = ringAng(n), [x, y] = pos(n);
      if (t.type === 'hq') sq += `<g class="tb-n hq" data-n="${n}"><path d="${sector(372, 488, a - half() + 0.1, a + half() - 0.1)}" fill="${col(t.cat)}"/>
        <path d="${sector(380, 480, a - half() + 0.8, a + half() - 0.8)}" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="4"/><text x="${x}" y="${y}" font-size="34">${emo(t.cat)}</text></g>`;
      else sq += `<g class="tb-n" data-n="${n}"><path d="${sector(395, 465, a - half() + 0.4, a + half() - 0.4)}" fill="${t.type === 'again' ? '#3a3d46' : col(t.cat)}"/>
        <text x="${x}" y="${y}" font-size="24">${t.type === 'again' ? '🎲' : emo(t.cat)}</text></g>`;
    }
    for (let k = 0; k < K; k++) for (let j = 0; j < 4; j++) {
      const n = spoke(k, j), t = info(n), [x, y] = pos(n), a = spokeAng(k) + 90;
      sq += `<g class="tb-n" data-n="${n}"><rect x="${x - 31}" y="${y - 31}" width="62" height="62" rx="12" fill="${col(t.cat)}" transform="rotate(${a} ${x} ${y})"/><text x="${x}" y="${y}" font-size="24">${emo(t.cat)}</text></g>`;
    }
    let hub = '';
    for (let k = 0; k < K; k++) { const a = spokeAng(k), h = 180 / K; hub += `<path d="${sector(0.01, 84, a - h, a + h)}" fill="${col(k)}"/>`; }
    return `<svg viewBox="0 0 1000 1000" class="tb-svg" role="img" aria-label="Spelbräde">
      <circle cx="500" cy="500" r="496" fill="#16171d" stroke="rgba(229,169,104,0.35)" stroke-width="4"/>
      <circle cx="500" cy="500" r="360" fill="#0f1015"/>
      <g class="tb-sq">${sq}</g>
      <g class="tb-n hub" data-n="${HUB}">${hub}<circle cx="500" cy="500" r="44" fill="#0f1015" stroke="#E5A968" stroke-width="4"/><text x="500" y="502" font-size="40">🥧</text></g>
      <g class="tb-marks"></g><g class="tb-pieces"></g></svg>`;
  }
  function pieSVG(w, cats, color, size, label) {
    let s = '';
    const N = cats.length, h = 180 / N;
    for (let k = 0; k < N; k++) { const a = -90 + k * 360 / N; const p0 = [Math.cos((a - h) * RAD) * 20, Math.sin((a - h) * RAD) * 20], p1 = [Math.cos((a + h) * RAD) * 20, Math.sin((a + h) * RAD) * 20];
      s += `<path d="M0,0 L${p0[0].toFixed(2)},${p0[1].toFixed(2)} A20,20 0 0 1 ${p1[0].toFixed(2)},${p1[1].toFixed(2)} Z" fill="${(w || []).includes(k) ? cats[k].color : '#2a2c33'}" stroke="#0b0c10" stroke-width="1.2"/>`; }
    return `<g>${s}<circle r="21" fill="none" stroke="${color}" stroke-width="5"/>${label ? `<text y="1" font-size="15" class="tb-ini">${esc(label)}</text>` : ''}</g>`;
  }
  const pieIcon = (w, cats, color, px) => `<svg viewBox="-26 -26 52 52" width="${px}" height="${px}" class="tb-pie">${pieSVG(w, cats, color, 1)}</svg>`;
  // ritar/uppdaterar brädet i en behållare. st: { cats, pieces:[{pid,node,w,c,i}], dests:[n], cur }
  function drawBoard(box, st, onPick) {
    setK(st.cats.length);
    if (box.dataset.tbBuilt !== st.cats.map(c => c.id).join()) {
      box.innerHTML = boardSVG(st.cats); box.dataset.tbBuilt = st.cats.map(c => c.id).join();
      if (onPick) box.querySelector('svg').addEventListener('click', e => {
        const g = e.target.closest('.tb-n.dest, .tb-mark'); if (!g) return;
        onPick(+g.dataset.n);
      });
    }
    const svg = box.querySelector('svg');
    svg.querySelectorAll('.tb-n').forEach(g => g.classList.toggle('dest', (st.dests || []).includes(+g.dataset.n)));
    svg.querySelector('.tb-marks').innerHTML = (st.dests || []).map((n, i) => { const [x, y] = pos(n);
      return `<g class="tb-mark" data-n="${n}"><circle cx="${x}" cy="${y - 34}" r="19" fill="#fff" stroke="#111" stroke-width="3"/><text x="${x}" y="${y - 33}" font-size="22" fill="#111" font-weight="700">${i + 1}</text></g>`; }).join('');
    const byNode = new Map();
    (st.pieces || []).forEach(p => { const a = byNode.get(p.node) || []; a.push(p); byNode.set(p.node, a); });
    const layer = svg.querySelector('.tb-pieces');
    const have = new Map([...layer.children].map(g => [g.dataset.pid, g]));
    (st.pieces || []).forEach(p => {
      const grp = byNode.get(p.node), k = grp.indexOf(p), m = grp.length;
      let [x, y] = pos(p.node);
      if (m > 1) { x += Math.cos(2 * Math.PI * k / m) * 26; y += Math.sin(2 * Math.PI * k / m) * 26; }
      let g = have.get(p.pid);
      if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.dataset.pid = p.pid; g.setAttribute('class', 'tb-piece'); layer.appendChild(g); }
      const sig = (p.w || []).join() + p.c + p.i + (p.pid === st.cur);
      if (g.dataset.sig !== sig) { g.innerHTML = pieSVG(p.w, st.cats, p.c, 1, p.i); g.dataset.sig = sig; }
      g.classList.toggle('cur', p.pid === st.cur);
      g.style.transform = `translate(${x}px, ${y}px) scale(${p.pid === st.cur ? 1.75 : 1.4})`;
      have.delete(p.pid);
    });
    have.forEach(g => g.remove());
  }
  function catOf(st, n) { setK(st.cats.length); const t = info(n); return t.type === 'hub' ? { label: '⭐ Mitten', color: '#E5A968' } : t.type === 'again' ? { label: '🎲 Slå igen', color: '#6b7280' } : { label: `${st.cats[t.cat].emo} ${st.cats[t.cat].name}${t.type === 'hq' ? ' – högkvarter 🥧' : ''}`, color: st.cats[t.cat].color }; }

  // ---------- storbilden ----------
  const host = (() => {
    let H, o, pool = null, poolKey = '', cats = [], pieces = new Map(), order = [], cur = null, phase = 'load', sid = 0, roll = 0;
    let dests = new Map(), q = null, qi = 0, qKind = 'normal', qOpts = null, qCorrect = -1, qOral = false, answered = null, result = null, picker = null;
    let tips = new Map(), tm = null, nextT = null, stopped = false, startedAt = 0, winner = null, timeUp = false, rollAnim = null, walkT = null, lastNote = '';
    const el = id => document.getElementById(id);
    const catIds = opts => opts.theme === 'musik' ? QuizSources.THEMES.musik.slice() : QuizSources.THEMES.allm.concat(opts.six || 'sport');
    const needN = () => o.need ? Math.min(o.need, cats.length) : cats.length;   // 0 = alla bitar
    function makePool(opts) {
      const key = [catIds(opts).join(), opts.lang].join('|');
      if (pool && poolKey === key) return pool;
      if (pool) pool.stop();
      poolKey = key;
      pool = QuizSources.createPool({ cats: catIds(opts), lang: opts.lang || 'sv', onStatus: s => { lastNote = s.note || ''; lobbyStatus(s); } });
      pool.load();
      return pool;
    }
    function lobbyStatus(s) {
      let p = document.getElementById('tbLobbyStatus');
      const anchor = document.getElementById('minNote');
      if (!p && anchor) { p = document.createElement('p'); p.id = 'tbLobbyStatus'; p.className = 'text-muted'; p.style.cssText = 'font-size:0.9rem;margin-top:0.4rem'; anchor.after(p); }
      if (!p) return;
      const n = s.counts, total = Object.values(n).reduce((a, b) => a + b, 0);
      p.innerHTML = `🥧 Frågor: ${Object.keys(n).map(c => `${QuizSources.CATS[c].emo} ${n[c]}`).join(' · ')} ${s.pending ? '<span class="spin" style="display:inline-block;width:0.9em;height:0.9em;vertical-align:-2px"></span>' : '✅'}${s.note ? `<br>⚠️ ${esc(s.note)}` : ''}`;
      if (phase === 'load' && el('tbCard')) loadingView(total);
    }
    function lobby(opts, h) { H = h; o = opts; phase = 'load'; makePool(opts); }
    function onlineOrder() { return order.filter(pid => { const p = H.players.get(pid); return p && p.on && pieces.has(pid); }); }
    function addPiece(pid) {
      if (pieces.has(pid) || pieces.size >= MAXP) return;
      const used = new Set([...pieces.values()].map(p => p.c));
      const c = PCOL.find(x => !used.has(x)) || PCOL[pieces.size % PCOL.length];
      pieces.set(pid, { node: HUB, w: new Set(), c, i: (H.pname(pid) || '?').trim().charAt(0).toUpperCase() });
      if (!order.includes(pid)) order.push(pid);
    }
    async function start(opts, h) {
      H = h; o = opts; stopped = false; winner = null; timeUp = false;
      cats = catIds(o).map(id => QuizSources.CATS[id]);
      setK(cats.length);
      pieces = new Map(); order = []; cur = null; sid = 0; result = null; q = null;
      H.order.forEach(pid => { const p = H.players.get(pid); if (p && p.on) addPiece(pid); });
      H.el.innerHTML = `<div class="tb">
        <div class="tb-boardwrap"><div class="tb-board" id="tbBoard"></div></div>
        <div class="tb-side">
          <div class="tb-turn" id="tbTurn"></div>
          <div class="tb-card" id="tbCard"></div>
          <div class="acts" id="tbActs"></div>
          <div class="tb-players" id="tbPlayers"></div>
          <p class="tb-credit">${esc(QuizSources.CREDIT)}</p>
        </div></div>`;
      el('tbActs').addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (b) hostAction(b.dataset.a); });
      phase = 'load'; render(); H.sendState();
      makePool(o);
      await pool.load();
      if (stopped) return;
      startedAt = Date.now();
      if (lastNote) H.toast('⚠️ ' + lastNote, 6000);
      cur = onlineOrder()[0] || null;
      if (!cur) { H.finish(); return; }
      go('roll');
    }
    function go(p) { phase = p; sid++; render(); H.sendState(); }
    function pl(pid) { return H.players.get(pid); }
    function nextTurn() {
      clearTimers();
      if (checkTime()) return;
      const ord = onlineOrder();
      if (!ord.length) { H.finish(); return; }
      const i = ord.indexOf(cur);
      cur = ord[(i + 1) % ord.length];
      roll = 0; dests = new Map(); q = null; result = null;
      go('roll');
      H.msg({ k: 'turn', pid: cur });
    }
    function checkTime() {
      if (!o.limit || timeUp) return false;
      if (Date.now() - startedAt < o.limit * 60000) return false;
      timeUp = true; H.toast('⏰ Tiden är ute!', 4000); setTimeout(() => H.finish(), 2500); return true;
    }
    function clearTimers() { clearTimeout(nextT); clearTimeout(walkT); clearInterval(rollAnim); rollAnim = null; if (tm) tm.stop(); tm = null; }
    function doRoll() {
      if (phase !== 'roll') return;
      phase = 'rolling'; sid++;
      roll = 1 + Math.floor(Math.random() * 6);
      let k = 0;
      H.sendState();
      rollAnim = setInterval(() => { const d = el('tbDie'); if (d) d.innerHTML = die(1 + Math.floor(Math.random() * 6), 'roll'); if (++k > 7) { clearInterval(rollAnim); rollAnim = null; afterRoll(); } }, 110);
      render();
    }
    function afterRoll() {
      if (stopped || phase !== 'rolling') return;
      dests = reach(pieces.get(cur).node, roll);
      if (dests.size === 1) { go('move'); nextT = setTimeout(() => doMove([...dests.keys()][0]), 1200); return; }
      go('move');
    }
    function doMove(node) {
      if (phase !== 'move' || !dests.has(node)) return;
      clearTimeout(nextT);
      const path = dests.get(node).slice(), me = pieces.get(cur);
      dests = new Map(); phase = 'walk'; sid++; H.sendState(); render();
      const step = () => {
        if (stopped) return;
        me.node = path.shift(); drawHostBoard();
        if (path.length) walkT = setTimeout(step, 230); else walkT = setTimeout(() => land(node), 380);
      };
      step();
    }
    function land(node) {
      const t = info(node), me = pieces.get(cur);
      if (t.type === 'again') { H.toast(`🎲 ${H.pname(cur)} slår igen!`, 2200); go('roll'); return; }
      if (t.type === 'hub') {
        if (me.w.size >= needN()) {
          const ord = onlineOrder(), i = ord.indexOf(cur);
          picker = ord.length > 1 ? ord[(i + 1) % ord.length] : cur;      // nästa spelare väljer kategori
          qKind = 'final'; go('pickcat'); return;
        }
        picker = cur; qKind = 'hub'; go('pickcat'); return;
      }
      ask(t.cat, t.type === 'hq' ? 'hq' : 'normal');
    }
    function ask(ci, kind, exceptId) {
      clearTimers();
      qi = ci; qKind = kind;
      q = pool.take(cats[ci].id, exceptId);
      if (!q) { for (const c of H.shuffle(cats)) { q = pool.take(c.id); if (q) break; } }   // låna från en annan kategori
      if (!q) { H.toast('Frågorna tog slut 😮 – nästa spelare', 3000); nextTurn(); return; }
      answered = null; tips = new Map(); result = null;
      qOral = o.mode === 'oral' || !(q.wrong || []).length;
      if (!qOral) {
        let all = [q.correct, ...q.wrong.slice(0, 3)];
        all = q.keepOrder ? all.sort((a, b) => (parseFloat(a) - parseFloat(b)) || String(a).localeCompare(b)) : H.shuffle(all);
        qOpts = all; qCorrect = all.indexOf(q.correct);
        tm = H.timer(30000, f => { const b = el('tbTimer'); if (b) b.style.transform = `scaleX(${f})`; }, () => answer(null));
      } else { qOpts = null; qCorrect = -1; }
      go('question');
    }
    function answer(i) {
      if (phase !== 'question' || qOral) return;
      answered = i; finishQ(i === qCorrect);
    }
    function judge(ok) { if (phase !== 'question' || !qOral) return; finishQ(!!ok); }
    function finishQ(ok) {
      clearTimers();
      const p = pl(cur), me = pieces.get(cur);
      let wedge = false;
      if (ok) {
        if (p) p.score += 10;
        if (qKind === 'hq' && !me.w.has(qi)) { me.w.add(qi); wedge = true; if (p) p.score += 100; }
        if (qKind === 'final') { winner = cur; if (p) p.score += 500; }
      }
      if (!qOral) tips.forEach((i, pid) => { if (pid !== cur && i === qCorrect) { const x = pl(pid); if (x) x.score += 5; } });
      result = { ok, wedge, correct: q.correct, all: me.w.size >= needN() };
      H.msg({ k: 'res', pid: cur, ok, wedge });
      if (ok) H.confetti(wedge || winner ? 160 : 60, false);
      go('result');
      if (winner) { nextT = setTimeout(() => H.finish(), 5000); return; }
      if (wedge && result.all) H.toast(`🥧 ${H.pname(cur)} har alla tårtbitar – nu in till mitten!`, 5000);
      nextT = setTimeout(() => { if (checkTime()) return; if (ok) { roll = 0; q = null; result = null; go('roll'); H.msg({ k: 'turn', pid: cur }); } else nextTurn(); }, wedge ? 5000 : 4000);
    }
    function onAct(m) {
      if (stopped) return;
      if (m.t === 'roll' && m.pid === cur) doRoll();
      else if (m.t === 'move' && m.pid === cur) doMove(+m.node);
      else if (m.t === 'cat' && phase === 'pickcat' && m.pid === picker) ask(Math.max(0, Math.min(cats.length - 1, +m.i || 0)), qKind);
      else if (m.t === 'ans' && phase === 'question' && !qOral) {
        const i = +m.i; if (!(i >= 0 && i < qOpts.length)) return;
        if (m.pid === cur) answer(i); else if (!tips.has(m.pid)) { tips.set(m.pid, i); render(); H.sendState(); }
      } else if (m.t === 'judge' && phase === 'question' && qOral && m.pid !== cur) judge(m.ok);
    }
    function onPresence() {
      if (stopped || phase === 'load') return;
      H.order.forEach(pid => { const p = H.players.get(pid); if (p && p.on && !pieces.has(pid)) { addPiece(pid); H.toast(`👋 ${H.pname(pid)} är med i spelet`, 2500); } });
      const cp = pl(cur);
      if (cur && (!cp || !cp.on) && ['roll', 'move', 'pickcat', 'question'].includes(phase)) { H.toast(`${H.pname(cur)} lämnade – nästa spelare`, 3000); nextTurn(); return; }
      if (phase === 'pickcat' && picker && !(pl(picker) || {}).on) picker = cur;
      render(); H.sendState();
    }
    function hostAction(a) {
      if (a === 'roll' && phase === 'roll') doRoll();
      else if (a === 'skip') { clearTimers(); nextTurn(); }
      else if (a === 'ok') judge(true);
      else if (a === 'no') judge(false);
      else if (a === 'bad' && phase === 'question' && q) {
        const bad = q; QuizSources.block(bad).then(okb => H.toast(okb ? '🚫 Frågan är spärrad och visas inte igen' : '🚫 Frågan byttes ut', 2500));
        ask(qi, qKind, bad.id);
      } else if (a === 'randcat' && phase === 'pickcat') ask(Math.floor(Math.random() * cats.length), qKind);
    }
    function drawHostBoard() {
      const b = el('tbBoard'); if (!b) return;
      drawBoard(b, { cats, pieces: pieceList(), dests: phase === 'move' ? [...dests.keys()] : [], cur }, n => { if (phase === 'move') doMove(n); });
    }
    function pieceList() { return [...pieces.entries()].map(([pid, p]) => ({ pid, node: p.node, w: [...p.w], c: p.c, i: p.i })); }
    function loadingView(total) {
      const c = el('tbCard'); if (!c) return;
      c.innerHTML = `<div class="tb-q"><div class="spin"></div><h3>Hämtar och översätter frågor…</h3><p class="gsub">${total || 0} frågor klara</p></div>`;
    }
    function render() {
      if (!el('tbCard')) return;
      drawHostBoard();
      const name = pid => H.esc(H.pname(pid)), me = pieces.get(cur), color = me ? me.c : '#fff';
      const need = needN();
      el('tbPlayers').innerHTML = [...pieces.entries()].sort((a, b) => (pl(b[0]) || {}).score - (pl(a[0]) || {}).score).map(([pid, p]) => {
        const x = pl(pid) || {};
        return `<div class="${pid === cur ? 'act' : ''} ${x.on ? '' : 'off'}">${pieIcon([...p.w], cats, p.c, 34)}<span>${name(pid)}</span><small>${p.w.size}/${need} 🥧</small><b>${x.score || 0}</b></div>`;
      }).join('');
      if (phase === 'load') { el('tbTurn').innerHTML = ''; el('tbActs').innerHTML = ''; loadingView(0); return; }
      el('tbTurn').innerHTML = `<div class="tb-who" style="--pc:${color}">${pieIcon(me ? [...me.w] : [], cats, color, 54)}<div><small>${timeLeftText()}Tur</small><h2>${name(cur)}</h2></div>
        <div class="dice big" id="tbDie">${phase === 'rolling' ? die(1, 'roll') : roll ? die(roll) : ''}</div></div>`;
      let card = '', acts = '';
      if (phase === 'roll') { card = `<div class="tb-q"><h3>🎲 Slå tärningen på mobilen!</h3><p class="gsub">Skaka mobilen eller tryck på tärningen.</p></div>`; acts = btn('roll', '🎲 Slå åt spelaren') + btn('skip', '⏭ Hoppa över'); }
      else if (phase === 'rolling') card = `<div class="tb-q"><h3>Tärningen rullar…</h3></div>`;
      else if (phase === 'move') { card = `<div class="tb-q"><h3>Välj ruta på mobilen</h3><div class="tb-dests">${[...dests.keys()].map((n, i) => { const c = catOf({ cats }, n); return `<span style="--dc:${c.color}"><b>${i + 1}</b> ${esc(c.label)}</span>`; }).join('')}</div></div>`; acts = btn('skip', '⏭ Hoppa över'); }
      else if (phase === 'walk') card = `<div class="tb-q"><h3>🚶 ${name(cur)} flyttar…</h3></div>`;
      else if (phase === 'pickcat') {
        card = qKind === 'final'
          ? `<div class="tb-q"><h3>⭐ Slutfrågan!</h3><p class="gsub">${name(picker)} väljer kategori åt ${name(cur)} på mobilen.</p></div>`
          : `<div class="tb-q"><h3>⭐ Mitten</h3><p class="gsub">${name(cur)} väljer valfri kategori på mobilen.</p></div>`;
        acts = btn('randcat', '🎰 Slumpa kategori');
      } else if (phase === 'question' || phase === 'result') {
        const c = cats[qi];
        const tag = qKind === 'final' ? '⭐ Slutfråga' : qKind === 'hq' ? (me && me.w.has(qi) && phase === 'question' ? 'Högkvarter (har redan biten)' : '🥧 Om tårtbiten!') : qKind === 'hub' ? '⭐ Mitten' : '';
        card = `<div class="tb-q" style="--cc:${c.color}"><div class="tb-cat">${c.emo} ${esc(c.name)}${tag ? ` · ${tag}` : ''}${q && q.lang === 'en' ? ' · 🇬🇧' : ''}</div>
          <div class="tb-text">${esc(q ? q.q : '')}</div>`;
        if (qOpts) card += `<div class="opts tb-opts">${qOpts.map((t, i) => `<div class="opt ${phase === 'result' && i === qCorrect ? 'tb-right' : ''} ${phase === 'result' && i === answered && i !== qCorrect ? 'tb-wrong' : ''}"><span class="ltr">${'ABCD'[i]}</span>${esc(t)}${phase === 'question' && [...tips.values()].length ? '' : ''}</div>`).join('')}</div>`;
        if (phase === 'question') {
          if (qOpts) card += `<div class="timer"><div id="tbTimer"></div></div><p class="gsub" style="margin-top:0.4rem">${name(cur)} svarar på mobilen${tips.size ? ` · ${tips.size} har tippat` : ' · de andra kan tippa för +5'}</p>`;
          else { card += `<p class="gsub">${name(cur)} svarar högt – de andra ser svaret på mobilen och dömer.</p>`; acts = btn('ok', '✅ Rätt') + btn('no', '❌ Fel'); }
          acts += btn('bad', '🚫 Dålig fråga – byt') + btn('skip', '⏭ Hoppa över');
        } else if (result) {
          card += `<div class="tb-res ${result.ok ? 'ok' : 'no'}">${winner ? `🏆 ${name(cur)} vinner!` : result.ok ? (result.wedge ? `🥧 Rätt – ${name(cur)} tar tårtbiten!` : '✅ Rätt! Slå igen') : `❌ Fel – rätt svar: <b>${esc(result.correct)}</b>`}</div>`;
        }
        card += '</div>';
      }
      el('tbCard').innerHTML = card;
      el('tbActs').innerHTML = acts;
    }
    const btn = (a, t) => `<button type="button" class="btn-outline" data-a="${a}">${t}</button>`;
    function timeLeftText() { if (!o.limit || !startedAt) return ''; const m = Math.max(0, Math.ceil((o.limit * 60000 - (Date.now() - startedAt)) / 60000)); return `⏱ ${m} min kvar · `; }
    function state() {
      const s = { phase, sid, cur, picker, roll, kind: qKind, need: needN(), mode: o.mode,
        cats: cats.map(c => ({ id: c.id, name: c.name, emo: c.emo, color: c.color })), pieces: pieceList() };
      if (phase === 'move') s.dests = [...dests.keys()];
      if ((phase === 'question' || phase === 'result') && q) {
        s.q = { text: q.q, cat: qi, opts: qOpts, oral: qOral, lang: q.lang };
        if (qOral) s.q.answer = q.correct;              // domarna (alla utom den som svarar) ser svaret
        if (phase === 'question' && tm) { s.remainMs = tm.left; s.timeMs = 30000; }
        s.tipped = [...tips.keys()];
      }
      if (phase === 'result' && result) Object.assign(s, { ok: result.ok, wedge: result.wedge, correctIdx: qCorrect, correct: result.correct, answered, winner });
      return s;
    }
    function stop() { stopped = true; clearTimers(); }
    // länk till egna frågor (bara admin/stämledare)
    function setup(box) {
      if (typeof getCurrentMember !== 'function') return;
      getCurrentMember().then(m => { if (m && typeof isSongEditor === 'function' && isSongEditor(m))
        box.insertAdjacentHTML('beforeend', '<p class="text-muted" style="margin:0"><a href="/admin/quizfragor.html?from=party">✏️ Skriv egna frågor eller spärra dåliga frågor</a></p>'); }).catch(() => {});
    }
    return { lobby, start, onAct, onPresence, state, stop, setup, _t: { pieces: () => pieces } };
  })();

  // ---------- mobilen ----------
  const player = (() => {
    let myTip = null, mySid = -1, shakeOff = null;
    function key(s, me, pid) { return [s.phase, s.sid, (s.tipped || []).includes(pid)].join('|'); }
    function render(s, me, A) {
      if (s.sid !== mySid) { myTip = null; mySid = s.sid; }
      const P = (s.pieces || []).find(p => p.pid === A.pid);
      const name = pid => ((s.players || []).find(p => p.pid === pid) || {}).name || '?';
      const myTurn = s.cur === A.pid;
      const cats = s.cats || [];
      const head = `<div class="head"><span>🥧 Tårtbitarna</span><span class="w">${P ? `${P.w.length}/${s.need} 🥧` : ''} · ${me.score || 0} p</span></div>`;
      const mine = P ? `<div class="tb-me">${pieIcon(P.w, cats, P.c, 64)}</div>` : '';
      if (s.phase === 'load') { A.render(head + '<div class="center"><div class="spin"></div><p>Frågorna laddas…</p></div>'); return; }
      if (!P) { A.render(head + '<div class="center"><div class="big">👀</div><h1>Fullt bräde</h1><p>Du följer spelet – max 8 pjäser.</p></div>'); return; }
      const c = s.q ? cats[s.q.cat] : null;
      if (s.phase === 'roll' && myTurn) {
        A.render(head + `<div class="center tb-rollv">${mine}<h1>Din tur!</h1><button type="button" class="tb-rollbtn" id="tbRoll">${die(Math.ceil(Math.random() * 6))}<span>Slå tärningen</span></button><p>Tryck – eller skaka mobilen</p></div>`);
        A.vibrate([80, 60, 80]);
        let sent = false;
        const doRoll = () => { if (sent) return; sent = true; A.$('tbRoll').disabled = true; A.$('tbRoll').classList.add('rolling'); A.send('roll', {}); A.vibrate(40); };
        A.$('tbRoll').addEventListener('click', doRoll);
        // skaka för att slå (Android; på iPhone krävs tillstånd, så där räcker knappen)
        if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission !== 'function') {
          const f = e => { const a = e.accelerationIncludingGravity || {}; if (Math.hypot(a.x || 0, a.y || 0, a.z || 0) > 26) doRoll(); };
          window.addEventListener('devicemotion', f); A.onCleanup(() => window.removeEventListener('devicemotion', f));
        }
        return;
      }
      if (s.phase === 'move' && myTurn) {
        A.render(head + `<div class="tb-movev"><p style="margin:0 0 0.4rem;text-align:center">Du slog <b>${s.roll}</b> – välj ruta:</p><div class="tb-board tb-mini" id="tbMini"></div>
          <div class="choices tb-dlist">${(s.dests || []).map((n, i) => { const k = catOf(s, n); return `<button type="button" data-n="${n}" style="--dc:${k.color}"><b>${i + 1}</b> ${A.esc(k.label)}</button>`; }).join('')}</div></div>`);
        const pick = n => { A.send('move', { node: n }); A.render(head + '<div class="center"><div class="spin"></div><p>Flyttar…</p></div>'); A.vibrate(20); };
        drawBoard(A.$('tbMini'), { cats, pieces: s.pieces, dests: s.dests, cur: s.cur }, pick);
        document.querySelectorAll('.tb-dlist button').forEach(b => b.addEventListener('click', () => pick(+b.dataset.n)));
        return;
      }
      if (s.phase === 'pickcat' && s.picker === A.pid) {
        const fin = s.kind === 'final';
        A.render(head + `<div class="tb-pickv"><h2 style="text-align:center;margin:0.4rem 0">${fin ? (s.cur === A.pid ? '⭐ Din slutfråga!' : `⭐ Välj kategori för ${A.esc(name(s.cur))}s slutfråga`) : '⭐ Välj kategori'}</h2>
          <p style="text-align:center;margin:0 0 0.8rem;color:var(--text-muted)">${fin ? 'Välj den du tror är svårast!' : 'Vilken kategori vill du ha?'}</p>
          <div class="choices tb-cats">${cats.map((k, i) => `<button type="button" data-i="${i}" style="--dc:${k.color}">${k.emo} ${A.esc(k.name)}</button>`).join('')}</div></div>`);
        document.querySelectorAll('.tb-cats button').forEach(b => b.addEventListener('click', () => { A.send('cat', { i: +b.dataset.i }); A.render(head + '<div class="center"><div class="spin"></div></div>'); }));
        return;
      }
      if (s.phase === 'question' && s.q) {
        const qbox = `<div class="qbox tb-qbox" style="--cc:${c.color}"><small>${c.emo} ${A.esc(c.name)}${s.kind === 'final' ? ' · ⭐ Slutfråga' : s.kind === 'hq' ? ' · 🥧 Om tårtbiten' : ''}</small><br>${A.esc(s.q.text)}</div>`;
        if (!s.q.oral) {
          const tipped = (s.tipped || []).includes(A.pid);
          if (!myTurn && tipped) { A.render(head + A.timerBar(s) + qbox + `<div class="center" style="min-height:30dvh"><div class="big">🤞</div><p>Tips lagt – ${A.esc(name(s.cur))} svarar…</p></div>`); return; }
          A.render(head + A.timerBar(s) + qbox + `${myTurn ? '<p style="text-align:center;margin:0 0 0.5rem;font-weight:700;color:var(--accent)">Din fråga – välj svar!</p>' : `<p style="text-align:center;margin:0 0 0.5rem;color:var(--text-muted)">${A.esc(name(s.cur))} svarar. Tippa för +5!</p>`}
            <div class="choices tb-ans">${s.q.opts.map((t, i) => `<button type="button" data-i="${i}"><span class="ltr">${'ABCD'[i]}</span>${A.esc(t)}</button>`).join('')}</div>`);
          document.querySelectorAll('.tb-ans button').forEach(b => b.addEventListener('click', () => {
            myTip = +b.dataset.i; A.send('ans', { i: myTip }); A.vibrate(25);
            document.querySelectorAll('.tb-ans button').forEach(x => { x.disabled = true; x.classList.toggle('sel', x === b); });
          }));
          return;
        }
        if (myTurn) { A.render(head + qbox + `<div class="center" style="min-height:30dvh"><div class="big">🎤</div><h1>Svara högt!</h1><p>De andra ser svaret och dömer.</p></div>`); return; }
        A.render(head + qbox + `<div class="tb-judge"><p>Rätt svar:</p><div class="word">${A.esc(s.q.answer)}</div><p>Svarade ${A.esc(name(s.cur))} rätt?</p>
          <div class="acts" style="justify-content:center"><button type="button" class="judge ok" data-ok="1">✅ Rätt</button><button type="button" class="judge no" data-ok="0">❌ Fel</button></div></div>`);
        document.querySelectorAll('.tb-judge button').forEach(b => b.addEventListener('click', () => { A.send('judge', { ok: b.dataset.ok === '1' }); A.vibrate(20); }));
        return;
      }
      if (s.phase === 'result' && s.q) {
        const big = s.winner ? (s.winner === A.pid ? '🏆' : '👏') : s.ok ? (s.wedge ? '🥧' : '✅') : '❌';
        const line = s.winner ? (s.winner === A.pid ? 'Du vann!' : `${A.esc(name(s.winner))} vann!`)
          : myTurn ? (s.ok ? (s.wedge ? 'Tårtbiten är din!' : 'Rätt – slå igen!') : 'Fel svar') : `${A.esc(name(s.cur))} svarade ${s.ok ? 'rätt' : 'fel'}`;
        const tipTxt = !myTurn && myTip != null && !s.q.oral ? (myTip === s.correctIdx ? '<span class="pill">🤞 Ditt tips var rätt: +5</span>' : '<span class="pill">Ditt tips var fel</span>') : '';
        A.render(head + `<div class="center">${mine}<div class="big">${big}</div><h1>${line}</h1><p>Rätt svar: <b style="color:var(--accent)">${A.esc(s.correct)}</b></p>${tipTxt}</div>`);
        if (myTurn && s.ok) { A.confetti(s.wedge || s.winner ? 160 : 70, false); A.vibrate([60, 40, 60]); } else if (myTurn) A.vibrate(250);
        if (!myTurn && myTip != null && myTip === s.correctIdx) A.vibrate(40);
        return;
      }
      // väntar på någon annan
      const curP = (s.pieces || []).find(p => p.pid === s.cur);
      const what = { roll: 'slår tärningen', rolling: `slog …`, move: `slog ${s.roll} och väljer ruta`, walk: 'flyttar', pickcat: s.kind === 'final' ? `ska få slutfrågan – ${A.esc(name(s.picker))} väljer kategori` : 'väljer kategori' }[s.phase] || '';
      A.render(head + `<div class="center">${mine}<p>Det är</p><h1 style="color:${curP ? curP.c : '#fff'}">${A.esc(name(s.cur))}s tur</h1><p>${what}</p>
        ${P.w.length >= s.need ? '<span class="pill">🥧 Du har alla bitar – ta dig till mitten!</span>' : `<span class="pill">Dina tårtbitar: ${P.w.length} av ${s.need}</span>`}</div>`);
    }
    return { key, render };
  })();

  G.tartbitar = {
    id: 'tartbitar', emo: '🥧', name: '🥧 Tårtbitarna', title: 'Tårt<span class="hot">bitarna</span>', minPlayers: 2, bgMusic: true,
    desc: 'Frågesport med spelbräde! Slå tärningen och flytta din pjäs från mobilen, svara rätt på högkvarteren och samla tårtbitar. Spela i lag: ett lag = en mobil.',
    opts: [
      { key: 'theme', label: 'Tema', values: [['allm', '🧠 Allmänbildning'], ['musik', '🤘 Musik']], def: 'allm', help: 'Musik: fyra kategorier – Klassisk rock, Hårdrock, Metal och Punk.' },
      { key: 'need', label: 'Tårtbitar för att vinna', values: [[3, '3 – snabbt'], [0, 'Alla – klassiskt']], def: 3, help: 'Med alla bitar tar man sig in till mitten och får en slutfråga – kategorin väljer motståndaren.' },
      { key: 'mode', label: 'Svar', values: [['mc', 'Flervalsfrågor'], ['oral', 'Svara högt']], def: 'mc', help: 'Flerval: svara på mobilen, de andra kan tippa för +5. Svara högt: de andra ser svaret på mobilen och dömer.' },
      { key: 'six', label: 'Sjätte kategorin (allmänbildning)', values: [['sport', '⚽ Sport'], ['rock', '🤘 Rock'], ['kor', '🎤 Heavy Voices']], def: 'sport', help: 'Heavy Voices = frågor från körens egen frågebank och "fortsätt raden" ur repertoaren.' },
      { key: 'lang', label: 'Språk', values: [['sv', 'Svenska'], ['en', 'Engelska (original)']], def: 'sv' },
      { key: 'limit', label: 'Tidsgräns', values: [[0, 'Ingen'], [30, '30 min'], [45, '45 min']], def: 0, help: 'När tiden är ute vinner den med flest poäng (100 per tårtbit, 10 per rätt svar).' },
    ],
    host, player,
    _test: { info, nb, reach, setK, get HUB() { return HUB; } },
  };
})();
