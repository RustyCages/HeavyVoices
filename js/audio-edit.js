// Ljudredigering för Stämsynk: klipp, beskär, tystnad, tempo (utan att tonhöjden ändras),
// vågformstoppar och export till WAV/MP3. Arbetar på enkla objekt
//   clip = { sampleRate, channels: [Float32Array, …] }
// så att allt kan testas utan webbläsare. toBuffer()/fromBuffer() växlar mot Web Audio.
(function (root) {
  const len = c => c.channels[0].length;
  const dur = c => len(c) / c.sampleRate;
  const map = (c, fn) => ({ sampleRate: c.sampleRate, channels: c.channels.map(fn) });

  function fromBuffer(buf) {
    const channels = [];
    for (let i = 0; i < Math.min(2, buf.numberOfChannels); i++) channels.push(new Float32Array(buf.getChannelData(i)));
    return { sampleRate: buf.sampleRate, channels };
  }
  function toBuffer(ctx, c) {
    const b = ctx.createBuffer(c.channels.length, Math.max(1, len(c)), c.sampleRate);
    c.channels.forEach((ch, i) => b.copyToChannel(ch, i));
    return b;
  }

  const idx = (c, t) => Math.max(0, Math.min(len(c), Math.round(t * c.sampleRate)));
  // ta bort [a, b) sekunder
  function cut(c, a, b) {
    const i0 = idx(c, Math.min(a, b)), i1 = idx(c, Math.max(a, b));
    return map(c, ch => { const o = new Float32Array(ch.length - (i1 - i0)); o.set(ch.subarray(0, i0)); o.set(ch.subarray(i1), i0); return o; });
  }
  // behåll bara [a, b)
  function crop(c, a, b) {
    const i0 = idx(c, Math.min(a, b)), i1 = idx(c, Math.max(a, b));
    return map(c, ch => ch.slice(i0, i1));
  }
  // tystnad på sekunder at (0 = början, dur = slutet)
  function insertSilence(c, at, seconds) {
    const i = idx(c, at), n = Math.max(0, Math.round(seconds * c.sampleRate));
    return map(c, ch => { const o = new Float32Array(ch.length + n); o.set(ch.subarray(0, i)); o.set(ch.subarray(i), i + n); return o; });
  }
  // mjuk in-/uttoning vid snitt så det inte klickar
  function fadeEdges(c, at, ms = 6) {
    const i = idx(c, at), n = Math.round(ms / 1000 * c.sampleRate);
    c.channels.forEach(ch => {
      for (let k = 0; k < n; k++) {
        const g = k / n;
        if (i - 1 - k >= 0) ch[i - 1 - k] *= g;
        if (i + k < ch.length) ch[i + k] *= g;
      }
    });
    return c;
  }

  // Tempo utan tonhöjdsändring: WSOLA (överlappande fönster, varje nytt fönster
  // väljs där vågformen passar bäst ihop med det förra). rate > 1 = snabbare.
  function timeStretch(c, rate, onProgress) {
    if (!(rate > 0) || Math.abs(rate - 1) < 1e-6) return map(c, ch => ch.slice());
    const sr = c.sampleRate;
    const N = Math.round(sr * 0.046) & ~1;          // ca 46 ms fönster
    const Hs = N / 2;                               // utsteg (50 % överlapp → Hann summerar till 1)
    const Ha = Hs * rate;                           // insteg
    const tol = Math.round(sr * 0.012);             // sök ±12 ms
    const inLen = len(c), outLen = Math.max(1, Math.round(inLen / rate));
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const mono = new Float32Array(inLen);
    c.channels.forEach(ch => { for (let i = 0; i < inLen; i++) mono[i] += ch[i] / c.channels.length; });
    const out = c.channels.map(() => new Float32Array(outLen + N));
    const at = i => (i >= 0 && i < inLen ? mono[i] : 0);
    let prevPos = 0;                                // var förra fönstret togs i originalet
    const frames = Math.ceil(outLen / Hs);
    const CL = Math.round(N / 2), STEP = 4;         // jämför halva fönstret, var 4:e sampel
    for (let f = 0; f < frames; f++) {
      const outPos = f * Hs;
      let pos = Math.round(f * Ha);
      if (f > 0) {
        // naturlig fortsättning på förra fönstret = prevPos + Hs; leta närmast pos efter bäst likhet
        const nat = prevPos + Hs;
        let best = -Infinity, bestD = 0;
        for (let d = -tol; d <= tol; d += 2) {
          const cand = pos + d;
          if (cand < 0) continue;
          let s = 0;
          for (let k = 0; k < CL; k += STEP) s += at(nat + k) * at(cand + k);
          if (s > best) { best = s; bestD = d; }
        }
        pos = Math.max(0, pos + bestD);
      }
      for (let ci = 0; ci < c.channels.length; ci++) {
        const src = c.channels[ci], dst = out[ci];
        for (let k = 0; k < N; k++) { const j = pos + k; if (j < inLen) dst[outPos + k] += src[j] * win[k]; }
      }
      prevPos = pos;
      if (onProgress && (f & 255) === 0) onProgress(f / frames);
    }
    return { sampleRate: sr, channels: out.map(ch => ch.slice(0, outLen)) };
  }

  // Vågformstoppar: min/max per hink (rate hinkar per sekund), båda kanalerna ihop
  function peaks(c, rate = 200) {
    const hop = Math.max(1, Math.round(c.sampleRate / rate)), n = Math.ceil(len(c) / hop);
    const mn = new Float32Array(n), mx = new Float32Array(n);
    const a = c.channels[0], b = c.channels[1] || a;
    for (let i = 0; i < n; i++) {
      let lo = 0, hi = 0;
      const s = i * hop, e = Math.min(len(c), s + hop);
      for (let j = s; j < e; j++) { const v = (a[j] + b[j]) * 0.5; if (v < lo) lo = v; if (v > hi) hi = v; }
      mn[i] = lo; mx[i] = hi;
    }
    return { rate: c.sampleRate / hop, min: mn, max: mx };
  }

  // ---------- export ----------
  function toInt16(ch) {
    const o = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) { const v = Math.max(-1, Math.min(1, ch[i])); o[i] = v < 0 ? v * 32768 : v * 32767; }
    return o;
  }
  function encodeWav(c) {
    const nCh = c.channels.length, n = len(c), bytes = n * nCh * 2;
    const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, nCh, true); v.setUint32(24, c.sampleRate, true);
    v.setUint32(28, c.sampleRate * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, bytes, true);
    const ints = c.channels.map(toInt16);
    let o = 44;
    for (let i = 0; i < n; i++) for (let k = 0; k < nCh; k++) { v.setInt16(o, ints[k][i], true); o += 2; }
    return new Blob([buf], { type: 'audio/wav' });
  }
  // MP3 via lamejs (laddas från CDN första gången). kbps 192 räcker gott för sång.
  let lameP = null;
  function loadLame() {
    if (root.lamejs) return Promise.resolve(root.lamejs);
    if (!lameP) lameP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
      s.onload = () => root.lamejs ? res(root.lamejs) : rej(new Error('MP3-kodaren laddades inte'));
      s.onerror = () => { lameP = null; rej(new Error('Kunde inte hämta MP3-kodaren')); };
      document.head.appendChild(s);
    });
    return lameP;
  }
  async function encodeMp3(c, kbps = 192, onProgress) {
    const lame = await loadLame();
    const nCh = c.channels.length;
    const enc = new lame.Mp3Encoder(nCh, c.sampleRate, kbps);
    const ints = c.channels.map(toInt16), n = len(c), parts = [], BLOCK = 1152 * 20;
    for (let i = 0; i < n; i += BLOCK) {
      const l = ints[0].subarray(i, i + BLOCK), r = nCh > 1 ? ints[1].subarray(i, i + BLOCK) : undefined;
      const mp3 = nCh > 1 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
      if (mp3.length) parts.push(new Uint8Array(mp3));
      if ((i / BLOCK) % 40 === 0) { if (onProgress) onProgress(i / n); await new Promise(r2 => setTimeout(r2, 0)); }
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  root.AudioEdit = { fromBuffer, toBuffer, duration: dur, cut, crop, insertSilence, fadeEdges, timeStretch, peaks, encodeWav, encodeMp3, loadLame };
})(typeof window !== 'undefined' ? window : globalThis);
