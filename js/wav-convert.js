// WAV → MP3 i webbläsaren (inget skickas iväg). Används i Studio och Repertoar.
//   WavConvert.mount(el)   – el får en filväljare, kvalitetsval, Konvertera-knapp och resultatlista
(function (root) {
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  function mount(el) {
    el.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center;">
        <input type="file" data-r="files" accept=".wav,.wave,.aif,.aiff,.flac,audio/wav,audio/x-wav,audio/*" multiple style="flex:1 1 14rem; margin:0;">
        <select data-r="kbps" style="margin:0; width:auto;" title="Kvalitet">
          <option value="128">128 kbps</option><option value="192" selected>192 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps</option>
        </select>
        <button type="button" data-r="go" style="margin:0;">Konvertera</button>
      </div>
      <div data-r="out" style="margin-top:0.6rem; display:grid; gap:0.4rem;"></div>`;
    const $ = k => el.querySelector(`[data-r=${k}]`);
    $('go').addEventListener('click', async () => {
      const files = [...$('files').files], out = $('out'), btn = $('go');
      if (!files.length) { out.innerHTML = '<span class="text-muted">Välj en eller flera filer först.</span>'; return; }
      const kbps = Number($('kbps').value) || 192;
      btn.disabled = true; out.innerHTML = '';
      const ctx = new (root.AudioContext || root.webkitAudioContext)();
      for (const f of files) {
        const row = document.createElement('div'); row.className = 'text-muted'; row.style.fontSize = '0.9rem';
        row.textContent = f.name + ' – läser in…'; out.appendChild(row);
        try {
          const clip = AudioEdit.fromBuffer(await ctx.decodeAudioData(await f.arrayBuffer()));
          const blob = await AudioEdit.encodeMp3(clip, kbps, p => { row.textContent = `${f.name} – kodar ${Math.round(p * 100)} %…`; });
          const name = f.name.replace(/\.[^.]+$/, '') + '.mp3', url = URL.createObjectURL(blob);
          row.className = ''; row.style.color = '';
          row.innerHTML = `✅ ${esc(f.name)} (${mb(f.size)}) → <b>${esc(name)}</b> (${mb(blob.size)}) <a href="${url}" download="${esc(name)}" data-no-transition class="btn btn-outline" style="padding:0.2rem 0.7rem;margin-left:0.4rem;text-decoration:none;">Ladda ner</a>`;
        } catch (e) { row.innerHTML = `❌ ${esc(f.name)} – ${esc((e && e.message) || 'kunde inte konverteras')}`; }
      }
      try { ctx.close(); } catch (_) {}
      btn.disabled = false;
    });
  }
  root.WavConvert = { mount };
})(window);
