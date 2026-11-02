/**
 * Fotos für die Kategorie-Kacheln auf der Startseite (Unsplash-Lizenz: kostenlos, auch kommerziell, ohne Pflicht zur
 * Namensnennung – wir nennen die Fotografen trotzdem unter /bildnachweise). Ausgeliefert werden sie über die
 * Bildoptimierung von Next.js von unserem eigenen Server: Besucher laden nichts direkt bei Unsplash.
 *
 * Schlüssel ist der Pfad der Hauptkategorie. Fehlt ein Eintrag, zeigt die Kachel das Kategorie-Symbol.
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
};

export const UNSPLASH_ORIGIN = 'https://images.unsplash.com';

/** Bild-URL in passender Größe (Unsplash schneidet zu; Next.js optimiert danach noch einmal) */
export function categoryPhotoUrl(photo: CategoryPhoto, width = 640) {
  return `${UNSPLASH_ORIGIN}/${photo.src}?w=${width}&h=${Math.round(width * 0.75)}&fit=crop&crop=entropy&auto=format&q=70`;
}
