// Live-synk av karaoketexten i Repertoar-spelaren.
//  • Värden (admin/stämledare) startar en session: får en fyrsiffrig kod + QR-kod. Värden spelar ljudet.
//  • Medlemmarna skannar QR-koden (eller skriver koden) och ser samma låt och rad i sin egen spelare –
//    utan eget ljud. Varje medlem ser sin egen stämmas textversion om den finns.
//  • Supabase Realtime (broadcast + presence), inga tabeller. Kanal: hvlive-<kod>.
//  • Positionen räknas relativt mottagningstiden (inte enheternas klockor, som kan skilja sekunder).
(function (root) {
  const LAT = 0.12;          // ungefärlig fördröjning värd → medlem (s)
  const BEAT_MS = 2000;      // värden skickar läget minst så här ofta
  const LOST_MS = 9000;      // inget hört från värden så här länge = tappad kontakt

  let o = null;              // inställningar från sidan
  let ch = null, role = null, code = '';
  let followers = 0, beat = null, lastSent = 0;
  let st = null, base = 0, recv = 0, lastHeard = 0, watchdog = null, wake = null;

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const joinUrl = () => location.origin + '/medlem/repertoar.html?live=' + code;

  // ---------- UI ----------
  function css() {
    if ($('liveSyncCss')) return;
    const s = document.createElement('style'); s.id = 'liveSyncCss';
    s.textContent = `
      .live-row { display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center; margin:-0.3rem 0 1rem; }
      .live-row button { font-size:0.9rem; padding:0.45rem 0.9rem; }
      .live-pill { display:inline-flex; align-items:center; gap:0.45rem; padding:0.4rem 0.85rem; border-radius:999px; background:rgba(229,169,104,0.14); border:1px solid rgba(229,169,104,0.5); color:var(--text, #fff); font-size:0.9rem; cursor:pointer; }
      .live-dot { width:0.55rem; height:0.55rem; border-radius:50%; background:#f87171; box-shadow:0 0 0 0 rgba(248,113,113,0.7); animation:livePulse 1.6s infinite; }
      @keyframes livePulse { 70% { box-shadow:0 0 0 0.5rem rgba(248,113,113,0); } 100% { box-shadow:0 0 0 0 rgba(248,113,113,0); } }
      .live-ov { position:fixed; inset:0; z-index:2000; background:rgba(5,6,9,0.82); display:grid; place-items:center; padding:1rem; }
      .live-box { background:var(--surface, #16181e); border:1px solid rgba(255,255,255,0.1); border-radius:1.1rem; padding:1.3rem; width:min(92vw, 400px); display:grid; gap:0.9rem; text-align:center; }
      .live-box h2 { margin:0; }
      .live-box p { margin:0; color:var(--text-muted); }
      .live-qr { background:#fff; border-radius:0.9rem; padding:0.7rem; line-height:0; width:min(70vw, 260px); margin:0 auto; }
      .live-qr svg { width:100%; height:auto; }
      .live-code { font-family:'Roboto Condensed', sans-serif; font-size:2.6rem; font-weight:700; letter-spacing:0.25em; color:var(--accent); }
      .live-box input { font-family:'Roboto Condensed', sans-serif; font-size:2rem; letter-spacing:0.3em; text-align:center; margin:0; }
      .live-btns { display:flex; gap:0.5rem; justify-content:center; flex-wrap:wrap; }
      .live-err { color:#f87171 !important; }
      /* Medlem som följer: inga egna uppspelningskontroller */
      #playerBar.live-follow #playerScrubberRow,
      #playerBar.live-follow #repeatBtn, #playerBar.live-follow #prevBtn, #playerBar.live-follow #playPauseBtn,
      #playerBar.live-follow #nextBtn, #playerBar.live-follow #mixerBtn, #playerBar.live-follow #speedBtn { display:none !important; }
      .live-follow-tag { display:block; font-size:0.78rem; color:var(--accent); letter-spacing:0.04em; }
    `;
    document.head.appendChild(s);
  }
  function overlay(html) {
    closeOverlay();
    const ov = document.createElement('div'); ov.className = 'live-ov'; ov.id = 'liveOv';
    ov.innerHTML = `<div class="live-box" role="dialog" aria-modal="true">${html}</div>`;
    ov.addEventListener('click', e => { if (e.target === ov) closeOverlay(); });
    document.body.appendChild(ov);
    return ov;
  }
  function closeOverlay() { const ov = $('liveOv'); if (ov) ov.remove(); }

  function renderRow() {
    const row = $(o.rowId); if (!row) return;
    if (role === 'host') {
      row.innerHTML = `<span class="live-pill" id="livePill"><span class="live-dot"></span>Live ${esc(code)} · ${followers} följer</span>`;
      $('livePill').addEventListener('click', hostPanel);
    } else if (role === 'follow') {
      row.innerHTML = `<span class="live-pill"><span class="live-dot"></span>Följer live ${esc(code)}</span><button class="btn-outline" id="liveLeave">Lämna</button>`;
      $('liveLeave').addEventListener('click', () => leave());
    } else {
      row.innerHTML = (o.canHost ? `<button class="btn-outline" id="liveStart" title="Dela det du spelar så att medlemmarna ser texten på sina mobiler">📡 Starta live-text</button>` : '') +
        `<button class="btn-outline" id="liveJoin" title="Följ texten till det som spelas på värdens dator">📡 Följ live</button>`;
      if ($('liveStart')) $('liveStart').addEventListener('click', startHost);
      $('liveJoin').addEventListener('click', () => joinForm());
    }
  }

  // ---------- värd ----------
  function hostPanel() {
    overlay(`<h2>📡 Live-text</h2>
      <p>Medlemmarna skannar koden och ser texten till det du spelar.</p>
      <div class="live-qr" id="liveQr"></div>
      <div class="live-code">${esc(code)}</div>
      <p>eller Repertoar → 📡 Följ live → skriv koden</p>
      <p id="liveCount">👥 ${followers} följer</p>
      <div class="live-btns"><button class="btn-gold" id="liveHide">Klar</button><button class="btn-outline danger" id="liveStop">Avsluta live</button></div>`);
    try {
      const qr = root.qrcode(0, 'M'); qr.addData(joinUrl()); qr.make();
      $('liveQr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    } catch (e) { $('liveQr').hidden = true; }
    $('liveHide').addEventListener('click', closeOverlay);
    $('liveStop').addEventListener('click', () => { closeOverlay(); stopHost(); });
  }
  function startHost() {
    if (ch) return;
    code = String(Math.floor(1000 + Math.random() * 9000));
    role = 'host'; followers = 0;
    ch = o.client.channel('hvlive-' + code, { config: { broadcast: { self: false }, presence: { key: 'host' } } });
    ch.on('presence', { event: 'sync' }, () => {
      const ps = ch.presenceState();
      followers = Object.keys(ps).filter(k => k !== 'host').length;
      renderRow();
      const c = $('liveCount'); if (c) c.textContent = `👥 ${followers} följer`;
    });
    ch.on('broadcast', { event: 'hello' }, () => send(true));
    ch.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ host: true });
        send(true);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        o.toast && o.toast('Live-text: tappade anslutningen, försöker igen…');
      }
    });
    beat = setInterval(() => { if (Date.now() - lastSent > BEAT_MS - 100) send(true); }, 500);
    renderRow();
    hostPanel();
  }
  function stopHost() {
    if (role !== 'host') return;
    try { ch.send({ type: 'broadcast', event: 'state', payload: { closed: true } }); } catch (e) {}
    clearInterval(beat); beat = null;
    const c = ch; ch = null; role = null; code = '';
    setTimeout(() => { try { o.client.removeChannel(c); } catch (e) {} }, 400);
    renderRow();
  }
  function send(force) {
    if (role !== 'host' || !ch) return;
    const s = o.getState();
    const payload = { songId: s.songId || null, title: s.title || '', pos: +(s.pos || 0).toFixed(3), playing: !!s.playing, rate: s.rate || 1 };
    try { ch.send({ type: 'broadcast', event: 'state', payload }); } catch (e) {}
    lastSent = Date.now();
  }
  // sidan anropar denna vid play/paus/sök/låtbyte/hastighet
  let notifyT = null;
  function notify() {
    if (role !== 'host') return;
    clearTimeout(notifyT);
    notifyT = setTimeout(() => send(true), 60);   // samla ihop flera händelser i rad
  }

  // ---------- medlem som följer ----------
  function joinForm(msg, preset) {
    overlay(`<h2>📡 Följ live</h2>
      <p>Skriv koden som syns på värdens skärm.</p>
      <form id="liveJf" style="display:grid;gap:0.7rem">
        <input id="liveCodeIn" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="Kod" value="${esc(preset || '')}" autocomplete="off" aria-label="Kod">
        <div class="live-btns"><button type="submit" class="btn-gold">Följ</button><button type="button" class="btn-outline" id="liveCancel">Avbryt</button></div>
        ${msg ? `<p class="live-err">${esc(msg)}</p>` : ''}
      </form>`);
    $('liveCodeIn').focus();
    $('liveCancel').addEventListener('click', closeOverlay);
    $('liveJf').addEventListener('submit', e => {
      e.preventDefault();
      const c = $('liveCodeIn').value.replace(/\D/g, '');
      if (c.length !== 4) { joinForm('Koden har fyra siffror.', c); return; }
      closeOverlay(); follow(c);
    });
  }
  function follow(c) {
    if (role === 'host') stopHost();
    if (ch) leave(true);
    code = c; role = 'follow'; st = null; lastHeard = 0;
    const pid = 'm' + (o.member && o.member.id ? String(o.member.id).slice(0, 8) : '') + Math.random().toString(36).slice(2, 6);
    ch = o.client.channel('hvlive-' + code, { config: { broadcast: { self: false }, presence: { key: pid } } });
    ch.on('broadcast', { event: 'state' }, ({ payload }) => onState(payload || {}));
    ch.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ name: (o.member && o.member.name) || '' });
        ch.send({ type: 'broadcast', event: 'hello', payload: {} });
        setTimeout(() => { if (role === 'follow' && !lastHeard) { leave(true); joinForm(`Hittar ingen live-session med koden ${c}.`, c); } }, 6000);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (!lastHeard) { leave(true); joinForm('Kunde inte ansluta. Kolla nätet och försök igen.', c); }
      }
    });
    clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (role === 'follow' && lastHeard && Date.now() - lastHeard > LOST_MS) {
        o.toast && o.toast('Tappade kontakten med värden – väntar…');
        lastHeard = Date.now();   // visa inte meddelandet varje halvsekund
      }
    }, 1000);
    keepAwake(true);
    o.onFollowStart && o.onFollowStart();
    renderRow();
    try { history.replaceState(null, '', location.pathname + '?live=' + code); } catch (e) {}
  }
  function onState(s) {
    if (role !== 'follow') return;
    lastHeard = Date.now();
    if (s.closed) { leave(); o.toast && o.toast('Värden avslutade live-texten'); return; }
    const prev = st; st = s;
    base = (s.pos || 0) + (s.playing ? LAT * (s.rate || 1) : 0);
    recv = performance.now();
    if (!prev || prev.songId !== s.songId) o.onFollowSong && o.onFollowSong(s);
  }
  function leave(silent) {
    clearInterval(watchdog); watchdog = null;
    const c = ch; ch = null;
    if (c) { try { o.client.removeChannel(c); } catch (e) {} }
    const was = role === 'follow';
    role = null; code = ''; st = null;
    keepAwake(false);
    if (was && o.onFollowEnd) o.onFollowEnd();
    renderRow();
    if (!silent) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  }
  // håll mobilskärmen tänd medan man följer
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && role === 'follow') keepAwake(true); });

  root.LiveSync = {
    init(opts) {
      o = opts; css(); renderRow();
      const c = (new URLSearchParams(location.search).get('live') || '').replace(/\D/g, '').slice(0, 4);
      if (c.length === 4) follow(c);
    },
    notify,
    leave: () => leave(),
    get hosting() { return role === 'host'; },
    get following() { return role === 'follow'; },
    get playing() { return !!(st && st.playing); },
    get rate() { return (st && st.rate) || 1; },
    pos() {
      if (!st) return 0;
      return st.playing ? base + (performance.now() - recv) / 1000 * (st.rate || 1) : base;
    },
  };
})(window);
