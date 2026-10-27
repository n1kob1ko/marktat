import type { AttributeOption } from './types.js';

/** Hilfsfunktion: Labels werden zu Werten („Mercedes-Benz“ → „mercedes-benz“), sofern nicht angegeben. */
function opts(entries: readonly (string | readonly [value: string, label: string])[]): AttributeOption[] {
  return entries.map((entry) =>
    typeof entry === 'string'
      ? { value: entry.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), label: entry }
      : { value: entry[0], label: entry[1] },
  );
}

export function pickOptions(options: readonly AttributeOption[], values: readonly string[]): AttributeOption[] {
  return values.map((value) => {
    const option = options.find((o) => o.value === value);
    if (!option) throw new Error(`Unbekannte Option ${value}`);
    return option;
  });
}

const OTHER = ['other', 'Andere'] as const;

// --- Fahrzeuge -----------------------------------------------------------------

export const CAR_BRANDS = opts([
  'Alfa Romeo', 'Audi', 'BMW', 'BYD', ['citroen', 'Citroën'], 'Cupra', 'Dacia', 'DS', 'Fiat', 'Ford', 'Honda',
  'Hyundai', 'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Mazda', 'Mercedes-Benz', 'MG', 'Mini', 'Mitsubishi',
  'Nissan', 'Opel', 'Peugeot', 'Polestar', 'Porsche', 'Renault', 'Seat', ['skoda', 'Škoda'], 'Smart', 'Subaru',
  'Suzuki', 'Tesla', 'Toyota', ['vw', 'VW'], 'Volvo', OTHER,
]);

export const MOTORCYCLE_BRANDS = opts([
  'Aprilia', 'BMW', 'Ducati', 'Harley-Davidson', 'Honda', 'Husqvarna', 'Kawasaki', 'KTM', 'Moto Guzzi', 'Piaggio',
  'Royal Enfield', 'Suzuki', 'Triumph', 'Vespa', 'Yamaha', OTHER,
]);

export const FUEL_TYPES = opts([
  ['petrol', 'Benzin'],
  ['diesel', 'Diesel'],
  ['electric', 'Elektro'],
  ['hybrid-petrol', 'Hybrid (Benzin/Elektro)'],
  ['hybrid-diesel', 'Hybrid (Diesel/Elektro)'],
  ['plug-in-hybrid', 'Plug-in-Hybrid'],
  ['cng', 'Erdgas (CNG)'],
  ['lpg', 'Autogas (LPG)'],
  ['hydrogen', 'Wasserstoff'],
  OTHER,
]);

export const TRANSMISSIONS = opts([
  ['manual', 'Schaltgetriebe'],
  ['automatic', 'Automatik'],
  ['semi-automatic', 'Halbautomatik'],
]);

export const VEHICLE_CONDITIONS = opts([
  ['new', 'Neufahrzeug'],
  ['day-registration', 'Tageszulassung'],
  ['demo', 'Vorführfahrzeug'],
  ['used', 'Gebrauchtfahrzeug'],
  ['accident', 'Unfallfahrzeug'],
  ['defective', 'Defekt / Bastlerfahrzeug'],
]);

export const MONTHS = opts(
  ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'].map(
    (label, i) => [String(i + 1).padStart(2, '0'), label] as const,
  ),
);

export const CAMPER_TYPES = opts([
  ['motorhome', 'Wohnmobil'],
  ['camper-van', 'Campingbus / Kastenwagen'],
  ['caravan', 'Wohnwagen'],
]);

export const COMMERCIAL_VEHICLE_TYPES = opts([
  ['van', 'Transporter'],
  ['truck', 'LKW'],
  ['tractor', 'Traktor / Landmaschine'],
  ['construction', 'Baumaschine'],
  ['trailer', 'Anhänger'],
  OTHER,
]);

export const TIRE_SEASONS = opts([
  ['summer', 'Sommerreifen'],
  ['winter', 'Winterreifen'],
  ['all-season', 'Ganzjahresreifen'],
]);

// --- Immobilien ----------------------------------------------------------------

export const OFFER_TYPES = opts([
  ['BUY', 'Kauf'],
  ['RENT', 'Miete'],
]);

export const FLOORS = opts([
  ['souterrain', 'Souterrain'],
  ['ground', 'Erdgeschoss'],
  ['mezzanine', 'Mezzanin'],
  ...Array.from({ length: 10 }, (_, i) => [String(i + 1), `${i + 1}. Stock`] as const),
  ['11-plus', '11. Stock oder höher'],
  ['attic', 'Dachgeschoss'],
]);

export const HEATING_TYPES = opts([
  ['district', 'Fernwärme'],
  ['gas', 'Gas'],
  ['heat-pump', 'Wärmepumpe'],
  ['pellets', 'Pellets / Holz'],
  ['oil', 'Öl'],
  ['electric', 'Elektro'],
  OTHER,
]);

export const PROPERTY_FEATURES = opts([
  ['balcony', 'Balkon'],
  ['terrace', 'Terrasse'],
  ['loggia', 'Loggia'],
  ['garden', 'Garten'],
  ['elevator', 'Lift'],
  ['cellar', 'Keller / Abteil'],
  ['parking', 'Garage / Stellplatz'],
  ['fitted-kitchen', 'Einbauküche'],
  ['furnished', 'Möbliert'],
  ['barrier-free', 'Barrierefrei'],
  ['pets-allowed', 'Haustiere erlaubt'],
  ['underfloor-heating', 'Fußbodenheizung'],
  ['air-conditioning', 'Klimaanlage'],
]);

export const ZONINGS = opts([
  ['building-land', 'Bauland'],
  ['green-land', 'Grünland'],
  ['agriculture', 'Land- und Forstwirtschaft'],
  ['commercial', 'Betriebsbaugebiet'],
]);

export const COMMERCIAL_PROPERTY_TYPES = opts([
  ['office', 'Büro'],
  ['retail', 'Geschäftslokal'],
  ['gastronomy', 'Gastronomie'],
  ['warehouse', 'Lager / Halle'],
  ['practice', 'Praxis'],
  OTHER,
]);

export const PARKING_TYPES = opts([
  ['garage', 'Garage'],
  ['underground', 'Tiefgaragenplatz'],
  ['carport', 'Carport'],
  ['outdoor', 'Freiplatz'],
]);

// --- Jobs ----------------------------------------------------------------------

/** Berufsbereiche angelehnt an die Berufsbereiche des AMS (vereinfacht). */
export const JOB_FIELDS = opts([
  ['office', 'Büro, Verwaltung, Assistenz'],
  ['sales', 'Verkauf, Handel, Kundenservice'],
  ['hospitality', 'Gastronomie, Hotellerie, Tourismus'],
  ['it', 'IT, Software, Telekommunikation'],
  ['engineering', 'Technik, Ingenieurwesen, Forschung'],
  ['trades', 'Handwerk, Bau, Installation'],
  ['production', 'Produktion, Industrie'],
  ['logistics', 'Lager, Logistik, Transport'],
  ['health', 'Gesundheit, Pflege, Soziales'],
  ['education', 'Bildung, Kinderbetreuung'],
  ['finance', 'Finanzen, Recht, Steuern'],
  ['marketing', 'Marketing, Medien, Design'],
  ['cleaning', 'Reinigung, Hausbetreuung'],
  ['agriculture', 'Land- und Forstwirtschaft, Umwelt'],
  ['public', 'Öffentlicher Dienst, Sicherheit'],
  OTHER,
]);

export const EMPLOYMENT_TYPES = opts([
  ['employee', 'Angestelltenverhältnis'],
  ['worker', 'Arbeiterverhältnis'],
  ['temporary', 'Arbeitskräfteüberlassung'],
  ['free-contract', 'Freier Dienstvertrag'],
  ['contract-work', 'Werkvertrag / Projekt'],
  ['apprenticeship', 'Lehre'],
  ['mandatory-internship', 'Pflichtpraktikum'],
  ['holiday-internship', 'Ferialpraxis'],
  ['internship', 'Praktikum'],
  ['marginal', 'Geringfügige Beschäftigung'],
]);

export const WORKING_TIME_MODELS = opts([
  ['fixed', 'Fixe Arbeitszeiten'],
  ['flextime', 'Gleitzeit'],
  ['shifts', 'Schichtdienst'],
  ['by-agreement', 'Nach Vereinbarung'],
]);

export const WORKPLACE_TYPES = opts([
  ['onsite', 'Vor Ort'],
  ['hybrid', 'Hybrid (teilweise Homeoffice)'],
  ['remote', 'Homeoffice / Remote'],
]);

export const SALARY_PERIODS = opts([
  ['month', 'pro Monat'],
  ['year', 'pro Jahr'],
  ['hour', 'pro Stunde'],
]);

export const EXPERIENCE_LEVELS = opts([
  ['none', 'Keine erforderlich'],
  ['junior', 'Bis 2 Jahre'],
  ['mid', '3 bis 5 Jahre'],
  ['senior', 'Mehr als 5 Jahre'],
]);

// --- Marktplatz ----------------------------------------------------------------

export const PHONE_BRANDS = opts([
  'Apple', 'Samsung', 'Google', 'Xiaomi', 'Huawei', 'OnePlus', 'Sony', 'Motorola', 'Nokia', 'Fairphone', OTHER,
]);

export const STORAGE_SIZES = opts(
  [16, 32, 64, 128, 256, 512, 1024, 2048].map((gb) => [String(gb), gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`] as const),
);

export const RAM_SIZES = opts([4, 8, 16, 32, 64, 128].map((gb) => [String(gb), `${gb} GB`] as const));

export const COMPUTER_TYPES = opts([
  ['laptop', 'Laptop'],
  ['desktop', 'Desktop-PC'],
  ['all-in-one', 'All-in-One'],
  ['mini-pc', 'Mini-PC'],
  OTHER,
]);

export const CONSOLE_PLATFORMS = opts([
  ['ps5', 'PlayStation 5'],
  ['ps4', 'PlayStation 4'],
  ['xbox-series', 'Xbox Series X|S'],
  ['xbox-one', 'Xbox One'],
  ['switch-2', 'Nintendo Switch 2'],
  ['switch', 'Nintendo Switch'],
  ['pc', 'PC'],
  ['retro', 'Retro-Konsolen'],
  OTHER,
]);

export const BIKE_TYPES = opts([
  ['city', 'Citybike'],
  ['trekking', 'Trekkingrad'],
  ['mountain', 'Mountainbike'],
  ['e-bike', 'E-Bike'],
  ['road', 'Rennrad'],
  ['gravel', 'Gravelbike'],
  ['kids', 'Kinderrad'],
  ['bmx', 'BMX'],
  ['cargo', 'Lastenrad'],
  OTHER,
]);

export const WHEEL_SIZES = opts(['12', '14', '16', '18', '20', '24', '26', '27.5', '28', '29'].map((v) => [v, `${v.replace('.', ',')} Zoll`] as const));

export const CHILD_SIZES = opts(
  [50, 56, 62, 68, 74, 80, 86, 92, 98, 104, 110, 116, 122, 128, 134, 140, 146, 152, 158, 164, 170, 176].map(
    (cm) => [String(cm), `Gr. ${cm}`] as const,
  ),
);

export const SERVICE_PRICE_UNITS = opts([
  ['hour', 'pro Stunde'],
  ['day', 'pro Tag'],
  ['flat', 'Pauschal'],
]);
