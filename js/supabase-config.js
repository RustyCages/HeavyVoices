// Fyll i efter att Supabase-projektet är skapat
const SUPABASE_URL = 'https://scfudeyozwedohujsoua.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lQf4A7LCOH42d_Di-B7oiw_1JzB_2sh';

// Laddas via CDN i HTML (se index.html) — ingen bundler
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
 

// ---------- R2-lagring ----------
// Stämmor och uppvärmningsvideor ligger i Cloudflare R2 i stället för Supabase Storage.
// supabaseClient.storage.from('heavy-voices-stems' | 'heavy-voices-warmup') pekas om till
// Edge Function r2-files, med samma anrop och svarsformat som Storage-API:t
// (createSignedUrl(s), upload, remove, list, download). Sökvägarna i databasen är oförändrade.
// Övriga buckets (noter, filer, recordings) går som förut mot Supabase.
(function () {
  const R2_AREAS = { 'heavy-voices-stems': 'stems', 'heavy-voices-warmup': 'warmup', 'heavy-voices-forum': 'forum', 'heavy-voices-inbox': 'inbox' };
  const storage = supabaseClient.storage;
  const originalFrom = storage.from.bind(storage);

  async function call(action, area, params) {
    const { data, error } = await supabaseClient.functions.invoke('r2-files', { body: { action, area, ...params } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context?.json(); if (j?.error) msg = j.error; } catch (_) { /* ingen JSON */ }
      return { data: null, error: new Error(msg) };
    }
    if (data?.error) return { data: null, error: new Error(data.error) };
    return { data, error: null };
  }

  function r2Bucket(area) {
    return {
      async createSignedUrl(path, _expiresIn, opts) {
        const dl = opts?.download;
        const r = await call('download', area, {
          key: path, download: !!dl, filename: typeof dl === 'string' ? dl : undefined,
        });
        return r.error ? r : { data: { signedUrl: r.data.url }, error: null };
      },

      async createSignedUrls(paths, _expiresIn) {
        const out = [];
        for (let i = 0; i < paths.length; i += 50) {
          const chunk = paths.slice(i, i + 50);
          const r = await call('sign', area, { keys: chunk });
          if (r.error) return r;
          for (const p of chunk) {
            const url = r.data.urls[p] || null;
            out.push({ path: p, signedUrl: url, error: url ? null : 'Not found' });
          }
        }
        return { data: out, error: null };
      },

      async upload(path, file, opts = {}) {
        const contentType = opts.contentType || file.type || 'application/octet-stream';
        const r = await call('upload', area, { key: path, contentType });
        if (r.error) return r;
        const res = await fetch(r.data.url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
        if (!res.ok) return { data: null, error: new Error(`Uppladdningen misslyckades (${res.status})`) };
        return { data: { path, fullPath: `${area}/${path}` }, error: null };
      },

      async remove(paths) {
        const results = await Promise.all((paths || []).filter(Boolean).map(key => call('delete', area, { key })));
        const failed = results.find(r => r.error);
        return failed ? { data: null, error: failed.error } : { data: paths.map(name => ({ name })), error: null };
      },

      async list(prefix = '', opts = {}) {
        const r = await call('list', area, { prefix });
        if (r.error) return r;
        let items = [
          ...r.data.folders.map(f => ({ name: f.replace(/\/$/, '').split('/').pop(), id: null, metadata: null })),
          ...r.data.files.map(f => ({
            name: f.name, id: f.key, updated_at: f.updated, created_at: f.updated,
            metadata: { size: f.size },
          })),
        ];
        if (opts.search) items = items.filter(i => i.name.toLowerCase().includes(String(opts.search).toLowerCase()));
        if (opts.sortBy?.order === 'desc') items.reverse();
        const offset = opts.offset || 0;
        return { data: items.slice(offset, offset + (opts.limit || 100)), error: null };
      },

      async download(path) {
        const r = await this.createSignedUrl(path);
        if (r.error) return r;
        const res = await fetch(r.data.signedUrl);
        if (!res.ok) return { data: null, error: new Error(`Hämtningen misslyckades (${res.status})`) };
        return { data: await res.blob(), error: null };
      },
    };
  }

  // Party Mode-media (party/fireworks, party/fireworks-sound, party/intro-music) ligger kvar i
  // Supabase Storage – de flyttades inte till R2. Sökvägar under party/ går därför mot Supabase.
  const isParty = p => /^party(\/|$)/.test(String(p || ''));
  function routed(bucket, area) {
    const r2 = r2Bucket(area), sb = originalFrom(bucket);
    const pick = p => (isParty(p) ? sb : r2);
    return {
      createSignedUrl: (path, ...a) => pick(path).createSignedUrl(path, ...a),
      createSignedUrls: (paths, ...a) => ((paths || []).length && paths.every(isParty) ? sb : r2).createSignedUrls(paths, ...a),
      upload: (path, ...a) => pick(path).upload(path, ...a),
      remove: (paths) => ((paths || []).length && paths.every(isParty) ? sb : r2).remove(paths),
      list: (prefix, ...a) => pick(prefix).list(prefix, ...a),
      download: (path) => pick(path).download(path),
    };
  }

  storage.from = (bucket) => (R2_AREAS[bucket] ? routed(bucket, R2_AREAS[bucket]) : originalFrom(bucket));
})();

// ---------- Nödstopp (killswitch) ----------
// Admin kan stänga sajten under Admin (tabell site_status). Öppna sidor kollar var 30:e sekund och när
// fliken visas igen – den som inte är admin skickas till stängt-sidan. Nya sidvisningar stoppas redan
// av Cloudflare (functions/_middleware.js), och databasen släpper bara in admin (is_approved_member).
(function siteGuard() {
  const p = location.pathname;
  if (/^\/(logga-in|aterstall-losenord|satt-losenord|stangd)(\.html)?$/.test(p)) return;
  let banner = null;
  async function check() {
    try {
      const { data, error } = await supabaseClient.from('site_status').select('closed').eq('id', 1).maybeSingle();
      if (error || !data || !data.closed) { if (banner) { banner.remove(); banner = null; } return; }
      const { data: adm } = await supabaseClient.rpc('is_admin');
      if (adm !== true) { location.replace('/stangd.html?from=' + encodeURIComponent(p + location.search)); return; }
      if (!banner) {
        banner = document.createElement('a');
        banner.href = '/admin/#nodstopp';
        banner.textContent = '🚨 Sajten är STÄNGD för medlemmar – bara admin kommer in. Tryck här för att öppna igen.';
        banner.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#b91c1c;color:#fff;text-align:center;padding:0.55rem 1rem;font:600 0.9rem system-ui,sans-serif;text-decoration:none';
        document.body.appendChild(banner);
      }
    } catch (e) { /* ingen kontakt – låt sidan vara */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check); else check();
  setInterval(check, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();

// ---------- WAV/AIFF/FLAC sparas aldrig på nätet: görs om till MP3 direkt när någon väljer eller drar in en sådan fil ----------
// Gäller alla filväljare och släppytor på sidorna. Undantag: element (eller förälder) med data-keep-wav – t.ex. Studio, som
// arbetar med ljudet lokalt och själv sparar MP3, och WAV→MP3-verktyget.
(function () {
  const RX = /\.(wav|wave|aif|aiff|aifc|flac)$/i;
  const isRaw = f => !!f && (RX.test(f.name || '') || /^audio\/(x-)?(wav|wave|aiff|flac)$/i.test(f.type || ''));
  let libP = null;
  const lib = () => window.AudioEdit && AudioEdit.toMp3File ? Promise.resolve() : (libP = libP || new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = '/js/audio-edit.js'; s.onload = res; s.onerror = () => { libP = null; rej(new Error('kunde inte ladda ljudverktyget')); }; document.head.appendChild(s);
  }));
  let box = null;
  const note = (msg, done) => {
    if (!box) { box = document.createElement('div'); box.style.cssText = 'position:fixed;left:50%;bottom:1.2rem;transform:translateX(-50%);z-index:99999;background:#1f232c;color:#fff;border:1px solid #E5A968;border-radius:0.6rem;padding:0.6rem 1rem;font:500 0.9rem system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);max-width:90vw'; document.body.appendChild(box); }
    box.textContent = msg; box.hidden = false;
    clearTimeout(box._t); if (done) box._t = setTimeout(() => { box.hidden = true; }, 4000);
  };
  async function convertAll(files) {
    await lib();
    const out = [];
    for (const f of files) {
      if (!isRaw(f)) { out.push(f); continue; }
      note(`${f.name} är okomprimerat ljud – gör om till MP3…`);
      out.push(await AudioEdit.toMp3File(f, 192, p => note(`Gör om ${f.name} till MP3… ${Math.round(p * 100)} %`)));
    }
    note(`✓ Gjort om till MP3 (WAV sparas inte på nätet)`, true);
    return out;
  }
  const toList = files => { const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); return dt; };
  // filväljare
  document.addEventListener('change', async e => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement) || inp.type !== 'file' || inp._wavDone || inp.closest('[data-keep-wav]')) return;
    const files = [...(inp.files || [])]; if (!files.some(isRaw)) return;
    e.stopImmediatePropagation();
    try { const conv = await convertAll(files); inp.files = toList(conv).files; }
    catch (err) { note('Kunde inte göra om till MP3: ' + (err.message || err), true); inp.value = ''; return; }
    inp._wavDone = true; inp.dispatchEvent(new Event('change', { bubbles: true })); inp._wavDone = false;
  }, true);
  // dra och släpp
  document.addEventListener('drop', async e => {
    if (e._wavDone || !e.dataTransfer || e.target.closest && e.target.closest('[data-keep-wav]')) return;
    const files = [...(e.dataTransfer.files || [])]; if (!files.some(isRaw)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const target = e.target, x = e.clientX, y = e.clientY;
    try {
      const dt = toList(await convertAll(files));
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
      ev._wavDone = true; target.dispatchEvent(ev);
    } catch (err) { note('Kunde inte göra om till MP3: ' + (err.message || err), true); }
  }, true);
})();
