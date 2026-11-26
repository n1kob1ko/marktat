import type { StaticImageData } from 'next/image';
import { KATEGORIE_BILDER } from './category-images';

/**
 * Bilder für die Kategorie-Kacheln (Startseite, Suche und Deals).
 *
 * Die meisten sind eigene, für Markterl erstellte Bilder (alle im gleichen Stil, siehe `category-images.ts`), liegen im
 * Projekt und werden mit dem Rest der Seite ausgeliefert. Wo es noch keins gibt, nehmen wir ein Unsplash-Foto
 * (Unsplash-Lizenz: kostenlos, auch kommerziell; die Fotografen nennen wir im Impressum). Die holt und verkleinert
 * unser eigener Server über die Bildoptimierung von Next.js: Besucher laden nichts direkt bei Unsplash.
 *
 * Schlüssel ist der Kategoriepfad (bzw. der Bereich). Fehlt ein Eintrag, zeigt die Kachel das Kategorie-Symbol bzw. die
 * Suchseite ihre schlichte Liste.
 */
export interface UnsplashPhoto {
  /** Pfad auf images.unsplash.com (ohne Parameter) */
  src: string;
  /** Unsplash-ID (für den Link zur Fotoseite) */
  id: string;
  author: string;
  username: string;
  /** Hauptfarbe des Fotos – Hintergrund, solange es lädt */
  color: string;
}

/** Eigenes Bild aus `src/assets/kategorien` */
export interface LocalCategoryImage {
  image: StaticImageData;
  /** Hintergrund, solange es lädt */
  color: string;
}

export type CategoryPhoto = UnsplashPhoto | LocalCategoryImage;

export const isUnsplashPhoto = (photo: CategoryPhoto): photo is UnsplashPhoto => 'id' in photo;

const photo = (src: string, id: string, author: string, username: string, color: string): UnsplashPhoto => ({ src, id, author, username, color });

/** Unsplash-Fotos für Kategorien, die noch kein eigenes Bild haben */
const UNSPLASH_PHOTOS: Record<string, UnsplashPhoto> = {
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

  // Deal-Kategorien ohne passende Marktplatz-Kategorie
  'deals/haushalt-kueche': photo('photo-1707241358597-bafcc8a8e73d', 'A_90G6Ta56A', 'Jakub Żerdzicki', 'jakubzerdzicki', '#595959'),
  'deals/lebensmittel': photo('photo-1588964895597-cfccd6e2dbf9', '8RaUEd8zD-U', 'Maria Lin Kim', 'mrsmaria', '#d9c08c'),
  'deals/reisen-freizeit': photo('photo-1473625247510-8ceb1760943f', '_g1WdcKcV3w', 'Mantas Hesthaven', 'mantashesthaven', '#260c0c'),
};

export const CATEGORY_PHOTOS: Record<string, CategoryPhoto> = { ...UNSPLASH_PHOTOS, ...KATEGORIE_BILDER };

/** Unsplash-Fotos, die tatsächlich noch angezeigt werden (für die Namensnennung im Impressum) */
export const USED_UNSPLASH_PHOTOS: UnsplashPhoto[] = Object.values(CATEGORY_PHOTOS).filter(isUnsplashPhoto);

/** Fotos der Deal-Kategorien: eigene (`deals/<slug>`) oder die der verwandten Marktplatz-Kategorie */
const DEAL_PHOTO_KEYS: Record<string, string> = {
  'elektronik-computer': 'marktplatz/computer-software',
  'smartphones-tablets': 'marktplatz/smartphones-telefonie',
  gaming: 'marktplatz/games-konsolen',
  'tv-audio': 'marktplatz/kameras-tv-multimedia',
  'moebel-wohnen': 'marktplatz/wohnen-haushalt-gastronomie',
  'baumarkt-garten': 'marktplatz/haus-garten-werkstatt',
  'mode-schuhe': 'marktplatz/mode-accessoires',
  'sport-freizeit': 'marktplatz/sport-sportgeraete',
  'baby-familie': 'marktplatz/baby-kind',
  autozubehoer: 'auto-motor/fahrzeugzubehoer',
  drogerie: 'marktplatz/beauty-gesundheit-wellness',
  'sonstige-angebote': 'marktplatz/sonstiges',
};

export function dealCategoryPhoto(slug: string, relatedCategoryPath?: string | null): CategoryPhoto | undefined {
  return (
    CATEGORY_PHOTOS[`deals/${slug}`] ??
    (DEAL_PHOTO_KEYS[slug] ? CATEGORY_PHOTOS[DEAL_PHOTO_KEYS[slug]] : undefined) ??
    (relatedCategoryPath ? nearestCategoryPhoto(relatedCategoryPath) : undefined)
  );
}

export const UNSPLASH_ORIGIN = 'https://images.unsplash.com';

/**
 * Quelle für `next/image`: das eigene Bild oder die Unsplash-URL in passender Größe (Unsplash schneidet zu; Next.js
 * optimiert danach noch einmal).
 */
export function categoryPhotoSrc(photo: CategoryPhoto, width = 640): string | StaticImageData {
  if (!isUnsplashPhoto(photo)) return photo.image;
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
