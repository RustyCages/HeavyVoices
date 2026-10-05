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
