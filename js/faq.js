// FAQ-sökning för medlemssidan (nivå A: ingen AI, bara sökning i kårens dokument).
// Svaren är hämtade ur förskrivna utdrag från guiderna + körinfo (choir_info) och visas som text.
// Lägg till eller ändra frågor i FAQ_GUIDER nedan när guiderna ändras.
(function (root) {
  const STOPP = [
    'och','att','det','en','ett','ar','jag','vi','du','som','for','pa','i','av','med','till',
    'hur','var','nar','vad','kan','om','den','de','man','far','ska','vill','mig','mitt','min',
    'din','ur','sa','an','inte','har','finns','fran','eller','men','sig','the','vara','blir','gor'
  ];

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const STOPP_SET = new Set(STOPP.map(norm));

  function tokens(text) {
    return norm(text).split(' ').filter(t => t.length >= 2 && !STOPP_SET.has(t));
  }

  // Ord matchar om de är lika, eller delar en tillräckligt lång prefix (grov ordstamning för svenska böjningar)
  function matchar(a, b) {
    if (a === b) return true;
    const min = Math.min(a.length, b.length);
    if (min < 4) return false;
    let p = 0;
    while (p < min && a[p] === b[p]) p++;
    return p >= 4 && p >= min - 3;
  }

  // entries: [{ q, a, kalla, nyckel: [] }]
  function sok(fraga, entries, max = 4) {
    const qt = tokens(fraga);
    if (!qt.length) return [];
    const hits = [];
    for (const e of entries) {
      const fF = tokens(e.q);
      const fN = tokens((e.nyckel || []).join(' '));
      const fA = tokens(e.a);
      let poang = 0;
      for (const t of qt) {
        let bast = 0;
        if (fF.some(d => matchar(t, d))) bast = Math.max(bast, 3);
        if (fN.some(d => matchar(t, d))) bast = Math.max(bast, 2);
        if (fA.some(d => matchar(t, d))) bast = Math.max(bast, 1);
        poang += bast;
      }
      if (poang > 0) hits.push({ e, poang });
    }
    hits.sort((x, y) => y.poang - x.poang);
    return hits.slice(0, max).map(h => h.e);
  }

  // Körinfo från choir_info: en post per stycke i content, och en per "På gång"-punkt.
  // Länkar utelämnas med avsikt (svar får bara innehålla kårens egna sidor).
  function korinfoPosts(row) {
    const out = [];
    if (!row) return out;
    String(row.content || '').split(/\n+/).map(s => s.trim()).filter(s => s.length >= 20).forEach(s => {
      out.push({ q: '', a: s, kalla: 'Körinfo', nyckel: [] });
    });
    (Array.isArray(row.upcoming) ? row.upcoming : []).forEach(u => {
      if (!u || !u.text) return;
      out.push({ q: u.title || '', a: u.text, kalla: 'På gång', nyckel: ['på gång', 'kommande', 'replokal', 'spelning'] });
    });
    return out;
  }

  const FAQ_GUIDER = [
    // Röstövning: medlem
    { q: 'Hur använder jag Röstövning?', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Gå till medlemsmenyn och välj Röstövning. Välj låt och din stämma (inget är förvalt). Under Sjung till bockar du i kompet. Lyssna med ▶ och tryck sedan 🎤 Sjung med. Noterna blir gröna när du träffar och röda när du missar.',
      nyckel: ['röstövning', 'öva', 'sjunga', 'notbana', 'träffa'] },
    { q: 'Varför måste jag använda hörlurar?', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Utan hörlurar hör mikrofonen musiken från högtalaren och räknar den som din sång, så resultatet blir fel.',
      nyckel: ['hörlurar', 'mikrofon', 'högtalare', 'musik'] },
    { q: 'Min röst ligger efter i notbanan', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Tryck 🎯 Kalibrera, sedan Starta, och klappa i takt med de 8 klicken. Det behövs bara en gång per telefon eller dator.',
      nyckel: ['kalibrera', 'efter', 'fördröjning', 'notbana', 'takt'] },
    { q: 'Låten syns inte i Röstövning', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Röstövning visar bara låtar som körledningen har gjort klara för röstövning, alltså där noterna är analyserade. Saknas en låt är den inte klar än. Fråga körledningen.',
      nyckel: ['låt', 'saknas', 'listan', 'klar'] },
    { q: 'Jag sjunger i fel oktav', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Kontrollera att Godkänn annan oktav är påslaget under ⚙ Fler inställningar. Då räknas det som träff även en eller två oktaver fel.',
      nyckel: ['oktav', 'fel', 'tenor', 'bas', 'godkänn'] },
    { q: 'Det är för svårt att få grönt', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Välj en lättare svårighetsgrad, till exempel Lätt eller Nybörjare. Du kan också trycka + för högre notblock.',
      nyckel: ['svårt', 'grönt', 'svårighetsgrad', 'lätt', 'nybörjare'] },
    { q: 'Mikrofonen fungerar inte', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Tillåt mikrofonen när webbläsaren frågar. Har du nekat tidigare, ändra det i webbläsarens inställningar för sidan.',
      nyckel: ['mikrofon', 'tillåt', 'fungerar', 'nekat'] },
    { q: 'Jag hör inget komp', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Bocka i Backtrack eller Instrumental under Sjung till. Finns de inte där har körledningen inte gjort dem valbara.',
      nyckel: ['komp', 'backtrack', 'instrumental', 'hör'] },
    { q: 'Var ser jag mina resultat?', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Under Min utveckling ser du dina sparade övningar, med senaste och bästa resultat. Bara du och körledningen ser siffrorna.',
      nyckel: ['resultat', 'utveckling', 'poäng', 'statistik', 'sparad'] },
    { q: 'Vad betyder träff och noter klara?', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Träff är hur stor del av tiden du legat rätt när det finns en not att sjunga. Noter klara är noter där du legat rätt minst 60 % av notens längd.',
      nyckel: ['träff', 'procent', 'klara', 'noter'] },
    { q: 'Vad är skillnaden mellan Sjung till och träff?', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Sjung till styr vad du hör i hörlurarna. Det påverkar inte vad som räknas som rätt. Det är träffen som avgör det.',
      nyckel: ['sjung till', 'hör', 'räknas', 'skillnad'] },
    { q: 'Vad är klick?', kalla: 'Guide för medlemmar: Röstövning',
      a: 'Klick är en metronom på låtens slag. Den syns bara när körledningen har ställt in tempot för låten.',
      nyckel: ['klick', 'metronom', 'tempo', 'slag'] },

    // Repertoar
    { q: 'Hur skapar jag en spellista?', kalla: 'Guide: Repertoar & texter',
      a: 'Gå till Repertoar, fliken Spellistor, skriv ett namn och tryck Skapa ny spellista. Lägg sedan till låtar med Lägg till i spellista, eller ＋ Spellista på låtraden.',
      nyckel: ['spellista', 'skapa', 'ny', 'lägga till'] },
    { q: 'Hur tystar jag en stämma i spelaren?', kalla: 'Guide: Repertoar & texter',
      a: 'Öppna Mixer ▾ i spellistan. Där finns en volymreglage per stämma och en knapp för att tysta den. Volymerna sparas.',
      nyckel: ['mixer', 'tysta', 'stämma', 'volym', 'spelaren'] },
    { q: 'Vad gör knapparna i spelaren?', kalla: 'Guide: Repertoar & texter',
      a: '⟳ spelar samma låt om och om igen. ⏮ ⏯ ⏭ är föregående, spela/pausa och nästa. 🎤 visar den synkade texten. ⛶ förstorar texten till helskärm.',
      nyckel: ['spelaren', 'knapp', 'helskärm', 'upprepa', 'nästa', 'text'] },
    { q: 'Varför rullar inte texten?', kalla: 'Guide: Repertoar & texter',
      a: 'Texten rullar bara om låten är synkad. Det är körledningen som synkar texten i Textsynk.',
      nyckel: ['text', 'rullar', 'synk', 'karaoke'] },
    { q: 'Var hittar jag sångtexter och noter?', kalla: 'Guide: Repertoar & texter',
      a: 'Under fliken Texter klickar du på namnet för att öppna dokumentet, eller på pilen för att ladda ner det. Du kan också trycka på 📄 i spelaren.',
      nyckel: ['noter', 'pdf', 'text', 'ladda ner', 'sångtext'] },
    { q: 'En stämma saknas i spellistan', kalla: 'Guide: Repertoar & texter',
      a: 'Stämman var inte ikryssad när låten lades till. Fäll ut låten under Låtar och lägg till den igen.',
      nyckel: ['stämma', 'saknas', 'spellista', 'kryssad'] },
    { q: 'Kan jag ladda ner stämfilerna?', kalla: 'Guide: Repertoar & texter',
      a: 'Nej. Bara admin och stämledare kan ladda ner stämfiler. Som medlem lyssnar du i spelaren.',
      nyckel: ['ladda ner', 'stämfil', 'ljud', 'spara'] },

    // Studio
    { q: 'Hur spelar jag in min stämma?', kalla: 'Studio – kom igång med att spela in stämmor',
      a: 'Öppna Studio från medlemsmenyn och välj låt. Sätt i hörlurarna, kalibrera en gång och klicka där du ska börja. Tryck ⏺ Spela in, och ■ Stoppa när du är klar. Namnge tagningen och tryck 💾 Spara inspelning.',
      nyckel: ['studio', 'spela in', 'inspelning', 'sjunga in', 'stämma'] },
    { q: 'Vem hör min inspelning?', kalla: 'Studio – kom igång med att spela in stämmor',
      a: 'Du väljer när du sparar: 🔒 Privat (bara du), 👥 Körledningen, eller 🌍 Alla i Studio för låten. Du kan ändra valet senare och spara igen.',
      nyckel: ['dela', 'synlig', 'privat', 'alla', 'körledningen', 'hör'] },
    { q: 'Varför ligger min inspelning efter i takt?', kalla: 'Studio – kom igång med att spela in stämmor',
      a: 'Kalibrera igen, särskilt om du använder trådlösa hörlurar. Du kan också flytta spåret i sidled med ↔ Flytta.',
      nyckel: ['efter', 'takt', 'kalibrera', 'trådlösa', 'flytta'] },
    { q: 'Var hittar jag mina inspelningar?', kalla: 'Studio – kom igång med att spela in stämmor',
      a: 'Under Mina inspelningar längst ned på Studio-sidan. Där tar knappen Öppna dig direkt till låten och inspelningen.',
      nyckel: ['mina inspelningar', 'hitta', 'öppna', 'sparade'] },
    { q: 'Kan jag ändra i en stämma som redan finns?', kalla: 'Studio – kom igång med att spela in stämmor',
      a: 'Låtens stämmor är låsta. Tryck ⧉ Kopia på stämmans rad för att få en egen kopia att redigera. Originalet påverkas inte.',
      nyckel: ['ändra', 'låst', 'kopia', 'redigera', 'stämma'] },
    { q: 'Hur får jag en mix av det jag hör?', kalla: 'Studio – kom igång med att spela in stämmor',
      a: '⬇ Mix av det som hörs laddar ner allt som är påslaget som en ljudfil. ⬇ Bara spåret laddar ner bara din tagning.',
      nyckel: ['mix', 'ladda ner', 'fil', 'spåret'] },
    { q: 'Kan jag använda Studio i mobilen?', kalla: 'Studio – kom igång med att spela in stämmor',
      a: 'Studio fungerar bäst på dator. Röstverktyg och Markera visas bara på dator. Byt till dator för att putsa inspelningen.',
      nyckel: ['mobil', 'telefon', 'dator', 'surfplatta'] },

    // Låt datorn sjunga
    { q: 'Hur låter jag datorn sjunga stämman?', kalla: 'Låt datorn sjunga stämman',
      a: 'Hämta MIDI-filen i Studio under 🤖 Låt datorn sjunga stämman. Öppna den i MuseScore med Muse Choir-ljudet (enklast), eller i OpenUtau med en AI-röst. Exportera som ljudfil och ladda in den i Studio med 📂 Ladda in ljudfil.',
      nyckel: ['datorn', 'sjunga', 'midi', 'museScore', 'openutau', 'stämman'] },
    { q: 'Det finns inga noter att ladda ner', kalla: 'Låt datorn sjunga stämman',
      a: 'Låten saknar notanalys. Be körledningen analysera stämmorna i Röstövning.',
      nyckel: ['noter', 'midi', 'inga', 'analys'] },

    // Stämledare och admin
    { q: 'Vad kan en stämledare göra?', kalla: 'Att vara stämledare i Heavy Voices',
      a: 'Stämledare får redigera låtar, Röstövning, Studio och Information. Stämledare har ingen åtkomst till medlemshantering, kalender eller övrig administration.',
      nyckel: ['stämledare', 'behörighet', 'rättigheter', 'roll'] },
    { q: 'Hur blir jag stämledare?', kalla: 'Att vara stämledare i Heavy Voices',
      a: 'En admin väljer Stämledare i rollväljaren vid ditt namn under Medlemmar. Då visas knappen 🎼 Stämledarverktyg på Huvudmeny.',
      nyckel: ['stämledare', 'bli', 'roll', 'admin'] },
    { q: 'Hur gör jag en låt synlig för medlemmarna?', kalla: 'Guide: Repertoar & texter',
      a: 'En ny låt är dold tills du trycker 👁‍🗨 Dold överst på kortet så att den blir 👁 Synlig.',
      nyckel: ['synlig', 'dold', 'publicera', 'låt'] },
    { q: 'Hur synkar jag sångtexten?', kalla: 'Guide för stämledare och admin: Röstövning och Textsynk',
      a: 'Öppna 🎤 Redigera text & synk, spela låten och håll in Mellanslag eller TAP medan raden sjungs. Nedtryckning sätter start, släpp sätter slut. Tryck Spara synk när du är klar.',
      nyckel: ['synka', 'text', 'textsynk', 'rad', 'tajma'] },
    { q: 'Mina ändringar syns inte för medlemmarna', kalla: 'Guide för stämledare och admin: Röstövning och Textsynk',
      a: 'Du har troligen inte sparat. Tryck 💾 Spara noter i Röstövning, eller Spara synk i Textsynk.',
      nyckel: ['ändring', 'spara', 'syns inte', 'medlemmarna'] },
    { q: 'Hur analyserar jag stämmorna?', kalla: 'Guide för stämledare och admin: Röstövning och Textsynk',
      a: 'I Röstövning väljer du låten och trycker Analysera alla sångstämmor. Backtrack, Instrumental och Full hoppas över. Det tar några sekunder per stämma.',
      nyckel: ['analys', 'analysera', 'noter', 'stämmor'] },

    // Mobil
    { q: 'Hur installerar jag appen på mobilen?', kalla: 'Installera Heavy Voices på mobilen',
      a: 'iPhone: öppna heavyvoices.se i Safari, tryck på Dela och välj Lägg till på hemskärmen. Android: tryck på Installera appen längst ner på medlemssidan och sedan Installera.',
      nyckel: ['installera', 'app', 'mobil', 'hemskärm', 'iphone', 'android'] },
    { q: 'Jag öppnade länken från Facebook', kalla: 'Installera Heavy Voices på mobilen',
      a: 'Tryck på menyn i hörnet och välj Öppna i webbläsare. Gör sedan installationen därifrån.',
      nyckel: ['facebook', 'messenger', 'öppna', 'webbläsare'] }
  ];

  const FALLBACK = 'Hittar du inte svaret? Fråga körledningen.';

  function visa(container, hits) {
    container.textContent = '';
    if (!hits.length) {
      const p = document.createElement('p');
      p.className = 'text-muted';
      p.textContent = 'Inget hittades. Prova andra ord, eller fråga körledningen.';
      container.appendChild(p);
      return;
    }
    hits.forEach(h => {
      const box = document.createElement('div');
      box.className = 'faq-hit';
      if (h.q) {
        const t = document.createElement('strong');
        t.textContent = h.q;
        box.appendChild(t);
      }
      const p = document.createElement('p');
      p.textContent = h.a;
      box.appendChild(p);
      const s = document.createElement('small');
      s.className = 'text-muted';
      s.textContent = 'Källa: ' + h.kalla;
      box.appendChild(s);
      container.appendChild(box);
    });
  }

  let korinfo = [];

  async function laddaKorinfo() {
    try {
      if (!root.supabaseClient) return;
      const { data, error } = await root.supabaseClient.from('choir_info')
        .select('content,upcoming').eq('id', 1).maybeSingle();
      if (!error && data) korinfo = korinfoPosts(data);
    } catch (e) { /* utan körinfo söker vi bara i guiderna */ }
  }

  function monta() {
    const form = document.getElementById('faqForm');
    const input = document.getElementById('faqInput');
    const results = document.getElementById('faqResults');
    if (!form || !input || !results) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fraga = input.value.trim().slice(0, 200);
      if (!fraga) { results.textContent = ''; return; }
      visa(results, sok(fraga, FAQ_GUIDER.concat(korinfo)));
    });
    laddaKorinfo();
  }

  root.HVFaq = { sok, tokens, korinfoPosts, FAQ_GUIDER, FALLBACK };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monta);
  else monta();
})(window);
