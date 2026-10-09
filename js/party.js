// Party Mode – delad kod för medlem/party.html, medlem/party-quiz.html och party-läget i Röstövning.
//  • requirePartyAccess(): admin alltid, medlemmar bara när admin öppnat Party Mode (party_settings)
//  • PartyFX: konfetti (canvas, inga bibliotek). Riktiga fyrverkerier = uppladdade videor (se party.html)
// Kräver supabase-config.js + auth.js.

async function requirePartyAccess() {
  const member = await requireAuth();
  if (!member) return null;
  const isAdmin = member.role === 'admin';
  let enabled = false, tableOk = true;
  const { data, error } = await supabaseClient.from('party_settings').select('members_enabled').eq('id', 1).maybeSingle();
  if (error) tableOk = false; else enabled = !!(data && data.members_enabled);
  if (!isAdmin && !enabled) { window.location.href = '/medlem/'; return null; }
  return { member, isAdmin, enabled, tableOk };
}

(function (root) {
  let soundOn = true;
  try { soundOn = localStorage.getItem('hv-party-sound') !== '0'; } catch (e) {}
  const COLORS = ['#E5A968', '#f0be86', '#ffffff', '#ff4d4d', '#ff8a3d', '#ffd166', '#c084fc', '#60a5fa'];
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let canvas = null, ctx = null, W = 0, H = 0, dpr = 1, raf = null, last = 0;
  let confetti = [];

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'party-fx';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2000' });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];

  // ---------- partiklar ----------
  function addConfetti(n, fromTop) {
    for (let i = 0; i < n; i++) {
      confetti.push(fromTop
        ? { x: rnd(0, W), y: rnd(-H * 0.6, -10), vx: rnd(-30, 30), vy: rnd(60, 160), rot: rnd(0, 6.28), vr: rnd(-6, 6), w: rnd(6, 11), h: rnd(9, 16), c: pick(COLORS), sway: rnd(0, 6.28), age: 0, life: 9 }
        : { x: W / 2 + rnd(-40, 40), y: H * 0.65, vx: rnd(-520, 520), vy: rnd(-900, -350), rot: rnd(0, 6.28), vr: rnd(-8, 8), w: rnd(6, 11), h: rnd(9, 16), c: pick(COLORS), sway: rnd(0, 6.28), age: 0, life: 7 });
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    ctx.clearRect(0, 0, W, H);
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.age += dt;
      if (c.age > c.life || c.y > H + 30) { confetti.splice(i, 1); continue; }
      c.vy = Math.min(c.vy + 600 * dt, 170); c.vx *= 0.97; c.sway += dt * 3;
      c.x += (c.vx + Math.sin(c.sway) * 40) * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
      ctx.globalAlpha = Math.min(1, (c.life - c.age) * 1.5);
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.scale(1, Math.abs(Math.cos(c.sway * 1.3)) * 0.8 + 0.2);
      ctx.fillStyle = c.c; ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (confetti.length) raf = requestAnimationFrame(frame);
    else { raf = null; ctx.clearRect(0, 0, W, H); }
  }
  function run() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  const PartyFX = {
    // ljudinställning (används av fyrverkerivideorna i party.html)
    setSound(on) { soundOn = !!on; },
    get sound() { return soundOn; },
    unlockAudio() {},
    // konfettiregn uppifrån (rain) eller en kanonsmäll från mitten
    confetti(n = 160, rain = true) { ensureCanvas(); addConfetti(reduced() ? Math.min(n, 50) : n, rain); run(); },
    stop() { confetti = []; },
  };
  root.PartyFX = PartyFX;
})(window);

// ---------- PartyMedia: uppladdad fyrverkerivideo, fyrverkeriljud och musik (Party-startsidans adminruta) ----------
//  • PartyMedia.lobbyMusic(true/false): lugn musik i bakgrunden innan spelen startar
//  • PartyMedia.celebrate(): när någon vinner – fyrverkerivideo, smällar, musik och konfetti
// Filerna ligger i Storage (heavy-voices-stems/party/…) och kräver inloggning; gäster får bara konfetti.
(function (root) {
  const BUCKET = 'heavy-voices-stems';
  const DIRS = { video: 'party/fireworks', sound: 'party/fireworks-sound', music: 'party/intro-music' };
  const RE = { video: /\.(mp4|webm|mov|m4v)$/i, sound: /\.(mp3|m4a|aac|ogg|wav|webm)$/i, music: /\.(mp3|m4a|aac|ogg|wav|webm)$/i };
  // iPhone/iPad låter inte sidan ändra volymen – där spelas ingen bakgrundsmusik
  const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const BG_VOL = 0.25;
  const urls = { video: [], sound: [], music: [] };
  let loading = null;

  function load() {
    if (loading) return loading;
    loading = (async () => {
      const sb = typeof supabaseClient !== 'undefined' ? supabaseClient : null; if (!sb) return;
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return;
        await Promise.all(Object.keys(DIRS).map(async k => {
          const { data, error } = await sb.storage.from(BUCKET).list(DIRS[k], { limit: 100 });
          if (error) return;
          const paths = (data || []).filter(f => f.id && RE[k].test(f.name) && Number((f.metadata && f.metadata.size) || 0) > 0).map(f => DIRS[k] + '/' + f.name);
          if (!paths.length) return;
          const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600 * 6);
          urls[k] = (signed || []).map(x => x.signedUrl).filter(Boolean);
        }));
      } catch (e) { /* ingen media – bara konfetti */ }
    })();
    return loading;
  }
  const pick = k => urls[k].length ? urls[k][Math.floor(Math.random() * urls[k].length)] : null;
  function ramp(a, to, ms, then) {
    if (!a) return;
    if (IOS) { if (to === 0) { a.pause(); if (then) then(); } return; }
    const from = a.volume, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step); else if (then) then();
    };
    requestAnimationFrame(step);
  }
  // spela nu, eller vid första tryckningen om webbläsaren blockerar ljud
  function playSoon(a, onStart) {
    a.play().then(onStart).catch(() => {
      const h = () => { window.removeEventListener('pointerdown', h, true); a.play().then(onStart).catch(() => {}); };
      window.addEventListener('pointerdown', h, true);
    });
  }

  let bg = null, bgWanted = false;
  async function lobbyMusic(on) {
    bgWanted = !!on;
    if (!on) { if (bg) { const a = bg; bg = null; ramp(a, 0, 900, () => a.pause()); } return; }
    if (show) show.close();   // tillbaka till start efter en vinst – fyrverkerierna tonas ut
    if (bg || IOS || !root.PartyFX || !PartyFX.sound) return;
    await load();
    const u = pick('music');
    if (!u || bg || !bgWanted) return;
    const a = new Audio(u); a.loop = true; a.volume = 0; bg = a;
    playSoon(a, () => { if (bg === a) ramp(a, BG_VOL, 1500); });
  }

  let show = null;
  async function celebrate() {
    if (root.PartyFX) PartyFX.confetti(320, true);
    lobbyMusic(false);
    await load();
    if (show) show.close(true);
    const sound = root.PartyFX ? PartyFX.sound : true;
    const v = pick('video'), s = sound ? pick('sound') : null, m = sound ? pick('music') : null;
    if (!v && !s && !m) return;
    const audios = [];
    if (s) { const a = new Audio(s); a.loop = true; a.volume = 0.9; audios.push(a); playSoon(a); }
    if (m) { const a = new Audio(m); a.volume = 0.7; audios.push(a); playSoon(a); }
    let wrap = null, btn = null;
    if (v) {
      wrap = document.createElement('div');
      // videon ligger bakom sidans innehåll (som en bakgrund) så att vinnartexten syns ovanpå
      Object.assign(wrap.style, { position: 'fixed', inset: '0', zIndex: '-1', pointerEvents: 'none', opacity: '0', transition: 'opacity 0.8s ease', background: '#000' });
      wrap.innerHTML = `<video muted playsinline autoplay style="width:100%;height:100%;object-fit:cover"></video>`;
      document.body.appendChild(wrap);
      btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = '✕ Stäng fyrverkerierna';
      btn.setAttribute('style', 'position:fixed;z-index:2100;top:max(0.8rem,env(safe-area-inset-top));right:0.8rem;background:rgba(0,0,0,0.6);color:#fff;border:1px solid rgba(255,255,255,0.25);padding:0.35rem 0.8rem;border-radius:999px;font-size:0.85rem');
      document.body.appendChild(btn);
      const vid = wrap.querySelector('video');
      vid.src = v; vid.muted = true;
      vid.play().then(() => { wrap.style.opacity = '1'; }).catch(() => { wrap.style.opacity = '1'; });
      vid.addEventListener('ended', () => close());
      btn.addEventListener('click', () => close());
    }
    let closed = false;
    function close(now) {
      if (closed) return; closed = true;
      if (wrap) { wrap.style.opacity = '0'; const w = wrap; setTimeout(() => w.remove(), now ? 0 : 900); }
      if (btn) btn.remove();
      audios.forEach(a => ramp(a, 0, now ? 50 : 1500, () => a.pause()));
      if (show && show.close === close) show = null;
    }
    show = { close };
    if (!v) setTimeout(() => close(), 25000);   // bara ljud: tona ut efter en stund
  }

  root.PartyMedia = { load, lobbyMusic, celebrate };

  // knappar på mobilens slutskärm (spel.html, spela.html, tidslinjen.html)
  // "Nytt spel" skickar händelsen hv-newgame som sidan lyssnar på (lämna rummet → kodformuläret)
  root.partyEndButtons = () => `<div class="end-acts"><button type="button" class="btn-outline" data-newgame>🎮 Nytt spel med ny kod</button><a class="btn btn-outline" href="/">🏠 Till Heavy Voices</a></div>
    <p class="end-hint">Startar frågeledaren en ny omgång kommer du med automatiskt.</p>`;
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-newgame]');
    if (b) { e.preventDefault(); document.dispatchEvent(new CustomEvent('hv-newgame')); }
  });
})(window);
