// Party Mode – låtar online för Tidslinjen (medlem/party-tidslinje.html).
//  • iTunes Search API (JSONP): 30 s-klipp + utgivningsdatum
//  • Deezer (JSONP): reservklipp om iTunes-klippet inte går att spela
//  • MusicBrainz: originalets utgivningsår (iTunes visar ofta årtalet för en remaster/samling)
// Kräver window.ROCK_ARTISTS (js/party-quiz-questions.js).
(function (root) {
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const SKIP = /\b(live|demo|instrumental|karaoke|remix|acoustic|unplugged|commentary|interview|edit|mono|rehearsal|session|version)\b/i;
  const THIS_YEAR = new Date().getFullYear();

  function jsonp(url, ms = 8000) {
    return new Promise((resolve, reject) => {
      const cb = '__hvjp' + Math.random().toString(36).slice(2);
      const sc = document.createElement('script');
      const done = () => { delete root[cb]; sc.remove(); clearTimeout(t); };
      const t = setTimeout(() => { done(); reject(new Error('timeout')); }, ms);
      root[cb] = data => { done(); resolve(data); };
      sc.onerror = () => { done(); reject(new Error('load')); };
      sc.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(sc);
    });
  }
  function cleanTitle(t) {
    return String(t || '').replace(/\s*[\(\[][^\)\]]*(remaster|version|mix|edit|deluxe|bonus|feat\.?|explicit|mono|stereo)[^\)\]]*[\)\]]/ig, '')
      .replace(/\s+-\s+.*(remaster|version|mix|edit|live|mono|stereo).*$/i, '').trim();
  }
  const yearOf = d => { const y = parseInt(String(d || '').slice(0, 4), 10); return y >= 1940 && y <= THIS_YEAR ? y : null; };

  // Låtar för en artist. year = tidigaste årtalet bland alla iTunes-versioner av samma titel.
  const cache = new Map();
  async function artistSongs(artist) {
    if (cache.has(artist)) return cache.get(artist);
    const url = 'https://itunes.apple.com/search?' + new URLSearchParams({ term: artist, entity: 'song', attribute: 'artistTerm', limit: '50', country: 'se' });
    const data = await jsonp(url);
    const want = norm(artist), byKey = new Map(), minYear = new Map();
    (data.results || []).forEach(r => {
      if (r.kind !== 'song' || !r.trackName || !r.artistName || !norm(r.artistName).startsWith(want)) return;
      const title = cleanTitle(r.trackName), key = norm(title);
      if (!key) return;
      const y = yearOf(r.releaseDate);
      if (y && (!minYear.has(key) || y < minYear.get(key))) minYear.set(key, y);
      if (!r.previewUrl || SKIP.test(r.trackName) || SKIP.test(r.collectionName || '') || byKey.has(key)) return;
      byKey.set(key, { id: 'it' + r.trackId, title, artist: r.artistName.split(/\s+(feat\.?|&)\s+/i)[0], url: r.previewUrl });
    });
    const out = [...byKey.entries()].map(([k, s]) => ({ ...s, year: minYear.get(k) || null })).filter(s => s.year);
    cache.set(artist, out);
    return out;
  }

  // MusicBrainz: tidigaste utgivningsåret för inspelningen (max 1 anrop/s enligt deras regler)
  let mbLast = 0;
  async function mbYear(song) {
    const wait = Math.max(0, mbLast + 1100 - Date.now()); mbLast = Date.now() + wait;
    if (wait) await new Promise(r => setTimeout(r, wait));
    const q = `recording:"${song.title.replace(/"/g, '')}" AND artist:"${song.artist.replace(/"/g, '')}"`;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch('https://musicbrainz.org/ws/2/recording/?' + new URLSearchParams({ query: q, fmt: 'json', limit: '25' }), { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const d = await res.json();
      const tn = norm(song.title), an = norm(song.artist).split(' ')[0];
      let best = null;
      (d.recordings || []).forEach(r => {
        if (norm(r.title) !== tn) return;
        const credit = norm((r['artist-credit'] || []).map(c => c.name).join(' '));
        if (!credit.includes(an)) return;
        const y = yearOf(r['first-release-date']);
        if (y && (!best || y < best)) best = y;
      });
      return best;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }

  function canPlay(url, ms = 7000) {
    return new Promise(res => {
      if (!url) return res(false);
      const a = new Audio(); a.preload = 'metadata';
      const done = ok => { clearTimeout(t); a.removeAttribute('src'); try { a.load(); } catch (e) {} res(ok); };
      const t = setTimeout(() => done(false), ms);
      a.addEventListener('loadedmetadata', () => done(true), { once: true });
      a.addEventListener('error', () => done(false), { once: true });
      a.src = url;
    });
  }
  async function deezerPreview(song) {
    try {
      const d = await jsonp('https://api.deezer.com/search?' + new URLSearchParams({ q: `artist:"${song.artist}" track:"${song.title}"`, limit: '5', output: 'jsonp' }), 6000);
      const hit = (d.data || []).find(x => x.preview);
      return hit ? hit.preview : null;
    } catch (e) { return null; }
  }

  // En kö med spelklara låtar (spelbart klipp + verifierat år), fylls på i bakgrunden.
  function createFeed(opts = {}) {
    const seen = new Set(opts.seen || []);
    const ready = [], waiters = [];
    let artists = shuffle(root.ROCK_ARTISTS || []), filling = false, failures = 0;
    async function prepare(song) {
      if (!(await canPlay(song.url))) {
        const dz = await deezerPreview(song);
        if (!dz || !(await canPlay(dz))) return null;
        song.url = dz;
      }
      const y = await mbYear(song);
      if (y && y < song.year) song.year = y;
      return song;
    }
    async function fill(target) {
      if (filling) return; filling = true;
      try {
        while (ready.length < target && failures < 25) {
          if (!artists.length) artists = shuffle(root.ROCK_ARTISTS || []);
          const artist = artists.pop();
          let songs = [];
          try { songs = await artistSongs(artist); } catch (e) { failures++; continue; }
          // en låt per artist och varv – bland de mest populära
          const cand = shuffle(songs.slice(0, 10).filter(s => !seen.has(s.id)))[0];
          if (!cand) continue;
          seen.add(cand.id);
          const s = await prepare({ ...cand });
          if (!s) { failures++; continue; }
          failures = 0;
          ready.push(s);
          while (waiters.length && ready.length) waiters.shift()(ready.shift());
        }
      } finally { filling = false; }
    }
    return {
      // nästa låt (väntar om kön är tom)
      next() {
        const p = ready.length ? Promise.resolve(ready.shift()) : new Promise((res, rej) => {
          waiters.push(res);
          setTimeout(() => { const i = waiters.indexOf(res); if (i >= 0) { waiters.splice(i, 1); rej(new Error('Hittade inga låtar – kontrollera nätet')); } }, 45000);
        });
        fill((opts.ahead || 4) + waiters.length);
        return p;
      },
      warm(n) { fill(n); },
      get size() { return ready.length; },
      get seen() { return [...seen]; },
    };
  }

  root.PartyMusic = { createFeed, shuffle, norm };
})(window);
