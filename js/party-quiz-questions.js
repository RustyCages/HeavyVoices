// Rockquiz – artistlista för de online-baserade omgångarna (medlem/party-quiz.html).
// Frågorna i övrigt hämtas från the-trivia-api.com vid varje quiz.

// Artister för de online-baserade omgångarna "Gissa låten" (iTunes-klipp) och "Fortsätt raden"
// (texter från LRCLIB). Varje quiz slumpar några av dem. Lägg gärna till fler.
window.ROCK_ARTISTS = [
  'AC/DC', 'Aerosmith', 'Alice Cooper', 'Alice In Chains', 'Avenged Sevenfold', 'Black Sabbath', 'Blue Öyster Cult',
  'Bon Jovi', 'Bruce Springsteen', 'Bryan Adams', 'Def Leppard', 'Deep Purple', 'Dio', 'Dire Straits', 'Disturbed',
  'Europe', 'Evanescence', 'Extreme', 'Foo Fighters', 'Foreigner', 'Ghost', 'Green Day', "Guns N' Roses",
  'Hammerfall', 'Heart', 'Iron Maiden', 'Joan Jett & The Blackhearts', 'Journey', 'Judas Priest', 'Kiss', 'Kent',
  'Led Zeppelin', 'Linkin Park', 'Lynyrd Skynyrd', 'Meat Loaf', 'Megadeth', 'Metallica', 'Motörhead', 'Mötley Crüe',
  'Muse', 'Nickelback', 'Nightwish', 'Nirvana', 'Ozzy Osbourne', 'Pearl Jam', 'Pink Floyd', 'Poison', 'Queen',
  'Rainbow', 'Rammstein', 'Red Hot Chili Peppers', 'R.E.M.', 'Rush', 'Sabaton', 'Scorpions', 'Skid Row', 'Slayer',
  'Soundgarden', 'Status Quo', 'Steppenwolf', 'Survivor', 'System Of A Down', 'The Cult', 'The Darkness', 'The Doors',
  'The Hellacopters', 'The Hives', 'The Killers', 'The Rolling Stones', 'The Who', 'Thin Lizzy', 'Toto', 'Twisted Sister',
  'U2', 'Van Halen', 'Volbeat', 'W.A.S.P.', 'Whitesnake', 'ZZ Top', 'Billy Idol', 'Billy Squier', 'Boston',
  'Creedence Clearwater Revival', 'Cheap Trick', 'Free', 'Gary Moore', 'Living Colour', 'Mr. Big', 'Ratt', 'Saxon',
  'Smashing Pumpkins', 'Stone Temple Pilots', 'Styx', 'Ted Nugent', 'Tesla', 'The Offspring', 'The Clash', 'Def Leppard',
  'Wolfmother', 'Rage Against The Machine', 'Queens Of The Stone Age', 'Thunder', 'Airbourne', 'Dio', 'Uriah Heep',
];
// Fler artister (okt 2026) – fler låtar, klipp och genererade frågor innan något upprepas
window.ROCK_ARTISTS = window.ROCK_ARTISTS.concat([
  // klassisk rock / 60–70-tal
  'The Beatles', 'The Kinks', 'The Animals', 'Cream', 'Jimi Hendrix', 'Jethro Tull', 'Genesis', 'Yes', 'Eagles',
  'Fleetwood Mac', 'Bad Company', 'Grand Funk Railroad', 'The Allman Brothers Band', 'Golden Earring', 'Sweet', 'Slade',
  'T. Rex', 'David Bowie', 'Kansas', 'REO Speedwagon', 'Blondie', 'Pat Benatar', 'Tom Petty', 'Bob Seger', 'Santana',
  'Supertramp', 'Electric Light Orchestra', 'Nazareth', 'Mountain', 'Humble Pie', 'Montrose', 'Ten Years After',
  // 80-tal / hårdrock / glam
  'Quiet Riot', 'Dokken', 'Cinderella', 'Warrant', 'Winger', 'Great White', 'Night Ranger', 'Loverboy', 'Krokus',
  'Accept', 'Helloween', 'Europe', 'Vixen', 'Lita Ford', 'Dee Snider', 'Bonfire', 'Gotthard', 'Treat', 'Pretty Maids',
  'Y&T', 'Asia', 'Heart', 'Kix', 'L.A. Guns', 'Faster Pussycat', 'Firehouse', 'Steelheart', 'Danger Danger',
  // metal
  'Pantera', 'Anthrax', 'Testament', 'Sepultura', 'Machine Head', 'Slipknot', 'Korn', 'Trivium', 'Lamb of God',
  'Five Finger Death Punch', 'Avantasia', 'Manowar', 'Blind Guardian', 'Dream Theater', 'Opeth', 'In Flames',
  'Amon Amarth', 'Arch Enemy', 'Within Temptation', 'Epica', 'Children of Bodom', 'Gojira', 'Mastodon', 'Tool',
  'Stratovarius', 'Dimmu Borgir', 'Bullet For My Valentine', 'Killswitch Engage', 'Trivium', 'Powerwolf', 'Lordi',
  // 90-tal / alternativ / grunge
  'Audioslave', 'Temple Of The Dog', 'Bush', 'Live', 'Collective Soul', 'Creed', 'Live', 'The Cranberries',
  'Radiohead', 'Oasis', 'Blur', 'Placebo', 'Marilyn Manson', 'Nine Inch Nails', 'White Zombie', 'Faith No More',
  'Jane\'s Addiction', 'Screaming Trees', 'Mudhoney', 'Hole', 'Weezer', 'Foo Fighters', 'Third Eye Blind', 'Incubus',
  // 2000-tal och framåt
  'Shinedown', 'Three Days Grace', 'Breaking Benjamin', 'Papa Roach', 'Godsmack', 'Staind', 'Seether', 'Daughtry',
  'Halestorm', 'Alter Bridge', 'Slash', 'Velvet Revolver', 'Royal Blood', 'Greta Van Fleet', 'Rival Sons',
  'The Struts', 'Måneskin', 'Black Stone Cherry', 'Bring Me The Horizon', 'Sleep Token', 'The White Stripes',
  'The Black Keys', 'Arctic Monkeys', 'The Strokes', 'Kings of Leon', 'Jet', 'My Chemical Romance', 'Fall Out Boy',
  'Paramore', 'Thirty Seconds To Mars', 'Biffy Clyro', 'Billy Talent', 'Sum 41', 'Blink-182', 'Rise Against',
  // Sverige och Norden
  'Ebba Grön', 'Imperiet', 'Magnus Uggla', 'Gyllene Tider', 'Roxette', 'Backyard Babies', 'Mustasch', 'Graveyard',
  'Soilwork', 'Dark Funeral', 'Candlemass', 'Bathory', 'Entombed', 'Dissection', 'Clawfinger', 'Thåström',
  'Hardcore Superstar', 'Crashdïet', 'H.E.A.T', 'Eclipse', 'Dynazty', 'Amaranthe', 'Avatar', 'Royal Republic',
  'Kent', 'Takida', 'Mando Diao', 'Sahara Hotnights', 'The Sounds', 'Sator', 'Wilmer X', 'Electric Boys',
  'Turbonegro', 'Mayhem', 'Hanoi Rocks', 'Children of Bodom', 'HIM', 'Stratovarius', 'Apocalyptica',
]);
window.ROCK_ARTISTS = [...new Set(window.ROCK_ARTISTS)];
