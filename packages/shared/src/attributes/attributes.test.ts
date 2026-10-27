import { describe, expect, it } from 'vitest';
import {
  carryOverAttributes,
  categoryAttributeSchema,
  describeListingAttributes,
  listingFacts,
  missingRequiredAttributes,
  parseListingAttributes,
  parseLocaleNumber,
  priceFieldLabel,
  priceSuffix,
  readAttributeForm,
} from './index.js';

const NOW = new Date('2026-10-27T12:00:00Z');
/** Intl setzt nach „€“ ein geschütztes Leerzeichen */
const plain = (value: string | undefined) => value?.replace(/\u00a0/g, ' ');
const keys = (path: string) => categoryAttributeSchema(path).fields.map((f) => f.key);

describe('categoryAttributeSchema', () => {
  it('unterscheidet nach Unterkategorie, nicht nur nach Bereich', () => {
    expect(keys('auto-motor/gebrauchtwagen')).toEqual(
      expect.arrayContaining(['brand', 'model', 'firstRegistrationYear', 'mileageKm', 'fuelType', 'transmission', 'powerKw', 'vehicleCondition']),
    );
    expect(keys('auto-motor/motorraeder')).toContain('displacementCcm');
    expect(keys('auto-motor/motorraeder')).not.toContain('sleepingPlaces');
    expect(keys('immobilien/wohnungen/mietwohnungen')).toContain('floor');
    expect(keys('immobilien/haeuser/haeuser-kaufen')).not.toContain('floor');
    expect(keys('immobilien/haeuser/haeuser-kaufen')).toContain('plotAreaSqm');
    expect(keys('jobs/vollzeit')).toEqual(expect.arrayContaining(['jobTitle', 'employmentType', 'weeklyHours', 'workplaceType', 'salaryGross', 'experience']));
    expect(keys('marktplatz/elektronik/handys-smartphones')).toEqual(['brand', 'storageGb']);
    expect(keys('marktplatz/garten/pflanzen')).toEqual([]);
  });

  it('erbt Regeln vom übergeordneten Pfad', () => {
    expect(keys('marktplatz/moebel-wohnen/sofas-sessel')).toEqual(['widthCm', 'depthCm', 'heightCm']);
    expect(keys('marktplatz/moebel-wohnen/deko-accessoires')).toEqual([]);
    expect(categoryAttributeSchema('marktplatz/dienstleistungen/handwerk').itemCondition).toBe(false);
    expect(categoryAttributeSchema('marktplatz/elektronik/tv-audio').itemCondition).toBe(true);
    expect(categoryAttributeSchema('auto-motor/fahrzeugzubehoer/ersatzteile').itemCondition).toBe(true);
    expect(categoryAttributeSchema('auto-motor/gebrauchtwagen').itemCondition).toBe(false);
  });

  it('kennt Jobs ohne Preis und mit Arbeitsort', () => {
    const jobs = categoryAttributeSchema('jobs/teilzeit');
    expect(jobs.price).toBe('none');
    expect(jobs.locationLabel).toBe('Arbeitsort');
  });

  it('liefert ohne Kategorie keine Zusatzfelder', () => {
    expect(categoryAttributeSchema(null).fields).toEqual([]);
    expect(categoryAttributeSchema('gibt-es/nicht').fields).toEqual([]);
  });
});

describe('parseListingAttributes', () => {
  const car = categoryAttributeSchema('auto-motor/gebrauchtwagen');
  const validCar = {
    brand: 'vw',
    model: 'Golf 1.5 TSI',
    firstRegistrationYear: 2019,
    firstRegistrationMonth: '03',
    mileageKm: 85_000,
    fuelType: 'petrol',
    transmission: 'manual',
    powerKw: 110,
    vehicleCondition: 'used',
  };

  it('akzeptiert gültige Angaben und bereinigt Texte', () => {
    const result = parseListingAttributes(car, { ...validCar, model: '  Golf   1.5 TSI ' }, NOW);
    expect(result.issues).toEqual([]);
    expect(result.attributes).toEqual(validCar);
    expect(missingRequiredAttributes(car, result.attributes)).toEqual([]);
  });

  it('lehnt fremde Felder, falsche Typen und Bereiche mit deutschen Meldungen ab', () => {
    const result = parseListingAttributes(
      car,
      { ...validCar, livingAreaSqm: 80, mileageKm: -5, fuelType: 'kerosin', firstRegistrationYear: 2027, model: 42, powerKw: 110.5 },
      NOW,
    );
    expect(Object.fromEntries(result.issues.map((i) => [i.path, i.message]))).toEqual({
      'attributes.livingAreaSqm': 'Diese Angabe passt nicht zur gewählten Kategorie.',
      'attributes.mileageKm': 'Kilometerstand muss zwischen 0 und 2.000.000 km liegen.',
      'attributes.fuelType': 'Bitte wähle bei „Kraftstoff“ einen der vorgegebenen Werte.',
      'attributes.firstRegistrationYear': 'Erstzulassung muss zwischen 1900 und 2026 liegen.',
      'attributes.model': 'Bitte gib bei „Modell“ einen Text ein.',
      'attributes.powerKw': 'Leistung muss eine ganze Zahl sein.',
    });
  });

  it('meldet Felder bei Kategorien ohne Zusatzangaben', () => {
    const result = parseListingAttributes(categoryAttributeSchema('marktplatz/garten/pflanzen'), { mileageKm: 1 });
    expect(result.issues[0]).toEqual({ path: 'attributes.mileageKm', message: 'Für diese Kategorie gibt es keine Zusatzangaben.' });
  });

  it('prüft Nachkommastellen und Raster', () => {
    const flat = categoryAttributeSchema('immobilien/wohnungen/mietwohnungen');
    expect(parseListingAttributes(flat, { rooms: 2.5 }).issues).toEqual([]);
    expect(parseListingAttributes(flat, { rooms: 2.3 }).issues[0]?.message).toBe('Zimmer ist nur in Schritten von 0,5 möglich.');
    expect(parseListingAttributes(flat, { operatingCosts: 180.555 }).issues[0]?.message).toBe(
      'Betriebskosten darf höchstens 2 Nachkommastellen haben.',
    );
    expect(parseListingAttributes(flat, { rooms: Number.POSITIVE_INFINITY }).issues).toHaveLength(1);
  });

  it('setzt feste Werte der Kategorie und lehnt abweichende ab', () => {
    const rent = categoryAttributeSchema('immobilien/wohnungen/mietwohnungen');
    expect(parseListingAttributes(rent, {}).attributes).toEqual({ offerType: 'RENT' });
    expect(parseListingAttributes(rent, { offerType: 'BUY' }).issues[0]?.message).toBe(
      'In dieser Kategorie ist „Angebotsart“ immer „Miete“.',
    );
    const plot = categoryAttributeSchema('immobilien/grundstuecke');
    expect(parseListingAttributes(plot, { offerType: 'BUY' }).attributes.offerType).toBe('BUY');
    expect(parseListingAttributes(plot, {}).attributes.offerType).toBeUndefined();
  });

  it('normalisiert Mehrfachauswahl und verwirft leere Werte', () => {
    const flat = categoryAttributeSchema('immobilien/wohnungen/eigentumswohnungen');
    const result = parseListingAttributes(flat, { features: ['elevator', 'balcony', 'balcony'], heating: '', floor: null });
    expect(result.issues).toEqual([]);
    expect(result.attributes).toEqual({ offerType: 'BUY', features: ['balcony', 'elevator'] });
    // „Haustiere erlaubt“ gibt es nur bei Miete
    expect(parseListingAttributes(flat, { features: ['pets-allowed'] }).issues).toHaveLength(1);
  });
});

describe('missingRequiredAttributes', () => {
  it('nennt fehlende Pflichtangaben je Kategorie', () => {
    const issues = missingRequiredAttributes(categoryAttributeSchema('immobilien/wohnungen/mietwohnungen'), { offerType: 'RENT' });
    expect(issues).toEqual([
      { path: 'attributes.livingAreaSqm', message: 'Bitte gib „Wohnfläche“ an.' },
      { path: 'attributes.rooms', message: 'Bitte gib „Zimmer“ an.' },
    ]);
  });

  it('verlangt beim Neuwagen weniger als beim Gebrauchtwagen', () => {
    const base = { brand: 'vw', model: 'ID.3', fuelType: 'electric', transmission: 'automatic', vehicleCondition: 'new' };
    expect(missingRequiredAttributes(categoryAttributeSchema('auto-motor/neuwagen'), base)).toEqual([]);
    expect(missingRequiredAttributes(categoryAttributeSchema('auto-motor/gebrauchtwagen'), { ...base, vehicleCondition: 'used' }).map((i) => i.path)).toEqual([
      'attributes.firstRegistrationYear',
      'attributes.mileageKm',
    ]);
  });

  it('verlangt den Gehaltszeitraum nur, wenn ein Gehalt angegeben ist (Freelance)', () => {
    const freelance = categoryAttributeSchema('jobs/freelance');
    const base = { jobTitle: 'Webentwicklung', employmentType: 'contract-work', workplaceType: 'remote' };
    expect(missingRequiredAttributes(freelance, base)).toEqual([]);
    expect(missingRequiredAttributes(freelance, { ...base, salaryGross: 60 }).map((i) => i.path)).toEqual(['attributes.salaryPeriod']);
  });
});

describe('carryOverAttributes', () => {
  it('übernimmt beim Kategoriewechsel nur passende Werte', () => {
    const stored = { offerType: 'RENT', livingAreaSqm: 72, rooms: 3, features: ['balcony', 'pets-allowed'], mileageKm: 5 };
    expect(carryOverAttributes(categoryAttributeSchema('immobilien/wohnungen/eigentumswohnungen'), stored)).toEqual({
      offerType: 'BUY',
      livingAreaSqm: 72,
      rooms: 3,
      features: ['balcony'],
    });
    expect(carryOverAttributes(categoryAttributeSchema('jobs/vollzeit'), stored)).toEqual({});
  });

  it('ignoriert ungültige Altdaten statt abzustürzen', () => {
    expect(carryOverAttributes(categoryAttributeSchema('auto-motor/gebrauchtwagen'), null)).toEqual({});
    expect(carryOverAttributes(categoryAttributeSchema('auto-motor/gebrauchtwagen'), ['x'])).toEqual({});
    expect(carryOverAttributes(categoryAttributeSchema('auto-motor/gebrauchtwagen'), { mileageKm: '85000', firstRegistrationYear: 2019 })).toEqual({
      firstRegistrationYear: 2019,
    });
  });
});

describe('parseLocaleNumber und readAttributeForm', () => {
  it('versteht österreichische Zahlenformate', () => {
    expect(parseLocaleNumber('85.000')).toBe(85_000);
    expect(parseLocaleNumber('1.299,90')).toBe(1299.9);
    expect(parseLocaleNumber('2,5')).toBe(2.5);
    expect(parseLocaleNumber('38.5')).toBe(38.5);
    expect(parseLocaleNumber('85 000')).toBe(85_000);
    expect(parseLocaleNumber('viel')).toBeNull();
    expect(parseLocaleNumber('')).toBeNull();
  });

  it('liest nur die Felder der aktuellen Kategorie aus dem Formular', () => {
    const form = new Map<string, string[]>([
      ['attr.livingAreaSqm', ['72,5']],
      ['attr.rooms', ['3']],
      ['attr.features', ['balcony', 'elevator']],
      ['attr.mileageKm', ['85.000']],
      ['attr.offerType', ['BUY']],
      ['attr.heating', ['']],
    ]);
    const result = readAttributeForm(categoryAttributeSchema('immobilien/wohnungen/mietwohnungen'), (name) => form.get(name) ?? []);
    expect(result.issues).toEqual([]);
    expect(result.attributes).toEqual({ livingAreaSqm: 72.5, rooms: 3, features: ['balcony', 'elevator'] });
  });

  it('meldet Texte in Zahlenfeldern', () => {
    const result = readAttributeForm(categoryAttributeSchema('auto-motor/gebrauchtwagen'), (name) =>
      name === 'attr.mileageKm' ? ['ca. 80 tkm'] : [],
    );
    expect(result.issues).toEqual([{ path: 'attributes.mileageKm', message: 'Bitte gib bei „Kilometerstand“ eine Zahl ein.' }]);
  });
});

describe('Darstellung', () => {
  it('formatiert Angaben für die Detailseite', () => {
    const car = categoryAttributeSchema('auto-motor/gebrauchtwagen');
    const items = describeListingAttributes(car, {
      brand: 'vw', model: 'Golf', firstRegistrationYear: 2019, firstRegistrationMonth: '03', mileageKm: 85_000, fuelType: 'diesel', powerKw: 110, legacy: 'x',
    });
    expect(items.map((i) => [i.label, i.value])).toEqual([
      ['Marke', 'VW'],
      ['Modell', 'Golf'],
      ['Erstzulassung', '03/2019'],
      ['Kilometerstand', '85.000 km'],
      ['Kraftstoff', 'Diesel'],
      ['Leistung', '110 kW (150 PS)'],
    ]);
    expect(listingFacts(car, { firstRegistrationYear: 2019, mileageKm: 85_000, fuelType: 'diesel' })).toEqual(['2019', '85.000 km', 'Diesel']);
  });

  it('zeigt Gehalt, Ausstattung und Betriebskosten lesbar an', () => {
    const job = categoryAttributeSchema('jobs/vollzeit');
    const items = describeListingAttributes(job, { salaryGross: 2400, salaryPeriod: 'month', overpayment: true, weeklyHours: 38.5 });
    expect(items.map((i) => plain(i.value))).toEqual(['38,5 Std. / Woche', '€ 2.400 brutto pro Monat, Überzahlung möglich']);

    const flat = categoryAttributeSchema('immobilien/wohnungen/mietwohnungen');
    const flatItems = describeListingAttributes(flat, { livingAreaSqm: 72.5, operatingCosts: 180.5, features: ['balcony', 'elevator'] });
    expect(plain(flatItems.find((i) => i.key === 'operatingCosts')?.value)).toBe('€ 180,50 / Monat');
    expect(flatItems.find((i) => i.key === 'features')?.values).toEqual(['Balkon', 'Lift']);
    expect(flatItems.find((i) => i.key === 'offerType')?.value).toBe('Miete');
  });

  it('beschriftet Preise je nach Angebotsart', () => {
    const rent = categoryAttributeSchema('immobilien/wohnungen/mietwohnungen');
    expect(priceSuffix(rent, {})).toBe('pro Monat');
    expect(priceFieldLabel(rent, {})).toBe('Miete pro Monat in Euro');
    const plot = categoryAttributeSchema('immobilien/grundstuecke');
    expect(priceFieldLabel(plot, { offerType: 'BUY' })).toBe('Kaufpreis in Euro');
    expect(priceSuffix(categoryAttributeSchema('marktplatz/dienstleistungen/handwerk'), { pricePer: 'hour' })).toBe('pro Stunde');
    expect(priceSuffix(categoryAttributeSchema('marktplatz/garten/pflanzen'), { pricePer: 'hour' })).toBeNull();
  });
});
