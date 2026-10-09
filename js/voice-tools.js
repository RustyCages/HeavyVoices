// Röstverktyg för Studio:
//   pitchShift        – ändra tonhöjden ±halvtoner utan att ändra tempot
//   diatonicShift     – flytta varje not ett antal steg i tonarten (t.ex. ters över), not för not
//   renderVoice       – syntetisk körröst (”ooh/aah/mmm”) som sjunger en notlista
//   clean             – stämrengörare: följ tonen (behåll grundton + övertoner) och/eller ta bort brus
// Arbetar på samma klippformat som AudioEdit: { sampleRate, channels: [Float32Array, …] }.
// Allt är ren JS (inga webbläsar-API:er) så att det går att testa i Node.
(function (root) {
  const AE = () => root.AudioEdit;
  const len = c => c.channels[0].length;
  const tick = () => new Promise(r => setTimeout(r, 0));
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- tonhöjd ----------
  // linjär omsampling: läs källan med steget ratio (ratio > 1 = kortare och ljusare)
  function resample(ch, ratio, outLen) {
    const o = new Float32Array(outLen), n = ch.length;
    for (let i = 0; i < outLen; i++) {
      const x = i * ratio, i0 = Math.floor(x), f = x - i0;
      o[i] = i0 + 1 < n ? ch[i0] * (1 - f) + ch[i0 + 1] * f : (i0 < n ? ch[i0] : 0);
    }
    return o;
  }
  // sträck ut tiden med ratio (WSOLA, tonhöjden kvar) och sampla sedan om tillbaka → samma längd, ny tonhöjd
  function pitchShift(c, semis, onProgress) {
    if (!semis) return { sampleRate: c.sampleRate, channels: c.channels.map(ch => ch.slice()) };
    const ratio = Math.pow(2, semis / 12), n = len(c);
    const st = AE().timeStretch(c, 1 / ratio, onProgress);
    return { sampleRate: c.sampleRate, channels: st.channels.map(ch => resample(ch, ratio, n)) };
  }

  // tonart: { tonic, minor } (från PitchAnalyze.detectKey). Hur många halvtoner ska not n flyttas för steps steg i skalan?
  function scaleShift(n, key, steps) {
    if (!steps) return 0;
    if (!key) return Math.round(steps * 12 / 7);   // ingen tonart känd → ungefärligt
    const rel = key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const pc = ((Math.round(n) - key.tonic) % 12 + 12) % 12;
    let deg = 0; for (let i = 0; i < 7; i++) if (rel[i] <= pc) deg = i;   // ton utanför skalan → närmaste skalton under
    const idx = deg + steps, oct = Math.floor(idx / 7), to = rel[((idx % 7) + 7) % 7] + 12 * oct;
    return to - rel[deg];
  }
  // flytta ljudet not för not: notes = [{t, d, n}] i klippets egen tid
  async function diatonicShift(c, notes, key, steps, onProgress) {
    const sr = c.sampleRate, n = len(c);
    const ns = (notes || []).filter(x => x.t + x.d > 0 && x.t < n / sr).sort((a, b) => a.t - b.t);
    if (!ns.length) return null;
    // per millisekund: vilken flytt gäller (närmaste not även i pauser, så att konsonanter följer med)
    const ms = Math.ceil(n / sr * 1000), lab = new Float32Array(ms);
    let j = 0;
    for (let i = 0; i < ms; i++) {
      const t = i / 1000;
      while (j + 1 < ns.length && ns[j + 1].t <= t) j++;
      let best = ns[j];
      if (t < best.t) best = ns[j];
      else if (t > best.t + best.d && j + 1 < ns.length && (ns[j + 1].t - t) < (t - best.t - best.d)) best = ns[j + 1];
      lab[i] = scaleShift(best.n, key, steps);
    }
    const shifts = [...new Set(lab)];
    const versions = {};
    for (let k = 0; k < shifts.length; k++) {
      versions[shifts[k]] = pitchShift(c, shifts[k], p => onProgress && onProgress((k + p) / shifts.length));
      await tick();
    }
    if (shifts.length === 1) return versions[shifts[0]];
    // mjuka övergångar (25 ms) mellan versionerna
    const W = 25, weights = {};
    shifts.forEach(s => {
      const w = new Float32Array(ms);
      for (let i = 0; i < ms; i++) w[i] = lab[i] === s ? 1 : 0;
      const sm = new Float32Array(ms); let acc = 0;
      for (let i = 0; i < ms + W; i++) {
        if (i < ms) acc += w[i];
        if (i - W >= 0) acc -= w[i - W];
        const c0 = i - (W >> 1); if (c0 >= 0 && c0 < ms) sm[c0] = acc / W;
      }
      weights[s] = sm;
    });
    const out = c.channels.map(() => new Float32Array(n));
    for (let i = 0; i < n; i++) {
      const m = Math.min(ms - 1, Math.floor(i / sr * 1000));
      for (const s of shifts) {
        const w = weights[s][m]; if (!w) continue;
        const v = versions[s].channels;
        for (let ch = 0; ch < out.length; ch++) out[ch][i] += v[ch][i] * w;
      }
    }
    return { sampleRate: sr, channels: out };
  }

  // ---------- syntetisk körröst ----------
  // formanter: [frekvens Hz, bandbredd Hz, styrka]
  const VOWELS = {
    oo: [[330, 90, 1], [760, 110, 0.45], [2400, 180, 0.08], [3300, 250, 0.04]],
    aa: [[780, 90, 1], [1180, 100, 0.65], [2650, 130, 0.25], [3500, 160, 0.1]],
    mm: [[260, 70, 1], [1100, 180, 0.05], [2500, 250, 0.015]],
  };
  const TABLE = 4096, SIN = new Float32Array(TABLE + 1);
  for (let i = 0; i <= TABLE; i++) SIN[i] = Math.sin(2 * Math.PI * i / TABLE);
  function envelope(f, form) {
    let e = 0;
    for (const [F, B, A] of form) { const x = (f - F) / (B / 2); e += A / (1 + x * x); }
    return e;
  }
  // notes: [{t, d, n}] i sekunder från klippets början. opts: { sampleRate, vowel, voices (1|3), vibrato, start, end }
  async function renderVoice(notes, opts = {}, onProgress) {
    const sr = opts.sampleRate || 44100, vowel = VOWELS[opts.vowel] || VOWELS.oo;
    const ns = (notes || []).filter(x => x.d > 0.03 && isFinite(x.n)).sort((a, b) => a.t - b.t);
    if (!ns.length) return null;
    const end = ns[ns.length - 1].t + ns[ns.length - 1].d + 0.6;
    const n = Math.ceil(end * sr);
    // ljusa röster har högre formanter
    const med = ns.map(x => x.n).sort((a, b) => a - b)[ns.length >> 1];
    const fs = med >= 62 ? 1.14 : med >= 55 ? 1.06 : 1;
    const form = vowel.map(([F, B, A]) => [F * fs, B * fs, A]);
    const voices = opts.voices === 3
      ? [{ cents: -9, lag: 0.000, rate: 5.3, pan: 0.25 }, { cents: 0, lag: 0.018, rate: 5.7, pan: 0.5 }, { cents: 8, lag: -0.012, rate: 6.1, pan: 0.75 }]
      : [{ cents: 0, lag: 0, rate: 5.6, pan: 0.5 }];
    const L = new Float32Array(n), R = new Float32Array(n);
    const ATT = 0.07, REL = 0.14, GLIDE = 0.06, BLOCK = 128, MAXH = 48;
    let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const total = voices.length * ns.length; let doneN = 0, lastYield = Date.now();
    for (const v of voices) {
      const ph = new Float64Array(MAXH + 1), amps = new Float32Array(MAXH + 1);
      const gl = Math.sqrt(1 - v.pan), gr = Math.sqrt(v.pan);
      let drift = 0, driftT = 0;
      for (let k = 0; k < ns.length; k++) {
        const no = ns[k], prev = ns[k - 1];
        const t0 = Math.max(0, no.t + v.lag), t1 = t0 + no.d;
        const glideFrom = prev && no.t - (prev.t + prev.d) < 0.08 ? prev.n : null;
        const i0 = Math.floor(t0 * sr), i1 = Math.min(n, Math.ceil((t1 + REL) * sr));
        for (let b = i0; b < i1; b += BLOCK) {
          const tb = b / sr - t0;   // tid in i noten
          let m = no.n + v.cents / 100;
          if (glideFrom != null && tb < GLIDE) m = glideFrom + (m - glideFrom) * (0.5 - 0.5 * Math.cos(Math.PI * tb / GLIDE));
          if (opts.vibrato !== false && tb > 0.25) m += 0.22 * Math.min(1, (tb - 0.25) / 0.4) * Math.sin(2 * Math.PI * v.rate * tb);
          if (b / sr > driftT) { drift = (rnd() - 0.5) * 0.06; driftT = b / sr + 0.12; }   // små naturliga ojämnheter
          const f0 = hz(m + drift), inc = f0 / sr * TABLE;
          const nh = Math.min(MAXH, Math.floor(Math.min(sr * 0.45, 5200) / f0));
          for (let h = 1; h <= nh; h++) amps[h] = envelope(h * f0, form) / Math.sqrt(h);
          const e = Math.min(b + BLOCK, i1);
          for (let i = b; i < e; i++) {
            const t = i / sr - t0;
            let g = t < ATT ? (0.5 - 0.5 * Math.cos(Math.PI * t / ATT)) : 1;
            if (t > no.d) g *= Math.max(0, 1 - (t - no.d) / REL);
            if (g <= 0) continue;
            let s = 0;
            for (let h = 1; h <= nh; h++) {
              let p = ph[h] + inc * h; p -= Math.floor(p / TABLE) * TABLE; ph[h] = p;
              const pi = p | 0, fr = p - pi;
              s += amps[h] * (SIN[pi] + (SIN[pi + 1] - SIN[pi]) * fr);
            }
            s *= g; L[i] += s * gl; R[i] += s * gr;
          }
        }
        doneN++;
        if (Date.now() - lastYield > 40) { if (onProgress) onProgress(doneN / total); await tick(); lastYield = Date.now(); }
      }
    }
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    if (pk > 0) { const g = 0.7 / pk; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
    return { sampleRate: sr, channels: voices.length > 1 ? [L, R] : [L] };
  }
  // flytta en notlista: semis halvtoner + steps steg i tonarten
  function transposeNotes(notes, key, steps, semis) {
    return notes.map(x => ({ ...x, n: x.n + scaleShift(x.n, key, steps) + (semis || 0) }));
  }

  // ---------- rengöring (STFT-mask) ----------
  function fftTables(N) {
    const rev = new Uint32Array(N), bits = Math.log2(N);
    for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / N); sin[i] = -Math.sin(2 * Math.PI * i / N); }
    return { N, rev, cos, sin };
  }
  function fft(T, re, im, inverse) {
    const { N, rev, cos, sin } = T;
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let s = 0; s < N; s += size) for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = inverse ? -sin[k * step] : sin[k * step];
        const a = s + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
  // f0At(sekund i klippet) → Hz eller 0. opts: { mode: 'noise'|'pitch'|'both', strength 0..1 }
  async function clean(c, f0At, opts = {}, onProgress) {
    const sr = c.sampleRate, n = len(c), mode = opts.mode || 'both';
    const strength = Math.max(0, Math.min(1, opts.strength ?? 0.6));
    const N = sr > 32000 ? 2048 : 1024, H = N / 4, K = N / 2 + 1, T = fftTables(N);
    const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const frames = Math.ceil((n + N) / H);
    const binHz = sr / N;
    const mono = new Float32Array(n); c.channels.forEach(ch => { for (let i = 0; i < n; i++) mono[i] += ch[i] / c.channels.length; });
    const re = new Float64Array(N), im = new Float64Array(N);
    // 1) magnitud per ram (mono) → masker
    const mags = new Float32Array(frames * K);
    for (let f = 0; f < frames; f++) {
      const s0 = f * H - N;
      for (let i = 0; i < N; i++) { const j = s0 + i; re[i] = j >= 0 && j < n ? mono[j] * win[i] : 0; im[i] = 0; }
      fft(T, re, im);
      for (let k = 0; k < K; k++) mags[f * K + k] = Math.hypot(re[k], im[k]);
      if ((f & 511) === 0) { if (onProgress) onProgress(0.3 * f / frames); await tick(); }
    }
    const masks = new Float32Array(frames * K).fill(1);
    const floor = Math.pow(10, -(8 + 26 * strength) / 20);
    if (mode !== 'pitch') {
      // brusprofil: 12:e percentilen per frekvens (det tystaste partierna = brus)
      const noise = new Float32Array(K), col = new Float32Array(frames);
      for (let k = 0; k < K; k++) {
        let m = 0;
        for (let f = 0; f < frames; f++) { const v = mags[f * K + k]; if (v > 1e-9) col[m++] = v; }
        const s = col.subarray(0, m).sort();
        noise[k] = m ? s[Math.floor(m * 0.12)] : 0;
      }
      const over = 1.5 + 3 * strength, nfloor = Math.pow(10, -(6 + 14 * strength) / 20);
      for (let f = 0; f < frames; f++) for (let k = 0; k < K; k++) {
        const m = mags[f * K + k], r = m > 0 ? 1 - over * (noise[k] * noise[k]) / (m * m) : 0;
        masks[f * K + k] *= Math.max(nfloor, Math.min(1, r));
      }
    }
    if (mode !== 'noise' && f0At) {
      for (let f = 0; f < frames; f++) {
        const tc = (f * H - N / 2) / sr;
        let f0 = f0At(tc);
        const base = f * K;
        if (f0 > 40) {
          // finjustera grundtonen mot spektrumet (±50 cent) – analysen är gjord på 20 ms-steg
          let best = -1, bf = f0;
          for (let c2 = -50; c2 <= 50; c2 += 5) {
            const ff = f0 * Math.pow(2, c2 / 1200); let s = 0;
            for (let h = 1; h <= 8; h++) { const k = Math.round(h * ff / binHz); if (k < K) s += mags[base + k] / Math.sqrt(h); }
            if (s > best) { best = s; bf = ff; }
          }
          f0 = bf;
          for (let k = 0; k < K; k++) {
            const fr = k * binHz, h = Math.round(fr / f0);
            let g;
            if (h < 1) g = fr < f0 * 0.7 ? floor : 1;
            else {
              const d = Math.abs(fr - h * f0), w = Math.max(binHz * 0.9, 0.018 * h * f0);
              g = Math.max(floor, Math.exp(-0.5 * (d / w) * (d / w)));
              if (fr > 6000) g = Math.max(g, 0.35);   // luft och s-ljud ovanför övertonerna
            }
            masks[base + k] *= g;
          }
        } else {
          // ingen ton: behåll lite av diskanten (konsonanter), resten ner
          for (let k = 0; k < K; k++) masks[base + k] *= k * binHz > 3500 ? Math.max(floor, 0.3) : floor;
        }
      }
    }
    // jämna ut masken i tid (mindre ”bubbel”): snabb upp, långsam ner
    for (let k = 0; k < K; k++) {
      let prev = masks[k];
      for (let f = 1; f < frames; f++) { const i = f * K + k; const v = masks[i] > prev ? masks[i] : prev * 0.55 + masks[i] * 0.45; masks[i] = v; prev = v; }
    }
    // 2) maska varje kanal och sätt ihop igen (overlap-add, Hann² normaliseras)
    const out = c.channels.map(() => new Float32Array(n));
    const norm = new Float32Array(n);
    for (let f = 0; f < frames; f++) { const s0 = f * H - N; for (let i = 0; i < N; i++) { const j = s0 + i; if (j >= 0 && j < n) norm[j] += win[i] * win[i]; } }
    for (let ch = 0; ch < c.channels.length; ch++) {
      const x = c.channels[ch], y = out[ch];
      for (let f = 0; f < frames; f++) {
        const s0 = f * H - N;
        for (let i = 0; i < N; i++) { const j = s0 + i; re[i] = j >= 0 && j < n ? x[j] * win[i] : 0; im[i] = 0; }
        fft(T, re, im);
        for (let k = 0; k < K; k++) {
          const g = masks[f * K + k];
          re[k] *= g; im[k] *= g;
          if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
        }
        fft(T, re, im, true);
        for (let i = 0; i < N; i++) { const j = s0 + i; if (j >= 0 && j < n) y[j] += re[i] / N * win[i]; }
        if ((f & 511) === 0) { if (onProgress) onProgress(0.3 + 0.7 * (ch + f / frames) / c.channels.length); await tick(); }
      }
      for (let i = 0; i < n; i++) if (norm[i] > 1e-6) y[i] /= norm[i];
    }
    return { sampleRate: sr, channels: out };
  }
  // tonkurva (song_pitch: midi[] per hop sekunder, 0 = ingen ton) → f0At(t) i Hz, t i kurvans egen tid
  function curveF0(midi, hop) {
    return t => {
      const x = t / hop, i = Math.floor(x), f = x - i;
      const a = midi[i] || 0, b = midi[i + 1] || 0;
      if (a && b) return hz(a + (b - a) * f);
      return a ? hz(a) : (f > 0.5 && b ? hz(b) : 0);
    };
  }
  // mono 16 kHz för PitchAnalyze.analyze (enkel medelvärdes-nedsampling)
  function toMono16k(c) {
    const r = c.sampleRate / 16000, n = Math.floor(len(c) / r), o = new Float32Array(n), chs = c.channels;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * r), b = Math.max(a + 1, Math.floor((i + 1) * r));
      let s = 0; for (let j = a; j < b; j++) for (const ch of chs) s += ch[j] || 0;
      o[i] = s / ((b - a) * chs.length);
    }
    return o;
  }

  root.VoiceTools = { pitchShift, scaleShift, diatonicShift, renderVoice, transposeNotes, clean, curveF0, toMono16k, VOWELS };
})(typeof window !== 'undefined' ? window : globalThis);
