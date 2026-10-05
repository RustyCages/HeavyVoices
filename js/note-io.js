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
  function toMidi(notes, meta = {}) {
    const TPS = 960;
    const ev = [];
    notes.forEach(x => {
      const on = Math.round(x.t * TPS), off = Math.max(on + 1, Math.round((x.t + x.d) * TPS));
      const n = Math.max(0, Math.min(127, Math.round(x.n)));
      ev.push({ tick: on, ord: 1, bytes: [0x90, n, 90] });
      ev.push({ tick: off, ord: 0, bytes: [0x80, n, 0] });   // av före på vid samma tick
    });
    ev.sort((a, b) => a.tick - b.tick || a.ord - b.ord);
    const trk = [];
    const name = utf8(meta.stem ? `${meta.song || ''} – ${meta.stem}`.trim() : (meta.song || 'Heavy Voices'));
    trk.push(0, 0xFF, 0x03, ...vlq(name.length), ...name);              // spårnamn
    trk.push(0, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20);                   // tempo 120 bpm
    trk.push(0, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);             // 4/4
    trk.push(0, 0xC0, 52);                                             // ljud: kör "aah"
    let last = 0;
    ev.forEach(e => { trk.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; });
    trk.push(0, 0xFF, 0x2F, 0x00);
    const head = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xE0];  // MThd, format 0, 1 spår, 480 ppq
    const tlen = trk.length;
    return new Uint8Array([...head, 0x4D, 0x54, 0x72, 0x6B, (tlen >>> 24) & 255, (tlen >>> 16) & 255, (tlen >>> 8) & 255, tlen & 255, ...trk]);
  }

  // ---------- MIDI-import ----------
  // Returnerar [{ name, channel, notes }] – ett spår per MIDI-spår/kanal som har noter (trummor hoppas över)
  function fromMidi(buf) {
    const b = new Uint8Array(buf);
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
          if (mt === 0x03 && !names[t]) names[t] = new TextDecoder().decode(b.slice(p, p + l));
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
    return notes.map(x => ({ t: Math.max(0, r2(x.t)), d: Math.max(0.05, r2(x.d)), n: Math.round(x.n) }))
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

  const api = { toJson, fromJson, toMidi, fromMidi, topLine, saveFile, FORMAT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoteIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
