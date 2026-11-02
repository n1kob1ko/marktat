/**
 * Kategoriepfade vor dem Umbau des Marktplatzes (November 2026) → neue Pfade.
 *
 * Wird verwendet, um bestehende Inserate und gespeicherte Suchen beim Grunddaten-Import (`pnpm db:seed`)
 * umzuziehen und alte Links (…/suche?kategorie=marktplatz/elektronik) weiterzuleiten. Einträge nie entfernen:
 * alte Links und Lesezeichen gibt es weiter.
 */
export const LEGACY_CATEGORY_PATHS: Readonly<Record<string, string>> = {
  'marktplatz/elektronik': 'marktplatz/computer-software',
  'marktplatz/elektronik/handys-smartphones': 'marktplatz/smartphones-telefonie/smartphones',
  'marktplatz/elektronik/computer-laptops': 'marktplatz/computer-software/laptops-pcs',
  'marktplatz/elektronik/tablets-e-reader': 'marktplatz/computer-software/tablets-e-reader',
  'marktplatz/elektronik/tv-audio': 'marktplatz/kameras-tv-multimedia/fernseher',
  'marktplatz/elektronik/foto-kamera': 'marktplatz/kameras-tv-multimedia/fotokameras',
  'marktplatz/elektronik/konsolen-games': 'marktplatz/games-konsolen/konsolen',
  'marktplatz/elektronik/elektronik-zubehoer': 'marktplatz/computer-software/kabel-adapter-zubehoer',

  'marktplatz/moebel-wohnen': 'marktplatz/wohnen-haushalt-gastronomie',
  'marktplatz/moebel-wohnen/sofas-sessel': 'marktplatz/wohnen-haushalt-gastronomie/sofas-sessel',
  'marktplatz/moebel-wohnen/tische-stuehle': 'marktplatz/wohnen-haushalt-gastronomie/tische-stuehle',
  'marktplatz/moebel-wohnen/betten-matratzen': 'marktplatz/wohnen-haushalt-gastronomie/betten-matratzen',
  'marktplatz/moebel-wohnen/schraenke-regale': 'marktplatz/wohnen-haushalt-gastronomie/schraenke-regale',
  'marktplatz/moebel-wohnen/kuechen': 'marktplatz/wohnen-haushalt-gastronomie/kuechen',
  'marktplatz/moebel-wohnen/lampen-leuchten': 'marktplatz/wohnen-haushalt-gastronomie/lampen-leuchten',
  'marktplatz/moebel-wohnen/deko-accessoires': 'marktplatz/wohnen-haushalt-gastronomie/deko-accessoires',

  'marktplatz/kleidung-mode': 'marktplatz/mode-accessoires',
  'marktplatz/kleidung-mode/damenmode': 'marktplatz/mode-accessoires/damenmode/weitere-damenmode',
  'marktplatz/kleidung-mode/herrenmode': 'marktplatz/mode-accessoires/herrenmode/weitere-herrenmode',
  'marktplatz/kleidung-mode/schuhe': 'marktplatz/mode-accessoires/schuhe',
  'marktplatz/kleidung-mode/taschen-accessoires': 'marktplatz/mode-accessoires/taschen-rucksaecke',
  'marktplatz/kleidung-mode/schmuck-uhren': 'marktplatz/uhren-schmuck/sonstiges',

  'marktplatz/sport-freizeit': 'marktplatz/sport-sportgeraete',
  'marktplatz/sport-freizeit/fahrraeder': 'marktplatz/sport-sportgeraete/fahrraeder',
  'marktplatz/sport-freizeit/wintersport': 'marktplatz/sport-sportgeraete/wintersport/weiterer-wintersport',
  'marktplatz/sport-freizeit/fitness': 'marktplatz/sport-sportgeraete/fitness-kraftsport',
  'marktplatz/sport-freizeit/camping-outdoor': 'marktplatz/sport-sportgeraete/camping-outdoor',
  'marktplatz/sport-freizeit/musikinstrumente': 'marktplatz/freizeit-instrumente-kulinarik/musikinstrumente/weitere-instrumente',
  'marktplatz/sport-freizeit/buecher-filme-musik': 'marktplatz/buecher-filme-musik/sonstiges',

  'marktplatz/baby-kind/kinderwagen': 'marktplatz/baby-kind/kinderwagen-buggys',
  'marktplatz/baby-kind/kinderkleidung': 'marktplatz/baby-kind/kinderbekleidung',
  'marktplatz/baby-kind/spielzeug': 'marktplatz/spielen-spielzeug/sonstiges',

  'marktplatz/haushalt': 'marktplatz/wohnen-haushalt-gastronomie',
  'marktplatz/haushalt/haushaltsgeraete': 'marktplatz/wohnen-haushalt-gastronomie/haushaltsgeraete/weitere-haushaltsgeraete',
  'marktplatz/haushalt/kueche-geschirr': 'marktplatz/wohnen-haushalt-gastronomie/kueche-geschirr',
  'marktplatz/haushalt/werkzeug-heimwerken': 'marktplatz/haus-garten-werkstatt/handwerkzeug',
  'marktplatz/haushalt/reinigung': 'marktplatz/wohnen-haushalt-gastronomie/reinigung-pflege',

  'marktplatz/garten': 'marktplatz/haus-garten-werkstatt/garten',
  'marktplatz/garten/gartenmoebel': 'marktplatz/haus-garten-werkstatt/garten/gartenmoebel',
  'marktplatz/garten/gartengeraete': 'marktplatz/haus-garten-werkstatt/garten/gartengeraete',
  'marktplatz/garten/pflanzen': 'marktplatz/haus-garten-werkstatt/garten/pflanzen-samen',
  'marktplatz/garten/grillen': 'marktplatz/haus-garten-werkstatt/garten/grillen',

  'marktplatz/weitere-kategorien': 'marktplatz/sonstiges',
  'marktplatz/weitere-kategorien/tiere-tierbedarf': 'marktplatz/tiere-tierbedarf/tierbedarf',
  'marktplatz/weitere-kategorien/sammeln-antiquitaeten': 'marktplatz/antiquitaeten-kunst/sammeln-raritaeten',
  'marktplatz/weitere-kategorien/tickets-gutscheine': 'marktplatz/freizeit-instrumente-kulinarik/tickets-gutscheine',
  'marktplatz/weitere-kategorien/sonstiges': 'marktplatz/sonstiges',
};

/** Neuer Pfad für einen alten Kategoriepfad (sonst der Pfad selbst) */
export function currentCategoryPath(path: string): string {
  return LEGACY_CATEGORY_PATHS[path] ?? path;
}
