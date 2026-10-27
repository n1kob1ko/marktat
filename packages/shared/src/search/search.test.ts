import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_RULE_PATHS, categoryAttributeSchema } from '../attributes/definitions.js';
import {
  allSearchFilters,
  filterValues,
  filterWords,
  hasActiveFilters,
  hasItemCondition,
  hasPrice,
  monthlySalary,
  parseSearchParams,
  peekFilterScope,
  searchFiltersFor,
  toSearchParams,
} from './index.js';

const params = (filters: ReturnType<typeof searchFiltersFor>, input: Record<string, string>) => parseSearchParams(input, filters);
const keys = (path: string) => searchFiltersFor(path).map((f) => f.key);

describe('searchFiltersFor', () => {
  it('leitet die Filter für Auto & Motor aus den Felddefinitionen ab', () => {
    expect(keys('auto-motor/gebrauchtwagen')).toEqual([
      'brand', 'model', 'firstRegistrationYear', 'mileageKm', 'fuelType', 'transmission', 'powerKw', 'vehicleCondition',
    ]);
    const brand = searchFiltersFor('auto-motor').find((f) => f.key === 'brand');
    // Bereich: Marken von Autos und Motorrädern zusammengeführt, ohne Duplikate
    expect(brand).toMatchObject({ kind: 'options', match: 'any', param: 'marke' });
    const values = brand && brand.kind === 'options' ? brand.options.map((o) => o.value) : [];
    expect(values).toContain('vw');
    expect(values).toContain('ducati');
    expect(new Set(values).size).toBe(values.length);
    // Spezialfilter nur einer Unterkategorie erst dort
    expect(keys('auto-motor')).not.toContain('sleepingPlaces');
    expect(keys('auto-motor/wohnmobile-wohnwagen')).toContain('sleepingPlaces');
  });

  it('kennt Kaufen/Mieten, Fläche, Zimmer und Ausstattung bei Immobilien', () => {
    const filters = searchFiltersFor('immobilien');
    expect(filters.map((f) => f.param)).toEqual(expect.arrayContaining(['angebot', 'wohnflaeche', 'zimmer', 'ausstattung', 'objektart']));
    expect(filters.find((f) => f.key === 'offerType')).toMatchObject({ options: [{ value: 'BUY' }, { value: 'RENT' }] });
    expect(filters.find((f) => f.key === 'features')).toMatchObject({ match: 'all' });
    // In Mietwohnungen steht „Miete“ fest – kein Filter mit nur einer Möglichkeit
    expect(keys('immobilien/wohnungen/mietwohnungen')).not.toContain('offerType');
  });

  it('bietet bei Jobs Berufsbereich, Beschäftigungsart, Arbeitsort, Arbeitszeit und Gehalt', () => {
    expect(keys('jobs')).toEqual(expect.arrayContaining(['jobField', 'employmentType', 'workplaceType', 'workingTimeModel', 'weeklyHours', 'salaryMonthly']));
    expect(searchFiltersFor('jobs').find((f) => f.key === 'salaryMonthly')).toMatchObject({ kind: 'range', param: 'gehalt', euro: true });
    expect(hasPrice('jobs')).toBe(false);
    expect(hasPrice('jobs/vollzeit')).toBe(false);
    expect(hasPrice('immobilien')).toBe(true);
  });

  it('zeigt im Marktplatz erst in der Kategorie Eigenschaftsfilter', () => {
    expect(searchFiltersFor('marktplatz')).toEqual([]);
    expect(searchFiltersFor(null)).toEqual([]);
    expect(keys('marktplatz/sport-freizeit/fahrraeder')).toEqual(['bikeType', 'wheelSize']);
    expect(hasItemCondition('marktplatz')).toBe(true);
    expect(hasItemCondition('auto-motor/gebrauchtwagen')).toBe(false);
    expect(hasItemCondition('auto-motor')).toBe(true); // Zubehör
  });

  it('verwendet jeden URL-Namen für genau ein Feld, ohne Kollision mit allgemeinen Parametern', () => {
    const reserved = ['q', 'bereich', 'kategorie', 'bundesland', 'plz', 'ort', 'umkreis', 'preis', 'anbieter', 'zustand', 'sortierung', 'seite', 'pageSize', 'state', 'vertical', 'categoryId', 'page'];
    const byParam = new Map<string, string>();
    for (const path of ATTRIBUTE_RULE_PATHS) {
      for (const field of categoryAttributeSchema(path).fields) {
        if (!field.filter) continue;
        expect(reserved).not.toContain(field.filter.param);
        expect(field.filter.param).toMatch(/^[a-z-]+$/);
        const key = byParam.get(field.filter.param);
        if (key) expect(key).toBe(field.key);
        byParam.set(field.filter.param, field.key);
      }
    }
    expect(allSearchFilters().length).toBe(new Set(allSearchFilters().map((f) => f.key)).size);
  });
});

describe('parseSearchParams', () => {
  it('liest allgemeine Filter und Umkreis', () => {
    const { query, issues } = params([], {
      q: '  Damen  Fahrrad ', kategorie: 'marktplatz/sport-freizeit/fahrraeder', ort: '42', umkreis: '25',
      preis_ab: '50', preis_bis: '1.000', anbieter: 'privat', zustand: 'neu,gut', seite: '2',
    });
    expect(issues).toEqual([]);
    expect(query).toMatchObject({
      q: 'Damen Fahrrad', category: 'marktplatz/sport-freizeit/fahrraeder', locationId: 42, radiusKm: 25,
      priceMin: 50, priceMax: 1000, seller: 'privat', conditions: ['NEW', 'GOOD'], sort: 'relevanz', page: 2,
    });
  });

  it('meldet ungültige Werte und ignoriert sie', () => {
    const { query, issues } = params([], { umkreis: '30', plz: '0123', anbieter: 'x', zustand: 'kaputt', seite: '9999', sortierung: 'zufall', bundesland: 'bayern' });
    expect(issues.map((i) => i.param).sort()).toEqual(['anbieter', 'bundesland', 'plz', 'seite', 'sortierung', 'umkreis', 'zustand']);
    expect(query).toMatchObject({ page: 1, sort: 'neueste', attributes: {} });
    expect(query.radiusKm).toBeUndefined();
  });

  it('verlangt für den Umkreis einen Ort und tauscht vertauschte Preisgrenzen', () => {
    const { query, issues } = params([], { umkreis: '10', preis_ab: '500', preis_bis: '100' });
    expect(issues).toEqual([expect.objectContaining({ param: 'umkreis' })]);
    expect(query).toMatchObject({ priceMin: 100, priceMax: 500 });
  });

  it('versteht die alten API-Parameter', () => {
    const { query } = params([], { vertical: 'JOBS', state: 'wien', categoryId: 'ckabc123', page: '3' });
    expect(query).toMatchObject({ vertical: 'JOBS', state: 'wien', category: 'ckabc123', page: 3 });
    expect(peekFilterScope({ categoryId: 'ckabc123' })).toBeNull();
    expect(peekFilterScope({ bereich: 'immobilien' })).toBe('immobilien');
    expect(peekFilterScope({ kategorie: 'jobs/vollzeit', bereich: 'jobs' })).toBe('jobs/vollzeit');
  });

  it('liest Eigenschaftsfilter der Kategorie', () => {
    const filters = searchFiltersFor('auto-motor/gebrauchtwagen');
    const { query, issues } = params(filters, {
      marke: 'vw,audi', modell: 'Golf  TSI', erstzulassung_ab: '2015', kilometer_bis: '100.000', kraftstoff: 'diesel,unbekannt',
      leistung_ab: '150', leistung_bis: '80', zimmer_ab: '3',
    });
    expect(query.attributes).toEqual({
      brand: { values: ['audi', 'vw'] },
      model: { words: ['golf', 'tsi'] },
      firstRegistrationYear: { min: 2015 },
      mileageKm: { max: 100_000 },
      fuelType: { values: ['diesel'] },
      powerKw: { min: 80, max: 150 },
    });
    // Unbekannte Option wird gemeldet, „zimmer“ gehört nicht zur Kategorie und wird übergangen
    expect(issues).toEqual([expect.objectContaining({ param: 'kraftstoff' })]);
  });

  it('Ausstattung und Ja/Nein-Filter', () => {
    const { query } = params(searchFiltersFor('immobilien'), { ausstattung: 'balcony,elevator', angebot: 'RENT' });
    expect(query.attributes).toMatchObject({ features: { values: ['balcony', 'elevator'] }, offerType: { values: ['RENT'] } });
    const garage = params(searchFiltersFor('immobilien/garagen-parkplaetze'), { 'e-laden': 'ja' });
    expect(garage.query.attributes).toEqual({ evCharging: { flag: true } });
  });

  it('erzeugt kanonische Links, die wieder dieselbe Suche ergeben', () => {
    const filters = searchFiltersFor('immobilien');
    const input = { kategorie: 'immobilien/wohnungen', ort: '7', umkreis: '10', wohnflaeche_ab: '60', ausstattung: 'balcony', sortierung: 'preis_auf', seite: '3' };
    const { query } = params(filters, input);
    const canonical = toSearchParams(query, filters);
    expect(canonical).toEqual({
      kategorie: 'immobilien/wohnungen', ort: '7', umkreis: '10', wohnflaeche_ab: '60', ausstattung: 'balcony', sortierung: 'preis_auf', seite: '3',
    });
    expect(params(filters, canonical).query).toEqual(query);
    expect(hasActiveFilters(query)).toBe(true);
    expect(hasActiveFilters(params([], {}).query)).toBe(false);
  });

  it('Entfernung als Sortierung nur mit Ort', () => {
    expect(params([], { sortierung: 'entfernung' }).query.sort).toBe('neueste');
    expect(params([], { sortierung: 'entfernung', plz: '1010' }).query.sort).toBe('entfernung');
  });
});

describe('Indexwerte', () => {
  it('normalisiert Gehälter auf Monatsbeträge (14 Gehälter)', () => {
    expect(monthlySalary({ salaryGross: 2400, salaryPeriod: 'month' })).toBe(2400);
    expect(monthlySalary({ salaryGross: 42_000, salaryPeriod: 'year' })).toBe(3000);
    expect(monthlySalary({ salaryGross: 15, salaryPeriod: 'hour', weeklyHours: 20 })).toBe(1299);
    expect(monthlySalary({})).toBeNull();
  });

  it('liefert nur Filterfelder, Freitext als Wörter', () => {
    expect(filterValues({ brand: 'vw', model: 'Golf 1.5 TSI', mileageKm: 85_000, firstRegistrationMonth: '03' })).toEqual({
      brand: 'vw', model: ['golf', '1.5', 'tsi'], mileageKm: 85_000,
    });
    expect(filterWords('  Golf, GTI (Mk7) ')).toEqual(['golf', 'gti', 'mk7']);
  });
});
