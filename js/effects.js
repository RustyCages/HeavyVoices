// Ljudeffekter för Studio – börjar med reverb. Samma inställningar används för live-lyssning
// (Web Audio-noder i uppspelningen) och för att lägga på effekten i själva ljudfilen (OfflineAudioContext).
//
//   Effects.REVERB_DEFAULT                     { on, mix, size, tone, pre }
//   Effects.REVERB_PRESETS                     [{ id, label, mix, size, tone, pre }]
//   const fx = Effects.reverbChain(ctx, s)    fx.input / fx.output (GainNode), fx.update(s)
//   await Effects.renderReverb(clip, s)        → ny clip med reverben inbakad (svansen förlänger spåret)
//
// mix  0–1   andel eko (0 = torrt, 1 = bara eko)
// size 0.3–8 efterklangstid i sekunder (RT60, ungefär)
// tone 0–1   mörk ↔ ljus (dämpning av diskanten i ekot)
// pre  0–150 förfördröjning i ms innan ekot börjar
(function (root) {
  const REVERB_DEFAULT = { on: false, mix: 0.25, size: 1.8, tone: 0.55, pre: 20 };
  const REVERB_PRESETS = [
    { id: 'room',   label: 'Litet rum',   mix: 0.18, size: 0.6, tone: 0.6,  pre: 5 },
    { id: 'studio', label: 'Studio',      mix: 0.22, size: 1.2, tone: 0.65, pre: 12 },
    { id: 'hall',   label: 'Konsertsal',  mix: 0.28, size: 2.4, tone: 0.5,  pre: 25 },
    { id: 'church', label: 'Kyrka',       mix: 0.35, size: 4.5, tone: 0.4,  pre: 40 },
    { id: 'plate',  label: 'Platta (ljus)', mix: 0.25, size: 1.6, tone: 0.85, pre: 0 },
    { id: 'arena',  label: 'Arena',       mix: 0.4,  size: 6.5, tone: 0.35, pre: 80 },
  ];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v)));
  const norm = s => ({
    on: !!(s && s.on),
    mix: clamp(s && s.mix != null ? s.mix : REVERB_DEFAULT.mix, 0, 1),
    size: clamp(s && s.size != null ? s.size : REVERB_DEFAULT.size, 0.3, 8),
    tone: clamp(s && s.tone != null ? s.tone : REVERB_DEFAULT.tone, 0, 1),
    pre: clamp(s && s.pre != null ? s.pre : REVERB_DEFAULT.pre, 0, 150),
  });
  // lika stark upplevd nivå över hela reglaget (equal power)
  const wetDry = mix => ({ dry: Math.cos(mix * Math.PI / 2), wet: Math.sin(mix * Math.PI / 2) * 1.6 });

  // impulssvar: stereo-brus som klingar av exponentiellt (−60 dB vid "size" s) och blir mörkare med tiden
  const irCache = new Map();
  function impulse(ctx, size, tone) {
    const key = ctx.sampleRate + ':' + size.toFixed(2) + ':' + tone.toFixed(2);
    if (irCache.has(key) && irCache.get(key).ctx === ctx) return irCache.get(key).buf;
    const sr = ctx.sampleRate, n = Math.max(1, Math.round(sr * size * 1.05));
    const buf = ctx.createBuffer(2, n, sr);
    const decay = 6.91 / size;                         // ln(1000) → −60 dB vid size
    const f0 = 1500 + tone * 14000, f1 = 400 + tone * 3500;   // diskantdämpning: ljusare/mörkare ekon
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, fc = f1 + (f0 - f1) * Math.exp(-t * 3 / size);
        const a = 1 - Math.exp(-2 * Math.PI * fc / sr);  // enpolig lågpass som sluts med tiden
        lp += a * (rnd() - lp);
        const env = Math.exp(-decay * t) * (t < 0.004 ? t / 0.004 : 1);
        d[i] = lp * env;
      }
    }
    // normalisera så att olika storlekar låter ungefär lika starka
    let e = 0; const d0 = buf.getChannelData(0), d1 = buf.getChannelData(1);
    for (let i = 0; i < n; i++) e += d0[i] * d0[i] + d1[i] * d1[i];
    const g = 1 / Math.sqrt(e / 2 || 1) * 0.35;
    for (let i = 0; i < n; i++) { d0[i] *= g; d1[i] *= g; }
    if (irCache.size > 12) irCache.clear();
    irCache.set(key, { ctx, buf });
    return buf;
  }

  function reverbChain(ctx, s) {
    s = norm(s);
    const input = ctx.createGain(), output = ctx.createGain();
    const dry = ctx.createGain(), wet = ctx.createGain(), pre = ctx.createDelay(0.5), conv = ctx.createConvolver(), lowcut = ctx.createBiquadFilter();
    lowcut.type = 'highpass'; lowcut.frequency.value = 180;   // ingen mullrig bas i ekot
    input.connect(dry); dry.connect(output);
    input.connect(lowcut); lowcut.connect(pre); pre.connect(conv); conv.connect(wet); wet.connect(output);
    let cur = null;
    function update(n) {
      n = norm(n);
      const w = wetDry(n.on ? n.mix : 0), now = ctx.currentTime;
      dry.gain.setTargetAtTime(w.dry, now, 0.02);
      wet.gain.setTargetAtTime(w.wet, now, 0.02);
      pre.delayTime.setTargetAtTime(n.pre / 1000, now, 0.02);
      if (!cur || cur.size !== n.size || cur.tone !== n.tone) conv.buffer = impulse(ctx, n.size, n.tone);
      cur = n;
    }
    update(s);
    return { input, output, update };
  }

  // lägg på reverben i ljudet: spåret blir längre med efterklangen (tystnad i slutet trimmas)
  async function renderReverb(clip, s) {
    s = norm({ ...s, on: true });
    const sr = clip.sampleRate, inLen = clip.channels[0].length;
    const tail = Math.round(sr * (s.size * 1.05 + s.pre / 1000 + 0.05));
    const Off = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const ctx = new Off(2, inLen + tail, sr);
    const buf = ctx.createBuffer(clip.channels.length, inLen, sr);
    clip.channels.forEach((ch, i) => buf.copyToChannel(ch, i));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const fx = reverbChain(ctx, s);
    src.connect(fx.input); fx.output.connect(ctx.destination); src.start(0);
    const out = await ctx.startRendering();
    const chs = [new Float32Array(out.getChannelData(0)), new Float32Array(out.getChannelData(1))];
    // trimma bort svans som är tystare än −70 dB
    let end = chs[0].length;
    while (end > inLen && Math.abs(chs[0][end - 1]) < 3e-4 && Math.abs(chs[1][end - 1]) < 3e-4) end--;
    let peak = 0; for (const ch of chs) for (let i = 0; i < end; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
    return { sampleRate: sr, channels: chs.map(ch => ch.slice(0, end)), peak };
  }

  root.Effects = { REVERB_DEFAULT, REVERB_PRESETS, reverbChain, renderReverb, normReverb: norm };
})(window);
