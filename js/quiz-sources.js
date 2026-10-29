// Frågekällor för frågesporterna (Tårtbitarna, rockquizen).
//  • The Trivia API (CC BY-NC 4.0) och Open Trivia DB (CC BY-SA 4.0) – engelska, översätts via Edge Function translate-quiz (DeepL)
//  • Wikidata (CC0) – frågor vi bygger själva, direkt på svenska (huvudstäder, grundämnen, Nobelpris, filmer, konst …)
//  • Körens egen frågebank (tabell quiz_questions) och repertoaren (songs.lyrics_plain)
//  • Rockfrågor från js/party-music.js (om den är laddad)
// Fråga: { id, cat, q, correct, wrong: [], src, lang: 'sv'|'en', h?, keepOrder? }
//
// QuizSources.createPool({ cats, lang, hard, onStatus }) → pool.load() / pool.take(cat) / pool.counts() / pool.stop()
// QuizSources.translate(lista) → samma lista på svenska (det som inte gick att översätta blir kvar på engelska)
(function (root) {
  const CATS = {
    geo:   { id: 'geo',   name: 'Geografi',           emo: '🌍', color: '#3b82f6', tta: ['geography'],           otdb: [22] },
    film:  { id: 'film',  name: 'Film & TV',          emo: '🎬', color: '#ec4899', tta: ['film_and_tv'],         otdb: [11, 14] },
    hist:  { id: 'hist',  name: 'Historia',           emo: '🏛️', color: '#eab308', tta: ['history'],             otdb: [23] },
    konst: { id: 'konst', name: 'Konst & litteratur', emo: '🎨', color: '#a855f7', tta: ['arts_and_literature'], otdb: [25, 10] },
    vet:   { id: 'vet',   name: 'Vetenskap & natur',  emo: '🔬', color: '#22c55e', tta: ['science'],             otdb: [17, 18, 19, 27] },
    sport: { id: 'sport', name: 'Sport & fritid',     emo: '⚽', color: '#f97316', tta: ['sport_and_leisure'],   otdb: [21] },
    rock:  { id: 'rock',  name: 'Rock',               emo: '🤘', color: '#ef4444', tta: [],                      otdb: [] },
    kor:   { id: 'kor',   name: 'Heavy Voices',       emo: '🎤', color: '#E5A968', tta: [],                      otdb: [] },
    // Musiktemat: frågor genereras ur artistlistorna (iTunes) + musikfrågor från databaserna som nämner en artist i genren
    klassisk: { id: 'klassisk', name: 'Klassisk rock', emo: '🎸', color: '#eab308', tta: [], otdb: [], music: true,
      artists: ['The Beatles', 'The Rolling Stones', 'Led Zeppelin', 'Pink Floyd', 'The Who', 'Queen', 'The Doors', 'Creedence Clearwater Revival', 'Eagles', 'Fleetwood Mac',
        'Lynyrd Skynyrd', 'ZZ Top', 'Bruce Springsteen', 'Tom Petty and the Heartbreakers', 'Dire Straits', 'Jimi Hendrix', 'Cream', 'Eric Clapton', 'The Kinks', 'Steppenwolf',
        'Boston', 'Kansas', 'Foreigner', 'Journey', 'Styx', 'Supertramp', 'Genesis', 'Yes', 'Jethro Tull', 'The Allman Brothers Band', 'Santana', 'Steely Dan',
        'Bob Seger', 'Bad Company', 'Free', 'Electric Light Orchestra', 'The Cars', 'Heart', 'Status Quo', 'David Bowie', 'Neil Young', 'Janis Joplin', 'Chicago',
        'Toto', 'REO Speedwagon', 'Golden Earring', 'Rush', 'The Animals', 'Elton John', 'Roxy Music', 'Cheap Trick', 'Grand Funk Railroad', 'Bachman-Turner Overdrive'] },
    hardrock: { id: 'hardrock', name: 'Hårdrock', emo: '🤘', color: '#ef4444', tta: [], otdb: [], music: true,
      artists: ['AC/DC', "Guns N' Roses", 'Aerosmith', 'Kiss', 'Deep Purple', 'Whitesnake', 'Def Leppard', 'Bon Jovi', 'Van Halen', 'Scorpions',
        'Mötley Crüe', 'Thin Lizzy', 'UFO', 'Rainbow', 'Ozzy Osbourne', 'Alice Cooper', 'Twisted Sister', 'Skid Row', 'Poison', 'Cinderella',
        'Ratt', 'Quiet Riot', 'Europe', 'Gotthard', 'Nazareth', 'Uriah Heep', 'Blue Öyster Cult', 'Ted Nugent', 'The Darkness', 'Airbourne',
        'Rose Tattoo', 'Krokus', 'Extreme', 'Mr. Big', 'Warrant', 'Tesla', 'Great White', 'W.A.S.P.', 'Dokken', 'Hardcore Superstar',
        'Crashdïet', 'H.E.A.T', 'Backyard Babies', 'The Hellacopters', 'Steel Panther', 'Velvet Revolver', 'Buckcherry', 'Alter Bridge', 'Halestorm', 'Rival Sons', 'Wolfmother'] },
    metal: { id: 'metal', name: 'Metal', emo: '💀', color: '#64748b', tta: [], otdb: [], music: true,
      artists: ['Metallica', 'Iron Maiden', 'Black Sabbath', 'Judas Priest', 'Slayer', 'Megadeth', 'Anthrax', 'Pantera', 'Motörhead', 'Dio',
        'Sepultura', 'Slipknot', 'System of a Down', 'Korn', 'Rammstein', 'Nightwish', 'In Flames', 'Opeth', 'Amon Amarth', 'Sabaton',
        'HammerFall', 'Dream Theater', 'Machine Head', 'Lamb of God', 'Gojira', 'Mastodon', 'Avenged Sevenfold', 'Trivium', 'Bullet for My Valentine', 'Children of Bodom',
        'Arch Enemy', 'Helloween', 'Accept', 'Saxon', 'Testament', 'Exodus', 'Ghost', 'Meshuggah', 'Within Temptation', 'Disturbed',
        'Five Finger Death Punch', 'Volbeat', 'Powerwolf', 'Manowar', 'Dimmu Borgir', 'Behemoth', 'Mercyful Fate', 'King Diamond', 'Candlemass', 'Soilwork', 'Dark Tranquillity', 'Avatar'] },
    punk: { id: 'punk', name: 'Punk', emo: '🧷', color: '#22c55e', tta: [], otdb: [], music: true,
      artists: ['Ramones', 'Sex Pistols', 'The Clash', 'Green Day', 'The Offspring', 'Bad Religion', 'NOFX', 'Rancid', 'Dead Kennedys', 'Misfits',
        'Social Distortion', 'Blink-182', 'Sum 41', 'Pennywise', 'Descendents', 'Buzzcocks', 'The Damned', 'Stiff Little Fingers', 'Ebba Grön', 'Millencolin',
        'Refused', 'Rise Against', 'Dropkick Murphys', 'Anti-Flag', 'Bad Brains', 'Black Flag', 'Dead Boys', 'Iggy Pop', 'Turbonegro', 'The Stooges',
        'Generation X', 'The Undertones', 'Bad Manners', 'Rancid', 'Against Me!', 'Billy Talent', 'Gogol Bordello', 'Simple Plan', 'Good Charlotte', 'Thåström', 'KSMB', 'Asta Kask', 'Noice'] },
  };
  const THEMES = { allm: ['geo', 'film', 'hist', 'konst', 'vet'], musik: ['klassisk', 'hardrock', 'metal', 'punk'] };
  const CREDIT = 'Frågor från The Trivia API (CC BY-NC 4.0), Open Trivia DB (CC BY-SA 4.0) och Wikidata (CC0). Översatt med DeepL.';

  // supabaseClient är en global const i js/supabase-config.js (inte en egenskap på window)
  const sb = () => root.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9åäö]+/g, ' ').trim();
  const decHtml = t => { const el = document.createElement('textarea'); el.innerHTML = String(t ?? ''); return el.value; };
  const decUrl = x => { try { return decodeURIComponent(x); } catch (e) { return x; } };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  async function getJson(url, opts = {}, ms = 15000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts)); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  // välj n olika felaktiga svar ur en lista
  function pickWrong(all, correct, n) {
    const c = norm(correct), out = [], seen = new Set([c]);
    for (const v of shuffle(all)) { const k = norm(v); if (!k || seen.has(k)) continue; seen.add(k); out.push(v); if (out.length >= n) break; }
    return out;
  }
  function yearWrong(y) {
    const set = new Set([y]);
    for (const d of shuffle([-1, 1, -2, 2, -3, 3, -5, 5, -8, 8])) { if (set.size >= 4) break; const v = y + d; if (v <= new Date().getFullYear()) set.add(v); }
    set.delete(y); return [...set].map(String);
  }

  // ---------- frågor man redan sett (sparas i webbläsaren) ----------
  const SEEN_KEY = 'hv-quiz-seen2';
  const seenSet = () => new Set(store.get(SEEN_KEY, []));
  function markSeen(id) { const a = store.get(SEEN_KEY, []); a.push(id); store.set(SEEN_KEY, a.slice(-3000)); }
  // Rockquizen (medlem/party-quiz.html) har en egen lista med sina id:n – båda spelen läser och skriver den,
  // så att samma fråga inte kommer i både rockquizen och Tårtbitarna
  const QUIZ_SEEN = 'hv-quiz-seen';
  const quizSeenSet = () => new Set(store.get(QUIZ_SEEN, []));
  function markQuizSeen(raw) { if (!raw) return; const a = store.get(QUIZ_SEEN, []); a.push(raw); store.set(QUIZ_SEEN, a.slice(-1500)); }
  const pmNorm = t => root.PartyMusic && root.PartyMusic.norm ? root.PartyMusic.norm(t) : norm(t);

  // ---------- The Trivia API ----------
  async function fromTriviaApi(cat, hard) {
    const c = CATS[cat]; if (!c || !c.tta.length) return [];
    const url = 'https://the-trivia-api.com/v2/questions?' + new URLSearchParams({ limit: '50', categories: c.tta.join(','), difficulties: hard ? 'easy,medium,hard' : 'easy,medium' });
    const items = await getJson(url, { headers: { Accept: 'application/json' } });
    return (Array.isArray(items) ? items : []).filter(it => it && !it.isNiche).map(it => ({
      id: 'tta:' + it.id, raw: it.id, cat, src: 'tta', lang: 'en',
      q: decHtml(typeof it.question === 'object' ? it.question.text : it.question),
      correct: decHtml(it.correctAnswer), wrong: (it.incorrectAnswers || []).map(decHtml).slice(0, 3),
    })).filter(x => x.q && x.correct && x.wrong.length >= 1);
  }

  // ---------- Open Trivia DB (max 1 anrop per 5 s – körs i kö) ----------
  let otdbQueue = Promise.resolve(), otdbLast = 0;
  async function otdbToken() {
    const t = store.get('hv-otdb-token', null);
    if (t && Date.now() - t.at < 5 * 3600e3) return t.token;
    try { const j = await getJson('https://opentdb.com/api_token.php?command=request'); if (j.token) { store.set('hv-otdb-token', { token: j.token, at: Date.now() }); otdbLast = Date.now(); return j.token; } } catch (e) {}
    return null;
  }
  function fromOpenTdb(cat, hard) {
    const c = CATS[cat]; if (!c || !c.otdb.length) return Promise.resolve([]);
    const job = otdbQueue.then(async () => {
      const id = c.otdb[Math.floor(Math.random() * c.otdb.length)];
      let token = await otdbToken();
      const ask = async () => {
        const gap = 5200 - (Date.now() - otdbLast); if (gap > 0) await wait(gap);
        otdbLast = Date.now();
        return getJson(`https://opentdb.com/api.php?amount=40&category=${id}&type=multiple&encode=url3986` + (token ? '&token=' + token : ''));
      };
      let d = await ask();
      if (d.response_code === 5) d = await ask();
      if (token && (d.response_code === 3 || d.response_code === 4)) {
        try { if (d.response_code === 4) await getJson('https://opentdb.com/api_token.php?command=reset&token=' + token); else { store.set('hv-otdb-token', null); token = null; } } catch (e) {}
        d = await ask();
      }
      if (d.response_code === 1 && token) { token = null; d = await ask(); }   // för få frågor kvar med nyckeln
      return (d.results || []).filter(r => hard || r.difficulty !== 'hard').map(r => ({
        id: 'otdb:' + norm(decUrl(r.question)).slice(0, 80), raw: 'otdb:' + pmNorm(decUrl(r.question)).slice(0, 60), cat, src: 'otdb', lang: 'en',
        q: decUrl(r.question), correct: decUrl(r.correct_answer), wrong: (r.incorrect_answers || []).map(decUrl).slice(0, 3),
      }));
    });
    otdbQueue = job.catch(() => {});
    return job;
  }

  // ---------- Wikidata (frågor direkt på svenska) ----------
  const WD = {
    capital: { cat: 'geo', q: `SELECT ?c ?cLabel ?xLabel WHERE { ?c wdt:P31 wd:Q3624078; wdt:P36 ?x. FILTER NOT EXISTS { ?c wdt:P576 [] } SERVICE wikibase:label { bd:serviceParam wikibase:language "sv". } }`,
      make: (rows) => { const by = new Map(); rows.forEach(r => { if (!by.has(r.c)) by.set(r.c, r); }); const all = [...by.values()];
        return all.map(r => ({ id: 'wd:cap:' + r.c, q: `Vad heter huvudstaden i ${r.cLabel}?`, correct: r.xLabel, wrong: pickWrong(all.map(x => x.xLabel), r.xLabel, 3) })); } },
    continent: { cat: 'geo', q: `SELECT ?c ?cLabel ?xLabel WHERE { ?c wdt:P31 wd:Q3624078; wdt:P30 ?x. FILTER NOT EXISTS { ?c wdt:P576 [] } SERVICE wikibase:label { bd:serviceParam wikibase:language "sv". } }`,
      make: (rows) => { const n = new Map(); rows.forEach(r => n.set(r.c, (n.get(r.c) || 0) + 1)); const conts = [...new Set(rows.map(r => r.xLabel))];
        return rows.filter(r => n.get(r.c) === 1 && !/antarktis/i.test(r.xLabel)).map(r => ({ id: 'wd:cont:' + r.c, q: `I vilken världsdel ligger ${r.cLabel}?`, correct: r.xLabel, wrong: pickWrong(conts.filter(c => !/antarktis/i.test(c)), r.xLabel, 3) })); } },
    bigcity: { cat: 'geo', q: `SELECT ?s ?sLabel ?xLabel WHERE { ?s wdt:P31 wd:Q1637706; wdt:P17 ?x. SERVICE wikibase:label { bd:serviceParam wikibase:language "sv". } }`,
      make: (rows) => { const all = [...new Set(rows.map(r => r.xLabel))];
        return rows.map(r => ({ id: 'wd:city:' + r.s, q: `I vilket land ligger miljonstaden ${r.sLabel}?`, correct: r.xLabel, wrong: pickWrong(all, r.xLabel, 3) })); } },
    element: { cat: 'vet', q: `SELECT ?e ?eLabel ?sym ?num WHERE { ?e wdt:P31 wd:Q11344; wdt:P246 ?sym; wdt:P1086 ?num. FILTER(?num <= 92) SERVICE wikibase:label { bd:serviceParam wikibase:language "sv". } }`,
      make: (rows) => { const all = rows.map(r => r.eLabel).map(s => s.charAt(0).toUpperCase() + s.slice(1));
        return rows.flatMap(r => { const name = r.eLabel.charAt(0).toUpperCase() + r.eLabel.slice(1);
          return [{ id: 'wd:sym:' + r.e, q: `Vilket grundämne har den kemiska beteckningen ${r.sym}?`, correct: name, wrong: pickWrong(all, name, 3) },
            { id: 'wd:num:' + r.e, q: `Vilket atomnummer har ${r.eLabel}?`, correct: String(r.num), wrong: yearWrong(+r.num).filter(v => +v > 0), keepOrder: true }]; }); } },
    nobellit: { cat: 'konst', q: `SELECT ?p ?pLabel ?y WHERE { ?p p:P166 ?st. ?st ps:P166 wd:Q37922; pq:P585 ?d. BIND(YEAR(?d) AS ?y) SERVICE wikibase:label { bd:serviceParam wikibase:language "sv,en". } }`,
      make: (rows) => { const all = rows.map(r => r.pLabel);
        return rows.map(r => ({ id: 'wd:nlit:' + r.p, q: `Vem fick Nobelpriset i litteratur ${r.y}?`, correct: r.pLabel, wrong: pickWrong(all, r.pLabel, 3) })); } },
    painting: { cat: 'konst', q: `SELECT ?w ?wLabel ?xLabel WHERE { ?w wdt:P31 wd:Q3305213; wdt:P170 ?x; wikibase:sitelinks ?n. FILTER(?n > 25) SERVICE wikibase:label { bd:serviceParam wikibase:language "sv". } }`,
      make: (rows) => { const all = [...new Set(rows.map(r => r.xLabel))];
        return rows.filter(r => !/okänd|unknown/i.test(r.xLabel)).map(r => ({ id: 'wd:paint:' + r.w, q: `Vem målade "${r.wLabel}"?`, correct: r.xLabel, wrong: pickWrong(all, r.xLabel, 3) })); } },
    oscar: { cat: 'film', q: `SELECT ?f ?fLabel ?xLabel WHERE { ?f wdt:P166 wd:Q102427; wdt:P57 ?x. SERVICE wikibase:label { bd:serviceParam wikibase:language "sv,en". } }`,
      make: (rows) => { const by = new Map(); rows.forEach(r => { if (!by.has(r.f)) by.set(r.f, r); }); const all = [...new Set(rows.map(r => r.xLabel))];
        return [...by.values()].map(r => ({ id: 'wd:oscar:' + r.f, q: `Vem regisserade Oscarsvinnaren "${r.fLabel}"?`, correct: r.xLabel, wrong: pickWrong(all, r.xLabel, 3) })); } },
    nobelpeace: { cat: 'hist', q: `SELECT ?p ?pLabel ?y WHERE { ?p p:P166 ?st. ?st ps:P166 wd:Q35637; pq:P585 ?d. BIND(YEAR(?d) AS ?y) SERVICE wikibase:label { bd:serviceParam wikibase:language "sv,en". } }`,
      make: (rows) => { const by = new Map(); rows.forEach(r => { const k = r.y; by.set(k, (by.get(k) || []).concat(r)); }); const all = rows.map(r => r.pLabel);
        return [...by.values()].filter(g => g.length === 1).map(g => g[0]).map(r => ({ id: 'wd:npeace:' + r.p + r.y, q: `Vem fick Nobels fredspris ${r.y}?`, correct: r.pLabel, wrong: pickWrong(all, r.pLabel, 3) })); } },
    war: { cat: 'hist', q: `SELECT ?w ?wLabel ?y WHERE { ?w wdt:P31 wd:Q198; wdt:P580 ?d; wikibase:sitelinks ?n. FILTER(?n > 50) BIND(YEAR(?d) AS ?y) SERVICE wikibase:label { bd:serviceParam wikibase:language "sv". } }`,
      make: (rows) => rows.filter(r => +r.y > 1000).map(r => ({ id: 'wd:war:' + r.w, q: `Vilket år började ${r.wLabel.charAt(0).toLowerCase() + r.wLabel.slice(1)}?`, correct: String(r.y), wrong: yearWrong(+r.y), keepOrder: true })) },
    olympics: { cat: 'sport', q: `SELECT ?g ?y ?xLabel WHERE { ?g wdt:P31 wd:Q159821; wdt:P276 ?x. OPTIONAL { ?g wdt:P580 ?a } OPTIONAL { ?g wdt:P585 ?b } BIND(YEAR(COALESCE(?a, ?b)) AS ?y) FILTER(BOUND(?y)) SERVICE wikibase:label { bd:serviceParam wikibase:language "sv". } }`,
      make: (rows) => { const by = new Map(); rows.forEach(r => { if (!by.has(r.y)) by.set(r.y, r); }); const all = [...new Set(rows.map(r => r.xLabel))];
        return [...by.values()].filter(r => +r.y <= new Date().getFullYear()).map(r => ({ id: 'wd:ol:' + r.y, q: `Var hölls sommar-OS ${r.y}?`, correct: r.xLabel, wrong: pickWrong(all, r.xLabel, 3) })); } },
  };
  const WD_URL = 'https://query.wikidata.org/sparql?format=json&query=';
  async function wikidataRows(key) {
    const c = store.get('hv-wd-' + key, null);
    if (c && Date.now() - c.at < 14 * 864e5 && c.rows && c.rows.length) return c.rows;
    const d = await getJson(WD_URL + encodeURIComponent(WD[key].q), { headers: { Accept: 'application/sparql-results+json' } }, 25000);
    const ent = v => v && v.value && v.value.startsWith('http://www.wikidata.org/entity/') ? v.value.slice(31) : (v ? v.value : '');
    const rows = (d.results && d.results.bindings || []).map(b => { const o = {}; Object.keys(b).forEach(k => o[k] = ent(b[k])); return o; })
      // rader utan svenskt namn (bara Q-nummer) hoppas över
      .filter(o => !Object.keys(o).some(k => /Label$/.test(k) && /^Q\d+$/.test(o[k])));
    if (rows.length) store.set('hv-wd-' + key, { at: Date.now(), rows });
    return rows;
  }
  async function fromWikidata(cat) {
    const keys = Object.keys(WD).filter(k => WD[k].cat === cat);
    const res = await Promise.allSettled(keys.map(async k => {
      const rows = await wikidataRows(k);
      if (rows.length < 4) return [];
      return WD[k].make(rows).filter(x => x.correct && x.wrong.length === 3).map(x => Object.assign(x, { cat, src: 'wd', lang: 'sv' }));
    }));
    return res.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  }

  // ---------- körens egen frågebank ----------
  async function fromBank(cats) {
    if (!sb()) return [];
    const { data, error } = await sb().from('quiz_questions').select('id, category, question, correct, wrong').eq('active', true).in('category', cats).limit(1000);
    if (error) return [];
    return (data || []).map(r => ({ id: 'bank:' + r.id, bankId: r.id, cat: r.category, src: 'bank', lang: 'sv', q: r.question, correct: r.correct, wrong: (r.wrong || []).filter(Boolean).slice(0, 3) }));
  }

  // ---------- repertoaren: "fortsätt raden" och "vilken låt" ----------
  const SECTION = /^(\[.*\]|\(.*\)|(vers|verse|refräng|chorus|brygga|bridge|intro|outro|stick|pre-?chorus|solo)\b.*)$/i;
  async function fromRepertoire() {
    if (!sb()) return [];
    const { data, error } = await sb().from('songs').select('id, title, lyrics_plain').not('lyrics_plain', 'is', null);
    if (error) return [];
    const songs = (data || []).map(s => ({ id: s.id, title: s.title, lines: [...new Set(String(s.lyrics_plain || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length >= 10 && l.length <= 90 && !SECTION.test(l)))] }))
      .filter(s => s.title && s.lines.length >= 6);
    if (songs.length < 2) return [];
    const out = [];
    for (const s of songs) {
      const others = songs.filter(x => x !== s);
      const otherLines = others.flatMap(x => x.lines);
      const raw = String((data.find(d => d.id === s.id) || {}).lyrics_plain || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !SECTION.test(l));
      for (const i of shuffle([...raw.keys()]).slice(0, 6)) {
        const cur = raw[i], nxt = raw[i + 1];
        if (!nxt || cur.length < 10 || nxt.length < 6 || norm(cur) === norm(nxt) || nxt.length > 90) continue;
        out.push({ id: 'rep:' + s.id + ':' + i, cat: 'kor', src: 'rep', lang: 'sv', q: `Fortsätt raden i "${s.title}":\n"${cur} …"`, correct: nxt, wrong: pickWrong(otherLines, nxt, 3) });
      }
      if (songs.length >= 4) for (const l of shuffle(s.lines).slice(0, 3))
        out.push({ id: 'rep2:' + s.id + ':' + norm(l).slice(0, 30), cat: 'kor', src: 'rep', lang: 'sv', q: `Vilken av våra låtar kommer raden från?\n"${l}"`, correct: s.title, wrong: pickWrong(others.map(x => x.title), s.title, 3) });
    }
    return out.filter(x => x.wrong.length >= 1);
  }

  // ---------- rock (js/party-music.js) ----------
  async function fromRock(hard) {
    const PM = root.PartyMusic; if (!PM) return [];
    const [g, o] = await Promise.allSettled([PM.makeRockQuestions(20, [...quizSeenSet()]), PM.openTriviaRock(25)]);
    return [].concat(g.status === 'fulfilled' ? g.value.map(x => convPM(x, 'rock', 'sv', 'rock')) : [], o.status === 'fulfilled' ? o.value.map(x => convPM(x, 'rock', 'en', 'otdb')) : []);
  }
  const convPM = (x, cat, lang, src) => ({ id: 'rock:' + x.id, raw: x.id, cat, src, lang, q: x.text, correct: x.correct, wrong: (x.options || []).filter(o => o !== x.correct).slice(0, 3), keepOrder: !!x.keepOrder });

  // ---------- musiktemat: genererade frågor per genre ----------
  async function fromGenre(cat, n = 12) {
    const PM = root.PartyMusic, c = CATS[cat]; if (!PM || !c || !c.artists) return [];
    const list = await PM.makeRockQuestions(n, [...quizSeenSet()], { artists: c.artists, maxArtists: 10 });
    return list.map(x => convPM(x, cat, 'sv', 'gen'));
  }
  // musikfrågor från databaserna, sorterade på genre efter vilken artist de nämner
  function genreOf(x, cats) {
    const t = ' ' + pmNorm([x.q, x.correct, ...(x.wrong || [])].join(' ')) + ' ';
    for (const c of cats) if (CATS[c].artists.some(a => { const k = pmNorm(a); return k.length > 2 && t.includes(' ' + k + ' '); })) return c;
    if (cats.includes('punk') && /\bpunk\b/i.test(x.q)) return 'punk';
    if (cats.includes('metal') && /\b(heavy )?metal\b/i.test(x.q)) return 'metal';
    return null;
  }
  async function fromMusicDb(cats, hard) {
    const PM = root.PartyMusic;
    const urls = ['https://the-trivia-api.com/v2/questions?limit=50&tags=rock_music', 'https://the-trivia-api.com/v2/questions?limit=50&categories=music', 'https://the-trivia-api.com/v2/questions?limit=50&categories=music'];
    const tta = await Promise.allSettled(urls.map((u, i) => wait(i * 300).then(() => getJson(u, { headers: { Accept: 'application/json' } }))));
    const out = [];
    tta.forEach(r => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []).forEach(it => {
      const x = { id: 'tta:' + it.id, raw: it.id, src: 'tta', lang: 'en', q: decHtml(typeof it.question === 'object' ? it.question.text : it.question), correct: decHtml(it.correctAnswer), wrong: (it.incorrectAnswers || []).map(decHtml).slice(0, 3) };
      if (x.q && x.correct && x.wrong.length) { x.cat = genreOf(x, cats); if (x.cat) out.push(x); }
    }));
    if (PM && PM.openTriviaRock) {
      // Open Trivia DB:s musikkategori (max 1 anrop/5 s – två omgångar)
      for (let k = 0; k < 2; k++) {
        try {
          const list = await (otdbQueue = otdbQueue.then(() => wait(Math.max(0, 5200 - (Date.now() - otdbLast)))).then(() => { otdbLast = Date.now(); return PM.openTriviaRock(50, [...quizSeenSet()]); }).catch(() => []));
          list.forEach(q => { const x = convPM(q, null, 'en', 'otdb'); x.cat = genreOf(x, cats); if (x.cat) out.push(x); });
        } catch (e) {}
      }
    }
    return out;
  }

  // ---------- översättning ----------
  let lastNote = '';
  async function translate(list, opts = {}) {
    const en = list.filter(x => x.lang === 'en');
    if (!en.length || !sb()) return list;
    const out = new Map();
    for (let i = 0; i < en.length; i += 100) {
      const chunk = en.slice(i, i + 100);
      try {
        const { data, error } = await withTimeout(sb().functions.invoke('translate-quiz', {
          body: { items: chunk.map(x => ({ q: x.q, correct: x.correct, wrong: x.wrong, cat: x.cat, src: x.src, keepAnswers: x.cat === 'rock' || !!(CATS[x.cat] && CATS[x.cat].music) })) } }), 30000);
        if (error) throw error;
        if (data && data.error) lastNote = data.code === 'no_key' ? 'DeepL-nyckeln saknas – frågorna visas på engelska' : data.error;
        (data && data.items || []).forEach((r, k) => { if (r) out.set(chunk[k], r); });
      } catch (e) { lastNote = 'Översättningen svarade inte – frågorna visas på engelska'; break; }
    }
    return list.flatMap(x => {
      if (x.lang !== 'en') return [x];
      const r = out.get(x);
      if (!r) return [x];                       // kvar på engelska
      if (r.blocked) return opts.keepBlocked ? [Object.assign({}, x, { blocked: true, h: r.h })] : [];
      return [Object.assign({}, x, { q: r.q, correct: r.correct, wrong: r.wrong || [], lang: 'sv', h: r.h, en: x.q })];
    });
  }
  // spärra en dålig fråga (admin/stämledare) så att den aldrig visas igen
  async function block(q) {
    if (!q || !sb()) return false;
    try {
      if (q.h) { const { error } = await sb().from('quiz_translations').update({ blocked: true }).eq('source_hash', q.h); return !error; }
      if (q.bankId) { const { error } = await sb().from('quiz_questions').update({ active: false }).eq('id', q.bankId); return !error; }
    } catch (e) {}
    return false;
  }

  // ---------- frågepool för ett spel ----------
  function createPool(opts = {}) {
    const cats = opts.cats || ['geo', 'film', 'hist', 'konst', 'vet', 'sport'];
    const lang = opts.lang || 'sv';
    const fresh = {}, reserve = {}, ids = new Set(), texts = new Set();
    cats.forEach(c => { fresh[c] = []; reserve[c] = []; });
    let stopped = false, pending = 0, done = 0, loadP = null;
    const seen = seenSet(), qSeen = quizSeenSet();
    const isSeen = x => seen.has(x.id) || (x.raw && qSeen.has(x.raw));
    const status = () => { if (opts.onStatus) opts.onStatus({ counts: counts(), pending, done, note: lastNote }); };
    function counts() { const o = {}; cats.forEach(c => o[c] = fresh[c].length + reserve[c].length); return o; }
    function add(list) {
      if (stopped) return;
      list.forEach(x => {
        if (!fresh[x.cat] || ids.has(x.id)) return;
        const t = norm(x.q); if (texts.has(t)) return;
        ids.add(x.id); texts.add(t);
        (isSeen(x) ? reserve : fresh)[x.cat].push(x);
      });
      cats.forEach(c => { fresh[c] = shuffle(fresh[c]); });
      status();
    }
    function job(p) {
      pending++; status();
      return p.then(async list => {
        if (stopped) return;
        if (lang === 'sv' && list.some(x => x.lang === 'en')) {
          add(list.filter(x => x.lang !== 'en'));
          list = await translate(list.filter(x => x.lang === 'en'));
        }
        add(list);
      }).catch(() => {}).finally(() => { pending--; done++; status(); });
    }
    function load() {
      if (loadP) return loadP;
      const jobs = [];
      // snabba källor först (Trivia API, Wikidata, egen bank), Open Trivia DB fyller på i bakgrunden
      jobs.push(job(fromBank(cats)));
      cats.forEach((c, i) => {
        if (c === 'rock') { jobs.push(job(fromRock(opts.hard))); return; }
        if (CATS[c] && CATS[c].music) { jobs.push(job(wait(i * 1500).then(() => fromGenre(c)))); return; }   // utspritt – iTunes tål inte för många anrop på en gång
        if (c === 'kor') { jobs.push(job(fromRepertoire())); return; }
        jobs.push(job(wait(i * 250).then(() => fromTriviaApi(c, opts.hard))));
        jobs.push(job(fromWikidata(c)));
      });
      cats.filter(c => CATS[c] && CATS[c].otdb.length).forEach(c => job(fromOpenTdb(c, opts.hard)));
      const music = cats.filter(c => CATS[c] && CATS[c].music);
      if (music.length) job(fromMusicDb(music, opts.hard));
      // "redo" när alla snabba källor svarat eller varje kategori har några frågor
      loadP = new Promise(res => {
        const check = () => { const n = counts(); if (cats.every(c => n[c] >= 4)) res(true); };
        const prev = opts.onStatus; opts.onStatus = s => { if (prev) prev(s); check(); };
        Promise.allSettled(jobs).then(() => res(true));
        setTimeout(() => res(true), 45000);
        check();
      });
      return loadP;
    }
    // hämta fler när en kategori börjar ta slut
    const refilling = new Set();
    function refill(c) {
      if (refilling.has(c) || stopped) return; refilling.add(c);
      const p = c === 'rock' ? fromRock(opts.hard) : (CATS[c] && CATS[c].music) ? fromGenre(c, 10) : c === 'kor' ? fromRepertoire() : Promise.allSettled([fromTriviaApi(c, opts.hard), fromOpenTdb(c, opts.hard)]).then(r => r.flatMap(x => x.status === 'fulfilled' ? x.value : []));
      job(p).finally(() => refilling.delete(c));
    }
    function take(c, exceptId) {
      const pick = arr => { const i = arr.findIndex(x => x.id !== exceptId); return i < 0 ? null : arr.splice(i, 1)[0]; };
      let q = pick(fresh[c] || []) || pick(reserve[c] || []);
      if ((fresh[c] || []).length < 3) refill(c);
      if (q) { markSeen(q.id); markQuizSeen(q.raw); }
      return q;
    }
    return { load, take, counts, cats, get note() { return lastNote; }, stop() { stopped = true; } };
  }

  root.QuizSources = { CATS, THEMES, CREDIT, createPool, translate, block, fromTriviaApi, fromOpenTdb, fromWikidata, fromBank, fromRepertoire };
})(window);
