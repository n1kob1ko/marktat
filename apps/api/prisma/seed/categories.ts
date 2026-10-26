import type { Vertical } from '@marktat/shared';

export interface CategorySeed {
  name: string;
  icon?: string;
  children?: CategorySeed[];
}

const leafs = (...names: string[]): CategorySeed[] => names.map((name) => ({ name }));

/** Kategoriebaum je Hauptbereich. Icons sind Namen aus lucide-react. */
export const CATEGORY_TREE: Record<Vertical, CategorySeed[]> = {
  MARKETPLACE: [
    {
      name: 'Elektronik',
      icon: 'smartphone',
      children: leafs(
        'Handys & Smartphones',
        'Computer & Laptops',
        'Tablets & E-Reader',
        'TV & Audio',
        'Foto & Kamera',
        'Konsolen & Games',
        'Elektronik-Zubehör',
      ),
    },
    {
      name: 'Möbel & Wohnen',
      icon: 'sofa',
      children: leafs(
        'Sofas & Sessel',
        'Tische & Stühle',
        'Betten & Matratzen',
        'Schränke & Regale',
        'Küchen',
        'Lampen & Leuchten',
        'Deko & Accessoires',
      ),
    },
    {
      name: 'Kleidung & Mode',
      icon: 'shirt',
      children: leafs('Damenmode', 'Herrenmode', 'Schuhe', 'Taschen & Accessoires', 'Schmuck & Uhren'),
    },
    {
      name: 'Sport & Freizeit',
      icon: 'bike',
      children: leafs(
        'Fahrräder',
        'Wintersport',
        'Fitness',
        'Camping & Outdoor',
        'Musikinstrumente',
        'Bücher, Filme & Musik',
      ),
    },
    {
      name: 'Baby & Kind',
      icon: 'baby',
      children: leafs('Kinderwagen', 'Kinderkleidung', 'Spielzeug', 'Kindermöbel', 'Autokindersitze'),
    },
    {
      name: 'Haushalt',
      icon: 'washing-machine',
      children: leafs('Haushaltsgeräte', 'Küche & Geschirr', 'Werkzeug & Heimwerken', 'Reinigung'),
    },
    {
      name: 'Garten',
      icon: 'flower-2',
      children: leafs('Gartenmöbel', 'Gartengeräte', 'Pflanzen', 'Grillen'),
    },
    {
      name: 'Dienstleistungen',
      icon: 'wrench',
      children: leafs(
        'Handwerk',
        'Umzug & Transport',
        'Nachhilfe & Unterricht',
        'Reinigungsdienste',
        'Betreuung & Pflege',
        'IT & Web',
      ),
    },
    {
      name: 'Weitere Kategorien',
      icon: 'package',
      children: leafs('Tiere & Tierbedarf', 'Sammeln & Antiquitäten', 'Tickets & Gutscheine', 'Sonstiges'),
    },
  ],
  VEHICLES: [
    { name: 'Gebrauchtwagen', icon: 'car' },
    { name: 'Neuwagen', icon: 'car-front' },
    { name: 'Motorräder', icon: 'bike' },
    { name: 'Wohnmobile & Wohnwagen', icon: 'caravan' },
    { name: 'Nutzfahrzeuge', icon: 'truck' },
    {
      name: 'Fahrzeugzubehör',
      icon: 'cog',
      children: leafs('Reifen & Felgen', 'Ersatzteile', 'Auto-Zubehör', 'Motorrad-Zubehör'),
    },
  ],
  REAL_ESTATE: [
    { name: 'Wohnungen', icon: 'building', children: leafs('Mietwohnungen', 'Eigentumswohnungen') },
    { name: 'Häuser', icon: 'house', children: leafs('Häuser mieten', 'Häuser kaufen') },
    { name: 'Grundstücke', icon: 'trees' },
    {
      name: 'Gewerbeimmobilien',
      icon: 'store',
      children: leafs('Gewerbeimmobilien mieten', 'Gewerbeimmobilien kaufen'),
    },
    { name: 'Garagen & Parkplätze', icon: 'square-parking' },
  ],
  JOBS: [
    { name: 'Vollzeit', icon: 'briefcase' },
    { name: 'Teilzeit', icon: 'clock' },
    { name: 'Lehrstellen', icon: 'graduation-cap' },
    { name: 'Praktika', icon: 'school' },
    { name: 'Geringfügige Beschäftigung', icon: 'hourglass' },
    { name: 'Freelance', icon: 'laptop' },
  ],
};
