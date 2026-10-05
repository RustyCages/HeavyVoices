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
window.ROCK_ARTISTS = [...new Set(window.ROCK_ARTISTS)];
