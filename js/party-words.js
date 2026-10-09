// Ordlistor för Mobilspel (medlem/party-spel.html): Ritleken och Mimleken.
// Lägg gärna till egna ord – en sträng per ord/uttryck.

// Saker som går att rita. Blandning av rock/kör och vardag.
window.DRAW_WORDS = [
  // rock & musik
  'Elgitarr', 'Trumset', 'Mikrofon', 'Förstärkare', 'Högtalare', 'Trumstock', 'Plektrum', 'Basgitarr', 'Keyboard', 'Hörlurar',
  'Kassettband', 'Vinylskiva', 'Notblad', 'Taktpinne', 'Scen', 'Strålkastare', 'Rökmaskin', 'Turnébuss', 'Backstagepass', 'Biljett',
  'Läderjacka', 'Nitarmband', 'Solglasögon', 'Långt hår', 'Tatuering', 'Dödskalle', 'Blixt', 'Eld', 'Pyroteknik', 'Konfetti',
  'Luftgitarr', 'Headbanging', 'Stagediving', 'Moshpit', 'Crowdsurfing', 'Djävulshorn', 'Encore', 'Soundcheck', 'Kör', 'Dirigent',
  'Stämgaffel', 'Metronom', 'Mikrofonstativ', 'Gitarrsolo', 'Trumsolo', 'Rockstjärna', 'Groupie', 'Festival', 'Tält', 'Lerig åker',
  'Öronproppar', 'Autograf', 'Guldskiva', 'Radio', 'Bergsprängare', 'Jukebox', 'Grammofon', 'Hammare', 'Kedja', 'Spik',
  // vardag & lättare
  'Katt', 'Hund', 'Kaffe', 'Pizza', 'Glass', 'Banan', 'Cykel', 'Bil', 'Flygplan', 'Båt',
  'Sol', 'Regn', 'Snögubbe', 'Julgran', 'Midsommarstång', 'Kräfta', 'Älg', 'Fyrtorn', 'Slott', 'Drake',
  'Spöke', 'Robot', 'Raket', 'Måne', 'Regnbåge', 'Paraply', 'Glasögon', 'Klocka', 'Nyckel', 'Lampa',
  'Säng', 'Badkar', 'Toalett', 'Telefon', 'Dator', 'Kamera', 'Ballong', 'Tårta', 'Present', 'Krona',
  'Svärd', 'Sköld', 'Pirat', 'Skattkista', 'Ö', 'Vulkan', 'Berg', 'Skog', 'Bro', 'Tåg',
  'Hjärta', 'Stjärna', 'Snigel', 'Fjäril', 'Spindel', 'Haj', 'Bläckfisk', 'Pingvin', 'Giraff', 'Elefant',
];

// Saker att mima (charader) – gärna rockigt och roligt att spela upp.
window.MIME_WORDS = [
  'Luftgitarr', 'Trumsolo', 'Headbanging', 'Stagediving', 'Crowdsurfing', 'Moshpit', 'Soundcheck', 'Krossa en gitarr',
  'Stämma en gitarr', 'Sjunga opera', 'Dirigera en kör', 'Sjunga i duschen', 'Karaoke', 'Ta en selfie med en rockstjärna',
  'Skriva autografer', 'Glömma texten', 'Vara backstage', 'Turnébuss på gropig väg', 'Roadie som bär förstärkare',
  'Festival i regn', 'Sova i tält', 'Öronproppar', 'Uppvärmning före konsert', 'Andningsövning', 'Falsk ton',
  'Rockstjärna som kastar plektrum', 'Publiken tänder mobillampor', 'Ringa in sig själv till encore', 'Pyroteknik som går fel',
  'Elgitarr med för kort sladd', 'DJ', 'Breakdance', 'Disco', 'Tango', 'Balett', 'Line dance', 'Robotdans',
  'Fiska', 'Köra bil', 'Rida', 'Simma', 'Klättra', 'Bowling', 'Golf', 'Tennis', 'Boxning', 'Yoga',
  'Laga mat', 'Diska', 'Dammsuga', 'Byta blöja', 'Sova', 'Vakna av väckarklockan', 'Bära tung väska', 'Gå i högklackat',
  'Äta spaghetti', 'Äta stark chili', 'Blåsa upp en ballong', 'Öppna en present', 'Bygga en snögubbe', 'Kasta snöboll',
  'Gå på lina', 'Trollkarl', 'Mumie', 'Zombie', 'Vampyr', 'Superhjälte', 'Astronaut', 'Pirat', 'Cowboy', 'Ninja',
];

// Vem i rummet …? – "Vem skulle mest troligt …"
window.WHO_PROMPTS = [
  'glömma texten mitt i en låt på scen', 'börja headbanga under en ballad', 'sjunga i duschen så att grannarna klagar',
  'bli rockstjärna på riktigt', 'komma för sent till repet', 'ha flest låtar på sin spellista som ingen annan känner till',
  'starta ett eget band imorgon', 'stagedive på nästa spelning', 'sjunga fel stämma utan att märka det',
  'kunna alla texter till ABBA utantill', 'ta med fel noter till konserten', 'vara den sista som går hem från festen',
  'spela luftgitarr i bilen vid rödljus', 'tatuera in kören', 'bli kompis med sångaren i sitt favoritband backstage',
  'dansa på bordet före midnatt', 'ha ett hemligt guilty pleasure-band', 'få ett skrattanfall mitt i en tyst del',
  'sova på bussen till spelningen', 'sjunga karaoke helt ensam', 'köpa en skinnjacka för dyra pengar',
  'bli igenkänd på stan', 'skriva kärleksbrev till en rockstjärna', 'sjunga högre än alla andra tillsammans',
  'öva hemma varje dag', 'tappa rösten efter en fest', 'gå på flest konserter i år', 'kunna spela trummor på allt',
  'prata med sina växter', 'gråta till en powerballad', 'bära solglasögon inomhus', 'vinna en luftgitarr-VM',
  'tycka att 80-talet var bäst', 'få hela publiken att sjunga med', 'hitta på egna ord när den glömmer texten',
  'ha flest konsertbiljetter sparade i en låda', 'bjuda hem hela kören på efterfest', 'dirigera kören bakom dirigentens rygg',
  'säga "en gång till!" efter sista låten', 'starta ett moshpit i en kyrka', 'åka på turné med ett band',
  'ha ett eget artistnamn redan', 'somna på soffan under festen', 'ringa in till radion och önska en låt',
  'bli kär i någon på en spelning', 'äta upp allt fikat på repet', 'ha på sig glitter en vanlig tisdag',
  'kunna sjunga baklänges', 'hamna på storbildsskärmen på en hockeymatch', 'vara bäst på att imitera kända sångare',
  'dyka upp utklädd utan att det är maskerad', 'bli först att hålla tal på festen', 'ta flest selfies under kvällen',
  'köra fel väg till spelningen', 'ha mest bakgrundsröster i sitt huvud', 'skriva en hit över en natt',
];
