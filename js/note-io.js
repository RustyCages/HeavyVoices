// Export/import av noter för Röstövningen.
// Noter = [{ t: start i sekunder, d: längd i sekunder, n: MIDI-nummer }]
// Format: Heavy Voices-JSON (.json) och standard-MIDI (.mid) – MIDI öppnas i
// MuseScore, Logic, Cubase m.fl., och MIDI-filer från notprogram kan läsas in.

(function (root) {
  const FORMAT = 'heavyvoices-notes';

  // ---------- JSON ----------
  function toJson(notes, meta = {}) {
    return JSON.stringify({
      format: FORMAT, version: 1,
      song: meta.song || null, stem: meta.stem || null,
      exported_at: new Date().toISOString(),
      info: 'Tider i sekunder från stämfilens början. n = MIDI-tonnummer (60 = C4).',
      notes: notes.map(x => ({ t: r2(x.t), d: r2(x.d), n: Math.round(x.n) })),
    }, null, 1);
  }
  function fromJson(text) {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j : (j.notes || j.edited_notes || null);
    if (!Array.isArray(list)) throw new Error('Filen innehåller inga noter');
    const notes = list.map(x => ({ t: Number(x.t), d: Number(x.d), n: Number(x.n) }))
      .filter(x => isFinite(x.t) && isFinite(x.d) && isFinite(x.n) && x.d > 0);
    if (!notes.length) throw new Error('Filen innehåller inga giltiga noter');
    return { notes: clean(notes), meta: { song: j.song || null, stem: j.stem || null } };
  }

  // ---------- MIDI-export (format 0, 120 bpm, 480 ticks/fjärdedel → 960 ticks/s) ----------
  // opts.tracks = [{ name, notes }] ger en MIDI med ett spår per röst (format 1).
  // opts.bpm sätter tempot i filen (tiderna i sekunder bevaras ändå exakt) – med låtens riktiga
  // tempo hamnar noterna rätt i takterna när filen öppnas i ett notprogram.
  // Noter med .syl får sångtext (lyric-händelser) som MuseScore m.fl. visar under noterna.
  function toMidi(notes, meta = {}, opts = {}) {
    const PPQ = 480;
    let bpm = Number(opts.bpm) || 120;
    while (bpm > 200) bpm /= 2;
    while (bpm < 50) bpm *= 2;
    const uspq = Math.round(60e6 / bpm), TPS = PPQ * 1e6 / uspq;
    const label = meta.stem ? `${meta.song || ''} – ${meta.stem}`.trim() : (meta.song || 'Heavy Voices');
    const tracks = opts.tracks && opts.tracks.length ? opts.tracks : [{ name: label, notes }];
    const multi = tracks.length > 1;
    const tempoEv = [0, 0xFF, 0x51, 0x03, (uspq >> 16) & 255, (uspq >> 8) & 255, uspq & 255, 0, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08];
    const chunk = (bytes) => [0x4D, 0x54, 0x72, 0x6B, (bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255, ...bytes];
    const body = [];
    if (multi) {
      const nm = latin1(meta.song || 'Heavy Voices');
      body.push(...chunk([0, 0xFF, 0x03, ...vlq(nm.length), ...nm, ...tempoEv, 0, 0xFF, 0x2F, 0x00]));
    }
    tracks.forEach((tr, ti) => {
      const ch = Math.min(15, ti >= 9 ? ti + 1 : ti);   // hoppa över trumkanalen 10
      const ev = [];
      tr.notes.forEach(x => {
        const on = Math.round(x.t * TPS), off = Math.max(on + 1, Math.round((x.t + x.d) * TPS));
        const n = Math.max(0, Math.min(127, Math.round(x.n)));
        if (x.syl != null && String(x.syl).trim()) {
          const ly = latin1(String(x.syl).replace(/^ /, '').replace(/~/g, ''));
          ev.push({ tick: on, ord: 1, bytes: [0xFF, 0x05, ...vlq(ly.length), ...ly] });
        }
        ev.push({ tick: on, ord: 2, bytes: [0x90 | ch, n, 90] });
        ev.push({ tick: off, ord: 0, bytes: [0x80 | ch, n, 0] });   // av före på vid samma tick
      });
      ev.sort((a, b) => a.tick - b.tick || a.ord - b.ord);
      const trk = [];
      const name = latin1(tr.name || label);
      trk.push(0, 0xFF, 0x03, ...vlq(name.length), ...name);
      if (!multi) trk.push(...tempoEv);
      trk.push(0, 0xC0 | ch, 52);                                     // ljud: kör "aah"
      let last = 0;
      ev.forEach(e => { trk.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; });
      trk.push(0, 0xFF, 0x2F, 0x00);
      body.push(...chunk(trk));
    });
    const ntrk = tracks.length + (multi ? 1 : 0);
    const head = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, multi ? 1 : 0, (ntrk >> 8) & 255, ntrk & 255, (PPQ >> 8) & 255, PPQ & 255];
    return new Uint8Array([...head, ...body]);
  }

  // ---------- MIDI-import ----------
  // Returnerar [{ name, channel, notes }] – ett spår per MIDI-spår/kanal som har noter (trummor hoppas över)
  function fromMidi(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let p = 0;
    const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); return s; };
    const u32 = () => { const v = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0; p += 4; return v; };
    const u16 = () => { const v = b[p] << 8 | b[p + 1]; p += 2; return v; };
    if (str(4) !== 'MThd') throw new Error('Inte en MIDI-fil');
    p += 4; const hlen = u32();
    const fmt = u16(), ntrk = u16(), div = u16(); p += hlen - 6;
    if (div & 0x8000) throw new Error('MIDI-filer med SMPTE-tid stöds inte – exportera med vanlig takt-tid');
    const tempos = [];   // { tick, uspq }
    const raw = [];      // { track, name, ch, n, on, off }
    const names = [];
    for (let t = 0; t < ntrk && p < b.length; t++) {
      if (str(4) !== 'MTrk') throw new Error('Trasig MIDI-fil');
      p += 4; const len = u32(), end = p + len;
      let tick = 0, status = 0;
      const open = {};
      while (p < end) {
        let d = 0, c; do { c = b[p++]; d = (d << 7) | (c & 0x7F); } while (c & 0x80);
        tick += d;
        let st = b[p];
        if (st & 0x80) { p++; status = st; } else st = status;   // running status
        const type = st & 0xF0, ch = st & 0x0F;
        if (st === 0xFF) {
          const mt = b[p++]; let l = 0; do { c = b[p++]; l = (l << 7) | (c & 0x7F); } while (c & 0x80);
          if (mt === 0x51) tempos.push({ tick, uspq: b[p] << 16 | b[p + 1] << 8 | b[p + 2] });
          if (mt === 0x03 && !names[t]) { const raw = b.slice(p, p + l); try { names[t] = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch (e) { names[t] = new TextDecoder('windows-1252').decode(raw); } }
          p += l;
        } else if (st === 0xF0 || st === 0xF7) {
          let l = 0; do { c = b[p++]; l = (l << 7) | (c & 0x7F); } while (c & 0x80); p += l;
        } else if (type === 0x90 || type === 0x80) {
          const n = b[p++], v = b[p++], key = ch * 128 + n;
          if (type === 0x90 && v > 0) { if (open[key] == null) open[key] = tick; }
          else if (open[key] != null) { raw.push({ track: t, ch, n, on: open[key], off: tick }); delete open[key]; }
        } else if (type === 0xC0 || type === 0xD0) p += 1;
        else p += 2;
      }
      p = end;
    }
    // tick → sekunder via tempokartan
    tempos.sort((a, b) => a.tick - b.tick);
    if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, uspq: 500000 });
    const segs = []; let sec = 0;
    tempos.forEach((tp, i) => {
      if (i) sec += (tp.tick - tempos[i - 1].tick) * tempos[i - 1].uspq / 1e6 / div;
      segs.push({ tick: tp.tick, sec, spt: tp.uspq / 1e6 / div });
    });
    const toSec = tk => { let s = segs[0]; for (const g of segs) { if (g.tick <= tk) s = g; else break; } return s.sec + (tk - s.tick) * s.spt; };

    const groups = new Map();
    raw.forEach(x => {
      if (x.ch === 9) return;  // trummor
      const k = fmt === 0 ? 'c' + x.ch : x.track + ':' + x.ch;
      if (!groups.has(k)) groups.set(k, { name: (names[x.track] || '').trim() || (fmt === 0 ? `Kanal ${x.ch + 1}` : `Spår ${x.track + 1}`) + (fmt === 0 ? '' : ` (kanal ${x.ch + 1})`), channel: x.ch, notes: [] });
      const t0 = toSec(x.on), t1 = toSec(x.off);
      if (t1 - t0 > 0.02) groups.get(k).notes.push({ t: t0, d: t1 - t0, n: x.n });
    });
    const out = [...groups.values()].filter(g => g.notes.length);
    if (!out.length) throw new Error('MIDI-filen innehåller inga noter');
    out.forEach(g => { g.notes = clean(g.notes); g.chords = hasChords(g.notes); });
    return out;
  }

  // ---------- hjälpare ----------
  function r2(v) { return Math.round(v * 100) / 100; }
  function clean(notes) {
    return notes.map(x => ({ t: Math.max(0, r2(x.t)), d: Math.max(0.05, r2(x.d)), n: Math.round(x.n), ...(x.syl != null ? { syl: x.syl } : {}) }))
      .sort((a, b) => a.t - b.t || b.n - a.n);
  }
  // Ackord i en stämma (flera toner samtidigt): behåll översta tonen
  function hasChords(notes) { return notes.some((x, i) => i && notes[i - 1].t + notes[i - 1].d > x.t + 0.03); }
  function topLine(notes) {
    const out = [];
    notes.forEach(x => {
      const prev = out[out.length - 1];
      if (prev && x.t < prev.t + prev.d - 0.03) {
        if (x.n > prev.n) { prev.d = r2(Math.max(0.05, x.t - prev.t)); out.push({ ...x }); }
        // lägre ton under en pågående ton hoppas över
      } else out.push({ ...x });
    });
    return out.filter(x => x.d >= 0.05);
  }
  function vlq(v) { const out = [v & 0x7F]; while ((v >>= 7)) out.unshift((v & 0x7F) | 0x80); return out; }
  function utf8(s) { return [...new TextEncoder().encode(s)]; }
  // MIDI-text skrivs som Latin-1 (å, ä, ö fungerar så i MuseScore m.fl.)
  function latin1(s) { return [...String(s).normalize('NFC').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')].map(c => { const k = c.codePointAt(0); return k < 256 ? k : 63; }); }

  // Spara en fil: "Spara som…"-dialog där webbläsaren stöder det (Chrome/Edge på dator), annars vanlig nedladdning
  async function saveFile(data, filename, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    if (root.showSaveFilePicker) {
      try {
        const ext = filename.slice(filename.lastIndexOf('.'));
        const h = await root.showSaveFilePicker({ suggestedName: filename, types: [{ description: ext === '.mid' ? 'MIDI-fil' : 'Notfil', accept: { [mime]: [ext] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return 'saved';
      } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'downloaded';
  }

  // ---------- UltraStar (.txt) ----------
  // Rader: ": start längd ton stavelse" (även * golden, R/G rap; F = fristil utan ton hoppas över),
  // "- start" = radbrytning, "E" = slut, "P1"/"P2" = duettröster. Tid: GAP (ms) + slag × 15/BPM s.
  // Ton 0 = C4 (MIDI 60).
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    let t = new TextDecoder('utf-8').decode(u8);
    if (t.includes('�')) { try { t = new TextDecoder('windows-1252').decode(u8); } catch (e) {} }
    return t.replace(/^﻿/, '');
  }
  function fromUltraStar(text) {
    const head = {};
    const tracks = [];
    let cur = null, rel = false, relBase = 0;
    const newTrack = (name) => { cur = { name, notes: [], lines: [] }; tracks.push(cur); relBase = 0; };
    const num = v => parseFloat(String(v).trim().replace(',', '.'));
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+$/, '');
      if (!line) continue;
      if (line[0] === '#') {
        const i = line.indexOf(':'); if (i < 0) continue;
        head[line.slice(1, i).trim().toUpperCase()] = line.slice(i + 1).trim();
        if (/^#RELATIVE:\s*yes/i.test(line)) rel = true;
        continue;
      }
      if (/^P\s*\d/i.test(line)) { newTrack(head['DUETSINGERP' + line.replace(/\D/g, '')] || head['P' + line.replace(/\D/g, '')] || 'Röst ' + line.replace(/\D/g, '')); continue; }
      if (line[0] === 'E') break;
      if (!cur) newTrack('Sång');
      const m = line.match(/^([:*FRG])\s*(-?\d+)\s+(\d+)\s+(-?\d+)\s?(.*)$/);
      if (m) {
        if (m[1] === 'F') continue;
        cur.notes.push({ beat: relBase + parseInt(m[2], 10), len: parseInt(m[3], 10), pitch: parseInt(m[4], 10), syl: m[5] || '' });
        continue;
      }
      const lb = line.match(/^-\s*(-?\d+)(?:\s+(-?\d+))?/);
      if (lb) {
        cur.lines.push(relBase + parseInt(lb[1], 10));
        if (rel) relBase += parseInt(lb[2] != null ? lb[2] : lb[1], 10);
      }
    }
    const bpm = num(head.BPM), gap = (num(head.GAP) || 0) / 1000;
    if (!(bpm > 0)) throw new Error('UltraStar-filen saknar #BPM');
    const beat = 15 / bpm;
    const out = tracks.filter(t => t.notes.length).map(t => ({
      name: t.name,
      notes: clean(t.notes.map(x => ({ t: gap + x.beat * beat, d: Math.max(0.05, x.len * beat), n: 60 + x.pitch, syl: x.syl }))),
      syllables: t.notes.map(x => x.syl),
    }));
    if (!out.length) throw new Error('UltraStar-filen innehåller inga noter');
    return { title: head.TITLE || '', artist: head.ARTIST || '', bpm, gap, tracks: out };
  }

  // ---------- Autosynk mot tonkurvan ----------
  // Letar upp förskjutning, tempo och transponering så att noterna bäst överensstämmer med
  // analysens tonkurva (midi[] med hop sekunder, 0 = tyst). Jämför tonklass (oktav spelar ingen
  // roll), så det fungerar även om stämfilen har backvocals eller går i en annan tonart.
  // Ljudtid = offset + notTid × scale.
  async function autoSync(notes, midi, hop, opts = {}) {
    const minScale = opts.minScale ?? 0.85, maxScale = opts.maxScale ?? 1.15;
    const tick = opts.onProgress || (() => {});
    const audioDur = midi.length * hop;
    const nEnd = Math.max(...notes.map(x => x.t + x.d));
    const nStart = Math.min(...notes.map(x => x.t));
    // notgaller (0 = ingen not)
    const grid = (res) => {
      const g = new Float32Array(Math.ceil(nEnd / res) + 2);
      notes.forEach(x => { for (let k = Math.floor(x.t / res); k < Math.ceil((x.t + x.d) / res); k++) g[k] = x.n; });
      return g;
    };
    // analysramar (röstade) med jämnt avstånd
    const frames = (step) => {
      const st = Math.max(1, Math.round(step / hop)), out = [];
      for (let i = 0; i < midi.length; i += st) if (midi[i] > 0) out.push([i * hop, midi[i]]);
      return out;
    };
    function score(fr, g, res, off, sc) {
      const h = new Float32Array(12);
      for (let k = 0; k < fr.length; k++) {
        const u = (fr[k][0] - off) / sc;
        if (u < 0) continue;
        const gi = (u / res) | 0;
        if (gi >= g.length) continue;
        const n = g[gi];
        if (!n) continue;
        let dd = (fr[k][1] - n) % 12; if (dd < 0) dd += 12;
        const b = Math.round(dd) % 12, w = 1 - Math.min(1, Math.abs(dd - Math.round(dd)) * 1.6);
        h[b] += w;
      }
      let best = 0, bi = 0; for (let b = 0; b < 12; b++) if (h[b] > best) { best = h[b]; bi = b; }
      return [best, bi];
    }
    // grov sökning
    const RC = 0.1, gC = grid(RC), fC = frames(0.1);
    if (fC.length < 20) throw new Error('Tonkurvan har för lite sång att synka mot');
    let best = { s: -1 }, second = -1;
    const scales = [];
    for (let sc = minScale; sc <= maxScale + 1e-9; sc += 0.01) scales.push(Math.round(sc * 1000) / 1000);
    let done = 0, last = Date.now();
    const cands = [];
    for (const sc of scales) {
      const oMin = -nEnd * sc + 2, oMax = audioDur - nStart * sc - 2;
      for (let off = oMin; off <= oMax; off += 0.1) {
        const [s, b] = score(fC, gC, RC, off, sc);
        cands.push([s, off, sc, b]);
        if (s > best.s) best = { s, off, sc, b };
      }
      done++;
      if (Date.now() - last > 40) { tick(0.8 * done / scales.length); await new Promise(r => setTimeout(r, 0)); last = Date.now(); }
    }
    // näst bästa kandidat långt från den bästa (för säkerhetsmått)
    for (const c of cands) if (Math.abs(c[1] - best.off) > 2 && c[0] > second) second = c[0];
    // finjustering
    const RF = 0.02, gF = grid(RF), fF = frames(0.02);
    let fine = { s: -1 };
    for (let sc = best.sc - 0.012; sc <= best.sc + 0.012 + 1e-9; sc += 0.002) {
      for (let off = best.off - 0.3; off <= best.off + 0.3 + 1e-9; off += 0.02) {
        const [s, b] = score(fF, gF, RF, off, sc);
        if (s > fine.s) fine = { s, off, sc, b };
      }
    }
    tick(1);
    // transponering: tonklass-skillnad + den oktav som ligger närmast stämmans läge
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    const audioMed = med(fF.map(f => f[1])), noteMed = med(notes.map(x => x.n));
    let tr = fine.b > 6 ? fine.b - 12 : fine.b;
    tr += 12 * Math.round((audioMed - (noteMed + tr)) / 12);
    // träffgrad bland röstade ramar inom notområdet
    const covered = fF.filter(f => { const u = (f[0] - fine.off) / fine.sc; return u >= nStart && u <= nEnd; }).length || 1;
    return {
      offset: Math.round(fine.off * 100) / 100,
      scale: Math.round(fine.sc * 1000) / 1000,
      transpose: tr,
      match: Math.min(1, fine.s / covered),
      confidence: second > 0 ? best.s / second : 9,
    };
  }
  function applySync(notes, r) {
    return notes.map(x => ({
      t: Math.round((r.offset + x.t * r.scale) * 100) / 100,
      d: Math.max(0.05, Math.round(x.d * r.scale * 100) / 100),
      n: x.n + r.transpose,
    })).filter(x => x.t + x.d > 0).map(x => (x.t < 0 ? { ...x, d: Math.round((x.d + x.t) * 100) / 100, t: 0 } : x)).filter(x => x.d >= 0.05);
  }

  const api = { toJson, fromJson, toMidi, fromMidi, fromUltraStar, decodeText, autoSync, applySync, topLine, saveFile, FORMAT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoteIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
