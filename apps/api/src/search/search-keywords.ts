/**
 * Alltags- und österreichische Wörter je Kategorie, damit die Suche auch findet, was im Titel nicht steht:
 * „Auto“ findet den „VW Golf“ in Gebrauchtwagen, „Handy“ das „iPhone 14“, „Radl“ das „Citybike“.
 *
 * Synonyme von Meilisearch helfen hier nicht: sie greifen nur bei ganzen, gleichen Wörtern („sofa“ ≠ „Sofas“,
 * „wagen“ ≠ „Gebrauchtwagen“), und die deutsche Wortzerlegung ist bewusst aus (siehe indexSettings).
 * Darum stehen die Wörter direkt im Suchdokument (Feld `keywords`), in Einzahl und Mehrzahl.
 *
 * Schlüssel = Kategoriepfad; ein Eintrag gilt für die Kategorie und alle Unterkategorien.
 */
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  // Auto & Motor
  'auto-motor/gebrauchtwagen': ['auto', 'autos', 'pkw', 'wagen', 'gebrauchtauto', 'kfz'],
  'auto-motor/neuwagen': ['auto', 'autos', 'pkw', 'wagen', 'neuauto', 'kfz'],
  'auto-motor/motorraeder': ['motorrad', 'moped', 'roller', 'bike', 'maschin'],
  'auto-motor/wohnmobile-wohnwagen': ['camper', 'wohnmobil', 'wohnwagen', 'wohnmobile'],
  'auto-motor/nutzfahrzeuge': ['lkw', 'transporter', 'kastenwagen', 'traktor'],
  'auto-motor/fahrzeugzubehoer/reifen-felgen': ['reifen', 'felgen', 'winterreifen', 'sommerreifen', 'patschen'],

  // Immobilien
  'immobilien/wohnungen': ['wohnung', 'wohnungen', 'apartment', 'garconniere'],
  'immobilien/wohnungen/mietwohnungen': ['miete', 'mietwohnung'],
  'immobilien/wohnungen/eigentumswohnungen': ['eigentum', 'kaufen'],
  'immobilien/haeuser': ['haus', 'häuser', 'einfamilienhaus', 'reihenhaus'],
  'immobilien/grundstuecke': ['grund', 'grundstück', 'baugrund'],
  'immobilien/garagen-parkplaetze': ['garage', 'parkplatz', 'stellplatz'],

  // Marktplatz
  'marktplatz/smartphones-telefonie/smartphones': ['handy', 'handys', 'smartphone', 'mobiltelefon', 'telefon'],
  'marktplatz/smartphones-telefonie/handyhuellen-zubehoer': ['handy', 'handyhülle', 'hülle', 'ladekabel'],
  'marktplatz/smartphones-telefonie/festnetztelefone': ['telefon', 'festnetz'],
  'marktplatz/smartphones-telefonie/smartwatches-wearables': ['uhr', 'smartwatch'],
  'marktplatz/computer-software/laptops-pcs': ['computer', 'pc', 'laptop', 'notebook', 'rechner'],
  'marktplatz/computer-software/tablets-e-reader': ['tablet', 'ipad', 'ebook'],
  'marktplatz/kameras-tv-multimedia/fernseher': ['tv', 'fernseher', 'fernseh', 'flatscreen'],
  'marktplatz/kameras-tv-multimedia/fotokameras': ['kamera', 'fotoapparat'],
  'marktplatz/games-konsolen/konsolen': ['konsole', 'spielkonsole'],
  'marktplatz/sport-sportgeraete/fahrraeder': ['fahrrad', 'fahrräder', 'rad', 'räder', 'radl', 'radln', 'bike', 'velo'],
  'marktplatz/sport-sportgeraete/fahrradzubehoer-teile': ['fahrrad', 'rad', 'radl'],
  'marktplatz/sport-sportgeraete/wintersport/ski': ['ski', 'schi', 'skier', 'schier', 'skiausrüstung'],
  'marktplatz/sport-sportgeraete/wintersport/skischuhe': ['ski', 'schi', 'schischuhe', 'skischuh'],
  'marktplatz/sport-sportgeraete/wintersport/skitouren': ['ski', 'schi', 'tourenski', 'schitouren'],
  'marktplatz/sport-sportgeraete/wintersport/langlauf': ['ski', 'schi', 'langlaufski'],
  'marktplatz/sport-sportgeraete/wintersport/eislaufen-rodeln': ['rodel', 'schlitten', 'eislaufschuhe', 'schlittschuhe'],
  'marktplatz/sport-sportgeraete/fitness-kraftsport': ['fitness', 'hantel', 'hanteln', 'heimtrainer'],
  'marktplatz/wohnen-haushalt-gastronomie/sofas-sessel': ['sofa', 'couch', 'couches', 'sessel', 'bank', 'diwan', 'ecksofa', 'wohnlandschaft'],
  'marktplatz/wohnen-haushalt-gastronomie/tische-stuehle': ['tisch', 'tische', 'stuhl', 'stühle', 'sessel', 'esstisch', 'sesserl'],
  'marktplatz/wohnen-haushalt-gastronomie/schraenke-regale': ['kasten', 'kastl', 'kästen', 'schrank', 'regal', 'kommode', 'stellage'],
  'marktplatz/wohnen-haushalt-gastronomie/betten-matratzen': ['bett', 'betten', 'matratze', 'lattenrost'],
  'marktplatz/wohnen-haushalt-gastronomie/lampen-leuchten': ['lampe', 'lampen', 'leuchte', 'luster'],
  'marktplatz/wohnen-haushalt-gastronomie/kueche-geschirr': ['geschirr', 'service', 'häferl', 'teller', 'besteck', 'topf', 'töpfe', 'pfanne'],
  'marktplatz/wohnen-haushalt-gastronomie/kuechen': ['küche', 'einbauküche', 'kuchl'],
  'marktplatz/wohnen-haushalt-gastronomie/haushaltsgeraete/waschmaschinen-trockner': ['waschmaschine', 'trockner', 'wäschetrockner'],
  'marktplatz/wohnen-haushalt-gastronomie/haushaltsgeraete/kuehlen-gefrieren': ['kühlschrank', 'eiskasten', 'gefrierschrank', 'gefriertruhe'],
  'marktplatz/wohnen-haushalt-gastronomie/haushaltsgeraete/kaffee-espresso': ['kaffeemaschine', 'espressomaschine', 'kaffee'],
  'marktplatz/wohnen-haushalt-gastronomie/haushaltsgeraete/staubsauger': ['staubsauger', 'sauger', 'saugroboter'],
  'marktplatz/wohnen-haushalt-gastronomie/haushaltsgeraete/geschirrspueler': ['geschirrspüler', 'spülmaschine', 'abwasch'],
  'marktplatz/wohnen-haushalt-gastronomie/haushaltsgeraete/herde-backoefen': ['herd', 'backofen', 'ofen', 'rohr'],
  'marktplatz/haus-garten-werkstatt/garten/gartenmoebel': ['gartenmöbel', 'gartentisch', 'gartensessel', 'liege'],
  'marktplatz/haus-garten-werkstatt/garten/rasenmaeher': ['rasenmäher', 'mäher', 'rasenmaeher'],
  'marktplatz/haus-garten-werkstatt/garten/grillen': ['griller', 'grill'],
  'marktplatz/haus-garten-werkstatt/elektrowerkzeug': ['werkzeug', 'bohrmaschine', 'akkuschrauber', 'flex'],
  'marktplatz/haus-garten-werkstatt/handwerkzeug': ['werkzeug', 'werkzeugkoffer'],
  'marktplatz/baby-kind/kinderwagen-buggys': ['kinderwagen', 'kinderwagerl', 'buggy', 'wagerl'],
  'marktplatz/baby-kind/kinderbekleidung': ['gewand', 'kindergewand', 'babygewand', 'kleidung', 'kinderkleidung', 'babykleidung', 'gewandpaket'],
  'marktplatz/baby-kind/kinderschuhe': ['schuhe', 'kinderschuhe', 'patscherl'],
  'marktplatz/baby-kind/kindermoebel': ['kinderbett', 'gitterbett', 'hochstuhl', 'wickeltisch', 'wickelkommode'],
  'marktplatz/baby-kind/autokindersitze': ['kindersitz', 'autositz', 'babyschale', 'maxicosi'],
  'marktplatz/baby-kind/babyausstattung': ['baby', 'babysachen', 'babyphone'],
  'marktplatz/mode-accessoires': ['gewand', 'kleidung', 'mode'],
  'marktplatz/mode-accessoires/schuhe': ['schuhe', 'schuh'],
  'marktplatz/mode-accessoires/trachten': ['tracht', 'dirndl', 'lederhose'],
  'marktplatz/spielen-spielzeug': ['spielzeug', 'spielsachen'],
  'marktplatz/spielen-spielzeug/lego-bausteine': ['lego', 'bausteine', 'duplo'],
  'marktplatz/tiere-tierbedarf/hunde': ['hund', 'hunde', 'welpe', 'welpen'],
  'marktplatz/tiere-tierbedarf/katzen': ['katze', 'katzen', 'kitten'],
  'marktplatz/buecher-filme-musik/buecher': ['buch', 'bücher', 'roman'],
  'marktplatz/freizeit-instrumente-kulinarik/musikinstrumente': ['instrument', 'musikinstrument'],
  'marktplatz/freizeit-instrumente-kulinarik/musikinstrumente/tasteninstrumente': ['klavier', 'keyboard', 'piano', 'e-piano'],
  'marktplatz/freizeit-instrumente-kulinarik/musikinstrumente/gitarren-baesse': ['gitarre', 'bass', 'e-gitarre'],
  'marktplatz/antiquitaeten-kunst/porzellan-keramik': ['porzellan', 'keramik', 'geschirr', 'service'],
  'marktplatz/dienstleistungen/nachhilfe-unterricht': ['nachhilfe', 'unterricht', 'lernhilfe'],
  'marktplatz/dienstleistungen/umzug-transport': ['umzug', 'transport', 'übersiedlung', 'übersiedeln'],
};

/** Wörter für Inserate „zu verschenken“ – damit „gratis“ oder „geschenkt“ sie findet */
export const FREE_KEYWORDS = ['gratis', 'geschenkt', 'verschenken', 'kostenlos', 'umsonst'];

/** Alle Stichwörter für ein Inserat: aus der Kategorie samt Oberkategorien und aus der Preisart */
export function listingKeywords(categoryPaths: string[], free: boolean): string[] {
  const words = new Set<string>();
  for (const path of categoryPaths) for (const word of CATEGORY_KEYWORDS[path] ?? []) words.add(word);
  if (free) for (const word of FREE_KEYWORDS) words.add(word);
  return [...words];
}
