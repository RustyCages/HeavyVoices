// Tonhöjdsanalys (pitch) av en stämfil — används av admin/tonkurva.html.
// Ingen extern lib: YIN-algoritmen (de Cheveigné & Kawahara 2002) direkt på
// mono-ljud nedsamplat till 16 kHz. Resultatet är en tonkurva (MIDI-värden med
// decimaler, 0 = tyst/ingen ton) plus en lista av "noter" för notbanan.
//
// Fungerar både i webbläsaren (window.PitchAnalyze) och i Node (module.exports) för test.

(function (root) {
  const SR = 16000;          // analys-samplingsfrekvens
  const HOP_SEC = 0.02;      // en punkt var 20 ms
  const WIN = 512;           // analysfönster (32 ms) — räcker för två perioder ned till ~62 Hz
  const YIN_THRESHOLD = 0.15;
  const YIN_MAX = 0.35;      // sämre än så = ingen tydlig ton
  const SILENCE_REL = 0.06;  // ram tystare än 6 % av "typisk stark" nivå = tyst
  const MIN_RUN_FRAMES = 4;  // tonade partier kortare än 80 ms tas bort (konsonanter, brus)
  const MIN_NOTE_SEC = 0.1;

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function midiToName(m) { const r = Math.round(m); return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); }
  const hzToMidi = hz => 69 + 12 * Math.log2(hz / 440);

  // Rimligt tonomfång utifrån stämmans namn — minskar oktavfel.
  function rangeForLabel(label) {
    const l = String(label || '').toLowerCase();
    if (/bas|bass|baryton/.test(l)) return { fmin: 60, fmax: 500 };
    if (/tenor/.test(l)) return { fmin: 80, fmax: 700 };
    if (/alt|alto/.test(l)) return { fmin: 130, fmax: 1000 };
    if (/sopran|soprano/.test(l)) return { fmin: 160, fmax: 1300 };
    return { fmin: 60, fmax: 1300 };
  }

  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // YIN på en ram. Returnerar { hz, conf } eller null.
  function yinFrame(x, off, tauMin, tauMax, d) {
    // differensfunktion
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < WIN; i++) { const v = x[off + i] - x[off + i + tau]; s += v * v; }
      d[tau] = s;
    }
    // kumulativ medelnormalisering
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; d[tau] = run > 0 ? d[tau] * tau / run : 1; }
    // första lokala minimum under tröskeln
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < YIN_THRESHOLD) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t; break;
      }
    }
    if (tau === -1) { // ingen under tröskeln — ta globalt minimum om det är hyfsat
      let best = Infinity;
      for (let t = tauMin; t <= tauMax; t++) if (d[t] < best) { best = d[t]; tau = t; }
      if (best > YIN_MAX) return null;
    }
    // parabolisk interpolation för bråkdels-tau
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a + c - 2 * b;
      if (den > 0) better = tau + (a - c) / (2 * den);
    }
    return { hz: SR / better, conf: 1 - d[tau] };
  }

  // samples: Float32Array mono i 16 kHz. Returnerar Promise<resultat>.
  async function analyze(samples, opts = {}, onProgress) {
    const fmin = opts.fmin || 60, fmax = opts.fmax || 1300;
    const tauMin = Math.max(2, Math.floor(SR / fmax));
    const tauMax = Math.min(WIN - 1, Math.ceil(SR / fmin));
    const hop = Math.round(HOP_SEC * SR);
    const frames = Math.max(0, Math.floor((samples.length - WIN - tauMax) / hop) + 1);

    // energi per ram → tystnadsgräns relativt låtens starka partier (95:e percentilen)
    const rms = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0; const off = f * hop;
      for (let i = 0; i < WIN; i++) s += samples[off + i] * samples[off + i];
      rms[f] = Math.sqrt(s / WIN);
    }
    const sorted = Array.from(rms).filter(v => v > 1e-5).sort((a, b) => a - b);
    const loud = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    const gate = Math.max(1e-4, loud * SILENCE_REL);

    const raw = new Float32Array(frames); // MIDI, 0 = ingen ton
    const d = new Float32Array(tauMax + 1);
    let lastYield = Date.now();
    for (let f = 0; f < frames; f++) {
      if (rms[f] >= gate) {
        const r = yinFrame(samples, f * hop, tauMin, tauMax, d);
        if (r && r.hz >= fmin * 0.95 && r.hz <= fmax * 1.05) raw[f] = hzToMidi(r.hz);
      }
      if (Date.now() - lastYield > 40) { // låt sidan andas + rapportera
        if (onProgress) onProgress(f / frames);
        await new Promise(res => setTimeout(res, 0));
        lastYield = Date.now();
      }
    }
    if (onProgress) onProgress(1);

    const midi = cleanCurve(raw);
    const notes = toNotes(midi);
    const voiced = midi.filter(v => v > 0);
    return {
      v: 1,
      hop: HOP_SEC,
      fmin, fmax,
      midi: Array.from(midi, v => v > 0 ? Math.round(v * 100) / 100 : 0),
      notes,
      stats: {
        duration: Math.round(frames * HOP_SEC * 10) / 10,
        voicedPct: frames ? Math.round(100 * voiced.length / frames) : 0,
        noteCount: notes.length,
        low: notes.length ? Math.min(...notes.map(n => n.n)) : null,
        high: notes.length ? Math.max(...notes.map(n => n.n)) : null,
      },
    };
  }

  // Städa kurvan: oktavhopp, medianfilter, ta bort korta snuttar.
  function cleanCurve(raw) {
    const n = raw.length;
    const out = Float32Array.from(raw);

    // 1) oktavfel: en ram som ligger ~12 halvtoner från sin omgivning flyttas en oktav
    for (let i = 0; i < n; i++) {
      if (!out[i]) continue;
      const nb = [];
      for (let j = Math.max(0, i - 5); j <= Math.min(n - 1, i + 5); j++) if (j !== i && out[j]) nb.push(out[j]);
      if (nb.length < 4) continue;
      const m = median(nb);
      const diff = out[i] - m;
      if (Math.abs(Math.abs(diff) - 12) < 1.5) out[i] -= Math.sign(diff) * 12;
    }

    // 2) medianfilter (5 ramar) inom tonade partier
    const sm = Float32Array.from(out);
    for (let i = 0; i < n; i++) {
      if (!out[i]) continue;
      const w = [];
      for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < n && out[j]) w.push(out[j]);
      sm[i] = median(w);
    }

    // 3) fyll små hål (≤ 2 ramar) mellan två närliggande toner
    for (let i = 1; i < n - 1; i++) {
      if (sm[i]) continue;
      let k = i; while (k < n && !sm[k] && k - i < 3) k++;
      if (k < n && sm[k] && k - i <= 2 && sm[i - 1] && Math.abs(sm[i - 1] - sm[k]) < 1) {
        for (let j = i; j < k; j++) sm[j] = sm[i - 1] + (sm[k] - sm[i - 1]) * (j - i + 1) / (k - i + 1);
      }
    }

    // 4) ta bort för korta tonade partier
    let i = 0;
    while (i < n) {
      if (!sm[i]) { i++; continue; }
      let j = i; while (j < n && sm[j]) j++;
      if (j - i < MIN_RUN_FRAMES) for (let k = i; k < j; k++) sm[k] = 0;
      i = j;
    }
    return sm;
  }

  // Dela tonade partier i noter: ny not när kurvan stadigt (≥ 3 ramar) lämnar
  // nuvarande halvton. Notens tonhöjd = median av ramarna, avrundad.
  function toNotes(midi) {
    const notes = [];
    const n = midi.length;
    const push = (a, b) => {
      if ((b - a) * HOP_SEC < MIN_NOTE_SEC) return;
      const vals = Array.from(midi.slice(a, b));
      notes.push({ t: Math.round(a * HOP_SEC * 100) / 100, d: Math.round((b - a) * HOP_SEC * 100) / 100, n: Math.round(median(vals)) });
    };
    let i = 0;
    while (i < n) {
      if (!midi[i]) { i++; continue; }
      let j = i; while (j < n && midi[j]) j++;
      // tonat parti [i, j)
      let start = i;
      let cur = Math.round(median(Array.from(midi.slice(i, Math.min(j, i + 3)))));
      let k = i;
      while (k < j) {
        if (Math.abs(midi[k] - cur) > 0.6) {
          let m = k; while (m < j && Math.abs(midi[m] - cur) > 0.6) m++;
          if (m - k >= 3) { // stadig förändring → ny not från k
            push(start, k);
            start = k;
            cur = Math.round(median(Array.from(midi.slice(k, Math.min(j, k + 3)))));
            k++;
          } else {
            k = m; // kort avvikelse (glid/vibrato) — hoppa förbi
          }
          continue;
        }
        k++;
      }
      push(start, j);
      i = j;
    }
    // slå ihop direkt angränsande noter med samma tonhöjd
    const merged = [];
    for (const nt of notes) {
      const p = merged[merged.length - 1];
      if (p && p.n === nt.n && Math.abs(p.t + p.d - nt.t) < 0.03) p.d = Math.round((nt.t + nt.d - p.t) * 100) / 100;
      else merged.push({ ...nt });
    }
    return merged;
  }

  // Webbläsare: avkoda → mono 16 kHz med OfflineAudioContext.
  async function toMono16k(audioBuffer) {
    const len = Math.ceil(audioBuffer.duration * SR);
    const Off = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const ctx = new Off(1, len, SR);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.start();
    const out = await ctx.startRendering();
    return out.getChannelData(0);
  }

  // Live-tonhöjd från mikrofon. read() returnerar MIDI (med decimaler) eller null.
  // Läser senaste ~85 ms från en AnalyserNode, samplar om till 16 kHz och kör samma YIN.
  function createLiveDetector(audioCtx, stream, opts = {}) {
    const fmin = opts.fmin || 60, fmax = opts.fmax || 1300;
    const tauMin = Math.max(2, Math.floor(SR / fmax));
    const tauMax = Math.min(WIN - 1, Math.ceil(SR / fmin));
    const need = WIN + tauMax + 1;
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser();
    an.fftSize = 4096;
    src.connect(an); // kopplas INTE till högtalarna
    const raw = new Float32Array(an.fftSize);
    const x = new Float32Array(need);
    const d = new Float32Array(tauMax + 1);
    const ratio = audioCtx.sampleRate / SR;
    const recent = [];
    return {
      read() {
        an.getFloatTimeDomainData(raw);
        // ta de senaste 'need' samplen i 16 kHz (linjär interpolation + enkel medelvärdesbildning mot vikning)
        const startPos = raw.length - 1 - (need - 1) * ratio;
        if (startPos < 1) return null;
        let s = 0;
        for (let i = 0; i < need; i++) {
          const p = startPos + i * ratio, k = Math.floor(p), f = p - k;
          let v = raw[k] + (raw[k + 1] - raw[k]) * f;
          if (ratio >= 2) v = (v + raw[k - 1] + raw[k + 1]) / 3;
          x[i] = v; s += v * v;
        }
        const rms = Math.sqrt(s / need);
        if (rms < (opts.gate || 0.008)) { recent.length = 0; return null; }
        const r = yinFrame(x, 0, tauMin, tauMax, d);
        if (!r || r.hz < fmin * 0.95 || r.hz > fmax * 1.05) { recent.length = 0; return null; }
        let m = hzToMidi(r.hz);
        // oktavhopp mot senaste värdena rättas, och lite utjämning (median av 3)
        if (recent.length) {
          const last = recent[recent.length - 1], diff = m - last;
          if (Math.abs(Math.abs(diff) - 12) < 1) m -= Math.sign(diff) * 12;
        }
        recent.push(m); if (recent.length > 3) recent.shift();
        return median(recent);
      },
      stop() {
        try { src.disconnect(); } catch (e) {}
        stream.getTracks().forEach(t => t.stop());
      },
    };
  }

  const api = { analyze, toMono16k, createLiveDetector, rangeForLabel, midiToName, SR, HOP_SEC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PitchAnalyze = api;
})(typeof window !== 'undefined' ? window : globalThis);
