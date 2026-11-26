import type { LocalCategoryImage } from './category-photos';
import antiquitaetenKunst from '@/assets/kategorien/antiquitaeten-kunst.jpg';
import babyKind from '@/assets/kategorien/baby-kind.jpg';
import beautyGesundheit from '@/assets/kategorien/beauty-gesundheit.jpg';
import boote from '@/assets/kategorien/boote.jpg';
import buecherFilmeMusik from '@/assets/kategorien/buecher-filme-musik.jpg';
import computerSoftware from '@/assets/kategorien/computer-software.jpg';
import dienstleistungen from '@/assets/kategorien/dienstleistungen.jpg';
import freizeitInstrumente from '@/assets/kategorien/freizeit-instrumente.jpg';
import gamesKonsolen from '@/assets/kategorien/games-konsolen.jpg';
import hausGarten from '@/assets/kategorien/haus-garten.jpg';
import kamerasTv from '@/assets/kategorien/kameras-tv.jpg';
import mode from '@/assets/kategorien/mode.jpg';
import smartphones from '@/assets/kategorien/smartphones.jpg';
import sonstiges from '@/assets/kategorien/sonstiges.jpg';
import spielzeug from '@/assets/kategorien/spielzeug.jpg';
import sport from '@/assets/kategorien/sport.jpg';
import tiere from '@/assets/kategorien/tiere.jpg';
import uhrenSchmuck from '@/assets/kategorien/uhren-schmuck.jpg';
import wohnenHaushalt from '@/assets/kategorien/wohnen-haushalt.jpg';

/**
 * Eigene Kategorie-Bilder für Markterl (mit KI erstellt, Stil „Studio“: echte Gegenstände auf ruhigem Blaugrau, Licht
 * von links oben, unteres Drittel frei für den Namen). Schlüssel wie in `category-photos.ts`.
 * Neue Bilder: JPEG 1200 × 896 in `src/assets/kategorien/`, hier importieren und eintragen.
 */
export const KATEGORIE_BILDER: Record<string, LocalCategoryImage> = {
  'marktplatz/antiquitaeten-kunst': { image: antiquitaetenKunst, color: '#b3bbc0' },
  'marktplatz/baby-kind': { image: babyKind, color: '#b5b9ba' },
  'marktplatz/beauty-gesundheit-wellness': { image: beautyGesundheit, color: '#bac1c5' },
  'marktplatz/boote-yachten-jetskis': { image: boote, color: '#bdbcc0' },
  'marktplatz/buecher-filme-musik': { image: buecherFilmeMusik, color: '#abb3b6' },
  'marktplatz/computer-software': { image: computerSoftware, color: '#aeb8c1' },
  'marktplatz/dienstleistungen': { image: dienstleistungen, color: '#a6b0b9' },
  'marktplatz/freizeit-instrumente-kulinarik': { image: freizeitInstrumente, color: '#9a9fa2' },
  'marktplatz/games-konsolen': { image: gamesKonsolen, color: '#b6c1cb' },
  'marktplatz/haus-garten-werkstatt': { image: hausGarten, color: '#b9c2c3' },
  'marktplatz/kameras-tv-multimedia': { image: kamerasTv, color: '#b2bdc6' },
  'marktplatz/mode-accessoires': { image: mode, color: '#a6aeb4' },
  'marktplatz/smartphones-telefonie': { image: smartphones, color: '#a5afb9' },
  'marktplatz/sonstiges': { image: sonstiges, color: '#b4b7b7' },
  'marktplatz/spielen-spielzeug': { image: spielzeug, color: '#bdc2c3' },
  'marktplatz/sport-sportgeraete': { image: sport, color: '#a7b2b8' },
  'marktplatz/tiere-tierbedarf': { image: tiere, color: '#b7bdbd' },
  'marktplatz/uhren-schmuck': { image: uhrenSchmuck, color: '#bac1c7' },
  'marktplatz/wohnen-haushalt-gastronomie': { image: wohnenHaushalt, color: '#b9bbbc' },
};
