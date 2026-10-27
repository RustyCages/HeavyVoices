// Skapa notblad (MusicXML) från noterna i Röstövningen.
// Noter = [{ t: start i sekunder (stämfilens tid), d: längd, n: MIDI-nummer, w?: ord }]
// Noterna läggs i låtens taktrutnät (songs.bpm / beat_offset / beats_per_bar) och avrundas till
// åttondelar eller sextondelar. Tonart gissas från tonerna, klav väljs efter stämma.
// Resultatet är ett övningsnotblad – öppnas i MuseScore för finputs/utskrift, visas i spelarens Noter-läge.
//
//   Notblad.build({ title, parts: [{ name, notes, lyr?, offset }], bpm, beatOffset, beatsPerBar, grid })
//     offset     = stämfilens förskjutning mot låtens tidslinje (s)
//     beatOffset = taktettan på låtens tidslinje (s)
//     grid       = 2 (åttondelar) eller 4 (sextondelar)
//   → { xml, key, bars, partMeasures(k), stats }

(function (root) {
  const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const MAJ_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
  const SV = ['C', 'C#', 'D', 'Ess', 'E', 'F', 'F#', 'G', 'Ass', 'A', 'B', 'H'];
  const SHARP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
  const FLAT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];
  // längd i sextondelar → notvärde
  const TYPES = { 16: ['whole', 0], 12: ['half', 1], 8: ['half', 0], 6: ['quarter', 1], 4: ['quarter', 0], 3: ['eighth', 1], 2: ['eighth', 0], 1: ['16th', 0] };

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const mod12 = n => ((Math.round(n) % 12) + 12) % 12;

  // ---------- tonart ----------
  function detectKey(notes) {
    const h = new Array(12).fill(0);
    notes.forEach(n => { h[mod12(n.n)] += n.d; });
    if (h.every(v => v === 0)) return { fifths: 0, minor: false, name: 'C-dur' };
    const corr = (prof, k) => {
      const ys = h.map((_, i) => prof[(i - k + 12) % 12]);
      const mx = h.reduce((a, b) => a + b) / 12, my = ys.reduce((a, b) => a + b) / 12;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < 12; i++) { num += (h[i] - mx) * (ys[i] - my); dx += (h[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
      return num / Math.sqrt(dx * dy || 1);
    };
    let best = { r: -2, tonic: 0, minor: false };
    for (let k = 0; k < 12; k++) {
      const a = corr(KS_MAJ, k), b = corr(KS_MIN, k);
      if (a > best.r) best = { r: a, tonic: k, minor: false };
      if (b > best.r) best = { r: b, tonic: k, minor: true };
    }
    const majTonic = best.minor ? (best.tonic + 3) % 12 : best.tonic;
    const fifths = MAJ_FIFTHS[majTonic];   // Fiss-dur skrivs med 6♯
    const name = (best.minor ? SV[best.tonic].toLowerCase() : SV[best.tonic]) + (best.minor ? '-moll' : '-dur');
    return { fifths, minor: best.minor, name, confidence: Math.round(best.r * 100) / 100 };
  }
  function keyFromFifths(fifths, minor) {
    const majTonic = Object.keys(MAJ_FIFTHS).map(Number).find(k => MAJ_FIFTHS[k] === fifths) ?? 0;
    const tonic = minor ? (majTonic + 9) % 12 : majTonic;
    return { fifths, minor: !!minor, name: (minor ? SV[tonic].toLowerCase() : SV[tonic]) + (minor ? '-moll' : '-dur') };
  }

  function spell(n, fifths) {
    const [step, alter] = (fifths < 0 ? FLAT : SHARP)[mod12(n)];
    // oktaven följer notnamnet (Cb/B# förekommer inte i tabellerna ovan)
    return { step, alter, octave: Math.floor(Math.round(n) / 12) - 1 };
  }

  // ---------- klav ----------
  function clefFor(name, notes) {
    const s = String(name || '').toLowerCase();
    if (/\bbas|^bas|bass|baryton/.test(s)) return 'F';
    if (/tenor/.test(s)) return 'G8';
    if (/sopran|alt|mezzo|diskant/.test(s)) return 'G';
    const ns = notes.map(n => n.n).sort((a, b) => a - b);
    const med = ns.length ? ns[Math.floor(ns.length / 2)] : 64;
    return med >= 60 ? 'G' : med >= 52 ? 'G8' : 'F';
  }
  function clefXml(c) {
    if (c === 'F') return '<clef><sign>F</sign><line>4</line></clef>';
    if (c === 'G8') return '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>';
    return '<clef><sign>G</sign><line>2</line></clef>';
  }

  // ---------- taktföljning ----------
  // Inspelningen följer sällan låtens inställda tempo exakt (och glider ofta under låten). Rutnätet får
  // därför följa sångarnas notstarter: för varje takt mäts hur långt starterna ligger från närmaste
  // åttondel, och rutnätet flyttas en bit åt det hållet (alla stämmor tillsammans). Första taktettan
  // ligger där admin satt den. dev(t) = hur mycket rutnätet är förskjutet vid låttiden t.
  function trackGrid(onsets, o, barU) {
    const e8 = 30 / o.bpm, barSec = barU * 15 / o.bpm;
    const ts = onsets.slice().sort((a, b) => a - b);
    // fast rutnät (avstängt eller för få noter att följa)
    if (ts.length < 6 || o.follow === false) return {
      barDev: () => 0,
      locate: t => { const v = (t - o.beatOffset) / barSec, k = Math.floor(v); return { k, u: v - k }; },
    };
    const k0 = Math.floor((ts[0] - o.beatOffset) / barSec) - 1, k1 = Math.ceil((ts[ts.length - 1] - o.beatOffset) / barSec) + 1;
    const devs = new Map();
    let dev = 0;
    const median = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    // från taktettan och framåt, sedan bakåt för takterna före
    const step = (k, from) => {
      const s0 = o.beatOffset + k * barSec + from, s1 = s0 + barSec;
      const res = ts.filter(t => t >= s0 - e8 / 2 && t < s1 - e8 / 2).map(t => {
        const x = (t - s0) / e8;
        return (x - Math.round(x)) * e8;
      });
      let d = from;
      if (res.length >= 3) d = from + Math.max(-0.4 * e8, Math.min(0.4 * e8, median(res))) * 0.6;
      return d;
    };
    // första takten mäts också (sångarna ligger ofta lite före/efter taktettan som admin satt)
    const d0 = step(0, 0);
    devs.set(0, d0);
    dev = d0; for (let k = 0; k <= k1; k++) { dev = step(k, dev); devs.set(k + 1, dev); }
    dev = d0; for (let k = -1; k >= k0; k--) { dev = step(k, dev); devs.set(k, dev); }
    // utjämning (snitt med grannarna) så att rutnätet inte hoppar mellan takterna
    const keys = [...devs.keys()].sort((a, b) => a - b), sm = new Map();
    keys.forEach(k => { const v = [k - 1, k, k + 1].filter(j => devs.has(j)).map(j => devs.get(j)); sm.set(k, v.reduce((a, b) => a + b) / v.length); });
    const barDev = k => sm.has(k) ? sm.get(k) : (k < keys[0] ? sm.get(keys[0]) : sm.get(keys[keys.length - 1]));
    // dev vid låttiden t: linjärt mellan taktstarterna (taktstarten själv är förskjuten)
    const dev_t = t => {
      let k = Math.floor((t - o.beatOffset) / barSec);
      for (let it = 0; it < 3; it++) {   // rätta k om förskjutningen flyttat taktgränsen
        const a = o.beatOffset + k * barSec + barDev(k);
        if (t < a) k--; else if (t >= o.beatOffset + (k + 1) * barSec + barDev(k + 1)) k++; else break;
      }
      const a = o.beatOffset + k * barSec + barDev(k), b = o.beatOffset + (k + 1) * barSec + barDev(k + 1);
      const u = Math.max(0, Math.min(1, (t - a) / Math.max(1e-6, b - a)));
      // positionen i takten räknas om så att takten sträcks mellan a och b
      return { k, u };
    };
    return { barDev, locate: dev_t };
  }

  // ---------- noter → rutnät ----------
  // Alla positioner i sextondelar från taktettan (kan vara negativa = upptakt/intro).
  // Starter läggs helst på åttondelar – sextondel bara när noten tydligt ligger mitt emellan.
  // Slut: legato fram till nästa not om luckan är kortare än en åttondel (andning/analys), annars avrundat.
  function quantize(part, o) {
    const unit = 60 / o.bpm / 4, barU = o.barU;
    // låttid → sextondelar från taktettan (rutnätet följer inspelningen, se trackGrid)
    const x = s => { const { k, u } = o.grid_.locate(s + (part.offset || 0)); return (k + u) * barU; };
    // långa noter (≥ en åttondel) som börjar en sextondel fel är nästan alltid en tidig/sen insats
    const snapStart = (v, len) => {
      const q2 = Math.round(v / 2) * 2;
      if (o.grid === 2 || Math.abs(v - q2) <= (len >= 3 ? 0.85 : 0.62)) return q2;
      return Math.round(v);
    };
    // slut före en paus: helst på slag, annars åttondel (exakt slut spelar mindre roll)
    const snapEnd = v => {
      const q4 = Math.round(v / 4) * 4, q2 = Math.round(v / 2) * 2;
      if (Math.abs(v - q4) <= 1.1) return q4;
      return o.grid === 2 || Math.abs(v - q2) <= 0.8 ? q2 : Math.round(v);
    };
    const raw = (part.notes || [])
      .filter(n => n && isFinite(n.t) && isFinite(n.d) && n.d > 0 && isFinite(n.n))
      .map(n => ({ xa: x(n.t), xb: x(n.t + n.d), n: Math.round(n.n), t: n.t, d: n.d, w: n.w ? String(n.w).trim() : '' }))
      .sort((p, q) => p.xa - q.xa);
    const out = []; let dropped = 0;
    raw.forEach(r => {
      let a = snapStart(r.xa, r.xb - r.xa);
      const p = out[out.length - 1];
      if (p && a <= p.a) {
        // två noter på samma åttondel: flytta den senare en sextondel om den låg efter, annars slå ihop
        if (o.grid === 4 && r.xa > p.xa + 0.5) a = p.a + 1;
        else { dropped++; if (!p.w && r.w) p.w = r.w; if (r.xb > p.xb) p.xb = r.xb; return; }
      }
      out.push({ ...r, a });
    });
    out.forEach((r, i) => {
      const next = out[i + 1];
      let b = snapEnd(r.xb);
      if (next && (next.a - r.xb < 2.2 || b > next.a)) b = next.a;   // legato / överlapp
      if (b <= r.a) b = r.a + (o.grid === 2 ? 2 : 1);
      if (next && b > next.a) b = next.a;
      r.b = b;
    });
    const notes = out.filter(r => r.b > r.a);
    dropped += out.length - notes.length;
    // sångtext: textrutorna (ord) läggs på första noten inom rutan, följande noter i rutan = melism
    const lyr = Array.isArray(part.lyr) && part.lyr.length ? part.lyr : null;
    if (lyr) {
      notes.forEach(r => { r.w = ''; });
      lyr.forEach(bx => {
        const w = String(bx.w || '').trim(); if (!w) return;
        const t0 = Number(bx.t) || 0, t1 = t0 + Math.max(0.05, Number(bx.d) || 0.3);
        const inBox = notes.filter(r => r.t >= t0 - 0.15 && r.t < t1 - 0.02);
        const first = inBox.find(r => !r.w) || (inBox.length ? null : nearest(notes, t0));
        if (!first) return;
        first.w = w;
        first.melisma = inBox.filter(r => r !== first).length > 0;
      });
    }
    // delade ord ("lju..." | "set", "wa-" | "ter") blir stavelser med bindestreck i notskriften
    let cont = false;
    notes.forEach(r => {
      if (!r.w) return;
      const more = /(\.\.\.|…|-)$/.test(r.w);
      r.w = r.w.replace(/(\.\.\.|…|-)+$/, '').trim() || r.w;
      r.syl = cont ? (more ? 'middle' : 'end') : (more ? 'begin' : 'single');
      cont = more;
    });
    let err = 0; notes.forEach(r => { err += Math.abs(r.a - r.xa) * unit; });   // ungefärligt (ms)
    return { notes, dropped, meanErrMs: notes.length ? Math.round(err / notes.length * 1000) : 0 };
  }
  function nearest(list, t) {
    let best = null, bd = 0.4;
    list.forEach(x => { const d = Math.abs(x.t - t); if (d < bd && !x.w) { bd = d; best = x; } });
    return best;
  }

  // Delar en längd från position p i takten i läsbara notvärden (sextondelar).
  function decompose(p, L, barU) {
    const out = [];
    while (L > 0) {
      let v;
      if (p % 4 !== 0) {
        v = Math.min(L, 4 - (p % 4));                 // off-beat: fyll upp till nästa slag
        if (v === 3 && p % 2 === 0) v = 2;
      } else {
        const room = Math.min(L, barU - p);
        const ok = c => c <= room && (
          c <= 6 ||
          (c === 8 && (barU % 8 !== 0 || p % 8 === 0)) ||
          (c === 12 && p === 0) ||
          (c === 16 && p === 0));
        v = [16, 12, 8, 6, 4, 3, 2, 1].find(ok) || 1;
      }
      out.push(v); p += v; L -= v;
    }
    return out;
  }

  // ---------- bygg MusicXML ----------
  function build(opts) {
    const o = {
      bpm: Number(opts.bpm) || 0, beatOffset: Number(opts.beatOffset) || 0,
      beatsPerBar: Math.max(1, Math.min(12, Number(opts.beatsPerBar) || 4)), grid: Number(opts.grid) === 2 ? 2 : 4,
    };
    if (!(o.bpm >= 20 && o.bpm <= 400)) throw new Error('Låten har inget tempo – sätt det i 🥁 Tempo & klick först');
    const barU = o.beatsPerBar * 4;
    const songBpm = o.bpm;
    o.barU = barU; o.follow = opts.follow !== false;
    const onsets = (opts.parts || []).flatMap(p => (p.notes || []).filter(n => n && isFinite(n.t) && n.d > 0).map(n => n.t + (p.offset || 0)));
    o.grid_ = trackGrid(onsets, o, barU);
    const unitSec = 60 / o.bpm / 4, barSec = barU * unitSec;

    const parts = (opts.parts || []).map(p => ({ ...p, q: quantize(p, o) })).filter(p => p.q.notes.length);
    if (!parts.length) throw new Error('Inga noter att göra notblad av');

    const all = parts.flatMap(p => p.q.notes);
    const minU = Math.min(...all.map(x => x.a)), maxU = Math.max(...all.map(x => x.b));
    const firstBar = Math.floor(minU / barU), lastBar = Math.floor((maxU - 1) / barU);
    const nBars = lastBar - firstBar + 1;
    const key = opts.key && Number.isFinite(opts.key.fifths) ? keyFromFifths(opts.key.fifths, opts.key.minor)
      : detectKey(parts.flatMap(p => p.q.notes.map(x => ({ n: x.n, d: x.b - x.a }))));

    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
      '<score-partwise version="4.0">\n' +
      `  <work><work-title>${esc(opts.title || 'Notblad')}</work-title></work>\n` +
      `  <identification><encoding><software>Heavy Voices – Skapa notblad</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding>` +
      '<miscellaneous><miscellaneous-field name="info">Skapat automatiskt från tonkurvan – övningsnotblad, kontrollera mot inspelningen.</miscellaneous-field></miscellaneous></identification>\n' +
      '  <part-list>\n' +
      parts.map((p, k) => `    <score-part id="P${k + 1}"><part-name>${esc(p.name || 'Stämma')}</part-name><score-instrument id="P${k + 1}-I1"><instrument-name>Voice</instrument-name></score-instrument><midi-instrument id="P${k + 1}-I1"><midi-program>53</midi-program></midi-instrument></score-part>\n`).join('') +
      '  </part-list>\n';

    parts.forEach((p, k) => {
      const clef = clefFor(p.name, p.q.notes);
      xml += `  <part id="P${k + 1}">\n`;
      // segment (noter och pauser) i absoluta sextondelar
      const segs = [];
      let cur = firstBar * barU;
      p.q.notes.forEach(x => {
        if (x.a > cur) segs.push({ a: cur, b: x.a, rest: true });
        segs.push({ a: x.a, b: x.b, n: x.n, w: x.w, syl: x.syl, melisma: x.melisma });
        cur = x.b;
      });
      if (cur < (lastBar + 1) * barU) segs.push({ a: cur, b: (lastBar + 1) * barU, rest: true });

      for (let m = 0; m < nBars; m++) {
        const b0 = (firstBar + m) * barU, b1 = b0 + barU;
        let body = '';
        if (m === 0) {
          body += `      <attributes><divisions>4</divisions><key><fifths>${key.fifths}</fifths><mode>${key.minor ? 'minor' : 'major'}</mode></key>` +
            `<time><beats>${o.beatsPerBar}</beats><beat-type>4</beat-type></time>${clefXml(clef)}</attributes>\n`;
          if (k === 0) body += `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(o.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(o.bpm * 100) / 100}"/></direction>\n`;
        }
        // bitar i den här takten
        const pieces = [];
        segs.forEach(s => {
          const a = Math.max(s.a, b0), b = Math.min(s.b, b1);
          if (b <= a) return;
          const lens = decompose(a - b0, b - a, barU);
          let pos = a - b0;
          lens.forEach((len, i) => {
            const firstOfNote = !s.rest && pos + b0 === s.a;
            const lastOfNote = !s.rest && pos + b0 + len === s.b;
            pieces.push({ pos, len, rest: s.rest, n: s.n,
              tieStop: !s.rest && !firstOfNote, tieStart: !s.rest && !lastOfNote,
              w: firstOfNote ? s.w : '', syl: s.syl, melisma: firstOfNote && (s.melisma || false) });
            pos += len;
          });
        });
        if (pieces.length === 1 && pieces[0].rest && pieces[0].len === barU) {
          body += `      <note><rest measure="yes"/><duration>${barU}</duration><voice>1</voice></note>\n`;
        } else {
          beams(pieces);
          pieces.forEach(pc => { body += noteXml(pc, key.fifths); });
        }
        xml += `    <measure number="${m + 1}">\n${body}`;
        if (m === nBars - 1) xml += '      <barline location="right"><bar-style>light-heavy</bar-style></barline>\n';
        xml += '    </measure>\n';
      }
      xml += '  </part>\n';
    });
    xml += '</score-partwise>\n';

    // takttabell för spelaren: notbladstid (s0/s1) ↔ stämfilens tid (a/b) per stämma
    const r3 = v => Math.round(v * 1000) / 1000;
    const partMeasures = k => {
      const off = parts[k] ? (parts[k].offset || 0) : 0;
      return Array.from({ length: nBars }, (_, m) => {
        const k = firstBar + m;
        const a = o.beatOffset + k * barSec + o.grid_.barDev(k) - off, b = o.beatOffset + (k + 1) * barSec + o.grid_.barDev(k + 1) - off;
        return { i: m, len: o.beatsPerBar, s0: r3(m * barSec), s1: r3((m + 1) * barSec), a: r3(a), b: r3(b) };
      });
    };
    return {
      xml, key, bars: nBars, partMeasures, bpm: songBpm,
      parts: parts.map(p => ({ name: p.name, clef: clefFor(p.name, p.q.notes), notes: p.q.notes.length, dropped: p.q.dropped, meanErrMs: p.q.meanErrMs })),
    };
  }

  // balkar: åttondelar/sextondelar inom samma slag
  function beams(pieces) {
    const beamable = pc => !pc.rest && pc.len < 4;
    for (let i = 0; i < pieces.length; i++) {
      if (!beamable(pieces[i])) continue;
      const beat = Math.floor(pieces[i].pos / 4);
      let j = i;
      while (j + 1 < pieces.length && beamable(pieces[j + 1]) && Math.floor(pieces[j + 1].pos / 4) === beat) j++;
      if (j > i) {
        const g = pieces.slice(i, j + 1);
        g.forEach((pc, k) => {
          pc.beam1 = k === 0 ? 'begin' : k === g.length - 1 ? 'end' : 'continue';
          if (pc.len === 1) {
            const prev = g[k - 1] && g[k - 1].len === 1, next = g[k + 1] && g[k + 1].len === 1;
            pc.beam2 = prev && next ? 'continue' : prev ? 'end' : next ? 'begin' : (k === 0 ? 'forward hook' : 'backward hook');
          }
        });
      }
      i = j;
    }
  }

  function noteXml(pc, fifths) {
    const [type, dots] = TYPES[pc.len] || ['16th', 0];
    let s = '      <note>';
    if (pc.rest) s += '<rest/>';
    else {
      const sp = spell(pc.n, fifths);
      s += `<pitch><step>${sp.step}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch>`;
    }
    s += `<duration>${pc.len}</duration>`;
    if (pc.tieStop) s += '<tie type="stop"/>';
    if (pc.tieStart) s += '<tie type="start"/>';
    s += `<voice>1</voice><type>${type}</type>` + '<dot/>'.repeat(dots);
    if (pc.beam1) s += `<beam number="1">${pc.beam1}</beam>`;
    if (pc.beam2) s += `<beam number="2">${pc.beam2}</beam>`;
    if (pc.tieStart || pc.tieStop) s += '<notations>' + (pc.tieStop ? '<tied type="stop"/>' : '') + (pc.tieStart ? '<tied type="start"/>' : '') + '</notations>';
    if (pc.w) s += `<lyric number="1"><syllabic>${pc.syl || 'single'}</syllabic><text>${esc(pc.w)}</text>${pc.melisma && (!pc.syl || pc.syl === 'single' || pc.syl === 'end') ? '<extend/>' : ''}</lyric>`;
    s += '</note>\n';
    return s;
  }

  const api = { build, detectKey, keyFromFifths, decompose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Notblad = api;
})(typeof window !== 'undefined' ? window : globalThis);
