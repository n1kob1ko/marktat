import { facetCategoryCounts, rollUpCategoryCounts } from './listing-search.service.js';

describe('Trefferzahlen je Kategorie', () => {
  it('zählt jede Kategorie für ihren Bereich und alle Oberkategorien', () => {
    expect(
      rollUpCategoryCounts([
        { vertical: 'MARKETPLACE', path: 'marktplatz/sport-freizeit/fahrraeder', count: 3 },
        { vertical: 'MARKETPLACE', path: 'marktplatz/sport-freizeit/fitness', count: 1 },
        { vertical: 'MARKETPLACE', path: 'marktplatz/elektronik/handys-smartphones', count: 2 },
        { vertical: 'VEHICLES', path: 'auto-motor/gebrauchtwagen', count: 4 },
        { vertical: 'JOBS', path: null, count: 1 },
      ]),
    ).toEqual({
      marktplatz: 6,
      'marktplatz/sport-freizeit': 4,
      'marktplatz/sport-freizeit/fahrraeder': 3,
      'marktplatz/sport-freizeit/fitness': 1,
      'marktplatz/elektronik': 2,
      'marktplatz/elektronik/handys-smartphones': 2,
      'auto-motor': 4,
      'auto-motor/gebrauchtwagen': 4,
      jobs: 1,
    });
  });

  it('übernimmt Meilisearch-Facetten in derselben Form (Bereiche über vertical)', () => {
    expect(
      facetCategoryCounts({
        categoryPaths: { marktplatz: 5, 'marktplatz/elektronik': 2, 'auto-motor/gebrauchtwagen': 1 },
        vertical: { MARKETPLACE: 6, VEHICLES: 1, UNBEKANNT: 9 },
      }),
    ).toEqual({ marktplatz: 6, 'marktplatz/elektronik': 2, 'auto-motor/gebrauchtwagen': 1, 'auto-motor': 1 });
    expect(facetCategoryCounts(undefined)).toEqual({});
  });
});
