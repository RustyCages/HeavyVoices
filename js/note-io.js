// Export/import av noter för Röstövningen.
// Noter = [{ t: start i sekunder, d: längd i sekunder, n: MIDI-nummer }]
// Format: Heavy Voices-JSON (.json) och standard-MIDI (.mid) – MIDI öppnas i
// MuseScore, Logic, Cubase m.fl., och MIDI-filer från notprogram kan läsas in.
// Import även från MusicXML (.musicxml/.xml/.mxl) och UltraStar (.txt).
// Noter kan ha sångtext: syl = stavelsen, cont = ordet fortsätter på nästa stavelse.

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
          const ly = latin1(String(x.syl).replace(/^ /, '').replace(/~/g, '') + (x.cont ? '-' : ''));
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
    const lyr = [];      // { track, tick, text } – sångtext (lyric-händelser)
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
          if (mt === 0x05) { const raw = b.slice(p, p + l); let tx; try { tx = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch (e) { tx = new TextDecoder('windows-1252').decode(raw); } lyr.push({ track: t, tick, text: tx }); }
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

    // sångtext: lyric-händelsen hör till noten som börjar på samma tick i samma spår
    // ("lju-" = ordet fortsätter, "\" eller "/" först = ny rad i .kar-filer)
    const lyrAt = new Map();
    lyr.forEach(e => {
      const tx = e.text.replace(/^[\\/\r\n]+/, '').replace(/[\r\n]+$/, '');
      if (!tx.trim()) return;
      lyrAt.set(e.track + ':' + e.tick, tx);
    });
    const used = new Set();
    const groups = new Map();
    raw.sort((a, b) => a.on - b.on || b.n - a.n).forEach(x => {
      if (x.ch === 9) return;  // trummor
      const k = fmt === 0 ? 'c' + x.ch : x.track + ':' + x.ch;
      if (!groups.has(k)) groups.set(k, { name: (names[x.track] || '').trim() || (fmt === 0 ? `Kanal ${x.ch + 1}` : `Spår ${x.track + 1}`) + (fmt === 0 ? '' : ` (kanal ${x.ch + 1})`), channel: x.ch, notes: [] });
      const t0 = toSec(x.on), t1 = toSec(x.off);
      if (t1 - t0 <= 0.02) return;
      const note = { t: t0, d: t1 - t0, n: x.n };
      // format 0: all text ligger i samma spår – den hör till kanalen som har en not på ticket
      const lk = (fmt === 0 ? 0 : x.track) + ':' + x.on;
      if (lyrAt.has(lk) && !used.has(lk)) {
        used.add(lk);
        const tx = lyrAt.get(lk);
        note.cont = /-\s*$/.test(tx);
        note.syl = tx.replace(/-\s*$/, '').trim();
      }
      groups.get(k).notes.push(note);
    });
    const out = [...groups.values()].filter(g => g.notes.length);
    if (!out.length) throw new Error('MIDI-filen innehåller inga noter');
    out.forEach(g => { g.notes = clean(g.notes); g.chords = hasChords(g.notes); });
    return out;
  }

  // ---------- hjälpare ----------
  function r2(v) { return Math.round(v * 100) / 100; }
  function clean(notes) {
    return notes.map(x => ({ t: Math.max(0, r2(x.t)), d: Math.max(0.05, r2(x.d)), n: Math.round(x.n), ...(x.syl != null ? { syl: x.syl, cont: !!x.cont } : {}) }))
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
    // stavelser: " ord" (blanksteg först) = nytt ord, utan blanksteg = samma ord, "~" = samma vokal (melisma)
    tracks.forEach(t => {
      const ns = t.notes;
      ns.forEach((x, i) => {
        const rawS = x.syl || '';
        if (!rawS.replace(/~/g, '').trim()) { x.cleanSyl = null; return; }
        x.cleanSyl = rawS.replace(/~/g, '').trim();
        let j = i + 1; while (j < ns.length && !(ns[j].syl || '').replace(/~/g, '').trim()) j++;
        const nx = j < ns.length ? ns[j].syl : null;
        const brk = t.lines.some(b => b > x.beat && j < ns.length && b <= ns[j].beat);
        x.cont = !!nx && !brk && !/\s$/.test(rawS) && !/^\s/.test(nx);
      });
    });
    const out = tracks.filter(t => t.notes.length).map(t => ({
      name: t.name,
      notes: clean(t.notes.map(x => ({ t: gap + x.beat * beat, d: Math.max(0.05, x.len * beat), n: 60 + x.pitch, syl: x.cleanSyl == null ? undefined : x.cleanSyl, cont: x.cont }))),
      syllables: t.notes.map(x => x.syl),
      breaks: t.lines.map(b => Math.round((gap + b * beat) * 100) / 100),
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
    // okänt tempo i filen (t.ex. MusicXML utan tempoangivelse): gissa först utifrån hur länge det sjungs
    if (opts.guessTempo) {
      let a = -1, z = -1;
      for (let i = 0; i < midi.length; i++) if (midi[i] > 0) { if (a < 0) a = i; z = i; }
      const n0 = Math.min(...notes.map(x => x.t)), n1 = Math.max(...notes.map(x => x.t + x.d));
      const s0 = a >= 0 && n1 > n0 ? Math.max(0.25, Math.min(4, (z - a) * hop / (n1 - n0))) : 1;
      const r = await autoSync(notes.map(x => ({ ...x, t: x.t * s0, d: x.d * s0 })), midi, hop, { ...opts, guessTempo: false, minScale: 0.8, maxScale: 1.2 });
      return { ...r, scale: Math.round(r.scale * s0 * 1000) / 1000 };
    }
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
    // notbladets oktav gäller – byt bara oktav om ljudet tydligt ligger i en annan (t.ex. en herre som sjunger sopran);
    // tonkurvan har ofta enstaka oktavfel och läckage från andra stämmor som drar ner medianen
    { const dd = audioMed - (noteMed + tr); if (Math.abs(dd) > 12) tr += 12 * Math.round(dd / 12); }
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
      ...(x.syl != null ? { syl: x.syl, cont: !!x.cont } : {}),
    })).filter(x => x.t + x.d > 0).map(x => (x.t < 0 ? { ...x, d: Math.round((x.d + x.t) * 100) / 100, t: 0 } : x)).filter(x => x.d >= 0.05);
  }

  // UltraStar → synkad text (.lrc): en rad per sångrad, tiden = radens första not.
  // Tom tidsstämpel efter raden om det är en längre paus innan nästa.
  function ultraStarToLrc(us, trackIndex = 0) {
    const tr = us.tracks[trackIndex];
    const lines = [];
    let cur = null, bi = 0;
    const br = (tr.breaks || []).slice().sort((a, b) => a - b);
    tr.notes.forEach(x => {
      while (bi < br.length && br[bi] <= x.t + 0.005) { cur = null; bi++; }
      if (!cur) { cur = { t: x.t, end: x.t + x.d, text: '' }; lines.push(cur); }
      if (x.syl) cur.text += String(x.syl).replace(/~/g, '') + (x.cont ? '' : ' ');
      cur.end = Math.max(cur.end, x.t + x.d);
    });
    const ts = sec => { const m = Math.floor(sec / 60), s = sec - m * 60; return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`; };
    const out = [];
    if (us.title) out.push(`[ti:${us.title}]`);
    if (us.artist) out.push(`[ar:${us.artist}]`);
    lines.forEach((l, i) => {
      const text = l.text.replace(/\s+/g, ' ').trim();
      if (!text) return;
      out.push(ts(l.t) + text);
      const next = lines[i + 1];
      if (!next || next.t - l.end > 2) out.push(ts(l.end + 0.3));
    });
    return out.join('\n') + '\n';
  }
  const isUltraStar = (text) => /^#BPM\s*:/mi.test(text) && /^[:*RG]\s*-?\d+\s+\d+\s+-?\d+/m.test(text);

  // ---------- MusicXML (.musicxml / .xml / .mxl) ----------
  // Notsättarens fil: varje stämma för sig, sångtext per not, tempo, bundna noter och repriser/voltor
  // (även D.C./D.S./Fine/Coda när filen har dem som <sound>). Repriser spelas ut i rätt ordning, och
  // vers 2 under en reprisstreck används andra gången.
  // Svar: { title, tempoKnown, bpm, tracks: [{ name, notes: [{ t, d, n, syl?, cont? }], chords }] }
  async function unzipFirstXml(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Trasig .mxl-fil');
    const cnt = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const files = {};
    for (let k = 0; k < cnt; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      files[new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen))] = { method, csize, local };
      p += 46 + nlen + xlen + clen;
    }
    const read = async (name) => {
      const f = files[name], lp = f.local;
      const start = lp + 30 + dv.getUint16(lp + 26, true) + dv.getUint16(lp + 28, true);
      const data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return data;
      if (f.method !== 8) throw new Error('Okänd komprimering i .mxl-filen');
      if (typeof DecompressionStream === 'undefined') throw new Error('Webbläsaren kan inte packa upp .mxl – exportera som okomprimerad MusicXML (.musicxml)');
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    };
    let rootName = null;
    if (files['META-INF/container.xml']) {
      const m = new TextDecoder().decode(await read('META-INF/container.xml')).match(/full-path="([^"]+)"/);
      if (m && files[m[1]]) rootName = m[1];
    }
    if (!rootName) rootName = Object.keys(files).find(k => !/^META-INF\//.test(k) && /\.(musicxml|xml)$/i.test(k));
    if (!rootName) throw new Error('Hittar ingen MusicXML i .mxl-filen');
    return decodeText(await read(rootName));
  }
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  async function fromMusicXml(input) {
    let xml;
    if (typeof input === 'string') xml = input;
    else {
      const u8 = new Uint8Array(input);
      xml = (u8[0] === 0x50 && u8[1] === 0x4B) ? await unzipFirstXml(u8) : decodeText(u8);
    }
    if (typeof DOMParser === 'undefined') throw new Error('DOMParser saknas');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Kunde inte läsa MusicXML-filen');
    const root = doc.documentElement;
    if (root.nodeName === 'score-timewise') throw new Error('Filen är "timewise" MusicXML – exportera som vanlig (partwise) MusicXML');
    if (root.nodeName !== 'score-partwise') throw new Error('Inte en MusicXML-fil');
    const kids = (el, tag) => el ? [...el.children].filter(c => c.nodeName === tag) : [];
    const kid = (el, tag) => el ? ([...el.children].find(c => c.nodeName === tag) || null) : null;
    const txt = (el, tag) => { const k = kid(el, tag); return k ? k.textContent.trim() : null; };
    const num = (v, d = 0) => { const x = parseFloat(v); return isFinite(x) ? x : d; };

    const title = txt(kid(root, 'work'), 'work-title') || txt(root, 'movement-title') || '';
    const partNames = {};
    kids(kid(root, 'part-list'), 'score-part').forEach(sp => {
      partNames[sp.getAttribute('id')] = txt(sp, 'part-name') || txt(sp, 'part-abbreviation') || sp.getAttribute('id');
    });

    // ---- läs varje stämma takt för takt ----
    const parts = kids(root, 'part').map(part => {
      let divisions = 1, beats = 4, beatType = 4, transpose = 0;
      const measures = kids(part, 'measure').map(meas => {
        const m = { len: 0, notes: [], tempos: [], fwd: false, bwd: 0, endStart: null, endStop: false, segno: null, coda: null, dacapo: false, dalsegno: null, fine: false, tocoda: null };
        let cur = 0, max = 0, lastStart = 0;
        const sound = (el) => {
          if (!el) return;
          const tp = el.getAttribute('tempo'); if (tp && num(tp) > 0) m.tempos.push({ pos: cur / divisions, bpm: num(tp) });
          if (el.hasAttribute('segno')) m.segno = el.getAttribute('segno') || 'segno';
          if (el.hasAttribute('coda')) m.coda = el.getAttribute('coda') || 'coda';
          if (el.getAttribute('dacapo') === 'yes') m.dacapo = true;
          if (el.hasAttribute('dalsegno')) m.dalsegno = el.getAttribute('dalsegno') || 'segno';
          if (el.hasAttribute('fine')) m.fine = true;
          if (el.hasAttribute('tocoda')) m.tocoda = el.getAttribute('tocoda') || 'coda';
        };
        for (const el of meas.children) {
          switch (el.nodeName) {
            case 'attributes': {
              const dv = txt(el, 'divisions'); if (dv) divisions = num(dv, 1) || 1;
              const tm = kid(el, 'time'); if (tm) { beats = num(String(txt(tm, 'beats')).split('+').reduce((a, b) => a + num(b), 0), 4) || 4; beatType = num(txt(tm, 'beat-type'), 4) || 4; }
              const tr = kid(el, 'transpose'); if (tr) transpose = num(txt(tr, 'chromatic')) + 12 * num(txt(tr, 'octave-change'));
              break;
            }
            case 'backup': cur -= num(txt(el, 'duration')); if (cur < 0) cur = 0; break;
            case 'forward': cur += num(txt(el, 'duration')); max = Math.max(max, cur); break;
            case 'sound': sound(el); break;
            case 'direction': {
              sound(kid(el, 'sound'));
              // metronom utan <sound tempo>
              if (!kid(el, 'sound') || !kid(el, 'sound').hasAttribute('tempo')) {
                kids(el, 'direction-type').forEach(dt => {
                  const mt = kid(dt, 'metronome'); if (!mt) return;
                  const pm = num(txt(mt, 'per-minute')); if (!(pm > 0)) return;
                  const unit = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[txt(mt, 'beat-unit')] || 1;
                  m.tempos.push({ pos: cur / divisions, bpm: pm * unit * (kid(mt, 'beat-unit-dot') ? 1.5 : 1) });
                });
              }
              kids(el, 'direction-type').forEach(dt => { if (kid(dt, 'segno') && !m.segno) m.segno = 'segno'; if (kid(dt, 'coda') && !m.coda) m.coda = 'coda'; });
              break;
            }
            case 'barline': {
              const rp = kid(el, 'repeat');
              if (rp) { if (rp.getAttribute('direction') === 'forward') m.fwd = true; else m.bwd = Math.max(2, num(rp.getAttribute('times'), 2)); }
              const en = kid(el, 'ending');
              if (en) {
                const ty = en.getAttribute('type');
                if (ty === 'start') m.endStart = String(en.getAttribute('number') || '1').split(/[,\s]+/).map(Number).filter(x => x > 0);
                else m.endStop = true;
              }
              sound(kid(el, 'sound'));
              break;
            }
            case 'note': {
              const dur = num(txt(el, 'duration'));
              const isChord = !!kid(el, 'chord');
              if (kid(el, 'grace') || kid(el, 'cue')) break;
              const start = isChord ? lastStart : cur;
              if (!isChord) { lastStart = cur; cur += dur; max = Math.max(max, cur); }
              const pitch = kid(el, 'pitch');
              if (!pitch || kid(el, 'rest') || dur <= 0) break;
              const n = 12 * (num(txt(pitch, 'octave'), 4) + 1) + (STEP[txt(pitch, 'step')] ?? 0) + num(txt(pitch, 'alter')) + transpose;
              const ties = kids(el, 'tie').map(t => t.getAttribute('type'));
              const lyrics = {};
              kids(el, 'lyric').forEach((ly, k) => {
                const texts = kids(ly, 'text').map(t => t.textContent);
                if (!texts.length) return;
                lyrics[ly.getAttribute('number') || String(k + 1)] = { text: texts.join(' ').trim(), syb: txt(ly, 'syllabic') || 'single' };
              });
              m.notes.push({ pos: start / divisions, dur: dur / divisions, n, voice: txt(el, 'voice') || '1', staff: txt(el, 'staff') || '1',
                tieStart: ties.includes('start'), tieStop: ties.includes('stop'), lyrics, chord: isChord });
              break;
            }
          }
        }
        m.len = max > 0 ? max / divisions : beats * 4 / beatType;
        return m;
      });
      return { id: part.getAttribute('id'), name: partNames[part.getAttribute('id')] || 'Stämma', measures };
    });
    if (!parts.length || !parts[0].measures.length) throw new Error('MusicXML-filen innehåller inga takter');

    // ---- repriser/voltor/hopp: spela ut takternas ordning (från första stämman) ----
    const meta = parts[0].measures.map((m, i) => {
      const o = { fwd: false, bwd: 0, endStart: null, endStop: false, segno: null, coda: null, dacapo: false, dalsegno: null, fine: false, tocoda: null };
      parts.forEach(p => { const x = p.measures[i]; if (!x) return; for (const k in o) if (x[k] && !o[k]) o[k] = x[k]; });
      return o;
    });
    const M = meta.length, order = [];
    let i = 0, guard = 0, repStart = 0, pass = 1, cameBack = false, afterJump = false;
    while (i < M && guard++ < 20000) {
      const m = meta[i];
      if (m.fwd && !cameBack) { repStart = i; pass = 1; }
      cameBack = false;
      if (m.endStart) {
        // volta: spela den här bara på rätt varv (efter D.C./D.S. den sista voltan)
        let k = i; while (k < M - 1 && !meta[k].endStop) k++;
        const lastEnding = !(meta[k + 1] && meta[k + 1].endStart);
        const play = afterJump ? lastEnding : (m.endStart.includes(pass) || (lastEnding && pass > Math.max(...m.endStart) && !meta.slice(i, k + 1).some(x => x.bwd)));
        if (!play) { i = k + 1; continue; }
      }
      order.push({ i, pass });
      // sista voltan utan reprisstreck: avsnittet är klart
      if (m.endStop && !m.bwd && !(meta[i + 1] && meta[i + 1].endStart)) { pass = 1; repStart = i + 1; }
      if (m.bwd && !afterJump) {
        if (pass < m.bwd) { pass++; i = repStart; cameBack = true; continue; }
        pass = 1; repStart = i + 1;
      }
      if (m.fine && afterJump) break;
      if (m.tocoda && afterJump) {
        const c = meta.findIndex((x, k) => k > i && x.coda && (x.coda === m.tocoda || m.tocoda === 'coda' || x.coda === 'coda'));
        if (c >= 0) { i = c; continue; }
      }
      if ((m.dacapo || m.dalsegno) && !afterJump) {
        afterJump = true; pass = 1;
        if (m.dacapo) { i = 0; continue; }
        const sg = meta.findIndex(x => x.segno && (x.segno === m.dalsegno || m.dalsegno === 'segno' || x.segno === 'segno'));
        i = sg >= 0 ? sg : 0; continue;
      }
      i++;
    }

    // ---- tidslinje i fjärdedelar, tempokarta ----
    const qStart = []; let q = 0;
    order.forEach(o => { qStart.push(q); q += parts[0].measures[o.i].len; });
    const tempos = [];
    order.forEach((o, k) => parts.forEach(p => { const m = p.measures[o.i]; if (m) m.tempos.forEach(tp => tempos.push({ q: qStart[k] + tp.pos, bpm: tp.bpm })); }));
    tempos.sort((a, b) => a.q - b.q);
    const tempoKnown = tempos.length > 0;
    const tmap = [];
    tempos.forEach(tp => { const l = tmap[tmap.length - 1]; if (l && Math.abs(l.q - tp.q) < 1e-6) l.bpm = tp.bpm; else if (!l || l.bpm !== tp.bpm) tmap.push({ q: tp.q, bpm: tp.bpm }); });
    if (!tmap.length || tmap[0].q > 0) tmap.unshift({ q: 0, bpm: tmap.length ? tmap[0].bpm : 120 });
    let sec = 0; tmap.forEach((s, k) => { if (k) sec += (s.q - tmap[k - 1].q) * 60 / tmap[k - 1].bpm; s.sec = sec; });
    const toSec = qq => { let s = tmap[0]; for (const x of tmap) { if (x.q <= qq + 1e-9) s = x; else break; } return s.sec + (qq - s.q) * 60 / s.bpm; };

    // ---- noter per stämma (och röst inom stämman) ----
    const tracks = [];
    parts.forEach((p, partIndex) => {
      const groups = new Map();
      order.forEach((o, k) => {
        const m = p.measures[o.i]; if (!m) return;
        m.notes.forEach(x => {
          const key = x.staff + ':' + x.voice;
          if (!groups.has(key)) groups.set(key, []);
          const lk = Object.keys(x.lyrics);
          const ly = x.lyrics[String(o.pass)] || x.lyrics['1'] || (lk.length ? x.lyrics[lk.sort()[0]] : null);
          groups.get(key).push({ q: qStart[k] + x.pos, dq: x.dur, n: x.n, tieStart: x.tieStart, tieStop: x.tieStop, ly, chord: x.chord });
        });
      });
      // små röster (t.ex. kort divisi) slås ihop med den största – översta tonen används då
      let gs = [...groups.entries()].map(([key, ns]) => ({ key, ns }));
      const total = gs.reduce((a, g) => a + g.ns.length, 0);
      gs.sort((a, b) => b.ns.length - a.ns.length);
      const big = gs.filter((g, k) => k === 0 || g.ns.length >= total * 0.15);
      gs.filter(g => !big.includes(g)).forEach(g => big[0].ns.push(...g.ns));
      big.forEach((g, gi) => {
        const ns = g.ns.sort((a, b) => a.q - b.q || b.n - a.n);
        const out = [];
        ns.forEach(x => {
          // bunden not: förläng föregående med samma ton
          if (x.tieStop) {
            const prev = [...out].reverse().find(y => y.n === x.n && Math.abs(y.q + y.dq - x.q) < 1e-3);
            if (prev) { prev.dq += x.dq; if (!prev.ly && x.ly) prev.ly = x.ly; return; }
          }
          out.push({ ...x });
        });
        const notes = out.map(x => {
          const t = toSec(x.q), d = toSec(x.q + x.dq) - t;
          const o = { t, d, n: x.n };
          if (x.ly && x.ly.text) { o.syl = x.ly.text; o.cont = x.ly.syb === 'begin' || x.ly.syb === 'middle'; }
          return o;
        });
        if (!notes.length) return;
        const name = big.length > 1 ? `${p.name} – röst ${gi + 1}` : p.name;
        const c = clean(notes);
        tracks.push({ name, notes: c, chords: hasChords(c), part: partIndex });
      });
    });
    if (!tracks.length) throw new Error('MusicXML-filen innehåller inga noter');
    // takterna i spelordning med tider (för notskriften i spelaren): i = taktens index i filen
    const measures = order.map((o, k) => { const len = parts[0].measures[o.i].len; return { i: o.i, len, s0: r2(toSec(qStart[k]) * 1000) / 1000, s1: r2(toSec(qStart[k] + len) * 1000) / 1000 }; });
    return { title, tempoKnown, bpm: tmap[0].bpm, tracks, measures, xml };
  }

  // ---------- sångtext → textrutor och rader ----------
  // Stavelserna på noterna slås ihop till ord: en ruta per ord, från första noten till sista (melismer räknas in).
  function lyricBoxes(notes) {
    const ns = (notes || []).slice().sort((a, b) => a.t - b.t);
    const out = [];
    let cur = null, open = false;
    ns.forEach(x => {
      const end = x.t + x.d, s = x.syl != null ? String(x.syl).trim() : '';
      if (s) {
        if (cur && open) { cur.w += s; cur.end = Math.max(cur.end, end); }
        else { cur = { t: x.t, end, w: s }; out.push(cur); }
        open = !!x.cont;
      } else if (cur && x.t - cur.end < 0.3) cur.end = Math.max(cur.end, end);
    });
    const boxes = out.map(b => ({ t: r2(b.t), d: r2(Math.max(0.05, b.end - b.t)), w: b.w }));
    for (let k = 0; k < boxes.length - 1; k++) if (boxes[k].t + boxes[k].d > boxes[k + 1].t) boxes[k].d = Math.max(0.05, r2(boxes[k + 1].t - boxes[k].t));
    return boxes;
  }
  // textrutor → rader för karaoken: ny rad vid paus, efter skiljetecken eller stor bokstav efter ett andetag
  function linesFromBoxes(boxes) {
    const lines = [];
    let cur = null;
    (boxes || []).forEach((b, k) => {
      const prev = boxes[k - 1];
      const gap = prev ? b.t - (prev.t + prev.d) : 99;
      const brk = !cur || gap > 0.9 || cur.words >= 10
        || (cur.words >= 3 && /[.,!?;:]$/.test(prev.w))
        || (cur.words >= 3 && gap > 0.25 && /^[A-ZÅÄÖ]/.test(b.w));
      if (brk) { cur = { t: b.t, end: b.t + b.d, text: b.w, words: 1 }; lines.push(cur); }
      else { cur.text += ' ' + b.w; cur.end = b.t + b.d; cur.words++; }
    });
    return lines.map(l => ({ t: r2(l.t), end: r2(l.end), text: l.text }));
  }
  function linesToLrc(lines, title) {
    const ts = sec => { sec = Math.max(0, sec); const m = Math.floor(sec / 60), s = sec - m * 60; return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`; };
    const out = title ? [`[ti:${title}]`] : [];
    lines.forEach((l, k) => {
      out.push(ts(l.t) + l.text);
      const next = lines[k + 1];
      if (!next || next.t - l.end > 2) out.push(ts(l.end + 0.3));
    });
    return out.join('\n') + '\n';
  }

  // ---------- finsynk: följ tempoändringar (ritardando, fermater, fritt tempo) ----------
  // Efter autoSync ligger noterna rätt i stort. Här jämförs noterna och tonkurvan bit för bit (DTW,
  // dynamisk tidsförvrängning inom ±band sekunder) och en tidskarta tas fram. Används bara om den
  // ger bättre överensstämmelse än utan.
  // span = [a, b]: räkna mot ALL sång i det området (inte bara där noterna ligger), så att det inte
  // lönar sig att trycka ihop eller flytta bort noter
  // others = andra stämmors noter i samma tid: övningsfiler har ofta de andra stämmorna i bakgrunden,
  // så en träff på en annan stämmas not räknas också (tonkurvan hoppar dit ibland)
  function matchScore(notes, midi, hop, span, others) {
    let hit = 0, tot = 0;
    const st = Math.max(1, Math.round(0.04 / hop));
    const lists = [notes, ...(others || [])].map(l => l.slice().sort((a, b) => a.t - b.t));
    const ks = lists.map(() => 0);
    const at = (li, t) => {
      const ns = lists[li]; let k = ks[li];
      while (k < ns.length && ns[k].t + ns[k].d < t) k++;
      ks[li] = k;
      for (let j = k; j < ns.length && ns[j].t <= t; j++) if (ns[j].t + ns[j].d >= t) return ns[j];
      return null;
    };
    const ok = (m, x) => { let dd = Math.abs(m - x.n) % 12; dd = Math.min(dd, 12 - dd); return dd <= 1; };
    for (let i = 0; i < midi.length; i += st) {
      const m = midi[i]; if (!(m > 0)) continue;
      const t = i * hop;
      if (span && (t < span[0] || t > span[1])) continue;
      const x = at(0, t);
      if (span) tot++;
      else if (!x) continue;
      else tot++;
      if (x && ok(m, x)) { hit++; continue; }
      for (let li = 1; li < lists.length; li++) { const y = at(li, t); if (y && ok(m, y)) { hit++; break; } }
    }
    return tot ? hit / tot : 0;
  }
  // kostnad för en ljudram a mot egen not s och andra stämmors noter os (tonklass, k = transponering)
  function frameCost(s, a, os, k, soft) {
    const pc = (x, y) => { let d = Math.abs(x - y - k) % 12; d = Math.min(d, 12 - d); return Math.min(1, Math.max(0, d - soft) / 1.5); };
    if (!a) return s ? 0.5 : 0;
    let c = s ? pc(a, s) : 0.6;
    for (let q = 0; q < os.length; q++) { const o = os[q]; if (o) { const co = pc(a, o) + 0.2; if (co < c) c = co; } }
    return c;
  }
  function warpMap(notes, midi, hop, opts = {}) {
    const R = 0.05, B = Math.round((opts.band ?? 3) / R);
    if (!notes.length) return null;
    const t0 = Math.max(0, Math.min(...notes.map(x => x.t)) - 2);
    const t1 = Math.min(midi.length * hop, Math.max(...notes.map(x => x.t + x.d)) + 2);
    const N = Math.ceil((t1 - t0) / R);
    if (N < 20) return null;
    const S = new Float32Array(N), A = new Float32Array(N);
    const grid = ns => { const g = new Float32Array(N); ns.forEach(x => { for (let k = Math.max(0, Math.floor((x.t - t0) / R)); k < Math.min(N, Math.ceil((x.t + x.d - t0) / R)); k++) g[k] = x.n; }); return g; };
    S.set(grid(notes));
    const O = (opts.others || []).map(grid), os = new Float32Array(O.length);
    for (let j = 0; j < N; j++) {
      // median av ramarna i fönstret (tål enstaka felaktiga tonhöjder)
      const a = Math.floor((t0 + j * R) / hop), b = Math.max(a + 1, Math.floor((t0 + (j + 1) * R) / hop));
      const v = []; for (let i = a; i < b && i < midi.length; i++) if (midi[i] > 0) v.push(midi[i]);
      A[j] = v.length * 2 >= (b - a) ? v.sort((x, y) => x - y)[v.length >> 1] : 0;
    }
    const cost = (i, j) => {
      if (!O.length) {
        const s = S[i], a = A[j];
        if (!s && !a) return 0;
        if (!s || !a) return 0.5;
        let d = Math.abs(a - s) % 12; d = Math.min(d, 12 - d);
        return Math.min(1, Math.max(0, d - 0.35) / 1.5);
      }
      for (let q = 0; q < O.length; q++) os[q] = O[q][i];
      return frameCost(S[i], A[j], os, 0, 0.35);
    };
    const W = 2 * B + 1, INF = 1e18;
    const D = new Float64Array(N * W).fill(INF), P = new Uint8Array(N * W);   // P: 0 diagonal, 1 från (i-1,j), 2 från (i,j-1)
    const at = (i, j) => { const k = j - i + B; return k >= 0 && k < W ? i * W + k : -1; };
    const PEN = 0.12;
    for (let i = 0; i < N; i++) {
      for (let j = Math.max(0, i - B); j <= Math.min(N - 1, i + B); j++) {
        const c = cost(i, j), idx = at(i, j);
        if (i === 0 && j === 0) { D[idx] = c; continue; }
        let best = INF, from = 0;
        const d1 = i && j ? at(i - 1, j - 1) : -1; if (d1 >= 0 && D[d1] + 2 * c < best) { best = D[d1] + 2 * c; from = 0; }
        const d2 = i ? at(i - 1, j) : -1; if (d2 >= 0 && D[d2] + c + PEN < best) { best = D[d2] + c + PEN; from = 1; }
        const d3 = j ? at(i, j - 1) : -1; if (d3 >= 0 && D[d3] + c + PEN < best) { best = D[d3] + c + PEN; from = 2; }
        D[idx] = best; P[idx] = from;
      }
    }
    // tillbaka längs bästa vägen: notram i → ljudram j
    const sum = new Float64Array(N), cnt = new Uint16Array(N);
    let i = N - 1, j = N - 1;
    while (i >= 0 && j >= 0) {
      sum[i] += j; cnt[i]++;
      if (i === 0 && j === 0) break;
      const f = P[at(i, j)];
      if (f === 0) { i--; j--; } else if (f === 1) i--; else j--;
    }
    const raw = new Float64Array(N);
    for (let k = 0; k < N; k++) raw[k] = cnt[k] ? sum[k] / cnt[k] : k;
    // jämna ut (±0,5 s) och håll kartan stigande
    const H = 10, M = new Float64Array(N);
    for (let k = 0; k < N; k++) { let s = 0, n = 0; for (let q = Math.max(0, k - H); q <= Math.min(N - 1, k + H); q++) { s += raw[q]; n++; } M[k] = s / n; }
    // stigande, och lagom brant: tempot får som mest halveras/fördubblas lokalt (annars trycks noter ihop)
    for (let k = 1; k < N; k++) M[k] = Math.min(M[k - 1] + 2, Math.max(M[k - 1] + 0.5, M[k]));
    const map = t => {
      const u = (t - t0) / R;
      if (u <= 0) return t + M[0] * R;
      if (u >= N - 1) return t + (M[N - 1] - (N - 1)) * R;
      const a = Math.floor(u), f = u - a;
      return t0 + (M[a] * (1 - f) + M[a + 1] * f) * R;
    };
    const warped = applyWarp(notes, map), oth = opts.others || [];
    const sp = [Math.min(...notes.map(x => x.t)), Math.max(...notes.map(x => x.t + x.d))];
    const before = matchScore(notes, midi, hop, sp, oth), after = matchScore(warped, midi, hop, sp, oth.map(o => applyWarp(o, map)));
    let maxShift = 0; for (let k = 0; k < N; k++) maxShift = Math.max(maxShift, Math.abs(M[k] - k) * R);
    return { map, before, after, better: after > before + 0.03, maxShift: r2(maxShift) };
  }
  // flera varv (varje varv rättar det förra) – svar: { map, before, after, passes } eller null om det inte blev bättre
  function fineSync(notes, midi, hop, others) {
    let cur = notes, curO = others || [], maps = [], before = null, after = null;
    for (let k = 0; k < 3; k++) {
      const w = warpMap(cur, midi, hop, { band: 4, others: curO });
      if (!w) break;
      if (before == null) {
        before = w.before;
        // stämmer den vanliga synken för dåligt finns inget pålitligt att finjustera mot
        if (before < 0.38) return null;
      }
      if (!w.better) break;
      maps.push(w.map); cur = applyWarp(cur, w.map); curO = curO.map(o => applyWarp(o, w.map)); after = w.after;
    }
    if (!maps.length) return null;
    return { map: t => maps.reduce((v, f) => f(v), t), before, after, passes: maps.length };
  }
  function applyWarp(notes, map) {
    return notes.map(x => {
      const t = map(x.t), e = map(x.t + x.d);
      return { ...x, t: r2(Math.max(0, t)), d: r2(Math.max(0.05, e - t)) };
    });
  }

  // ---------- helsynk med DTW: följer inspelningen genom hela låten ----------
  // Jämför notbladet och tonkurvan (tonklass, 0,1 s-steg) och hittar bästa vägen genom båda –
  // klarar annan starttid, annat tempo, ritardando, fermater och mellanspel av annan längd.
  // Svar: { map: notbladstid → ljudtid, transpose, cost } eller null
  // tonkurva → rutnät med R sekunder (median, 0 = tyst); off = förskjutning till gemensam tid
  function audioGrid(midi, hop, R, M, off = 0) {
    const A = new Float32Array(M);
    for (let j = 0; j < M; j++) {
      const t = j * R - off;
      const a = Math.floor(t / hop), b = Math.min(midi.length, Math.floor((t + R) / hop));
      if (b <= 0 || a >= midi.length) continue;
      const v = []; for (let i = Math.max(0, a); i < b; i++) if (midi[i] > 0) v.push(midi[i]);
      A[j] = v.length && v.length >= 0.4 * (b - Math.max(0, a)) ? v.sort((x, y) => x - y)[v.length >> 1] : 0;
    }
    return A;
  }
  function scoreGrid(notes, sA, R, N) {
    const g = new Float32Array(N);
    notes.forEach(x => { for (let i = Math.max(0, Math.round((x.t - sA) / R)); i < Math.min(N, Math.round((x.t + x.d - sA) / R)); i++) g[i] = x.n; });
    return g;
  }
  const pcHist = (arrs) => { const h = new Float64Array(12); arrs.forEach(g => g.forEach(v => { if (v) h[((Math.round(v) % 12) + 12) % 12]++; })); return h; };
  // kärnan: costRow(i, k, out) fyller kostnaden för notram i mot alla ljudramar. Svar { k, raw, total }
  async function dtwCore(N, M, ks, costRow, tick) {
    const Dp = new Float32Array(N * M), P = new Uint8Array(N * M), C = new Float32Array(M);
    let best = null, last = Date.now();
    for (let ci = 0; ci < ks.length; ci++) {
      const k = ks[ci];
      costRow(0, k, C);
      for (let j = 0; j < M; j++) { Dp[j] = C[j]; P[j] = 2; }   // fri start i ljudet
      for (let i = 1; i < N; i++) {
        const row = i * M, prev = row - M;
        const silentRow = costRow(i, k, C);
        for (let j = 0; j < M; j++) {
          const c = C[j], pen = (silentRow && c === 0) ? 0 : 0.3;
          let v = Dp[prev + j] + c + pen, f = 1;                         // noten fortsätter, ljudet står still
          if (j) {
            const dg = Dp[prev + j - 1] + c; if (dg <= v) { v = dg; f = 0; }   // båda går framåt
            const h = Dp[row + j - 1] + c + pen; if (h < v) { v = h; f = 2; }  // ljudet går framåt
          }
          Dp[row + j] = v; P[row + j] = f;
        }
        if (Date.now() - last > 40) { tick((ci + i / N) / ks.length); await new Promise(r => setTimeout(r, 0)); last = Date.now(); }
      }
      let jEnd = 0; for (let j = 1; j < M; j++) if (Dp[(N - 1) * M + j] < Dp[(N - 1) * M + jEnd]) jEnd = j;
      const total = Dp[(N - 1) * M + jEnd] / N;
      if (best && total >= best.total) continue;
      const sum = new Float64Array(N), cnt = new Uint32Array(N);
      let i = N - 1, j = jEnd;
      while (i >= 0) {
        sum[i] += j; cnt[i]++;
        const f = P[i * M + j];
        if (i === 0) break;
        if (f === 0) { i--; j--; } else if (f === 1) i--; else j--;
        if (j < 0) j = 0;
      }
      const raw = new Float64Array(N);
      for (let q = 0; q < N; q++) raw[q] = cnt[q] ? sum[q] / cnt[q] : (q ? raw[q - 1] : 0);
      best = { total, k, raw };
    }
    tick(1);
    return best;
  }
  // vägen → jämn, stigande karta (±0,5 s, tempot högst ¼–4 gånger lokalt)
  function pathMap(raw, N, R, sA) {
    const H = Math.round(0.5 / R), Mp = new Float64Array(N);
    for (let q = 0; q < N; q++) { let s = 0, c = 0; for (let r = Math.max(0, q - H); r <= Math.min(N - 1, q + H); r++) { s += raw[r]; c++; } Mp[q] = s / c; }
    for (let q = 1; q < N; q++) Mp[q] = Math.min(Mp[q - 1] + 4, Math.max(Mp[q - 1] + 0.25, Mp[q]));
    return s => {
      const u = (s - sA) / R;
      if (u <= 0) return Mp[0] * R + u * R;
      if (u >= N - 1) return Mp[N - 1] * R + (u - (N - 1)) * R;
      const a = Math.floor(u), f = u - a;
      return (Mp[a] * (1 - f) + Mp[a + 1] * f) * R;
    };
  }
  // oktav: notbladets oktav gäller – byt bara om ljudet tydligt ligger i en annan (t.ex. en herre som sjunger sopran);
  // tonkurvan har ofta enstaka oktavfel och läckage från andra stämmor som drar ner medianen
  function octaveFor(k, notes, A) {
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    const av = [...A].filter(Boolean);
    let tr = k > 6 ? k - 12 : k;
    if (!av.length || !notes.length) return tr;
    const dd = med(av) - (med(notes.map(x => x.n)) + tr);
    if (Math.abs(dd) > 12) tr += 12 * Math.round(dd / 12);
    return tr;
  }
  async function dtwSync(notes, midi, hop, opts = {}) {
    const R = opts.res || 0.1, tick = opts.onProgress || (() => {});
    if (!notes.length) return null;
    const n0 = Math.min(...notes.map(x => x.t)), n1 = Math.max(...notes.map(x => x.t + x.d));
    const sA = Math.max(0, n0 - 1), N = Math.ceil((n1 + 1 - sA) / R);
    const M = Math.ceil(midi.length * hop / R);
    if (N < 20 || M < 20) return null;
    const S = scoreGrid(notes, sA, R, N), A = audioGrid(midi, hop, R, M);
    const O = (opts.others || []).map(o => scoreGrid(o, sA, R, N)), os = new Float32Array(O.length);
    const hS = pcHist([S]), hA = pcHist([A]);
    const ks = [...Array(12).keys()].map(k => { let c = 0; for (let p = 0; p < 12; p++) c += hS[p] * hA[(p + k) % 12]; return [k, c]; })
      .sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
    const best = await dtwCore(N, M, ks, (i, k, C) => {
      const s = S[i];
      let anyO = false;
      for (let q = 0; q < O.length; q++) { os[q] = O[q][i]; if (os[q]) anyO = true; }
      for (let j = 0; j < M; j++) C[j] = frameCost(s, A[j], anyO ? os : [], k, 0.4);
      return !s;
    }, tick);
    if (!best) return null;
    return { map: pathMap(best.raw, N, R, sA), transpose: octaveFor(best.k, notes, A), cost: best.total };
  }
  // alla stämmor tillsammans: voices = [{ notes (notbladstid), midi, hop, off (stämmans förskjutning till låtens tid) }]
  // – en gemensam karta (notbladstid → låtens tid). Varje stämmas ljud jämförs med alla stämmors noter, så
  // övningsfiler med de andra stämmorna i bakgrunden hjälper i stället för att störa.
  async function jointSync(voices, opts = {}) {
    const R = opts.res || 0.1, tick = opts.onProgress || (() => {});
    const all = voices.flatMap(v => v.notes);
    if (!all.length) return null;
    const n0 = Math.min(...all.map(x => x.t)), n1 = Math.max(...all.map(x => x.t + x.d));
    const sA = Math.max(0, n0 - 1), N = Math.ceil((n1 + 1 - sA) / R);
    const M = Math.max(...voices.map(v => Math.ceil((v.midi.length * v.hop + Math.max(0, v.off || 0)) / R)));
    const S = voices.map(v => scoreGrid(v.notes, sA, R, N));
    const A = voices.map(v => audioGrid(v.midi, v.hop, R, M, v.off || 0));
    const hS = pcHist(S), hA = pcHist(A);
    const ks = [...Array(12).keys()].map(k => { let c = 0; for (let p = 0; p < 12; p++) c += hS[p] * hA[(p + k) % 12]; return [k, c]; })
      .sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
    const V = voices.length, os = voices.map(() => new Float32Array(V - 1));
    const best = await dtwCore(N, M, ks, (i, k, C) => {
      C.fill(0);
      let silent = true;
      for (let v = 0; v < V; v++) {
        const s = S[v][i]; if (s) silent = false;
        let q = 0, anyO = false; for (let w = 0; w < V; w++) if (w !== v) { os[v][q] = S[w][i]; if (os[v][q]) anyO = true; q++; }
        const Av = A[v];
        for (let j = 0; j < M; j++) C[j] += frameCost(s, Av[j], anyO ? os[v] : [], k, 0.4) / V;
      }
      return silent;
    }, tick);
    if (!best) return null;
    const map = pathMap(best.raw, N, R, sA);
    return { map, transposes: voices.map((v, x) => octaveFor(best.k, v.notes, A[x])), cost: best.total };
  }
  function mapNotes(notes, map, tr = 0) {
    return notes.map(x => {
      let a = map(x.t), b = map(x.t + x.d);
      if (a < 0) a = 0;
      return { ...x, t: r2(a), d: r2(Math.max(0.05, b - a)), n: x.n + tr };
    }).filter(x => x.t + x.d > 0.05);
  }
  // bästa synken: rak (start + tempo) eller DTW, sedan finjustering. Svar: { map, transpose, how, fine, match, lin }
  async function bestSync(notes, midi, hop, opts = {}) {
    const prog = opts.onProgress || (() => {});
    const all = [0, 1e9], cand = [];
    let lin = null;
    try {
      lin = await autoSync(notes, midi, hop, { guessTempo: opts.guessTempo, onProgress: p => prog(p * (opts.follow === false ? 0.95 : 0.45)) });
      cand.push({ how: 'lin', map: s => lin.offset + s * lin.scale, transpose: lin.transpose });
    } catch (e) { if (opts.follow === false) throw e; }
    if (opts.follow !== false) {
      const dt = await dtwSync(notes, midi, hop, { res: opts.res, others: opts.others, onProgress: p => prog(0.45 + p * 0.5) });
      if (dt) cand.push({ how: 'dtw', map: dt.map, transpose: dt.transpose });
    }
    if (!cand.length) throw new Error('Tonkurvan har för lite sång att synka mot');
    const oth = opts.others || [];
    const score = (map, tr) => matchScore(mapNotes(notes, map, tr), midi, hop, all, oth.map(o => mapNotes(o, map, tr)));
    cand.forEach(c => { c.match = score(c.map, c.transpose); });
    cand.sort((a, b) => b.match - a.match);
    let best = cand[0];
    if (opts.follow !== false) {
      const ns = mapNotes(notes, best.map, best.transpose), f = fineSync(ns, midi, hop, oth.map(o => mapNotes(o, best.map, best.transpose)));
      if (f) {
        const m0 = best.map, m2 = s => f.map(m0(s));
        const match = score(m2, best.transpose);
        if (match > best.match) best = { ...best, map: m2, match, fine: true };
      }
    }
    prog(1);
    // egen träffgrad (bara den här stämmans noter) för statusraden
    const own = matchScore(mapNotes(notes, best.map, best.transpose), midi, hop, all);
    return { map: best.map, transpose: best.transpose, how: best.how, fine: !!best.fine, match: best.match, own, withOthers: oth.length > 0, lin,
      linMatch: (cand.find(c => c.how === 'lin') || {}).match ?? null };
  }

  // ---------- takttabeller: { a, b } per takt (ljudtid) – samma notblad i flera stämmor ----------
  const sameMeasures = (x, y) => x && y && x.length === y.length && x.every((m, k) => m.i === y[k].i && Math.abs(m.len - y[k].len) < 1e-6);
  // median per takt av flera tabeller (alla i samma tid)
  function medianTable(tables) {
    const med = v => { const s = v.slice().sort((p, q) => p - q), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
    return tables[0].map((m, k) => ({ ...m, a: med(tables.map(t => t[k].a)), b: med(tables.map(t => t[k].b)) }));
  }
  // rätta bara de takter där stämman avviker från flertalet (> tol s från medianen); kräver minst två andra stämmor
  function consensusTable(own, others, tol = 0.4) {
    if (!others || others.length < 2) return own;
    const med = medianTable([own, ...others]);
    const as = own.map((m, k) => Math.abs(m.a - med[k].a) > tol ? med[k].a : m.a);
    for (let k = 1; k < as.length; k++) if (as[k] < as[k - 1] + 0.05) as[k] = as[k - 1] + 0.05;
    return own.map((m, k) => ({ ...m, a: as[k], b: k + 1 < as.length ? as[k + 1] : (Math.abs(m.b - med[k].b) > tol ? med[k].b : m.b) }));
  }
  // tid enligt en tabell → tid enligt en annan (takt för takt, rakt inom takten)
  function tableMap(from, to) {
    return t => {
      let k = 0;
      for (let i = 0; i < from.length; i++) { if (from[i].a <= t) k = i; else break; }
      const f = from[k], g = to[k];
      if (t < f.a) return t + (g.a - f.a);
      if (t >= f.b && k === from.length - 1) return t + (g.b - f.b);
      const u = f.b > f.a ? (t - f.a) / (f.b - f.a) : 0;
      return g.a + Math.min(1, u) * (g.b - g.a);
    };
  }
  // notbladstid (s0/s1 per takt) → ljudtid enligt tabellen
  function scoreMap(table) {
    return s => {
      let k = 0;
      for (let i = 0; i < table.length; i++) { if (table[i].s0 <= s) k = i; else break; }
      const m = table[k];
      if (s < m.s0) return m.a + (s - m.s0);
      if (s >= m.s1 && k === table.length - 1) return m.b + (s - m.s1);
      return m.a + (s - m.s0) / Math.max(1e-6, m.s1 - m.s0) * (m.b - m.a);
    };
  }

  const api = { ultraStarToLrc, isUltraStar, toJson, fromJson, toMidi, fromMidi, fromUltraStar, fromMusicXml, decodeText, autoSync, applySync, topLine, saveFile,
    lyricBoxes, linesFromBoxes, linesToLrc, warpMap, fineSync, applyWarp, matchScore, dtwSync, jointSync, bestSync, mapNotes, sameMeasures, medianTable, consensusTable, tableMap, scoreMap, FORMAT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoteIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
