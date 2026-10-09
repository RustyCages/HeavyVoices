// Party Mode – låtar online för Tidslinjen (medlem/party-tidslinje.html) och genererade
// rockfrågor för Rockquiz (medlem/party-quiz.html).
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
    const want = norm(artist), byKey = new Map(), minYear = new Map(), album = new Map();
    const COMP = /greatest|best of|hits|collection|essential|anthology|live|deluxe|edition|anniversary|box set|gold|platinum|ultimate|definitive|years|story|singles|soundtrack|remaster/i;
    (data.results || []).forEach(r => {
      if (r.kind !== 'song' || !r.trackName || !r.artistName || !norm(r.artistName).startsWith(want)) return;
      const title = cleanTitle(r.trackName), key = norm(title);
      if (!key) return;
      const y = yearOf(r.releaseDate);
      if (y && (!minYear.has(key) || y < minYear.get(key))) minYear.set(key, y);
      const alb = String(r.collectionName || '').replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').trim();
      if (y && alb && !COMP.test(r.collectionName || '') && (!album.has(key) || y < album.get(key).y)) album.set(key, { y, name: alb });
      if (!r.previewUrl || SKIP.test(r.trackName) || SKIP.test(r.collectionName || '') || byKey.has(key)) return;
      byKey.set(key, { id: 'it' + r.trackId, title, artist: r.artistName.split(/\s+(feat\.?|&)\s+/i)[0], url: r.previewUrl });
    });
    const out = [...byKey.entries()].map(([k, s]) => ({ ...s, year: minYear.get(k) || null, album: album.has(k) && album.get(k).y === minYear.get(k) ? album.get(k).name : null })).filter(s => s.year);
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
      if (opts.noYear) return song;
      const y = await mbYear(song);
      if (y && y < song.year) song.year = y;
      return song;
    }
    // opts.parallel: flera hämtare samtidigt (snabbare när många låtar behövs på en gång)
    let workers = 0;
    async function worker() {
      workers++;
      try {
        while (ready.length + pending < goal && failures < 25) {
          if (!artists.length) artists = shuffle(root.ROCK_ARTISTS || []);
          const artist = artists.pop();
          pending++;
          let s = null;
          try {
            let songs = [];
            try { songs = await artistSongs(artist); } catch (e) { failures++; continue; }
            // en låt per artist och varv – bland de mest populära
            const cand = shuffle(songs.slice(0, 10).filter(x => !seen.has(x.id) && !seenTitle.has(norm(x.title))))[0];
            if (!cand) continue;
            seen.add(cand.id); seenTitle.add(norm(cand.title));
            s = await prepare({ ...cand });
            if (!s) { failures++; continue; }
          } finally { pending--; }
          failures = 0;
          ready.push(s);
          while (waiters.length && ready.length) waiters.shift()(ready.shift());
        }
      } finally { workers--; }
    }
    let pending = 0, goal = 0;
    const seenTitle = new Set();
    function fill(target) {
      goal = target;
      const want = Math.max(1, opts.parallel || 1);
      while (workers < want && ready.length + pending < goal) worker();
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
      // tar n låtar på en gång (väntar tills alla finns)
      async take(n, onProgress) {
        fill(n);
        const t0 = Date.now();
        while (ready.length < n) {
          if (onProgress) onProgress(ready.length, n);
          if (failures >= 25 && !workers) break;
          if (Date.now() - t0 > 120000) break;
          if (!workers) fill(n);
          await new Promise(r => setTimeout(r, 300));
        }
        return ready.splice(0, n);
      },
      get size() { return ready.length; },
      get seen() { return [...seen]; },
    };
  }


  // ---------- genererade rockfrågor (svenska) ur iTunes + MusicBrainz ----------
  // Typer: vilket band, vilket årtionde/år, vilket album, vilken låt är INTE av …
  const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
  const decadeLabel = d => d >= 2000 ? `${d}-talet` : `${String(d).slice(2)}-talet`;
  async function makeRockQuestions(n, seenIds) {
    const seen = new Set(seenIds || []);
    const artists = shuffle(root.ROCK_ARTISTS || []).slice(0, Math.min(14, n + 6));
    const res = await Promise.allSettled(artists.map(artistSongs));
    const pool = res.map((r, i) => ({ artist: artists[i], songs: r.status === 'fulfilled' ? r.value.slice(0, 15) : [] })).filter(x => x.songs.length >= 4);
    if (pool.length < 4) throw new Error('för få artister');
    const out = [], used = new Set();
    const pickSong = A => shuffle(A.songs.slice(0, 10)).find(x => !used.has(x.id) && !seen.has('gen' + x.id));
    const otherArtists = A => shuffle(pool.filter(B => B !== A)).map(B => B.songs[0].artist);
    const types = shuffle(['band', 'band', 'year', 'year', 'album', 'odd']);
    let mbCalls = 0;
    for (let k = 0; out.length < n && k < n * 4; k++) {
      const A = pool[k % pool.length], s = pickSong(A);
      if (!s) continue;
      const type = types[k % types.length];
      let q = null;
      if (type === 'band') {
        if (norm(s.title).includes(norm(s.artist))) continue;   // titeln avslöjar svaret
        const opts = [s.artist, ...otherArtists(A).filter(a => norm(a) !== norm(s.artist)).slice(0, 3)];
        q = { text: `Vilket band/artist ligger bakom låten "${s.title}"?`, correct: s.artist, options: opts };
      } else if (type === 'year') {
        let y = s.year, exact = false;
        if (mbCalls < 3) { mbCalls++; const m = await mbYear(s); if (m) { y = Math.min(y, m); exact = true; } }
        if (exact) {
          const set = new Set([y]); const deltas = shuffle([-6, -4, -3, -2, 2, 3, 4, 6]);
          for (const d of deltas) { if (set.size >= 4) break; const v = y + d; if (v <= THIS_YEAR && v >= 1950) set.add(v); }
          q = { text: `Vilket år släpptes "${s.title}" med ${s.artist}?`, correct: String(y), options: [...set].map(String) };
        } else {
          const d = Math.floor(y / 10) * 10, near = DECADES.filter(x => x !== d).sort((a, b) => Math.abs(a - d) - Math.abs(b - d)).slice(0, 3);
          q = { text: `Från vilket årtionde är "${s.title}" med ${s.artist}?`, correct: decadeLabel(d), options: [d, ...near].sort((a, b) => a - b).map(decadeLabel), keepOrder: true };
        }
      } else if (type === 'album') {
        const albums = [...new Set(A.songs.map(x => x.album).filter(Boolean))];
        if (!s.album || albums.length < 4) continue;
        q = { text: `På vilket ${s.artist}-album finns "${s.title}"?`, correct: s.album, options: [s.album, ...shuffle(albums.filter(a => a !== s.album)).slice(0, 3)] };
      } else if (type === 'odd') {
        const B = shuffle(pool.filter(x => x !== A))[0], intruder = B && pickSong(B);
        const mine = shuffle(A.songs.slice(0, 12).filter(x => x !== s && norm(x.title) !== norm(intruder ? intruder.title : ''))).slice(0, 2);
        if (!intruder || mine.length < 2) continue;
        used.add(intruder.id);
        q = { text: `Vilken av låtarna är INTE av ${s.artist}?`, correct: intruder.title, options: [intruder.title, s.title, ...mine.map(x => x.title)], fact: `"${intruder.title}" är av ${intruder.artist}` };
      }
      if (!q || new Set(q.options.map(norm)).size < 4) continue;
      used.add(s.id);
      out.push({ kind: 'online', id: 'gen' + s.id, label: '🎸 Rockfrågor', text: q.text, correct: q.correct, options: q.keepOrder ? q.options : shuffle(q.options), fact: q.fact || '' });
    }
    if (!out.length) throw new Error('inga genererade frågor');
    return out;
  }

  // ---------- Open Trivia DB: musikfrågor som handlar om rock ----------
  async function openTriviaRock(n, seenIds) {
    const seen = new Set(seenIds || []);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch('https://opentdb.com/api.php?amount=50&category=12&type=multiple&encode=url3986', { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      const dec = x => { try { return decodeURIComponent(x); } catch (e) { return x; } };
      const names = (root.ROCK_ARTISTS || []).map(norm).filter(x => x.length > 3);
      const ROCKY = /\b(rock|metal|punk|grunge|guitar|guitarist|drummer|bassist|riff|headbang|mosh)\b/i;
      return (d.results || []).map(r => ({ text: dec(r.question), correct: dec(r.correct_answer), wrong: (r.incorrect_answers || []).map(dec) }))
        .filter(r => { const all = norm([r.text, r.correct, ...r.wrong].join(' ')); return ROCKY.test(r.text) || names.some(a => (' ' + all + ' ').includes(' ' + a + ' ')); })
        .map(r => ({ kind: 'online', id: 'otdb:' + norm(r.text).slice(0, 60), label: '🎸 Rockfrågor', text: r.text, correct: r.correct, options: shuffle([r.correct, ...r.wrong.slice(0, 3)]) }))
        .filter(q => !seen.has(q.id)).slice(0, n);
    } finally { clearTimeout(t); }
  }

  root.PartyMusic = { createFeed, shuffle, norm, makeRockQuestions, openTriviaRock };
})(window);
