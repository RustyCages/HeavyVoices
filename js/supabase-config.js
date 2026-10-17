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
  const R2_AREAS = { 'heavy-voices-stems': 'stems', 'heavy-voices-warmup': 'warmup' };
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
