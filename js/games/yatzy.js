// Yatzy – Mobilspel. Turordning: den som har turen slår och sparar tärningar på mobilen
// (eller skakar mobilen), storbilden visar tärningarna och protokollet för alla.
(function () {
  const G = (window.HVGames = window.HVGames || {});
  const CATS = [
    ['1', 'Ettor'], ['2', 'Tvåor'], ['3', 'Treor'], ['4', 'Fyror'], ['5', 'Femmor'], ['6', 'Sexor'],
    ['p1', 'Ett par'], ['p2', 'Två par'], ['k3', 'Tretal'], ['k4', 'Fyrtal'], ['ss', 'Liten stege'], ['ls', 'Stor stege'],
    ['fh', 'Kåk'], ['ch', 'Chans'], ['y', 'Yatzy'],
  ];
  const SHORT = ['1', '2', '3', '4', '5', '6', 'ch', 'y'];
  const UPPER = ['1', '2', '3', '4', '5', '6'];
  const catName = k => (CATS.find(c => c[0] === k) || [k, k])[1];
  function score(cat, d) {
    if (!d || d.length !== 5 || d.some(v => !v)) return 0;
    const c = [0, 0, 0, 0, 0, 0, 0]; d.forEach(v => c[v]++);
    const sum = d.reduce((a, b) => a + b, 0);
    if (UPPER.includes(cat)) return c[+cat] * +cat;
    const pairs = []; for (let v = 6; v >= 1; v--) if (c[v] >= 2) pairs.push(v);
    const kind = k => { for (let v = 6; v >= 1; v--) if (c[v] >= k) return v * k; return 0; };
    switch (cat) {
      case 'p1': return pairs.length ? pairs[0] * 2 : 0;
      case 'p2': return pairs.length >= 2 ? (pairs[0] + pairs[1]) * 2 : 0;
      case 'k3': return kind(3);
      case 'k4': return kind(4);
      case 'ss': return [1, 2, 3, 4, 5].every(v => c[v] === 1) ? 15 : 0;
      case 'ls': return [2, 3, 4, 5, 6].every(v => c[v] === 1) ? 20 : 0;
      case 'fh': return c.some((x, i) => i && x === 3) && c.some((x, i) => i && x === 2) ? sum : 0;
      case 'ch': return sum;
      case 'y': return c.some((x, i) => i && x === 5) ? 50 : 0;
    }
    return 0;
  }
  const upperSum = sh => UPPER.reduce((a, k) => a + (sh[k] || 0), 0);
  const bonus = sh => upperSum(sh) >= 63 ? 50 : 0;
  const total = sh => Object.values(sh).reduce((a, b) => a + b, 0) + bonus(sh);
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const die = (v, cls) => `<span class="die ${cls || ''}">${[...Array(9)].map((_, i) => `<i class="${v && PIPS[v].includes(i) ? 'p' : ''}"></i>`).join('')}</span>`;

  // ---------- storbilden ----------
  const host = (() => {
    let H, o, cats = [], sheets = {}, queue = [], qi = 0, round = 1, active = null, dice = [0, 0, 0, 0, 0], held = [false, false, false, false, false], rolls = 0, rollId = 0, lastPick = null, stopped = false;
    const el = id => document.getElementById(id);
    function start(opts, h) {
      H = h; o = opts; stopped = false;
      cats = o.variant === 'kort' ? SHORT : CATS.map(c => c[0]);
      sheets = {}; round = 1; lastPick = null;
      H.online().forEach(p => { sheets[p.pid] = {}; });
      queue = H.order.filter(pid => (H.players.get(pid) || {}).on); qi = -1;
      H.el.innerHTML = `<div class="ygame">
        <div class="gstage ystage">
          <div class="text-muted" id="yRound"></div>
          <h2 class="gtitle" id="yWho"></h2>
          <div class="dice big" id="yDice"></div>
          <div class="gsub" id="yInfo"></div>
          <div class="acts" style="justify-content:center"><button type="button" class="btn-outline" id="ySkip">⏭ Hoppa över turen</button></div>
        </div>
        <div class="ysheet-wrap"><table class="ysheet" id="ySheet"></table></div>
      </div>`;
      el('ySkip').addEventListener('click', () => { if (confirm(`Hoppa över ${H.pname(active)}s tur?`)) nextTurn(); });
      nextTurn();
    }
    function nextTurn() {
      if (stopped) return;
      for (let guard = 0; ; guard++) {
        qi++;
        if (qi >= queue.length) {
          round++; qi = 0;
          // nya spelare kommer in i nästa runda (de får färre rundor)
          queue = H.order.filter(pid => (H.players.get(pid) || {}).on);
          queue.forEach(pid => { if (!sheets[pid]) sheets[pid] = {}; });
          if (round > cats.length || !queue.length || guard > 2000) { finish(); return; }
        }
        const pid = queue[qi];
        if ((H.players.get(pid) || {}).on && sheets[pid] && Object.keys(sheets[pid]).length < cats.length) { active = pid; break; }
      }
      dice = [0, 0, 0, 0, 0]; held = [false, false, false, false, false]; rolls = 0;
      render(); H.sendState();
    }
    function finish() {
      Object.keys(sheets).forEach(pid => { const p = H.players.get(pid); if (p) p.score = total(sheets[pid]); });
      H.finish();
    }
    function render(rolled) {
      el('yRound').textContent = `Runda ${Math.min(round, cats.length)} av ${cats.length}`;
      el('yWho').innerHTML = `🎲 <span style="color:var(--accent)">${H.esc(H.pname(active))}</span> slår`;
      el('yDice').innerHTML = dice.map((v, i) => die(v, (held[i] ? 'held ' : '') + (rolled && !held[i] ? 'roll' : ''))).join('');
      el('yInfo').textContent = rolls === 0 ? 'Slå tärningarna på mobilen (eller skaka den)' : rolls < 3 ? `${3 - rolls} slag kvar – tryck på tärningar för att spara dem` : 'Välj var poängen ska skrivas';
      renderSheet();
    }
    function renderSheet() {
      const pids = Object.keys(sheets).filter(pid => H.players.has(pid));
      const head = `<tr><th></th>${pids.map(pid => `<th class="${pid === active ? 'act' : ''}">${H.esc(H.pname(pid))}</th>`).join('')}</tr>`;
      const row = k => `<tr><td>${catName(k)}</td>${pids.map(pid => {
        const sh = sheets[pid], v = sh[k];
        if (v != null) return `<td class="${pid === active ? 'act' : ''} ${lastPick && lastPick.pid === pid && lastPick.cat === k ? 'flash' : ''}">${v === 0 ? '–' : v}</td>`;
        if (pid === active && rolls > 0) return `<td class="act pot">${score(k, dice)}</td>`;
        return `<td class="${pid === active ? 'act' : ''}"></td>`;
      }).join('')}</tr>`;
      const upper = cats.filter(k => UPPER.includes(k)), lower = cats.filter(k => !UPPER.includes(k));
      el('ySheet').innerHTML = head + upper.map(row).join('')
        + `<tr class="sub"><td>Summa (bonus vid 63)</td>${pids.map(pid => `<td class="${pid === active ? 'act' : ''}">${upperSum(sheets[pid])}${bonus(sheets[pid]) ? ' +50' : ''}</td>`).join('')}</tr>`
        + lower.map(row).join('')
        + `<tr class="tot"><td>Totalt</td>${pids.map(pid => `<td class="${pid === active ? 'act' : ''}">${total(sheets[pid])}</td>`).join('')}</tr>`;
    }
    function onAct(m) {
      if (m.pid !== active || stopped) return;
      if (m.t === 'hold' && rolls > 0 && rolls < 3) {
        held = (m.held || []).slice(0, 5).map(Boolean);
        render(); H.sendState();
      } else if (m.t === 'roll' && rolls < 3) {
        if (rolls > 0 && Array.isArray(m.held)) held = m.held.slice(0, 5).map(Boolean); else if (rolls === 0) held = [false, false, false, false, false];
        dice = dice.map((v, i) => held[i] && v ? v : 1 + Math.floor(Math.random() * 6));
        rolls++; rollId++;
        render(true); H.sendState();
      } else if (m.t === 'score' && rolls > 0 && cats.includes(m.cat) && sheets[active] && sheets[active][m.cat] == null) {
        const v = score(m.cat, dice);
        sheets[active][m.cat] = v; lastPick = { pid: active, cat: m.cat, v };
        const p = H.players.get(active); if (p) p.score = total(sheets[active]);
        if (m.cat === 'y' && v === 50) { H.confetti(250, true); H.toast(`🎉 YATZY för ${H.pname(active)}!`); }
        else if (v === 0) H.toast(`${H.pname(active)} strök ${catName(m.cat)}`, 2500);
        else H.toast(`${H.pname(active)}: ${catName(m.cat)} ${v} p`, 2500);
        renderSheet(); H.sendState();
        setTimeout(nextTurn, 1600);
        rolls = 4;   // spärra tills nästa tur
      }
    }
    function onPresence() { if (active && !(H.players.get(active) || {}).on && rolls < 4) { H.toast(`${H.pname(active)} lämnade – nästa spelare`); nextTurn(); } }
    function state() {
      return { phase: 'turn', turn: round, rounds: cats.length, active, dice, held, rolls: Math.min(rolls, 3), rollId, cats, sheets, lastPick };
    }
    function stop() { stopped = true; }
    return { start, onAct, onPresence, state, stop };
  })();

  // ---------- mobilen ----------
  const player = (() => {
    let held = [false, false, false, false, false], pick = null, shakeOn = false;
    function key(s, me, pid) { return [s.phase, s.active, s.active === pid ? s.rollId + ':' + s.rolls : '', s.active === pid ? '' : s.rollId, s.lastPick ? s.lastPick.pid + s.lastPick.cat : ''].join('|'); }
    function render(s, me, A) {
      const mine = s.active === A.pid, sh = (s.sheets || {})[A.pid] || {};
      const actName = ((s.players || []).find(p => p.pid === s.active) || {}).name || '';
      if (!mine) {
        held = [false, false, false, false, false]; pick = null;
        A.render(`<div class="center"><p>Runda ${s.turn} av ${s.rounds}</p><h1>🎲 ${A.esc(actName)}</h1>
          <div class="dice" id="ydo">${(s.dice || []).map((v, i) => die(v, (s.held || [])[i] ? 'held' : '')).join('')}</div>
          <span class="pill">Din poäng: ${total(sh)}</span>
          <p style="font-size:0.85rem">${(s.sheets || {})[A.pid] ? 'Vänta på din tur – följ protokollet på storbilden.' : 'Du kommer med i nästa runda.'}</p></div>`);
        return;
      }
      if (s.rolls === 0) held = [false, false, false, false, false];
      else held = (s.held || held).slice();
      const rolled = s.rolls > 0, left = 3 - s.rolls;
      A.render(`<div class="head"><span>🎲 Din tur!</span><span class="w">Runda ${s.turn}/${s.rounds}</span></div>
        <div class="dice tap" id="yd">${(s.dice || []).map((v, i) => `<button type="button" data-i="${i}" ${rolled && left > 0 ? '' : 'disabled'}>${die(v, (held[i] ? 'held ' : '') + (rolled ? 'roll' : ''))}</button>`).join('')}</div>
        <p class="text-muted" style="text-align:center;font-size:0.85rem;margin:0.3rem 0 0.6rem">${rolled ? (left > 0 ? 'Tryck på tärningar du vill spara' : 'Inga slag kvar – välj rad nedan') : 'Slå tärningarna!'}</p>
        ${left > 0 ? `<button type="button" class="bigbtn" id="yRoll">🎲 Slå ${rolled ? `(${left} kvar)` : ''}</button>
          <button type="button" class="btn-outline shake-btn" id="yShake">${shakeOn ? '📳 Skaka mobilen för att slå' : '📳 Slå genom att skaka mobilen'}</button>` : ''}
        ${rolled ? `<div class="ycats" id="yc">${s.cats.map(k => sh[k] != null ? `<div class="used"><span>${catName(k)}</span><b>${sh[k] || '–'}</b></div>`
          : `<button type="button" data-k="${k}"><span>${catName(k)}</span><b>${score(k, s.dice)}</b></button>`).join('')}</div>
          <button type="button" class="bigbtn" id="yPick" hidden></button>` : ''}`);
      A.$('yd').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.i; held[i] = !held[i];
        b.querySelector('.die').classList.toggle('held', held[i]); b.querySelector('.die').classList.remove('roll');
        A.send('hold', { held });
      }));
      const roll = () => { if (!A.$('yRoll')) return; A.send('roll', { held }); A.vibrate(30); A.$('yRoll').disabled = true; };
      if (A.$('yRoll')) A.$('yRoll').addEventListener('click', roll);
      if (A.$('yShake')) A.$('yShake').addEventListener('click', async () => {
        try { if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) { const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') return; } } catch (e) { return; }
        shakeOn = true; A.$('yShake').textContent = '📳 Skaka mobilen för att slå';
      });
      if (shakeOn && left > 0) {
        let lastG = null, lastShake = 0;
        const onMotion = e => {
          const g = e.accelerationIncludingGravity; if (!g) return;
          if (lastG) { const d = Math.abs(g.x - lastG.x) + Math.abs(g.y - lastG.y) + Math.abs(g.z - lastG.z); if (d > 28 && Date.now() - lastShake > 1500) { lastShake = Date.now(); roll(); } }
          lastG = { x: g.x || 0, y: g.y || 0, z: g.z || 0 };
        };
        window.addEventListener('devicemotion', onMotion);
        A.onCleanup(() => window.removeEventListener('devicemotion', onMotion));
      }
      const yc = A.$('yc');
      if (yc) yc.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        pick = b.dataset.k;
        yc.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
        const pb = A.$('yPick'); pb.hidden = false; pb.textContent = `✔ Skriv ${score(pick, s.dice)} p på ${catName(pick)}`;
      }));
      const pb = A.$('yPick');
      if (pb) pb.addEventListener('click', () => { if (!pick) return; A.send('score', { cat: pick }); pb.disabled = true; A.vibrate(20); });
    }
    function update(s, me, A) {
      const d = A.$('ydo');
      if (d && s.active !== A.pid) d.innerHTML = (s.dice || []).map((v, i) => die(v, (s.held || [])[i] ? 'held' : '')).join('');
    }
    return { key, render, update };
  })();

  G.yatzy = {
    id: 'yatzy', emo: '🎲', name: '🎲 Yatzy', title: 'Yat<span class="hot">zy</span>', minPlayers: 1, bgMusic: true,
    desc: 'Klassisk Yatzy i turordning. Slå och spara tärningar på mobilen (eller skaka den) – storbilden visar tärningarna och protokollet.',
    opts: [{ key: 'variant', label: 'Protokoll', values: [['hel', 'Hela (15 rader)'], ['kort', 'Kort (8 rader)']], def: 'hel', help: 'Kort = ettor–sexor, chans och yatzy. Passar större sällskap.' }],
    host, player,
  };
})();
