/**
 * Fotos für die Kategorie-Kacheln (Startseite und Suche) (Unsplash-Lizenz: kostenlos, auch kommerziell, ohne Pflicht zur
 * Namensnennung – wir nennen die Fotografen trotzdem im Impressum). Ausgeliefert werden sie über die
 * Bildoptimierung von Next.js von unserem eigenen Server: Besucher laden nichts direkt bei Unsplash.
 *
 * Schlüssel ist der Kategoriepfad (bzw. der Bereich). Fehlt ein Eintrag, zeigt die Kachel das Kategorie-Symbol bzw. die
 * Suchseite ihre schlichte Liste.
 */
export interface CategoryPhoto {
  /** Pfad auf images.unsplash.com (ohne Parameter) */
  src: string;
  /** Unsplash-ID (für den Link zur Fotoseite) */
  id: string;
  author: string;
  username: string;
  /** Hauptfarbe des Fotos – Hintergrund, solange es lädt */
  color: string;
}

const photo = (src: string, id: string, author: string, username: string, color: string): CategoryPhoto => ({ src, id, author, username, color });

export const CATEGORY_PHOTOS: Record<string, CategoryPhoto> = {
  'marktplatz/antiquitaeten-kunst': photo('photo-1443884590026-2e4d21aee71c', 'Aq7paIaerrY', 'Christelle Bourgeois', 'calliframe', '#260c0c'),
  'marktplatz/baby-kind': photo('photo-1515488042361-ee00e0ddd4e4', 'p0hDztR46cw', 'Yuri Li', 'itshoobastank', '#d9d9d9'),
  'marktplatz/beauty-gesundheit-wellness': photo('photo-1583209814683-c023dd293cc6', 'dMjkQJs58uo', 'pmv chamara', 'pmvch', '#f3d9d9'),
  'marktplatz/boote-yachten-jetskis': photo('photo-1499365265913-51eac7765412', 'R4lFk-d37ng', 'Eric Ward', 'ericjamesward', '#404040'),
  'marktplatz/buecher-filme-musik': photo('photo-1483412033650-1015ddeb83d1', 'T3mKJXfdims', 'blocks', 'blocks', '#594026'),
  'marktplatz/computer-software': photo('photo-1496181133206-80ce9b88a853', '1SAnrIxw5OY', 'Kari Shea', 'karishea', '#d9d9d9'),
  'marktplatz/dienstleistungen': photo('photo-1645651964715-d200ce0939cc', 'EJU7A__krX0', 'benjamin lehman', 'abject', '#260c0c'),
  'marktplatz/freizeit-instrumente-kulinarik': photo('photo-1510915361894-db8b60106cb1', 'fCEJGBzAkrU', 'Jefferson Santos', 'jefflssantos', '#402626'),
  'marktplatz/games-konsolen': photo('photo-1612287230202-1ff1d85d1bdf', 'hUD0PUczwJQ', 'Javier Martínez', 'cjdante', '#73f3f3'),
  'marktplatz/haus-garten-werkstatt': photo('photo-1611843467160-25afb8df1074', 'q13Zq1Jufks', 'Sandie Clarke', 'honeypoppet', '#a68c73'),
  'marktplatz/kameras-tv-multimedia': photo('photo-1510127034890-ba27508e9f1c', 'F3Dde_9thd8', 'NordWood Themes', 'nordwood', '#d9d9d9'),
  'marktplatz/mode-accessoires': photo('photo-1558769132-cb1aea458c5e', 'TS--uNw-JqE', 'Alyssa Strohmann', 'anotherlovely', '#d9c0c0'),
  'marktplatz/smartphones-telefonie': photo('photo-1592890288564-76628a30a657', 'wK-elt11pF0', 'Jonas Leupe', 'jonasleupe', '#a6a6a6'),
  'marktplatz/spielen-spielzeug': photo('photo-1545558014-8692077e9b5c', 'gDiRwIYAMA8', 'Vanessa Bucceri', 'vbcreative', '#f3f3f3'),
  'marktplatz/sport-sportgeraete': photo('photo-1532298229144-0ec0c57515c7', 'yjAFnkLtKY0', 'Mikkel Bech', 'bechbox', '#262626'),
  'marktplatz/tiere-tierbedarf': photo('photo-1561037404-61cd46aa615b', 'N04FIfHhv_k', 'Victor G', 'victor_vector', '#f3d9c0'),
  'marktplatz/uhren-schmuck': photo('photo-1523170335258-f5ed11844a49', 'TJrkkhdB39E', 'John Torcasio', 'johntorcasio', '#8c8c8c'),
  'marktplatz/wohnen-haushalt-gastronomie': photo('photo-1555041469-a586c61ea9bc', 'fZuleEfeA1Q', 'Phillip Goldsberry', 'phillipgold', '#d9d9d9'),
  'marktplatz/sonstiges': photo('photo-1597668900045-b9283c0de174', 'fi6kmznklGQ', 'Nikola Đuza', 'nikolalsvk', '#c0a68c'),

  // Bereiche (Suche ohne Bereich: „Alle Bereiche“)
  marktplatz: photo('photo-1516382461343-35e1ba016e01', 'U3FPDpXQjCY', 'Jon Tyson', 'jontyson', '#262626'),
  'auto-motor': photo('photo-1772198549931-e22ded0b35c8', 'RrvBAdU52w8', 'Alin Andersen', 'onixion', '#404040'),
  immobilien: photo('photo-1667861135218-d8f65699d585', 'qH_bngYUSac', 'Jake Raimer', 'jakeraimer', '#260c0c'),
  jobs: photo('photo-1521791136064-7986c2920216', 'n95VMLxqM2I', 'Cytonn Photography', 'cytonn_photography', '#262626'),

  // Auto & Motor
  'auto-motor/gebrauchtwagen': photo('photo-1565043666747-69f6646db940', 'aZKJEvydrNM', 'Obi', 'obionyeador', '#262626'),
  'auto-motor/neuwagen': photo('photo-1643142314913-0cf633d9bbb5', 'bC5NNbwuoB0', 'Crosby Hinze', 'crosbyhinze', '#404040'),
  'auto-motor/motorraeder': photo('photo-1568772585407-9361f9bf3a87', 'f_gCjlNcVWo', 'Kirill Petropavlov', 'kp89_', '#262626'),
  'auto-motor/wohnmobile-wohnwagen': photo('photo-1515876305430-f06edab8282a', 'Mta8r0bxhbo', 'Kevin Schmid', 'lighttouchedphotography', '#260c0c'),
  'auto-motor/nutzfahrzeuge': photo('photo-1587813369290-091c9d432daf', '3vlGNkDep4E', 'Markus Winkler', 'markuswinkler', '#8c8c73'),
  'auto-motor/fahrzeugzubehoer': photo('photo-1601411101851-ea0e07766235', 'Irdm0-tevPc', 'Obi', 'obionyeador', '#262626'),

  // Immobilien
  'immobilien/wohnungen': photo('photo-1613575831056-0acd5da8f085', 'xtDpXi_a-YQ', 'Med Badr Chemmaoui', 'medbadrc', '#c0a68c'),
  'immobilien/haeuser': photo('photo-1516281717304-181e285c6e58', '_jmagbo2dnk', 'Wynand van Poortvliet', 'wwwynand', '#59590c'),
  'immobilien/grundstuecke': photo('photo-1717446585456-15dcbb9f039c', 'lNj-b8JbI8o', 'Bernd Dittrich', 'hdbernd', '#0c4073'),
  'immobilien/gewerbeimmobilien': photo('photo-1579900081514-6579e0e21d24', 'LTt9vVOMKfw', 'Bruce Williamson', 'rbw500', '#8ca6a6'),
  'immobilien/garagen-parkplaetze': photo('photo-1495435229349-e86db7bfa013', 'orGJcWVI6js', 'Quilia', 'heyquilia', '#262626'),

  // Jobs
  'jobs/vollzeit': photo('photo-1522071820081-009f0129c71c', 'QckxruozjRg', 'Annie Spratt', 'anniespratt', '#262626'),
  'jobs/teilzeit': photo('photo-1461988366670-48e401bafb0a', 'aw6UewokOIo', 'Crew', 'crew', '#262626'),
  'jobs/lehrstellen': photo('photo-1546964432-2ca7fcd08632', '38OOhn_R6aA', 'Vance Osterhout', 'rankandfiledostoevsky', '#f3f3f3'),
  'jobs/praktika': photo('photo-1515378960530-7c0da6231fb1', 'mfB1B1s4sMc', 'Christin Hume', 'christinhumephoto', '#d9d9d9'),
  'jobs/geringfuegige-beschaeftigung': photo('photo-1595475038705-1af15f928681', 'UYaBqDP6JoY', 'Brooke Cagle', 'brookecagle', '#f3f3f3'),
  'jobs/freelance': photo('photo-1605719125065-3dd9e3f79057', 'RgPQNvoIcdg', 'Helena Lopes', 'helenalopesph', '#d9d9d9'),
};

export const UNSPLASH_ORIGIN = 'https://images.unsplash.com';

/** Bild-URL in passender Größe (Unsplash schneidet zu; Next.js optimiert danach noch einmal) */
export function categoryPhotoUrl(photo: CategoryPhoto, width = 640) {
  return `${UNSPLASH_ORIGIN}/${photo.src}?w=${width}&h=${Math.round(width * 0.75)}&fit=crop&crop=entropy&auto=format&q=70`;
}

/** Foto der Kategorie oder, wenn sie keins hat, der nächsthöheren (marktplatz/elektronik/handys → marktplatz/elektronik → marktplatz) */
export function nearestCategoryPhoto(path: string): CategoryPhoto | undefined {
  const segments = path.split('/');
  for (let i = segments.length; i > 0; i--) {
    const found = CATEGORY_PHOTOS[segments.slice(0, i).join('/')];
    if (found) return found;
  }
  return undefined;
}
