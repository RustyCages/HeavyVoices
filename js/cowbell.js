// Koklocka för metronomen (Studio och Röstövning) – syntetisk, som en klassisk trummaskins cowbell:
// två fyrkantsvågor (ca 540 och 800 Hz) genom ett bandpassfilter, med kort, metallisk avklingning.
//
//   const nodes = Cowbell.hit(audioCtx, destination, när, taktetta?)   // returnerar oscillatorerna (för stop/disconnect)
(function (root) {
  function hit(ctx, dest, t, accent) {
    const f = accent ? 1.08 : 1;                     // taktettan lite ljusare och starkare
    const peak = accent ? 0.42 : 0.26;   // bandpassfiltret förstärker – håll toppen under ~0.8
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = o2.type = 'square';
    o1.frequency.value = 540 * f; o2.frequency.value = 800 * f;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100 * f; bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.0015);                // hårt anslag
    g.gain.exponentialRampToValueAtTime(peak * 0.32, t + 0.028);     // snabb första dämpning
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.32);           // metallisk svans
    o1.connect(hp); o2.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dest);
    o1.start(t); o2.start(t); o1.stop(t + 0.34); o2.stop(t + 0.34);
    return [o1, o2];
  }
  root.Cowbell = { hit };
})(window);
