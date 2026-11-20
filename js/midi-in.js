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

  // ett enkelt "piano": grundton + övertoner som klingar av
  function voice(ctx, dest, n, v, when) {
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

  async function render(notes, sampleRate = 44100) {
    if (!notes.length) return null;
    const t0 = Math.min(...notes.map(x => x.t)), end = Math.max(...notes.map(x => x.t + x.d)) - t0 + 1.2;
    const ctx = new OfflineAudioContext(1, Math.ceil(end * sampleRate), sampleRate);
    const bus = ctx.createDynamicsCompressor(); bus.threshold.value = -14; bus.ratio.value = 4; bus.connect(ctx.destination);
    notes.forEach(x => { const stop = voice(ctx, bus, x.n, x.v || 90, x.t - t0); stop(x.t - t0 + x.d); });
    return ctx.startRendering();
  }
  const hasChords = notes => notes.some((x, i) => i && notes.slice(0, i).some(y => y.t + y.d > x.t + 0.03));

  root.MidiIn = { supported, connect, inject, onDevices, start, stop, setMonitor, render, playNote: voice, hasChords, names,
    get recording() { return !!rec; } };
})(window);
