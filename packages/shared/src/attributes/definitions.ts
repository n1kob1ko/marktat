import {
  BIKE_TYPES,
  CAMPER_TYPES,
  CAR_BRANDS,
  CHILD_SIZES,
  COMMERCIAL_PROPERTY_TYPES,
  COMMERCIAL_VEHICLE_TYPES,
  COMPUTER_TYPES,
  CONSOLE_PLATFORMS,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  JOB_FIELDS,
  FLOORS,
  FUEL_TYPES,
  HEATING_TYPES,
  MONTHS,
  MOTORCYCLE_BRANDS,
  OFFER_TYPES,
  PARKING_TYPES,
  PHONE_BRANDS,
  pickOptions,
  PROPERTY_FEATURES,
  RAM_SIZES,
  SALARY_PERIODS,
  SERVICE_PRICE_UNITS,
  STORAGE_SIZES,
  TIRE_SEASONS,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  WHEEL_SIZES,
  WORKING_TIME_MODELS,
  WORKPLACE_TYPES,
  ZONINGS,
} from './options.js';
import type { AttributeField, CategoryAttributeSchema, NumberField, SelectField } from './types.js';

// --- Bausteine -------------------------------------------------------------------

const brandSelect = (options: SelectField['options']): AttributeField => ({
  key: 'brand', label: 'Marke', kind: 'select', options, required: true, filter: { param: 'marke' },
});
const brandText = (required = false): AttributeField => ({
  key: 'brand', label: 'Marke', kind: 'text', maxLength: 60, required, placeholder: 'z. B. Hymer',
});
const model = (required: boolean): AttributeField => ({
  key: 'model', label: 'Modell', kind: 'text', maxLength: 60, required, placeholder: 'z. B. Golf 1.5 TSI', filter: { param: 'modell' },
});
const firstRegistration = (required: boolean): AttributeField[] => [
  { key: 'firstRegistrationYear', label: 'Erstzulassung', kind: 'year', min: 1900, maxAhead: 0, required, monthKey: 'firstRegistrationMonth', highlight: true,
    filter: { param: 'erstzulassung' } },
  { key: 'firstRegistrationMonth', label: 'Monat der Erstzulassung', kind: 'select', options: MONTHS, hiddenInDetails: true },
];
const mileage = (required: boolean): NumberField => ({
  key: 'mileageKm', label: 'Kilometerstand', kind: 'number', min: 0, max: 2_000_000, decimals: 0, unit: 'km', required, highlight: true,
  placeholder: 'z. B. 85.000', filter: { param: 'kilometer' },
});
const fuel = (required: boolean, options = FUEL_TYPES): AttributeField => ({
  key: 'fuelType', label: 'Kraftstoff', kind: 'select', options, required, highlight: true, filter: { param: 'kraftstoff' },
});
const transmission = (required: boolean): AttributeField => ({
  key: 'transmission', label: 'Getriebe', kind: 'select', options: TRANSMISSIONS, required, filter: { param: 'getriebe' },
});
const power: NumberField = {
  key: 'powerKw', label: 'Leistung', kind: 'number', min: 1, max: 1500, decimals: 0, unit: 'kW', display: 'kw-ps',
  hint: 'In kW laut Zulassungsschein (Feld P.2). PS werden automatisch umgerechnet.',
  filter: { param: 'leistung', label: 'Leistung (kW)' },
};
const vehicleCondition = (values?: string[]): AttributeField => ({
  key: 'vehicleCondition', label: 'Fahrzeugzustand', kind: 'select', required: true,
  options: values ? pickOptions(VEHICLE_CONDITIONS, values) : VEHICLE_CONDITIONS, filter: { param: 'fahrzeugzustand' },
});

const offerType = (fixed?: 'BUY' | 'RENT'): AttributeField => ({
  key: 'offerType', label: 'Angebotsart', kind: 'select', options: OFFER_TYPES, required: true, fixed,
  hint: fixed ? undefined : 'Bei Miete gilt der Preis pro Monat.', filter: { param: 'angebot', label: 'Kaufen oder mieten' },
});
const area = (key: string, label: string, required: boolean, max: number, param: string): NumberField => ({
  key, label, kind: 'number', min: 1, max, decimals: 2, unit: 'm²', required, highlight: true, filter: { param },
});
const rooms: NumberField = {
  key: 'rooms', label: 'Zimmer', kind: 'number', min: 1, max: 50, decimals: 1, step: 0.5, required: true, highlight: true,
  hint: 'Halbe Zimmer mit Komma, z. B. 2,5', filter: { param: 'zimmer' },
};
const floor: AttributeField = { key: 'floor', label: 'Stockwerk', kind: 'select', options: FLOORS };
const constructionYear: AttributeField = { key: 'constructionYear', label: 'Baujahr', kind: 'year', min: 1500, maxAhead: 5 };
const operatingCosts: NumberField = {
  key: 'operatingCosts', label: 'Betriebskosten', kind: 'number', min: 0, max: 100_000, decimals: 2, unit: '€ / Monat', display: 'euro',
  hint: 'Monatlich, inkl. USt.',
};
const heating: AttributeField = { key: 'heating', label: 'Heizung', kind: 'select', options: HEATING_TYPES };
const features = (values: string[]): AttributeField => ({
  key: 'features', label: 'Ausstattung', kind: 'multiselect', options: pickOptions(PROPERTY_FEATURES, values), filter: { param: 'ausstattung' },
});
const energy: AttributeField[] = [
  {
    key: 'hwb', label: 'HWB', kind: 'number', min: 0, max: 1000, decimals: 1, unit: 'kWh/m²a',
    hint: 'Heizwärmebedarf laut Energieausweis. Liegt ein Energieausweis vor, sind HWB und fGEE in der Anzeige anzugeben.',
  },
  { key: 'fgee', label: 'fGEE', kind: 'number', min: 0, max: 10, decimals: 2, hint: 'Gesamtenergieeffizienz-Faktor laut Energieausweis' },
];

const FLAT_FEATURES = ['balcony', 'terrace', 'loggia', 'garden', 'elevator', 'cellar', 'parking', 'fitted-kitchen', 'furnished', 'barrier-free', 'underfloor-heating', 'air-conditioning'];
const HOUSE_FEATURES = ['balcony', 'terrace', 'garden', 'cellar', 'parking', 'fitted-kitchen', 'furnished', 'barrier-free', 'underfloor-heating', 'air-conditioning'];
const COMMERCIAL_FEATURES = ['elevator', 'cellar', 'parking', 'fitted-kitchen', 'barrier-free', 'air-conditioning'];

const flatFields = (offer: 'BUY' | 'RENT'): AttributeField[] => [
  offerType(offer),
  area('livingAreaSqm', 'Wohnfläche', true, 2000, 'wohnflaeche'),
  rooms,
  floor,
  constructionYear,
  operatingCosts,
  heating,
  features(offer === 'RENT' ? [...FLAT_FEATURES, 'pets-allowed'] : FLAT_FEATURES),
  ...energy,
];
const houseFields = (offer: 'BUY' | 'RENT'): AttributeField[] => [
  offerType(offer),
  area('livingAreaSqm', 'Wohnfläche', true, 5000, 'wohnflaeche'),
  { ...area('plotAreaSqm', 'Grundstücksfläche', false, 1_000_000, 'grundflaeche'), highlight: false },
  rooms,
  constructionYear,
  operatingCosts,
  heating,
  features(offer === 'RENT' ? [...HOUSE_FEATURES, 'pets-allowed'] : HOUSE_FEATURES),
  ...energy,
];
const commercialFields = (offer: 'BUY' | 'RENT'): AttributeField[] => [
  offerType(offer),
  {
    key: 'propertyType', label: 'Art der Immobilie', kind: 'select', options: COMMERCIAL_PROPERTY_TYPES, required: true, highlight: true,
    filter: { param: 'objektart' },
  },
  area('usableAreaSqm', 'Nutzfläche', true, 100_000, 'nutzflaeche'),
  floor,
  constructionYear,
  operatingCosts,
  heating,
  features(COMMERCIAL_FEATURES),
  ...energy,
];

const jobTitle: AttributeField = {
  key: 'jobTitle', label: 'Berufsbezeichnung', kind: 'text', maxLength: 100, required: true, placeholder: 'z. B. Bürokauffrau/-mann',
};
const jobField: AttributeField = {
  key: 'jobField', label: 'Berufsbereich', kind: 'select', options: JOB_FIELDS, filter: { param: 'berufsbereich' },
  hint: 'Hilft Bewerberinnen und Bewerbern, die Stelle über die Filter zu finden.',
};
const employmentType = (values: string[]): AttributeField => {
  const options = pickOptions(EMPLOYMENT_TYPES, values);
  return {
    key: 'employmentType', label: 'Beschäftigungsart', kind: 'select', options, required: true,
    fixed: options.length === 1 ? options[0]!.value : undefined, filter: { param: 'beschaeftigung' },
  };
};
const weeklyHours = (required: boolean, max = 60): NumberField => ({
  key: 'weeklyHours', label: 'Arbeitszeit', kind: 'number', min: 1, max, decimals: 1, unit: 'Std. / Woche', required, highlight: true,
  placeholder: 'z. B. 38,5', filter: { param: 'stunden', label: 'Arbeitszeit (Std. / Woche)' },
});
const workingTimeModel: AttributeField = {
  key: 'workingTimeModel', label: 'Arbeitszeitmodell', kind: 'select', options: WORKING_TIME_MODELS, filter: { param: 'arbeitszeit' },
};
const workplace: AttributeField = {
  key: 'workplaceType', label: 'Arbeitsort', kind: 'select', options: WORKPLACE_TYPES, required: true, highlight: true,
  hint: 'Den Ort selbst gibst du unten über die Postleitzahl an.', filter: { param: 'arbeitsort' },
};
const salary = (required: boolean): AttributeField[] => [
  {
    key: 'salaryGross', label: 'Gehalt (brutto)', kind: 'number', min: 1, max: 1_000_000, decimals: 2, unit: '€', display: 'euro', required,
    hint: required ? 'In Österreich muss eine Stellenanzeige das Mindestentgelt nennen (laut Kollektivvertrag oder Vereinbarung).' : undefined,
    // Gefiltert wird auf das Monatsgehalt (Jahresgehalt / 14, Stundenlohn × 4,33 × Wochenstunden), siehe search/
    filter: { param: 'gehalt', label: 'Gehalt (brutto pro Monat)' },
  },
  { key: 'salaryPeriod', label: 'Gehalt gilt', kind: 'select', options: SALARY_PERIODS, required, requiredWith: 'salaryGross', hiddenInDetails: true },
  { key: 'overpayment', label: 'Bereitschaft zur Überzahlung', kind: 'boolean' },
];
const experience: AttributeField = {
  key: 'experience', label: 'Berufserfahrung', kind: 'select', options: EXPERIENCE_LEVELS, filter: { param: 'erfahrung' },
};

const dimensions: AttributeField[] = [
  { key: 'widthCm', label: 'Breite', kind: 'number', min: 1, max: 2000, decimals: 0, unit: 'cm' },
  { key: 'depthCm', label: 'Tiefe', kind: 'number', min: 1, max: 2000, decimals: 0, unit: 'cm' },
  { key: 'heightCm', label: 'Höhe', kind: 'number', min: 1, max: 2000, decimals: 0, unit: 'cm' },
];
const textBrand: AttributeField = { key: 'brand', label: 'Marke', kind: 'text', maxLength: 60 };
const storage: AttributeField = {
  key: 'storageGb', label: 'Speicher', kind: 'select', options: STORAGE_SIZES, highlight: true, filter: { param: 'speicher' },
};
const screenSize = (min: number, max: number): AttributeField => ({
  key: 'screenSizeInch', label: 'Bildschirmdiagonale', kind: 'number', min, max, decimals: 1, unit: 'Zoll', highlight: true,
  filter: { param: 'diagonale' },
});

// --- Regeln je Kategoriepfad -------------------------------------------------------

interface Rule {
  /** Kategoriepfad wie in `categories.path`; gilt auch für alle Unterkategorien */
  path: string;
  fields?: readonly AttributeField[];
  itemCondition?: boolean;
  price?: CategoryAttributeSchema['price'];
  locationLabel?: string;
}

/**
 * Speziellere Pfade überschreiben allgemeinere. Felder werden nicht zusammengeführt, sondern ersetzt,
 * damit jede Kategorie genau die Liste zeigt, die hier steht.
 */
const RULES: readonly Rule[] = [
  // Marktplatz
  { path: 'marktplatz', itemCondition: true },
  { path: 'marktplatz/elektronik/handys-smartphones', fields: [{ key: 'brand', label: 'Marke', kind: 'select', options: PHONE_BRANDS, highlight: true, filter: { param: 'marke' } }, storage] },
  {
    path: 'marktplatz/elektronik/computer-laptops',
    fields: [
      { key: 'computerType', label: 'Gerätetyp', kind: 'select', options: COMPUTER_TYPES, highlight: true, filter: { param: 'geraet' } },
      textBrand,
      { key: 'ramGb', label: 'Arbeitsspeicher', kind: 'select', options: RAM_SIZES, highlight: true, filter: { param: 'arbeitsspeicher' } },
      storage,
      screenSize(7, 49),
    ],
  },
  { path: 'marktplatz/elektronik/tablets-e-reader', fields: [textBrand, storage, screenSize(4, 20)] },
  { path: 'marktplatz/elektronik/tv-audio', fields: [textBrand, screenSize(10, 120)] },
  { path: 'marktplatz/elektronik/foto-kamera', fields: [textBrand] },
  { path: 'marktplatz/elektronik/konsolen-games', fields: [{ key: 'platform', label: 'Plattform', kind: 'select', options: CONSOLE_PLATFORMS, highlight: true, filter: { param: 'plattform' } }] },
  { path: 'marktplatz/moebel-wohnen', fields: dimensions },
  { path: 'marktplatz/moebel-wohnen/deko-accessoires', fields: [] },
  {
    path: 'marktplatz/kleidung-mode/damenmode',
    fields: [{ key: 'size', label: 'Größe', kind: 'text', maxLength: 20, placeholder: 'z. B. M oder 38', highlight: true }, textBrand],
  },
  {
    path: 'marktplatz/kleidung-mode/herrenmode',
    fields: [{ key: 'size', label: 'Größe', kind: 'text', maxLength: 20, placeholder: 'z. B. L oder 52', highlight: true }, textBrand],
  },
  {
    path: 'marktplatz/kleidung-mode/schuhe',
    fields: [
      { key: 'shoeSizeEu', label: 'Schuhgröße (EU)', kind: 'number', min: 15, max: 52, decimals: 1, step: 0.5, highlight: true, filter: { param: 'schuhgroesse' } },
      textBrand,
    ],
  },
  { path: 'marktplatz/baby-kind/kinderkleidung', fields: [{ key: 'childSize', label: 'Größe', kind: 'select', options: CHILD_SIZES, highlight: true, filter: { param: 'groesse' } }] },
  {
    path: 'marktplatz/sport-freizeit/fahrraeder',
    fields: [
      { key: 'bikeType', label: 'Art', kind: 'select', options: BIKE_TYPES, highlight: true, filter: { param: 'radtyp', label: 'Fahrradart' } },
      { key: 'frameSize', label: 'Rahmengröße', kind: 'text', maxLength: 20, placeholder: 'z. B. 56 cm oder M', highlight: true },
      { key: 'wheelSize', label: 'Laufradgröße', kind: 'select', options: WHEEL_SIZES, highlight: true, filter: { param: 'laufrad' } },
    ],
  },
  {
    path: 'marktplatz/dienstleistungen',
    itemCondition: false,
    fields: [{ key: 'pricePer', label: 'Preis gilt', kind: 'select', options: SERVICE_PRICE_UNITS, hiddenInDetails: true }],
  },
  { path: 'marktplatz/weitere-kategorien/tickets-gutscheine', itemCondition: false },

  // Auto & Motor
  { path: 'auto-motor', itemCondition: false },
  {
    path: 'auto-motor/gebrauchtwagen',
    fields: [
      brandSelect(CAR_BRANDS), model(true), ...firstRegistration(true), mileage(true), fuel(true), transmission(true), power,
      vehicleCondition(['used', 'day-registration', 'demo', 'accident', 'defective']),
    ],
  },
  {
    path: 'auto-motor/neuwagen',
    fields: [
      brandSelect(CAR_BRANDS), model(true), ...firstRegistration(false), mileage(false), fuel(true), transmission(true), power,
      vehicleCondition(['new', 'day-registration', 'demo']),
    ],
  },
  {
    path: 'auto-motor/motorraeder',
    fields: [
      brandSelect(MOTORCYCLE_BRANDS), model(true), ...firstRegistration(true), mileage(true),
      { key: 'displacementCcm', label: 'Hubraum', kind: 'number', min: 1, max: 3000, decimals: 0, unit: 'cm³' },
      power, fuel(false, FUEL_TYPES.filter((f) => ['petrol', 'electric', 'other'].includes(f.value))), transmission(false),
      vehicleCondition(),
    ],
  },
  {
    path: 'auto-motor/wohnmobile-wohnwagen',
    fields: [
      { key: 'camperType', label: 'Fahrzeugart', kind: 'select', options: CAMPER_TYPES, required: true, filter: { param: 'aufbau' } },
      brandText(), model(false), ...firstRegistration(true), mileage(false),
      { key: 'sleepingPlaces', label: 'Schlafplätze', kind: 'number', min: 1, max: 12, decimals: 0, filter: { param: 'schlafplaetze' } },
      fuel(false), transmission(false), power, vehicleCondition(),
    ],
  },
  {
    path: 'auto-motor/nutzfahrzeuge',
    fields: [
      { key: 'vehicleType', label: 'Fahrzeugart', kind: 'select', options: COMMERCIAL_VEHICLE_TYPES, required: true, filter: { param: 'nutzfahrzeug' } },
      { ...brandText(), placeholder: 'z. B. Iveco' }, model(false), ...firstRegistration(true), mileage(false), fuel(false), transmission(false), power,
      vehicleCondition(),
    ],
  },
  { path: 'auto-motor/fahrzeugzubehoer', itemCondition: true },
  {
    path: 'auto-motor/fahrzeugzubehoer/reifen-felgen',
    fields: [
      { key: 'tireSeason', label: 'Reifenart', kind: 'select', options: TIRE_SEASONS, highlight: true, filter: { param: 'reifenart' } },
      { key: 'tireSize', label: 'Reifengröße', kind: 'text', maxLength: 30, placeholder: 'z. B. 205/55 R16', highlight: true },
      { key: 'rimDiameterInch', label: 'Felgengröße', kind: 'number', min: 10, max: 24, decimals: 0, unit: 'Zoll', filter: { param: 'felge' } },
      { key: 'quantity', label: 'Stückzahl', kind: 'number', min: 1, max: 20, decimals: 0, highlight: true },
    ],
  },

  // Immobilien
  { path: 'immobilien', itemCondition: false },
  { path: 'immobilien/wohnungen/mietwohnungen', fields: flatFields('RENT') },
  { path: 'immobilien/wohnungen/eigentumswohnungen', fields: flatFields('BUY') },
  { path: 'immobilien/haeuser/haeuser-mieten', fields: houseFields('RENT') },
  { path: 'immobilien/haeuser/haeuser-kaufen', fields: houseFields('BUY') },
  { path: 'immobilien/gewerbeimmobilien/gewerbeimmobilien-mieten', fields: commercialFields('RENT') },
  { path: 'immobilien/gewerbeimmobilien/gewerbeimmobilien-kaufen', fields: commercialFields('BUY') },
  {
    path: 'immobilien/grundstuecke',
    fields: [
      offerType(),
      area('plotAreaSqm', 'Grundstücksfläche', true, 10_000_000, 'grundflaeche'),
      { key: 'zoning', label: 'Widmung', kind: 'select', options: ZONINGS, highlight: true, filter: { param: 'widmung' } },
    ],
  },
  {
    path: 'immobilien/garagen-parkplaetze',
    fields: [
      offerType(),
      { key: 'parkingType', label: 'Art', kind: 'select', options: PARKING_TYPES, required: true, highlight: true, filter: { param: 'stellplatz', label: 'Art des Stellplatzes' } },
      { key: 'evCharging', label: 'Lademöglichkeit für E-Autos', kind: 'boolean', filter: { param: 'e-laden' } },
    ],
  },

  // Jobs
  { path: 'jobs', itemCondition: false, price: 'none', locationLabel: 'Arbeitsort' },
  {
    path: 'jobs/vollzeit',
    fields: [jobTitle, jobField, employmentType(['employee', 'worker', 'temporary', 'free-contract']), weeklyHours(false), workingTimeModel, workplace, ...salary(true), experience],
  },
  {
    path: 'jobs/teilzeit',
    fields: [jobTitle, jobField, employmentType(['employee', 'worker', 'temporary', 'free-contract']), weeklyHours(true), workingTimeModel, workplace, ...salary(true), experience],
  },
  {
    path: 'jobs/lehrstellen',
    fields: [
      jobTitle, jobField, employmentType(['apprenticeship']),
      { key: 'apprenticeshipYears', label: 'Lehrzeit', kind: 'number', min: 1, max: 4, decimals: 1, step: 0.5, unit: 'Jahre' },
      weeklyHours(false), workplace, ...salary(true),
    ],
  },
  {
    path: 'jobs/praktika',
    fields: [
      jobTitle, jobField, employmentType(['mandatory-internship', 'holiday-internship', 'internship']),
      { key: 'durationMonths', label: 'Dauer', kind: 'number', min: 1, max: 24, decimals: 0, unit: 'Monate', highlight: true },
      weeklyHours(false), workplace, ...salary(true),
    ],
  },
  {
    path: 'jobs/geringfuegige-beschaeftigung',
    fields: [jobTitle, jobField, employmentType(['marginal']), weeklyHours(true, 20), workingTimeModel, workplace, ...salary(true)],
  },
  {
    path: 'jobs/freelance',
    fields: [jobTitle, jobField, employmentType(['free-contract', 'contract-work']), weeklyHours(false), workplace, ...salary(false), experience],
  },
];

const RULES_BY_PATH = new Map(RULES.map((rule) => [rule.path, rule]));

const DEFAULT_SCHEMA: CategoryAttributeSchema = { fields: [], itemCondition: true, price: 'price', locationLabel: 'Standort' };

/**
 * Felder und Regeln für eine Kategorie. Ohne Kategorie (Entwurf) gibt es keine Zusatzfelder.
 * Der Pfad wird von oben nach unten durchlaufen, z. B. „immobilien“ → „immobilien/wohnungen“ → …
 */
export function categoryAttributeSchema(categoryPath: string | null | undefined): CategoryAttributeSchema {
  if (!categoryPath) return DEFAULT_SCHEMA;
  const schema: CategoryAttributeSchema = { ...DEFAULT_SCHEMA };
  const segments = categoryPath.split('/');
  for (let i = 1; i <= segments.length; i++) {
    const rule = RULES_BY_PATH.get(segments.slice(0, i).join('/'));
    if (!rule) continue;
    if (rule.fields) schema.fields = rule.fields;
    if (rule.itemCondition !== undefined) schema.itemCondition = rule.itemCondition;
    if (rule.price) schema.price = rule.price;
    if (rule.locationLabel) schema.locationLabel = rule.locationLabel;
  }
  return schema;
}

/** Alle Kategoriepfade mit eigener Regel – für Tests gegen den Kategoriebaum. */
export const ATTRIBUTE_RULE_PATHS: readonly string[] = RULES.map((rule) => rule.path);
