// Ledtrådarna – gissa resmålet (eller artisten) på så få ledtrådar som möjligt.
// Fem ledtrådar värda 10, 8, 6, 4 och 2 poäng. Varje spelare skriver sin gissning på mobilen och låser den
// på nuvarande poängnivå – en gång per omgång. Rätt svar ger de låsta poängen.
//  • Resmål: världens huvudstäder, ledtrådar byggda ur Wikidata (på svenska)
//  • Artister: rock/hårdrock/metal/punk, ledtrådar ur iTunes (debutår, album, låtar – störst hit sist)
(function () {
  const G = (window.HVGames = window.HVGames || {});
  const PTS = [10, 8, 6, 4, 2];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtPop = n => n >= 1e6 ? `${(n / 1e6).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} miljoner` : `${Math.round(n / 1000) * 1000 > 0 ? (Math.round(n / 1000)).toLocaleString('sv-SE') + ' 000' : n}`;

  // ---------- resmål: huvudstäder ----------
  const CAPITALS_Q = `SELECT ?x ?xLabel ?cLabel ?en ?n WHERE { ?c wdt:P31 wd:Q3624078; wdt:P36 ?x. FILTER NOT EXISTS { ?c wdt:P576 [] }
    ?x wikibase:sitelinks ?n. FILTER(?n > 120) OPTIONAL { ?x rdfs:label ?en FILTER(lang(?en) = "en") }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "sv". } }`;
  const detailQ = id => `SELECT (SAMPLE(?pop) AS ?pop) (SAMPLE(?elev) AS ?elev) (MIN(YEAR(?inc)) AS ?inc) (SAMPLE(?wl) AS ?water)
    (GROUP_CONCAT(DISTINCT ?tl; separator="|") AS ?twins) WHERE { BIND(wd:${id} AS ?x)
    OPTIONAL { ?x wdt:P1082 ?pop } OPTIONAL { ?x wdt:P2044 ?elev } OPTIONAL { ?x wdt:P571 ?inc }
    OPTIONAL { ?x wdt:P206 ?w. ?w rdfs:label ?wl FILTER(lang(?wl) = "sv") }
    OPTIONAL { ?x wdt:P190 ?t. ?t rdfs:label ?tl FILTER(lang(?tl) = "sv") } }`;
  const peopleQ = id => `SELECT ?pl ?n WHERE { ?p wdt:P19 wd:${id}; wdt:P31 wd:Q5; wikibase:sitelinks ?n. ?p rdfs:label ?pl FILTER(lang(?pl) = "sv") } ORDER BY DESC(?n) LIMIT 6`;
  async function capitalDest(row) {
    const QS = window.QuizSources;
    const [d, p] = await Promise.allSettled([QS.sparql(detailQ(row.x), 'det-' + row.x, 60), QS.sparql(peopleQ(row.x), 'ppl-' + row.x, 60)]);
    const det = d.status === 'fulfilled' ? (d.value[0] || {}) : {};
    const people = p.status === 'fulfilled' ? p.value.map(r => r.pl).filter(Boolean) : [];
    const city = row.xLabel, hide = t => !QS.norm(t).includes(QS.norm(city)) && !QS.norm(t).includes(QS.norm(row.cLabel));
    const hard = [], mid = [], easy = [];
    if (det.inc && +det.inc > 0 && +det.inc < 1990) hard.push(`Staden nämns första gången eller grundades år ${det.inc}.`);
    if (det.elev && !isNaN(+det.elev)) hard.push(`Staden ligger ungefär ${Math.round(+det.elev)} meter över havet.`);
    const twins = String(det.twins || '').split('|').filter(t => t && hide(t));
    if (twins.length) mid.push(`En av vänorterna är ${QS.shuffle(twins)[0]}.`);
    if (det.pop && +det.pop > 1000) mid.push(`Här bor omkring ${fmtPop(+det.pop)} invånare.`);
    const ppl = people.filter(hide);
    if (ppl[1]) mid.push(`${ppl[1]} föddes här.`);
    if (ppl[0]) easy.push(`${ppl[0]} föddes här.`);
    if (det.water && hide(det.water)) easy.push(`Staden ligger vid ${det.water}.`);
    const last = `Det är huvudstad i ${row.cLabel}.`;
    const all = [...hard, ...mid, ...easy];
    const clues = all.length > 4 ? [all[0], ...all.slice(-3)] : all;   // svåraste först, de lättaste sist
    if (clues.length < 3) return null;
    while (clues.length < 4) clues.splice(1, 0, `Det är en huvudstad med ${row.xLabel.length} bokstäver.`);
    return { kind: 'stad', answer: city, alts: [row.en].filter(Boolean), clues: [...clues, last], intro: '🌍 Vilken stad söker vi?' };
  }
  async function cityList() {
    const rows = await window.QuizSources.sparql(CAPITALS_Q, 'capitals2', 30);
    const by = new Map(); rows.forEach(r => { if (r.xLabel && !/^Q\d+$/.test(r.xLabel) && !by.has(r.x)) by.set(r.x, r); });
    return [...by.values()];
  }

  // ---------- artister ----------
  async function artistDest(artist, genre) {
    const PM = window.PartyMusic, QS = window.QuizSources;
    if (!PM) return null;
    const list = await artistSongsSafe(artist);
    if (!list || list.length < 5) return null;
    const an = QS.pmNorm(artist).replace(/^the /, '');
    const ok = t => t && !QS.pmNorm(t).includes(an);
    const titles = list.map(s => s.title).filter(ok);
    if (titles.length < 4) return null;
    const first = Math.min(...list.map(s => s.year).filter(Boolean));
    const albums = [...new Set(list.map(s => s.album).filter(ok))];
    const clues = [];
    clues.push(`Den första låten i vår lista kom ${first}. Genre: ${genre}.`);
    clues.push(albums.length ? `Ett av albumen heter "${QS.shuffle(albums.slice(Math.floor(albums.length / 2)))[0] || albums[0]}".` : `"${titles[titles.length - 1]}" är en av låtarna.`);
    clues.push(`"${titles[Math.min(titles.length - 1, 6 + Math.floor(Math.random() * 4))]}" är en av låtarna.`);
    clues.push(`"${titles[2]}" och "${titles[1]}" är två andra låtar.`);
    clues.push(`Den kanske mest kända låten är "${titles[0]}".`);
    const hit = list.find(s => s.title === titles[0]);
    return { kind: 'artist', answer: artist, alts: [artist.replace(/^The /i, '')], clues, intro: '🎸 Vilken artist eller vilket band söker vi?', clip: hit && hit.url };
  }
  async function artistSongsSafe(a) { return window.PartyMusic.artistSongs ? window.PartyMusic.artistSongs(a) : null; }

  // ---------- storbilden ----------
  const host = (() => {
    let H, o, phase = 'load', sid = 0, stopped = false, dests = [], di = -1, dest = null, level = 0, locks = new Map(), verdict = new Map();
    let tm = null, nextT = null, loading = null, audio = null;
    const el = id => document.getElementById(id);
    const GENRES = { klassisk: 'Klassisk rock', hardrock: 'Hårdrock', metal: 'Metal', punk: 'Punk' };
    async function buildDests(opts, n) {
      const out = [];
      if (opts.kind === 'artist') {
        const pool = window.QuizSources.shuffle(Object.keys(GENRES).flatMap(g => window.QuizSources.CATS[g].artists.map(a => [a, GENRES[g]])));
        for (const [a, g] of pool) { if (out.length >= n || stopped) break; try { const d = await artistDest(a, g); if (d) out.push(d); } catch (e) {} status(out.length, n); }
      } else {
        const list = window.QuizSources.shuffle(await cityList());
        for (const r of list) { if (out.length >= n || stopped) break; try { const d = await capitalDest(r); if (d) out.push(d); } catch (e) {} status(out.length, n); }
      }
      return out;
    }
    function status(k, n) {
      const t = `🚂 Resmål klara: ${k} av ${n}`;
      let p = document.getElementById('qsLobby'); const anchor = document.getElementById('minNote');
      if (!p && anchor) { p = document.createElement('p'); p.id = 'qsLobby'; p.className = 'text-muted'; p.style.cssText = 'font-size:0.9rem;margin-top:0.4rem'; anchor.after(p); }
      if (p) p.textContent = t;
      const m = el('ldMain'); if (m && phase === 'load') m.innerHTML = `<div class="jt-load"><div class="spin"></div><h3>Packar resväskan…</h3><p class="gsub">${k} av ${n} resmål klara</p></div>`;
    }
    function lobby(opts, h) { H = h; o = opts; phase = 'load'; stopped = false; loading = buildDests(opts, opts.rounds || 6); }
    async function start(opts, h) {
      H = h; o = opts; phase = 'load'; sid = 0; di = -1;
      H.el.innerHTML = `<div class="ld"><div id="ldMain"></div><div class="side"><div id="ldBoard"></div><div class="acts" id="ldActs"></div><p class="tb-credit">Ledtrådar från Wikidata (CC0) och iTunes.</p></div></div>`;
      el('ldActs').addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (b) action(b.dataset.a); });
      status(0, o.rounds || 6); H.sendState();
      if (!loading) loading = buildDests(o, o.rounds || 6);
      dests = await loading; loading = null;
      if (stopped) return;
      if (!dests.length) { H.toast('Kunde inte hämta några resmål – kontrollera nätet', 6000); el('ldMain').innerHTML = '<div class="jt-load"><h3>Inga resmål hittades 😕</h3><p class="gsub">Wikidata/iTunes svarade inte. Prova igen eller byt till det andra temat.</p></div>'; return; }
      next();
    }
    function go(p) { phase = p; sid++; render(); H.sendState(); }
    function clear() { clearTimeout(nextT); if (tm) tm.stop(); tm = null; }
    function stopClip() { if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; } }
    function next() {
      clear(); stopClip();
      di++;
      if (di >= dests.length) { H.finish(); return; }
      dest = dests[di]; level = 0; locks = new Map(); verdict = new Map();
      go('intro');
      nextT = setTimeout(() => showLevel(0), 3500);
    }
    function showLevel(l) {
      clear();
      level = l;
      if (l === PTS.length - 1 && dest.clip && o.clip !== false) { stopClip(); audio = new Audio(dest.clip); audio.volume = 0.8; audio.play().catch(() => {}); }
      tm = H.timer((o.time || 25) * 1000, f => { const b = el('ldTimer'); if (b) b.style.transform = `scaleX(${f})`; }, () => { if (level < PTS.length - 1) showLevel(level + 1); else reveal(); });
      go('clue');
    }
    function allLocked() { const on = H.online(); return on.length && on.every(p => locks.has(p.pid)); }
    function onAct(m) {
      if (stopped || m.t !== 'lock' || phase !== 'clue' || locks.has(m.pid) || !H.players.has(m.pid)) return;
      const g = String(m.g || '').trim().slice(0, 60); if (!g) return;
      locks.set(m.pid, { g, lvl: level });
      H.msg({ k: 'locked', pid: m.pid, pts: PTS[level] });
      render(); H.sendState();
      if (allLocked()) { H.toast('Alla har låst sina svar!', 2000); clear(); nextT = setTimeout(reveal, 1200); }
    }
    function reveal() {
      clear();
      locks.forEach((l, pid) => verdict.set(pid, window.QuizSources.answerMatch(l.g, [dest.answer, ...(dest.alts || [])])));
      score(+1);
      go('reveal');
      if ([...verdict.values()].some(Boolean)) H.confetti(80, false);
      if (dest.clip && !audio && o.clip !== false) { audio = new Audio(dest.clip); audio.play().catch(() => {}); }
    }
    function score(sign) { verdict.forEach((ok, pid) => { if (ok) { const p = H.players.get(pid); if (p) p.score += sign * PTS[locks.get(pid).lvl]; } }); }
    function toggle(pid) {
      if (phase !== 'reveal' || !locks.has(pid)) return;
      score(-1); verdict.set(pid, !verdict.get(pid)); score(+1);
      render(); H.sendState();
    }
    function action(a) {
      if (a === 'nextclue' && phase === 'clue') { if (level < PTS.length - 1) showLevel(level + 1); else reveal(); }
      else if (a === 'reveal' && phase === 'clue') reveal();
      else if (a === 'next' && (phase === 'reveal' || phase === 'intro')) next();
      else if (a === 'end' && confirm('Avsluta och visa resultatet?')) H.finish();
    }
    function onPresence() { if (phase === 'clue' && allLocked()) { clear(); nextT = setTimeout(reveal, 800); } }
    function render() {
      if (!el('ldMain') || !dest) return;
      const name = pid => H.esc(H.pname(pid));
      H.board(el('ldBoard'), p => locks.has(p.pid) ? (phase === 'reveal' ? { cls: verdict.get(p.pid) ? 'ok' : '', icon: verdict.get(p.pid) ? `+${PTS[locks.get(p.pid).lvl]}` : '❌' } : { icon: `🔒${PTS[locks.get(p.pid).lvl]}` }) : {});
      let html = `<div class="ld-card"><div class="ld-top"><span>🚂 ${di + 1} / ${dests.length}</span><span>${H.esc(dest.intro)}</span></div>`;
      if (phase === 'intro') html += `<div class="ld-big">${dest.kind === 'artist' ? '🎸' : '🌍'} Nytt resmål!</div><p class="gsub" style="text-align:center">Lås din gissning på mobilen – ju tidigare, desto fler poäng.</p>`;
      else {
        const shown = phase === 'reveal' ? PTS.length : level + 1;
        html += `<ol class="ld-clues">${dest.clues.slice(0, shown).map((c, i) => `<li class="${i === level && phase === 'clue' ? 'cur' : ''}"><b>${PTS[i]}</b><span>${H.esc(c)}</span></li>`).join('')}</ol>`;
        if (phase === 'clue') html += `<div class="timer"><div id="ldTimer"></div></div><p class="gsub">${locks.size} av ${H.online().length} har låst sina svar</p>`;
        if (phase === 'reveal') html += `<div class="ld-answer">${H.esc(dest.answer)}</div>
          <div class="ld-guesses">${[...locks.entries()].map(([pid, l]) => `<button type="button" class="${verdict.get(pid) ? 'ok' : 'no'}" data-pid="${pid}" title="Tryck för att ändra rätt/fel">${verdict.get(pid) ? '✅' : '❌'} <b>${name(pid)}</b> "${H.esc(l.g)}" <small>${PTS[l.lvl]} p</small></button>`).join('') || '<p class="gsub">Ingen låste något svar</p>'}</div>
          ${locks.size ? '<p class="gsub" style="font-size:0.85rem">Fel bedömt? Tryck på en gissning för att ändra.</p>' : ''}`;
      }
      html += '</div>';
      el('ldMain').innerHTML = html;
      el('ldMain').querySelectorAll('.ld-guesses [data-pid]').forEach(b => b.addEventListener('click', () => toggle(b.dataset.pid)));
      el('ldActs').innerHTML = (phase === 'clue' ? `<button type="button" class="btn-outline" data-a="nextclue">⏭ Nästa ledtråd</button><button type="button" class="btn-outline" data-a="reveal">👁 Visa svaret</button>` : '')
        + (phase === 'reveal' ? `<button type="button" data-a="next">${di + 1 < dests.length ? '🚂 Nästa resmål' : '🏁 Se resultatet'}</button>` : '')
        + `<button type="button" class="btn-outline" data-a="end">🏁 Avsluta</button>`;
    }
    function state() {
      const s = { phase, sid, level, pts: PTS[level], n: di + 1, total: dests.length, locks: Object.fromEntries([...locks.entries()].map(([pid, l]) => [pid, l.lvl])) };
      if (dest) { s.intro = dest.intro; s.clues = dest.clues.slice(0, phase === 'reveal' ? PTS.length : phase === 'clue' ? level + 1 : 0); }
      if (phase === 'clue' && tm) { s.remainMs = tm.left; s.timeMs = (o.time || 25) * 1000; }
      if (phase === 'reveal') { s.answer = dest.answer; s.verdict = Object.fromEntries(verdict); s.guesses = Object.fromEntries([...locks.entries()].map(([pid, l]) => [pid, l.g])); }
      return s;
    }
    function stop() { stopped = true; clear(); stopClip(); }
    return { lobby, start, onAct, onPresence, state, stop };
  })();

  // ---------- mobilen ----------
  const player = (() => {
    let draft = '';
    function key(s, me, pid) { return [s.phase, s.n, s.phase === 'clue' ? s.level : '', s.locks && s.locks[pid] != null, s.phase === 'reveal' ? JSON.stringify(s.verdict) : ''].join('|'); }
    function render(s, me, A) {
      const head = `<div class="head"><span>🚂 Ledtrådarna</span><span class="w">${s.total ? `${s.n}/${s.total} · ` : ''}${me.score || 0} p</span></div>`;
      if (s.phase === 'load') { A.render(head + '<div class="center"><div class="spin"></div><p>Packar resväskan…</p></div>'); return; }
      if (s.phase === 'intro') { draft = ''; A.render(head + `<div class="center"><div class="big">🚂</div><h1>Nytt resmål</h1><p>${A.esc(s.intro || '')}</p></div>`); return; }
      const clues = `<ol class="ld-clues mob">${(s.clues || []).map((c, i) => `<li class="${i === s.level && s.phase === 'clue' ? 'cur' : ''}"><b>${PTS[i]}</b><span>${A.esc(c)}</span></li>`).join('')}</ol>`;
      const mine = s.locks ? s.locks[A.pid] : null;
      if (s.phase === 'clue') {
        if (mine != null) { A.render(head + A.timerBar(s) + clues + `<div class="center" style="min-height:20dvh"><div class="big">🔒</div><p>Låst på <b style="color:var(--accent)">${PTS[mine]} poäng</b></p><p>"${A.esc(draft)}"</p></div>`); return; }
        A.render(head + A.timerBar(s) + clues + `<form class="ld-form" id="ldF"><input id="ldG" maxlength="60" autocomplete="off" autocapitalize="words" placeholder="${/artist/i.test(s.intro || '') ? 'Artist/band' : 'Stad'}" value="${A.esc(draft)}">
          <button type="submit">🔒 Lås på ${s.pts} poäng</button></form><p style="text-align:center;margin:0.4rem 0 0;color:var(--text-muted);font-size:0.85rem">Du kan bara låsa en gång per resmål.</p>`);
        const inp = A.$('ldG');
        inp.addEventListener('input', () => { draft = inp.value; });
        A.$('ldF').addEventListener('submit', e => { e.preventDefault(); const g = inp.value.trim(); if (!g) { inp.focus(); return; } draft = g; A.send('lock', { g }); A.vibrate(40); A.render(head + clues + '<div class="center" style="min-height:20dvh"><div class="spin"></div></div>'); });
        return;
      }
      if (s.phase === 'reveal') {
        const ok = s.verdict && s.verdict[A.pid];
        A.render(head + `<div class="center"><div class="big">${mine == null ? '🤷' : ok ? '✅' : '❌'}</div><p>Rätt svar</p><div class="word">${A.esc(s.answer)}</div>
          ${mine != null ? `<span class="pill">${ok ? `+${PTS[mine]} poäng` : 'Inga poäng'} – du gissade "${A.esc((s.guesses || {})[A.pid] || '')}"</span>` : '<span class="pill">Du låste inget svar</span>'}</div>`);
        if (ok) { A.confetti(90, false); A.vibrate([60, 40, 60]); }
      }
    }
    return { key, render };
  })();

  G.ledtradar = {
    id: 'ledtradar', emo: '🚂', name: '🚂 Ledtrådarna', title: 'Led<span class="hot">trådarna</span>', minPlayers: 1, bgMusic: false,
    desc: 'Fem ledtrådar värda 10, 8, 6, 4 och 2 poäng. Skriv din gissning på mobilen och lås den när du tror att du vet – ju tidigare, desto fler poäng.',
    opts: [
      { key: 'kind', label: 'Vad gissar vi?', values: [['stad', '🌍 Huvudstäder'], ['artist', '🎸 Artister & band']], def: 'stad', help: 'Huvudstäder: ledtrådar från Wikidata. Artister: klassisk rock, hårdrock, metal och punk – sista ledtråden spelar största hitten.' },
      { key: 'rounds', label: 'Antal resmål', values: [[5, '5'], [8, '8'], [10, '10']], def: 5 },
      { key: 'time', label: 'Tid per ledtråd', values: [[20, '20 s'], [30, '30 s'], [45, '45 s']], def: 30 },
    ],
    host, player,
  };
})();
