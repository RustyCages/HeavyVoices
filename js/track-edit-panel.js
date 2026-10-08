// Redigeringsverktyg för ett valt spår – används av Stämsynk och Studio.
// Klipp (ta bort / beskär markerat), tystnad, baka in förskjutning, tempo (utan tonhöjdsändring),
// normalisera, ångra och original. Själva ändringen görs av sidan via onEdit.
//
//   const panel = TrackEditPanel.mount(el, {
//     getTrack, getSelection, getPosition, toast,
//     onEdit(track, clip, newOffsetMs|null, note), onUndo(track), onOriginal(track),
//     canUndo(track), isEdited(track), extraRows: '<div class="tool-row">…</div>'  // sidans egna rader (spara m.m.)
//   });  panel.refresh(); panel.status(msg, warn); panel.selInfo(text)
(function (root) {
  const CSS = `
  .tep { margin-top: 1rem; padding: 0.8rem 0.9rem; border: 1px solid var(--border); border-radius: 0.6rem; background: rgba(0,0,0,0.2); display: grid; gap: 0.6rem; }
  .tep h3 { margin: 0; font-size: 1rem; }
  .tep h3 .tep-name { color: var(--accent); }
  .tool-row { display: flex; flex-wrap: wrap; gap: 0.4rem 0.6rem; align-items: center; font-size: 0.85rem; }
  .tool-row .k { font-family: 'Roboto Condensed', sans-serif; font-weight: 700; font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); min-width: 5.5rem; }
  .tool-row button { font-size: 0.8rem; padding: 0.35rem 0.65rem; }
  .tool-row input[type=number] { width: 5rem; margin: 0; padding: 0.3rem 0.4rem; }
  .tool-row input[type=text] { width: 12rem; margin: 0; padding: 0.3rem 0.45rem; }
  .tool-row select { width: auto; margin: 0; padding: 0.3rem 0.45rem; font-size: 0.82rem; }
  .tep .status { font-size: 0.82rem; color: var(--text-muted); }
  .tep .status.warn { color: #facc15; }`;
  let cssDone = false;
  const fmt = (s, t) => (root.WaveTimeline ? root.WaveTimeline.fmt(s, t) : String(s));

  function mount(el, o) {
    if (!cssDone) { cssDone = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
    el.classList.add('tep');
    el.innerHTML = `
      <h3>Valt spår: <span class="tep-name">–</span> <span class="status" data-r="info"></span></h3>
      <div class="tool-row" data-g="edit">
        <span class="k">Klipp</span>
        <button type="button" class="btn-outline" data-a="cut" title="Ta bort det markerade (Delete)">✂ Ta bort markerat</button>
        <button type="button" class="btn-outline" data-a="crop" title="Behåll bara det markerade">⌗ Beskär till markerat</button>
        <span class="status" data-r="sel">Markera ett område med ▭ Markera</span>
      </div>
      <div class="tool-row" data-g="edit">
        <span class="k">Tystnad</span>
        <input type="number" data-r="sil" value="0.5" min="0.01" max="60" step="0.05"> s
        <button type="button" class="btn-outline" data-a="silStart">i början</button>
        <button type="button" class="btn-outline" data-a="silHead" title="Vid spelhuvudet">vid spelhuvudet</button>
        <button type="button" class="btn-outline" data-a="silEnd">i slutet</button>
        <button type="button" class="btn-outline" data-a="bake" title="Gör förskjutningen till en del av filen: tystnad läggs till eller början klipps bort, och förskjutningen blir 0">⇥ Baka in förskjutningen</button>
      </div>
      <div class="tool-row" data-g="edit">
        <span class="k">Ljud</span>
        <input type="number" data-r="pct" value="100" min="50" max="200" step="0.1"> %
        <span class="status">eller BPM</span> <input type="number" data-r="bpmFrom" min="30" max="300" step="0.1" placeholder="nu"> → <input type="number" data-r="bpmTo" min="30" max="300" step="0.1" placeholder="ska bli">
        <button type="button" class="btn-outline" data-a="tempo" title="Ändrar tempot utan att ändra tonhöjden">⏱ Ändra tempo</button>
        <button type="button" class="btn-outline" data-a="norm" title="Höj volymen så att den starkaste toppen hamnar strax under max">📶 Normalisera</button>
      </div>
      <div class="tool-row" data-g="edit">
        <span class="k">Ändringar</span>
        <button type="button" class="btn-outline" data-a="undo" title="Ångra (Ctrl+Z)">↶ Ångra</button>
        <button type="button" class="btn-outline" data-a="orig" title="Tillbaka till filen som den var">⟲ Original</button>
        <span class="status" data-r="status"></span>
      </div>
      ${o.extraRows || ''}`;
    const $ = s => el.querySelector(s);
    const status = (msg, warn) => { const s = $('[data-r=status]'); s.textContent = msg || ''; s.classList.toggle('warn', !!warn); };
    const dur = tr => tr.clip ? AudioEdit.duration(tr.clip) : 0;
    const offS = tr => (tr.offsetMs || 0) / 1000;
    const fileT = (tr, t) => Math.max(0, Math.min(dur(tr), t - offS(tr)));
    const toast = m => (o.toast ? o.toast(m) : alert(m));
    function needSel() {
      const tr = o.getTrack(), s = o.getSelection();
      if (!s || s.track !== tr || Math.abs(s.b - s.a) < 0.01) { toast('Markera först ett område i det valda spåret (▭ Markera och dra)'); return null; }
      return [fileT(tr, Math.min(s.a, s.b)), fileT(tr, Math.max(s.a, s.b))];
    }
    const sil = () => Math.max(0.01, Math.min(60, Number($('[data-r=sil]').value) || 0.5));
    const act = {
      cut() { const r = needSel(); if (!r) return; const tr = o.getTrack(); const c = AudioEdit.cut(tr.clip, r[0], r[1]); AudioEdit.fadeEdges(c, r[0]); o.onEdit(tr, c, null, `${(r[1] - r[0]).toFixed(2)} s borttaget`); },
      // det som blir kvar ska ligga kvar på samma ställe i låten → förskjutningen flyttas med
      crop() { const r = needSel(); if (!r) return; const tr = o.getTrack(); o.onEdit(tr, AudioEdit.crop(tr.clip, r[0], r[1]), (tr.offsetMs || 0) + Math.round(r[0] * 1000), 'Beskuret'); },
      silStart() { const tr = o.getTrack(); o.onEdit(tr, AudioEdit.insertSilence(tr.clip, 0, sil()), null, `${sil()} s tystnad i början`); },
      silEnd() { const tr = o.getTrack(); o.onEdit(tr, AudioEdit.insertSilence(tr.clip, dur(tr), sil()), null, `${sil()} s tystnad i slutet`); },
      silHead() {
        const tr = o.getTrack(), at = o.getPosition() - offS(tr);
        if (at <= 0 || at >= dur(tr)) { toast('Spelhuvudet ligger utanför spåret'); return; }
        o.onEdit(tr, AudioEdit.insertSilence(tr.clip, at, sil()), null, `${sil()} s tystnad vid ${fmt(o.getPosition(), true)}`);
      },
      bake() {
        const tr = o.getTrack(), off = offS(tr);
        if (!tr.offsetMs) { toast('Spåret har ingen förskjutning att baka in'); return; }
        if (off < 0 && -off >= dur(tr)) { toast('Förskjutningen är längre än spåret'); return; }
        o.onEdit(tr, off > 0 ? AudioEdit.insertSilence(tr.clip, 0, off) : AudioEdit.crop(tr.clip, -off, dur(tr)), 0,
          off > 0 ? `${off.toFixed(3)} s tystnad tillagd i början` : `${(-off).toFixed(3)} s klippt i början`);
      },
      async tempo() {
        const pct = Number($('[data-r=pct]').value);
        if (!(pct >= 50 && pct <= 200) || pct === 100) { toast('Ange ett tempo mellan 50 och 200 % (100 = oförändrat)'); return; }
        const tr = o.getTrack(), b = $('[data-a=tempo]');
        b.disabled = true; status(`Ändrar tempot till ${pct} %… (kan ta några sekunder)`);
        await new Promise(r => setTimeout(r, 40));
        try {
          o.onEdit(tr, AudioEdit.timeStretch(tr.clip, pct / 100), null, `Tempo ${pct} %`);
          $('[data-r=pct]').value = 100; $('[data-r=bpmFrom]').value = ''; $('[data-r=bpmTo]').value = '';
        } catch (e) { status('Kunde inte ändra tempot: ' + (e.message || e), true); }
        b.disabled = false;
      },
      norm() {
        const tr = o.getTrack(), c = AudioEdit.normalize(tr.clip, 0.89);
        if (!c) { toast('Spåret är tyst – inget att normalisera'); return; }
        o.onEdit(tr, c, null, 'Normaliserat');
      },
      undo() { o.onUndo(o.getTrack()); },
      orig() { const tr = o.getTrack(); if (confirm(`Släppa alla ändringar i ${tr.label} och gå tillbaka till hur filen var?`)) o.onOriginal(tr); },
    };
    el.querySelectorAll('[data-a]').forEach(b => { if (act[b.dataset.a]) b.addEventListener('click', () => act[b.dataset.a]()); });
    ['bpmFrom', 'bpmTo'].forEach(k => $(`[data-r=${k}]`).addEventListener('input', () => {
      const a = Number($('[data-r=bpmFrom]').value), b = Number($('[data-r=bpmTo]').value);
      if (a > 0 && b > 0) $('[data-r=pct]').value = Math.round(b / a * 10000) / 100;
    }));
    function selInfo() {
      const s = o.getSelection(), e = $('[data-r=sel]');
      if (!s || Math.abs(s.b - s.a) < 0.005) { e.textContent = 'Välj ▭ Markera och dra i ett spår'; return; }
      const a = Math.min(s.a, s.b), b = Math.max(s.a, s.b);
      e.textContent = `Markerat i ${s.track.label}: ${fmt(a, true)}–${fmt(b, true)} (${(b - a).toFixed(2)} s)`;
    }
    function refresh() {
      const tr = o.getTrack(), editable = !!(tr && tr.clip && !tr.readOnly);
      $('.tep-name').textContent = tr ? tr.label : '–';
      $('[data-r=info]').textContent = tr && tr.clip ? `${fmt(dur(tr), true)} · ${tr.clip.sampleRate} Hz · ${tr.clip.channels.length === 2 ? 'stereo' : 'mono'}${tr.readOnly ? ' · kan inte ändras här' : ''}` : '';
      el.querySelectorAll('[data-g=edit] button, [data-g=edit] input').forEach(b => { b.disabled = !editable; });
      if (editable) {
        $('[data-a=undo]').disabled = !(o.canUndo && o.canUndo(tr));
        $('[data-a=orig]').disabled = !(o.isEdited && o.isEdited(tr)) && !(o.canUndo && o.canUndo(tr));
        $('[data-a=bake]').disabled = !tr.offsetMs;
      }
      selInfo();
    }
    return { el, refresh, status, selInfo, cut: () => act.cut() };
  }
  root.TrackEditPanel = { mount };
})(window);
