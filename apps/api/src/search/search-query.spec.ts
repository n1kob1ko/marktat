import { parseSearchParams, searchFiltersFor } from '@marktat/shared';
import { meiliFilters, meiliSort, type ResolvedSearch } from './search-query.js';

const NOW = new Date('2026-10-27T12:00:00Z');

function resolved(input: Record<string, string>, path: string | null, center: ResolvedSearch['center'] = null): ResolvedSearch {
  const filters = searchFiltersFor(path);
  return { query: parseSearchParams(input, filters).query, filters, categoryPath: path?.includes('/') ? path : null, center };
}

describe('meiliFilters', () => {
  it('blendet abgelaufene Inserate immer aus', () => {
    expect(meiliFilters(resolved({}, null), NOW)).toEqual([`expiresAt > ${NOW.getTime() / 1000}`]);
  });

  it('übersetzt Kategorie, Umkreis, Preis und Eigenschaften', () => {
    const center = { latitude: 48.2085, longitude: 16.3721, postalCode: '1010' };
    const filters = meiliFilters(
      resolved(
        { umkreis: '25', ort: '1', preis_bis: '15000', kraftstoff: 'diesel,petrol', kilometer_ab: '1000', modell: 'Golf "GTI"', anbieter: 'privat' },
        'auto-motor/gebrauchtwagen',
        center,
      ),
      NOW,
    );
    expect(filters).toEqual([
      `expiresAt > ${NOW.getTime() / 1000}`,
      'categoryPaths = "auto-motor/gebrauchtwagen"',
      '_geoRadius(48.2085, 16.3721, 25000)',
      'priceCents <= 1500000',
      'isBusiness = false',
      'attributes.model = "golf"',
      'attributes.model = "gti"',
      'attributes.mileageKm >= 1000',
      'attributes.fuelType IN ["petrol", "diesel"]',
    ]);
  });

  it('maskiert Anführungszeichen und Backslashes in Werten', () => {
    const filters = meiliFilters(resolved({ modell: 'a"b\\c' }, 'auto-motor/gebrauchtwagen'), NOW);
    expect(filters).toContain('attributes.model = "a\\"b\\\\c"');
  });

  it('Ausstattung: alle gewählten Merkmale müssen vorhanden sein', () => {
    const filters = meiliFilters(resolved({ ausstattung: 'balcony,elevator', bereich: 'immobilien' }, 'immobilien'), NOW);
    expect(filters).toContain('attributes.features = "balcony"');
    expect(filters).toContain('attributes.features = "elevator"');
  });

  it('PLZ ohne Umkreis filtert genau diese PLZ', () => {
    const center = { latitude: 47.07, longitude: 15.44, postalCode: '8010' };
    expect(meiliFilters(resolved({ plz: '8010' }, null, center), NOW)).toContain('postalCode = "8010"');
  });

  it('sortiert stabil', () => {
    expect(meiliSort(resolved({ sortierung: 'preis_auf' }, null))).toEqual(['priceCents:asc', 'publishedAt:desc', 'id:desc']);
    const center = { latitude: 48.2, longitude: 16.37, postalCode: '1010' };
    expect(meiliSort(resolved({ sortierung: 'entfernung', plz: '1010' }, null, center))[0]).toBe('_geoPoint(48.2, 16.37):asc');
  });
});
