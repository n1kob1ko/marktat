/**
 * Zubehör erkennen („Zubehör ausblenden“ in den Deals): Hüllen, Schutzgläser, Kabel, Ladegeräte, Halterungen,
 * Ersatzteile usw. Große Feeds (z. B. Media Markt) bestehen zu einem guten Teil daraus.
 *
 * Ein Muster für beide Suchwege: JavaScript (Meilisearch-Dokument) und PostgreSQL (`~*` im Ausweichbetrieb).
 * Deshalb nur Schreibweisen, die beide gleich verstehen – kein `\b` (in PostgreSQL ein Rückschritt), Lookahead geht.
 */
const PARTS = [
  // Hüllen und Schutz
  'hülle',
  'backcover',
  'book ?cover',
  'flip ?case',
  'smart folio',
  'displayschutz',
  'schutzglas',
  'panzerglas',
  'schutzfolie',
  'schutztasche',
  '(^|[ ,(])case([ ,)]|$)',
  // Kabel und Strom (nicht „kabellos“, „kabelgebunden“)
  'kabel(?!los|gebunden)',
  'adapter',
  'netzteil',
  'ladegerät',
  'ladestation',
  'ladepad',
  // Halter, Ersatz, Verbrauchsmaterial
  'halterung',
  'wandhalter',
  'ersatz',
  'aufsteckbürste',
  'zubehör',
  'fernbedienung',
  'staubsaugerbeutel',
  'filterbeutel',
  'wasserfilter',
  'toner',
  'tintenpatrone',
  'druckerpatrone',
  'eingabestift',
  'ohrpolster',
  // „Backcover, für Apple iPhone 17“, „Band, für AirPods“
  ', für (apple|iphone|ipad|airpods|macbook|samsung|galaxy|google|pixel|xiaomi|huawei|honor|oppo|oneplus|motorola|nokia|sony|xperia|playstation|ps5|xbox|nintendo|switch|gopro|dji)',
];

export const DEAL_ACCESSORY_PATTERN = `(${PARTS.join('|')})`;

const ACCESSORY = new RegExp(DEAL_ACCESSORY_PATTERN, 'i');

export function isDealAccessory(title: string): boolean {
  return ACCESSORY.test(title);
}
