import { parseSearchParams, searchFiltersFor, type CategoryNode, type LocationSummary } from '@marktat/shared';
import { describe, expect, it } from 'vitest';
import { formToSearch } from '@/components/search/search-filters';
import { activeFilters, findCategoryByPath, formatFilterNumber, resetHref, searchHref } from './search';

const BIKES = 'marktplatz/sport-freizeit/fahrraeder';
const VIENNA: LocationSummary = {
  id: 1,
  postalCode: '1010',
  place: 'Wien',
  municipality: null,
  district: 'Wien (Innere Stadt)',
  state: 'Wien',
  stateCode: 'AT-9',
};

const node = (path: string, name: string, children: CategoryNode[] = []): CategoryNode => ({
  id: path,
  slug: path.split('/').pop()!,
  path,
  name,
  vertical: 'MARKETPLACE',
  icon: null,
  children,
});

function parse(url: string) {
  const input = Object.fromEntries(new URL(url, 'http://x').searchParams);
  const filters = searchFiltersFor(input.kategorie ?? null);
  return { ...parseSearchParams(input, filters), filters };
}

describe('activeFilters', () => {
  it('beschreibt jeden Filter und verlinkt auf die Suche ohne ihn', () => {
    const { query, filters } = parse(`/suche?q=rad&kategorie=${BIKES}&plz=1010&umkreis=25&preis_bis=500&radtyp=city,e-bike&zustand=gut&sortierung=entfernung`);
    const chips = activeFilters(query, filters, { category: node(BIKES, 'Fahrräder'), location: VIENNA });
    expect(chips.map((c) => c.label)).toEqual([
      'Fahrräder',
      '1010 Wien + 25 km',
      'Preis bis €\u00a0500',
      'Zustand: Gut',
      'Fahrradart: Citybike',
      'Fahrradart: E-Bike',
    ]);

    const withoutPlace = new URL(chips[1]!.removeHref, 'http://x').searchParams;
    expect(withoutPlace.has('plz')).toBe(false);
    expect(withoutPlace.has('umkreis')).toBe(false);
    // Ohne Ort gibt es keine Entfernung – die Sortierung fällt auf Relevanz zurück
    expect(withoutPlace.get('sortierung')).not.toBe('entfernung');
    expect(withoutPlace.get('radtyp')).toBe('city,e-bike');

    const withoutCity = new URL(chips[4]!.removeHref, 'http://x').searchParams;
    expect(withoutCity.get('radtyp')).toBe('e-bike');

    // Ohne Kategorie fallen auch deren Eigenschaftsfilter weg
    const withoutCategory = new URL(chips[0]!.removeHref, 'http://x').searchParams;
    expect(withoutCategory.has('kategorie')).toBe(false);
    expect(withoutCategory.has('radtyp')).toBe(false);
    expect(withoutCategory.get('q')).toBe('rad');
  });

  it('setzt beim Entfernen eines Filters auf Seite 1 zurück', () => {
    const { query, filters } = parse('/suche?bundesland=tirol&seite=3');
    const [state] = activeFilters(query, filters, {});
    expect(state!.label).toBe('Tirol');
    expect(state!.removeHref).toBe('/suche');
  });
});

describe('Links', () => {
  it('ergibt aus einer geteilten URL wieder dieselbe Suche', () => {
    const url = `/suche?kategorie=${BIKES}&plz=1010&umkreis=10&laufrad_ab=26&radtyp=city`;
    const { query, filters } = parse(url);
    expect(parse(searchHref(query, filters)).query).toEqual(query);
  });

  it('„alle zurücksetzen“ behält nur den Suchbegriff', () => {
    expect(resetHref(parse('/suche?q=sofa&bundesland=wien').query)).toBe('/suche?q=sofa');
    expect(resetHref(parse('/suche?bundesland=wien').query)).toBe('/suche');
  });

  it('formatiert Zahlen, Beträge und Jahreszahlen', () => {
    const [year, mileage] = ['firstRegistrationYear', 'mileageKm'].map((k) => searchFiltersFor('auto-motor/gebrauchtwagen').find((f) => f.key === k)!);
    expect(formatFilterNumber(year!, 2015)).toBe('2015');
    expect(formatFilterNumber(mileage!, 100000)).toBe('100.000 km');
    const salary = searchFiltersFor('jobs').find((f) => f.key === 'salaryMonthly')!;
    expect(formatFilterNumber(salary, 2500)).toBe('€\u00a02.500');
  });

  it('findet Kategorien über ihren Pfad', () => {
    const tree = [node('marktplatz', 'Marktplatz', [node('marktplatz/sport-freizeit', 'Sport & Freizeit', [node(BIKES, 'Fahrräder')])])];
    expect(findCategoryByPath(tree, BIKES)?.name).toBe('Fahrräder');
    expect(findCategoryByPath(tree, 'gibt/es/nicht')).toBeUndefined();
  });
});

describe('formToSearch', () => {
  it('übernimmt nur Filter, die zur gewählten Kategorie passen', () => {
    const href = formToSearch([
      ['q', ' rad '],
      ['bereich', 'marktplatz'],
      ['kategorie', BIKES],
      ['radtyp', 'city'],
      ['radtyp', 'e-bike'],
      // Filter einer vorher gewählten Kategorie
      ['kraftstoff', 'diesel'],
      ['preis_ab', ''],
      ['preis_bis', '500'],
    ]);
    expect(href).toBe(`/suche?q=rad&kategorie=${encodeURIComponent(BIKES)}&radtyp=city%2Ce-bike&preis_bis=500`);
  });

  it('verlangt für den Umkreis einen Ort und bevorzugt den gewählten Ort vor der PLZ', () => {
    expect(formToSearch([['umkreis', '25']])).toBe('/suche');
    expect(formToSearch([['ort', '42'], ['plz', '1010'], ['umkreis', '25']])).toBe('/suche?ort=42&umkreis=25');
  });

  it('kennt bei Jobs kein Preisfeld', () => {
    expect(formToSearch([['bereich', 'jobs'], ['preis_bis', '100'], ['gehalt_ab', '2500']])).toBe('/suche?bereich=jobs&gehalt_ab=2500');
  });
});
