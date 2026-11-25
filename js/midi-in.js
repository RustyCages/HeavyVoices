// Spela in från ett MIDI-keyboard eller digitalpiano direkt i webbläsaren (Web MIDI – Chrome, Edge, Opera; inte Safari/iPhone).
// Används av Studio (nytt spår med pianoljud + MIDI-fil) och Röstövning (noter till vald stämma).
//
//   MidiIn.supported()                       → true om webbläsaren har Web MIDI
//   await MidiIn.connect()                   → namnen på anslutna MIDI-enheter (frågar om lov första gången)
//   MidiIn.onDevices(names => …)             → anropas när en enhet kopplas in eller ur
//   MidiIn.start({ clock, onNote, ctx, monitor })
//       clock()   = sidans tid i sekunder just nu (låtens/stämmans tid) – noterna får den tiden
//       onNote(n, on, count) = valfri, vid varje tangent
//       ctx/monitor = AudioContext + true → tangenterna hörs i datorn (för keyboard utan egna högtalare)
//   MidiIn.stop()                            → [{ t, d, n, v }] sorterat på t (sekunder, MIDI-nummer, styrka 1–127)
//   MidiIn.recording                         → true medan inspelningen pågår
//   await MidiIn.render(notes, sampleRate)   → AudioBuffer med enkelt pianoljud (t = 0 är första noten)
//   MidiIn.playNote(ctx, dest, n, v, when)   → stop(when) – ett pianoljud direkt
//   await MidiIn.loadPiano(ctx)              → laddar det valda ljudet (piano ~2 MB, kör ~0,5 MB, cachas); till dess ett enkelt ljud
//   MidiIn.setInstrument('piano'|'aah'|'ooh') / MidiIn.instrument / MidiIn.INSTR
//   await MidiIn.render(notes, sr, instrument) → AudioBuffer med valt ljud
//   MidiIn.setReverb(on) / MidiIn.reverb     → rumsklang på/av (sparas i webbläsaren)
//   MidiIn.inject(n, on, v)                  → en ton från pianot på skärmen (spelas in om inspelning pågår)
//   MidiIn.hasChords(notes)                  → true om noter ligger samtidigt (ackord / två händer)
(function (root) {
  let access = null, rec = null, devCb = null;
  const supported = () => !!(navigator.requestMIDIAccess && window.isSecureContext);
  const names = () => access ? [...access.inputs.values()].filter(i => i.state !== 'disconnected').map(i => i.name || 'MIDI-enhet') : [];

  async function connect() {
    if (!supported()) throw new Error('Webbläsaren saknar Web MIDI – använd Chrome eller Edge på en dator.');
    if (!access) {
      access = await navigator.requestMIDIAccess({ sysex: false });
      access.onstatechange = () => { hook(); if (devCb) devCb(names()); };
    }
    hook();
    return names();
  }
  function hook() { if (access) access.inputs.forEach(i => { i.onmidimessage = onMsg; }); }
  function onDevices(cb) { devCb = cb; }

  // ---------- inspelade ljud: en sampling var tredje halvton, tonerna däremellan räknas fram ----------
  //   piano: Salamander Grand Piano (Alexander Holm, CC BY 3.0)
  //   dam/herr/kor: Sonatina Symphonic Orchestra, Mattias Westlund (CC Sampling Plus 1.0)
  //   aah/ooh: körljud ur FluidR3 GM (Frank Wen, via midi-js-soundfonts, CC BY 3.0) – loopas så att tonen kan hållas
  const INSTR = {
    piano: { name: 'Piano', dir: '/audio/piano/', pcs: [['C', 0], ['Ds', 3], ['Fs', 6], ['A', 9]], lo: 21, hi: 108 },
    aah: { name: 'Kör "aah"', dir: '/audio/choir/aah/', pcs: [['C', 0], ['Eb', 3], ['Gb', 6], ['A', 9]], lo: 36, hi: 84, loop: true },
    ooh: { name: 'Kör "ooh"', dir: '/audio/choir/ooh/', pcs: [['C', 0], ['Eb', 3], ['Gb', 6], ['A', 9]], lo: 36, hi: 84, loop: true },
    // Sonatina Symphonic Orchestra (Mattias Westlund, CC Sampling Plus 1.0): riktig dam- och herrkör
    dam: { name: 'Damkör', dir: '/audio/choir/dam/', files: [['G4', 67], ['As4', 70], ['Cs5', 73], ['E5', 76], ['G5', 79], ['As5', 82], ['C6', 84]], loop: true },
    herr: { name: 'Herrkör', dir: '/audio/choir/herr/', files: [['G2', 43], ['As2', 46], ['Cs3', 49], ['E3', 52], ['G3', 55], ['As3', 58], ['Cs4', 61], ['E4', 64]], loop: true },
    // blandad: herrkör under D4, damkör från D4 – som en riktig kör
    kor: { name: 'Blandad kör', mix: [['herr', 0, 61], ['dam', 62, 127]], loop: true },
  };
  const bank = {}, banking = {};   // ljud → Map(midi → { buf, a, b })
  let instr = 'piano'; try { const v = localStorage.getItem('hv-midi-instr'); if (INSTR[v]) instr = v; } catch (e) {}
  // loopa ett stycke mitt i tonen; slutet av stycket blandas mjukt in mot det som ligger före starten → inget klick vid hoppet
  function makeLoop(ctx, buf) {
    const sr = buf.sampleRate, len = buf.length, a = Math.floor(sr * Math.min(0.9, buf.duration * 0.3)), b = Math.floor(len - sr * 0.35), x = Math.floor(sr * 0.25);
    if (b - a < sr * 0.6 || a < x) return { buf, a: 0, b: 0 };
    const out = ctx.createBuffer(buf.numberOfChannels, len, sr);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c).slice();
      for (let k = 0; k < x; k++) { const w = k / x, i = b - x + k; d[i] = d[i] * Math.sqrt(1 - w) + d[a - x + k] * Math.sqrt(w); }
      out.copyToChannel(d, c);
    }
    return { buf: out, a: a / sr, b: b / sr };
  }
  function loadInstrument(ctx, name = instr) {
    const def = INSTR[name]; if (!def) return Promise.resolve(false);
    if (bank[name]) return Promise.resolve(true);
    if (!banking[name]) banking[name] = (async () => {
      if (def.mix) { const ok = await Promise.all(def.mix.map(([k]) => loadInstrument(ctx, k))); if (ok.includes(false)) throw new Error('delljud saknas'); bank[name] = true; return true; }
      const list = def.files ? def.files.slice() : [];
      if (!def.files) for (let o = 0; o <= 8; o++) def.pcs.forEach(([p, pc]) => { const m = 12 * (o + 1) + pc; if (m >= def.lo && m <= def.hi) list.push([p + o, m]); });
      const map = new Map();
      await Promise.all(list.map(async ([file, m]) => {
        const r = await fetch(def.dir + file + '.mp3'); if (!r.ok) throw new Error('HTTP ' + r.status);
        const buf = await ctx.decodeAudioData(await r.arrayBuffer());
        map.set(m, def.loop ? makeLoop(ctx, buf) : { buf, a: 0, b: 0 });
      }));
      bank[name] = map; return true;
    })().catch(e => { banking[name] = null; console.warn(`Ljudet ${def.name} kunde inte laddas – enkelt ljud används`, e); return false; });
    return banking[name];
  }
  const loadPiano = (ctx) => loadInstrument(ctx, instr);   // det valda ljudet (namnet kvar för äldre anrop)
  function setInstrument(name) { if (INSTR[name]) { instr = name; try { localStorage.setItem('hv-midi-instr', name); } catch (e) {} } }
  // rumsklang: ett genererat rum (ingen fil), blandas in efter torrt ljud
  let reverbOn = true; try { reverbOn = localStorage.getItem('hv-piano-reverb') !== '0'; } catch (e) {}
  const outs = new WeakMap();
  function impulse(ctx, sec = 2.2) {
    const sr = ctx.sampleRate, n = Math.floor(sr * sec), b = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) { const x = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 3.2) * (i < sr * 0.012 ? i / (sr * 0.012) : 1); } }
    return b;
  }
  function out(ctx) {
    let o = outs.get(ctx);
    if (!o) {
      const input = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver(), pre = ctx.createDelay(0.1);
      conv.buffer = impulse(ctx); pre.delayTime.value = 0.018;
      input.connect(dry); dry.connect(ctx.destination);
      input.connect(pre); pre.connect(conv); conv.connect(wet); wet.connect(ctx.destination);
      o = { input, dry, wet }; outs.set(ctx, o);
    }
    o.wet.gain.value = reverbOn ? 0.32 : 0; o.dry.gain.value = reverbOn ? 0.9 : 1;
    return o.input;
  }
  function setReverb(on) { reverbOn = !!on; try { localStorage.setItem('hv-piano-reverb', on ? '1' : '0'); } catch (e) {} }
  // en ton från samplingarna (närmaste sampling, tonhöjden justeras). Piano: dämpas vid släpp. Kör: loopas så länge tonen hålls, tonar ut vid släpp.
  function sampleVoice(ctx, dest, n, v, when, name) {
    if (INSTR[name].mix) { const part = INSTR[name].mix.find(([, a, b]) => n >= a && n <= b); return sampleVoice(ctx, dest, n, v, when, part[0]); }
    const map = bank[name], def = INSTR[name];
    let best = null, bd = 99;
    map.forEach((_, m) => { const d = Math.abs(n - m); if (d < bd) { bd = d; best = m; } });
    const smp = map.get(best), rate = Math.pow(2, (n - best) / 12), g = ctx.createGain();
    const amp = def.loop ? 0.5 + 0.9 * ((v || 90) / 127) : 0.25 + 1.75 * Math.pow((v || 90) / 127, 1.6);
    const srcs = [];
    const add = (cents, delay, gain) => {
      const src = ctx.createBufferSource(), sg = ctx.createGain();
      src.buffer = smp.buf; src.playbackRate.value = rate * Math.pow(2, cents / 1200);
      if (smp.b > smp.a) { src.loop = true; src.loopStart = smp.a; src.loopEnd = smp.b; }
      sg.gain.value = gain; src.connect(sg); sg.connect(g); src.start(when + delay); srcs.push(src);
    };
    add(0, 0, 1);
    if (def.loop) add(7, 0.018, 0.55);   // en till sångare, lite ostämd och sen – mer körkänsla
    g.gain.setValueAtTime(def.loop ? 0 : amp, when);
    if (def.loop) g.gain.linearRampToValueAtTime(amp, when + 0.07);
    g.connect(dest);
    return (end) => {
      end = Math.max(end ?? ctx.currentTime, when + 0.02);
      g.gain.cancelScheduledValues(end); g.gain.setValueAtTime(amp, end);
      g.gain.setTargetAtTime(0, end, def.loop ? 0.09 : n > 88 ? 0.3 : 0.12);   // pianots diskant saknar dämpare
      srcs.forEach(src => { try { src.stop(end + 1.5); } catch (e) {} });
    };
  }
  function voice(ctx, dest, n, v, when, name = instr) {
    if (dest === undefined || dest === ctx.destination) dest = out(ctx);
    if (bank[name]) return sampleVoice(ctx, dest, n, v, when, name);
    return synthVoice(ctx, dest, n, v, when);
  }
  // reserv tills samplingarna laddats: grundton + övertoner som klingar av
  function synthVoice(ctx, dest, n, v, when) {
    const f = 440 * Math.pow(2, (n - 69) / 12), g = ctx.createGain(), amp = 0.06 + 0.22 * (v / 127);
    const decay = Math.max(0.6, 3.2 - (n - 40) * 0.035);   // basen klingar längre än diskanten
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(amp, when + 0.006);
    g.gain.setTargetAtTime(amp * 0.25, when + 0.006, decay / 3);
    g.connect(dest);
    const parts = [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12], [4, 'sine', 0.05]];
    const oscs = parts.map(([k, type, a]) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type; o.frequency.value = f * k; og.gain.value = a;
      o.connect(og); og.connect(g); o.start(when); return o;
    });
    return (end) => {
      end = Math.max(end ?? ctx.currentTime, when + 0.02);
      g.gain.cancelScheduledValues(end); g.gain.setTargetAtTime(0, end, 0.08);
      oscs.forEach(o => o.stop(end + 0.6));
    };
  }

  function onMsg(e) {
    if (!rec) return;
    const [st, a, b] = e.data, cmd = st & 0xF0;
    const t = rec.c0 + ((e.timeStamp || performance.now()) - rec.p0) / 1000;
    if (cmd === 0x90 && b > 0) {   // tangent ned
      if (rec.open.has(a)) release(a, t);
      rec.open.set(a, { t, n: a, v: b, stop: rec.monitor && !e.virtual ? voice(rec.ctx, rec.ctx.destination, a, b, rec.ctx.currentTime) : null });
      if (rec.onNote) rec.onNote(a, true, rec.notes.length + rec.open.size);
    } else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) {   // tangent upp
      if (rec.pedal) rec.held.add(a); else release(a, t);
      if (rec.onNote) rec.onNote(a, false, rec.notes.length + rec.open.size);
    } else if (cmd === 0xB0 && a === 64) {   // högerpedalen (sustain)
      rec.pedal = b >= 64;
      if (!rec.pedal) { rec.held.forEach(n => { if (rec.open.has(n)) release(n, t); }); rec.held.clear(); }
    }
  }
  function release(n, t) {
    const o = rec.open.get(n); if (!o) return;
    rec.open.delete(n); rec.held.delete(n);
    if (o.stop) o.stop();
    rec.notes.push({ t: o.t, d: Math.max(0.03, t - o.t), n: o.n, v: o.v });
  }

  // pianot på skärmen: samma väg som ett riktigt keyboard (ljudet spelar pianot självt)
  function injectPedal(on) { onMsg({ data: [0xB0, 64, on ? 127 : 0], timeStamp: performance.now(), virtual: true }); }
  function inject(n, on, v = 96) { onMsg({ data: on ? [0x90, n, v] : [0x80, n, 0], timeStamp: performance.now(), virtual: true }); }
  function start({ clock, onNote, ctx, monitor } = {}) {
    rec = { c0: clock ? clock() : 0, p0: performance.now(), notes: [], open: new Map(), held: new Set(), pedal: false, onNote, ctx, monitor: !!(monitor && ctx) };
  }
  function stop() {
    if (!rec) return [];
    const t = rec.c0 + (performance.now() - rec.p0) / 1000;
    [...rec.open.keys()].forEach(n => release(n, t));
    const notes = rec.notes.map(x => ({ t: Math.round(x.t * 1000) / 1000, d: Math.round(x.d * 1000) / 1000, n: x.n, v: x.v })).sort((x, y) => x.t - y.t || x.n - y.n);
    rec = null;
    return notes;
  }
  function setMonitor(on, ctx) { if (rec) { rec.monitor = !!(on && (ctx || rec.ctx)); if (ctx) rec.ctx = ctx; } }

  async function render(notes, sampleRate = 44100, name = instr) {
    if (!notes.length) return null;
    const t0 = Math.min(...notes.map(x => x.t)), end = Math.max(...notes.map(x => x.t + x.d)) - t0 + 1.2;
    await loadInstrument(new OfflineAudioContext(1, 1, sampleRate), name);
    const ctx = new OfflineAudioContext(2, Math.ceil((end + 2) * sampleRate), sampleRate);
    const bus = ctx.createDynamicsCompressor(); bus.threshold.value = -12; bus.ratio.value = 3; bus.connect(out(ctx));
    notes.forEach(x => { const stop = voice(ctx, bus, x.n, x.v || 90, x.t - t0, name); stop(x.t - t0 + x.d); });
    return ctx.startRendering();
  }

  const hasChords = notes => notes.some((x, i) => i && notes.slice(0, i).some(y => y.t + y.d > x.t + 0.03));

  root.MidiIn = { supported, connect, inject, injectPedal, loadPiano, loadInstrument, setInstrument, INSTR, get instrument() { return instr; }, setReverb, get reverb() { return reverbOn; }, get pianoReady() { return !!bank[instr]; }, out, onDevices, start, stop, setMonitor, render, playNote: voice, hasChords, names,
    get recording() { return !!rec; } };
})(window);
