// Party Mode – delad kod för medlem/party.html, medlem/party-quiz.html och party-läget i Röstövning.
//  • requirePartyAccess(): admin alltid, medlemmar bara när admin öppnat Party Mode (party_settings)
//  • PartyFX: fyrverkerier, konfetti och smällar (canvas + WebAudio, inga bibliotek)
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
  const COLORS = ['#E5A968', '#f0be86', '#ffffff', '#ff4d4d', '#ff8a3d', '#ffd166', '#c084fc', '#60a5fa'];
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let canvas = null, ctx = null, W = 0, H = 0, dpr = 1, raf = null, last = 0;
  let parts = [], rockets = [], confetti = [], autoUntil = 0, nextLaunch = 0;

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

  // ---------- ljud (bara efter att användaren klickat något – webbläsarna kräver det) ----------
  let actx = null;
  function unlockAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) {}
  }
  let soundOn = true;
  function boom(big) {
    if (!soundOn || !actx || actx.state !== 'running') return;
    const t = actx.currentTime, len = big ? 1.4 : 0.8;
    const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, big ? 2.2 : 3.5);
    const src = actx.createBufferSource(); src.buffer = buf;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(big ? 1800 : 3500, t); lp.frequency.exponentialRampToValueAtTime(120, t + len);
    const g = actx.createGain(); g.gain.value = big ? 0.55 : 0.25;
    src.connect(lp); lp.connect(g); g.connect(actx.destination);
    src.start(t);
    // lite sprak efteråt
    if (big) for (let k = 0; k < 6; k++) {
      const o = actx.createOscillator(), gg = actx.createGain(), s = t + 0.25 + Math.random() * 0.6;
      o.type = 'square'; o.frequency.value = rnd(2500, 6000);
      gg.gain.setValueAtTime(0.03, s); gg.gain.exponentialRampToValueAtTime(0.0001, s + 0.05);
      o.connect(gg); gg.connect(actx.destination); o.start(s); o.stop(s + 0.06);
    }
  }

  // ---------- partiklar ----------
  function launch() {
    const x = rnd(W * 0.12, W * 0.88);
    rockets.push({ x, y: H + 10, vx: rnd(-40, 40), vy: -rnd(H * 0.95, H * 1.35), fuse: rnd(0.7, 1.05), c: pick(COLORS), trail: [] });
  }
  function burst(x, y, c) {
    const n = Math.round(rnd(70, 120)), ring = Math.random() < 0.35, c2 = pick(COLORS);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.05, 0.05), sp = ring ? rnd(210, 240) : rnd(40, 260);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.1, 1.8), age: 0, c: Math.random() < 0.7 ? c : c2, s: rnd(1.4, 2.6), glitter: Math.random() < 0.3 });
    }
    // blixt
    parts.push({ x, y, vx: 0, vy: 0, life: 0.18, age: 0, c: '#fff', s: 38, flash: true });
    boom(Math.random() < 0.5);
  }
  function addConfetti(n, fromTop) {
    for (let i = 0; i < n; i++) {
      confetti.push(fromTop
        ? { x: rnd(0, W), y: rnd(-H * 0.6, -10), vx: rnd(-30, 30), vy: rnd(60, 160), rot: rnd(0, 6.28), vr: rnd(-6, 6), w: rnd(6, 11), h: rnd(9, 16), c: pick(COLORS), sway: rnd(0, 6.28), age: 0, life: 9 }
        : { x: W / 2 + rnd(-40, 40), y: H * 0.65, vx: rnd(-520, 520), vy: rnd(-900, -350), rot: rnd(0, 6.28), vr: rnd(-8, 8), w: rnd(6, 11), h: rnd(9, 16), c: pick(COLORS), sway: rnd(0, 6.28), age: 0, life: 7 });
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    if (now < autoUntil && now > nextLaunch) { launch(); if (Math.random() < 0.4) launch(); nextLaunch = now + rnd(260, 620); }
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    // raketer
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.trail.push([r.x, r.y]); if (r.trail.length > 10) r.trail.shift();
      r.vy += 380 * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.fuse -= dt;
      ctx.strokeStyle = r.c; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
      ctx.beginPath(); r.trail.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      if (r.fuse <= 0 || r.vy > -60) { burst(r.x, r.y, r.c); rockets.splice(i, 1); }
    }
    // gnistor
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      const k = 1 - p.age / p.life;
      if (p.flash) {
        ctx.globalAlpha = k * 0.5; ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1.5 - k), 0, 6.283); ctx.fill(); continue;
      }
      p.vx *= 0.985; p.vy = p.vy * 0.985 + 90 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = p.glitter ? (Math.random() < 0.5 ? k : k * 0.2) : k;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.6 + k * 0.6), 0, 6.283); ctx.fill();
    }
    // konfetti
    ctx.globalCompositeOperation = 'source-over';
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
    if (rockets.length || parts.length || confetti.length || now < autoUntil) raf = requestAnimationFrame(frame);
    else { raf = null; ctx.clearRect(0, 0, W, H); }
  }
  function run() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  const PartyFX = {
    unlockAudio,
    setSound(on) { soundOn = !!on; },
    get sound() { return soundOn; },
    // fyrverkerier i ms millisekunder
    fireworks(ms = 4000) {
      ensureCanvas();
      if (reduced()) { addConfetti(60, true); run(); return; }
      autoUntil = Math.max(autoUntil, performance.now() + ms); nextLaunch = 0; run();
    },
    // konfettiregn uppifrån (rain) eller en kanonsmäll från mitten
    confetti(n = 160, rain = true) { ensureCanvas(); addConfetti(reduced() ? Math.min(n, 50) : n, rain); run(); },
    // en enskild smäll på (x, y)
    burstAt(x, y) { ensureCanvas(); burst(x, y, pick(COLORS)); run(); },
    stop() { autoUntil = 0; rockets = []; parts = []; confetti = []; },
  };
  root.PartyFX = PartyFX;
  // första klicket/tryckningen låser upp ljudet
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, unlockAudio, { once: true, capture: true }));
})(window);
