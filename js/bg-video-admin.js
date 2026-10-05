// Adminpanel för låtens bakgrundsvideo – samma panel används i Admin → Låtar, Textsynk och Röstövning.
// Allt sparas på låten (songs.bg_video_path / bg_video_offset / bg_video_loop), så videon blir
// densamma överallt: bakom notbanan, bakom karaoketexten i spelaren och i Röstövning.
//
//   const panel = BgVideoAdmin.mount(element, {
//     client: supabaseClient, bucket: 'heavy-voices-stems',
//     getSong: () => song,                // låtobjektet (uppdateras på plats)
//     onChange: (song, what) => { ... },  // what: 'path' | 'offset' | 'loop'
//   });
//   panel.refresh();                      // t.ex. när en annan låt väljs
(function (root) {
  const CSS = `
  .bgva { display: grid; gap: 0.55rem; }
  .bgva-note { font-size: 0.78rem; color: var(--text-muted); line-height: 1.45; margin: 0; }
  .bgva-row { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; font-size: 0.85rem; }
  .bgva-row button { font-size: 0.8rem; padding: 0.3rem 0.6rem; }
  .bgva-row input[type=number] { width: 5.5rem; margin: 0; padding: 0.3rem 0.45rem; }
  .bgva-row input[type=checkbox] { width: auto; margin: 0; accent-color: var(--accent); }
  .bgva-name { color: var(--text-muted); font-size: 0.82rem; }
  .bgva-name.has { color: #4ade80; }
  .bgva-status { font-size: 0.8rem; color: var(--text-muted); min-height: 1em; }
  .bgva-status.warn { color: #facc15; }
  .bgva label.bgva-row { margin: 0; cursor: pointer; }`;
  let cssDone = false;
  function injectCss() {
    if (cssDone) return; cssDone = true;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fileLabel = p => { try { return decodeURIComponent(String(p).split('/').pop().replace(/^video__/, '')); } catch (e) { return p; } };

  function mount(el, opts) {
    injectCss();
    const { client, bucket } = opts;
    const getSong = opts.getSong;
    const changed = (what) => { try { opts.onChange && opts.onChange(getSong(), what); } catch (e) { console.error(e); } };
    el.classList.add('bgva');
    el.innerHTML = `
      <p class="bgva-note">En egen videofil (t.ex. från ett rep eller en konsert) som visas nedtonad bakom karaoketexten i spelaren och bakom notbanan i Röstövning. Videon är tyst – ljudet kommer från stämfilerna. Håll filen liten (helst under 50 MB, t.ex. 720p).</p>
      <div class="bgva-row">
        <button type="button" class="btn-outline" data-a="pick">📂 Välj videofil…</button>
        <input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" hidden>
        <span class="bgva-name"></span>
        <button type="button" class="btn-outline" data-a="remove" hidden>🗑 Ta bort videon</button>
      </div>
      <div class="bgva-row" data-r="offset" hidden>
        Förskjutning
        <button type="button" class="btn-outline" data-d="-1">−1 s</button>
        <button type="button" class="btn-outline" data-d="-0.1">−0,1</button>
        <input type="number" step="0.05" value="0" aria-label="Förskjutning i sekunder"> s
        <button type="button" class="btn-outline" data-d="0.1">+0,1</button>
        <button type="button" class="btn-outline" data-d="1">+1 s</button>
        <button type="button" data-a="save">Spara</button>
      </div>
      <label class="bgva-row" data-r="loop" hidden><input type="checkbox"> 🔁 Loopa videon – börjar om när den tar slut (bra för korta klipp)</label>
      <p class="bgva-note" data-r="help" hidden>Spela låten och justera tills bild och musik stämmer. Positivt värde = videon ligger längre fram (hoppar över videons början).</p>
      <div class="bgva-status" aria-live="polite"></div>`;
    const $ = s => el.querySelector(s);
    const file = $('input[type=file]'), num = $('input[type=number]'), loop = $('label[data-r=loop] input');
    const status = (msg, warn) => { const s = $('.bgva-status'); s.textContent = msg || ''; s.classList.toggle('warn', !!warn); };

    function refresh() {
      const song = getSong();
      const has = !!(song && song.bg_video_path);
      const nm = $('.bgva-name');
      nm.textContent = !song ? 'Välj en låt först' : has ? '✓ ' + fileLabel(song.bg_video_path) : 'Ingen video vald';
      nm.classList.toggle('has', has);
      $('[data-a=pick]').disabled = !song;
      $('[data-a=remove]').hidden = !has;
      ['offset', 'loop', 'help'].forEach(r => { el.querySelector(`[data-r=${r}]`).hidden = !has; });
      num.value = Number(song && song.bg_video_offset) || 0;
      loop.checked = !!(song && song.bg_video_loop);
    }

    $('[data-a=pick]').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      const song = getSong(); if (!f || !song) return;
      const mb = Math.round(f.size / 1048576);
      if (f.size > 50 * 1048576 && !confirm(`Filen är ${mb} MB. Stora filer tar lång tid att ladda för medlemmarna (och kan stoppas av lagringsgränsen). Ladda upp ändå?`)) return;
      const clean = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_');
      const path = `${song.id}/video__${clean}`;
      status(`Laddar upp ${f.name} (${mb} MB)…`);
      $('[data-a=pick]').disabled = true;
      const { error } = await client.storage.from(bucket).upload(path, f, { upsert: true, contentType: f.type || 'video/mp4' });
      $('[data-a=pick]').disabled = false;
      if (error) { status('Kunde inte ladda upp: ' + error.message, true); return; }
      const old = song.bg_video_path;
      const { error: e2 } = await client.from('songs').update({ bg_video_path: path }).eq('id', song.id);
      if (e2) { status('Kunde inte spara: ' + e2.message, true); return; }
      if (old && old !== path) client.storage.from(bucket).remove([old]);
      song.bg_video_path = path;
      status('Videon uppladdad ✓ – spela låten och justera förskjutningen vid behov');
      refresh(); changed('path');
    });
    $('[data-a=remove]').addEventListener('click', async () => {
      const song = getSong();
      if (!song || !song.bg_video_path || !confirm('Ta bort bakgrundsvideon för den här låten?')) return;
      const path = song.bg_video_path;
      const { error } = await client.from('songs').update({ bg_video_path: null, bg_video_offset: 0 }).eq('id', song.id);
      if (error) { status('Kunde inte ta bort: ' + error.message, true); return; }
      client.storage.from(bucket).remove([path]);
      song.bg_video_path = null; song.bg_video_offset = 0;
      status('Videon borttagen');
      refresh(); changed('path');
    });
    const setOffset = (v) => {
      const song = getSong(); if (!song) return;
      song.bg_video_offset = Math.round(v * 100) / 100;
      num.value = song.bg_video_offset;
      status('Inte sparat – tryck Spara', true);
      changed('offset');
    };
    el.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => setOffset((Number(getSong()?.bg_video_offset) || 0) + Number(b.dataset.d))));
    num.addEventListener('change', () => setOffset(Number(num.value) || 0));
    $('[data-a=save]').addEventListener('click', async () => {
      const song = getSong(); if (!song) return;
      const { error } = await client.from('songs').update({ bg_video_offset: Number(song.bg_video_offset) || 0 }).eq('id', song.id);
      status(error ? 'Kunde inte spara: ' + error.message : 'Förskjutningen sparad ✓', !!error);
    });
    loop.addEventListener('change', async () => {
      const song = getSong(); if (!song) return;
      song.bg_video_loop = loop.checked;
      changed('loop');
      const { error } = await client.from('songs').update({ bg_video_loop: song.bg_video_loop }).eq('id', song.id);
      status(error ? 'Kunde inte spara: ' + error.message : (song.bg_video_loop ? 'Videon loopar ✓' : 'Videon spelas en gång ✓'), !!error);
    });

    refresh();
    return { refresh, status };
  }

  root.BgVideoAdmin = { mount };
})(window);
