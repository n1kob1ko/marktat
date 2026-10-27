import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type { SearchIndexService } from '../src/search/search-index.service.js';
import { createTestApp, flushSearch, resetData, tokenFor } from './helpers.js';

/**
 * Suche über Meilisearch und Ausweichbetrieb über PostgreSQL mit denselben Testdaten.
 * Voraussetzung: Meilisearch läuft (`pnpm infra:up`), MEILI_URL ist gesetzt.
 */
describe('Suche', () => {
  let app: NestExpressApplication;
  let fallback: NestExpressApplication;
  let prisma: PrismaService;
  let searchIndex: SearchIndexService;
  const ids: Record<string, string> = {};
  const category: Record<string, string> = {};
  const place: Record<string, number> = {};

  const server = () => app.getHttpServer();
  const search = async (query: Record<string, string | number>, target = server()) => {
    const res = await request(target).get('/v1/listings').query(query).expect(200);
    return res.body as { items: { id: string; title: string; distanceKm?: number }[]; total: number; engine: string; totalPages: number; location: unknown };
  };
  const titles = (body: { items: { title: string }[] }) => body.items.map((i) => i.title);

  beforeAll(async () => {
    ({ app, prisma, searchIndex } = await createTestApp());
    // Port 9 (discard) – hier läuft kein Meilisearch: simuliert einen Ausfall
    ({ app: fallback } = await createTestApp({ meiliUrl: 'http://127.0.0.1:9' }));
    await resetData(prisma);

    for (const path of [
      'marktplatz/sport-freizeit/fahrraeder', 'auto-motor/gebrauchtwagen', 'immobilien/wohnungen/mietwohnungen',
      'immobilien/wohnungen/eigentumswohnungen', 'jobs/vollzeit',
    ]) {
      category[path] = (await prisma.category.findUniqueOrThrow({ where: { path } })).id;
    }
    for (const [key, postalCode, name] of [
      ['wien7', '1070', 'Wien'], ['wien1', '1010', 'Wien'], ['moedling', '2340', 'Mödling'], ['stpoelten', '3100', 'St. Pölten'], ['graz', '8010', 'Graz'],
    ] as const) {
      place[key] = (await prisma.location.findFirstOrThrow({ where: { postalCode, place: name } })).id;
    }

    const privat = await tokenFor();
    const firma = await tokenFor({ metadata: { display_name: 'Radhaus', account_type: 'BUSINESS', company_name: 'Radhaus GmbH' } });
    const description = 'Gepflegt, sofort verfügbar. Besichtigung und Abholung nach Vereinbarung.';
    const create = async (key: string, seller: { auth: Record<string, string> }, body: Record<string, unknown>, publish = true) => {
      const res = await request(server()).post('/v1/listings').set(seller.auth).send({ publish, description, priceType: 'FIXED', ...body });
      if (res.status !== 201) throw new Error(`${key}: ${JSON.stringify(res.body)}`);
      ids[key] = res.body.id;
    };
    const bikes = category['marktplatz/sport-freizeit/fahrraeder']!;
    await create('damenrad', privat, {
      title: 'Damen Fahrrad 28 Zoll, 7-Gang', categoryId: bikes, priceCents: 18_000, condition: 'GOOD', locationId: place.wien7,
      attributes: { bikeType: 'city', wheelSize: '28' },
    });
    await create('ebike', firma, {
      title: 'E-Bike Trekking mit neuem Akku', categoryId: bikes, priceCents: 120_000, condition: 'LIKE_NEW', locationId: place.moedling,
      attributes: { bikeType: 'e-bike', wheelSize: '28' },
    });
    await create('kinderrad', privat, {
      title: 'Kinderrad 20 Zoll blau', categoryId: bikes, priceCents: 6_000, condition: 'ACCEPTABLE', locationId: place.stpoelten,
      attributes: { bikeType: 'kids', wheelSize: '20' },
    });
    await create('rennrad', privat, {
      title: 'Rennrad Carbon 56 cm', categoryId: bikes, priceType: 'FREE', condition: 'GOOD', locationId: place.graz,
      attributes: { bikeType: 'road', wheelSize: '28' },
    });
    await create('entwurf', privat, { title: 'Fahrrad Entwurf Wien', categoryId: bikes, locationId: place.wien7 }, false);
    await create('pausiert', privat, {
      title: 'Pausiertes Fahrrad Wien', categoryId: bikes, priceCents: 10_000, condition: 'GOOD', locationId: place.wien1,
    });
    await request(server()).post(`/v1/listings/${ids.pausiert}/pause`).set(privat.auth).expect(200);

    const cars = category['auto-motor/gebrauchtwagen']!;
    const car = { transmission: 'manual', vehicleCondition: 'used' };
    await create('golf', firma, {
      title: 'VW Golf 2.0 TDI Highline', categoryId: cars, priceCents: 1_590_000, locationId: place.wien1,
      attributes: { ...car, brand: 'vw', model: 'Golf 2.0 TDI', firstRegistrationYear: 2018, mileageKm: 90_000, fuelType: 'diesel', powerKw: 110 },
    });
    await create('audi', privat, {
      title: 'Audi A4 Avant 1.8 TFSI', categoryId: cars, priceCents: 890_000, locationId: place.graz,
      attributes: { ...car, brand: 'audi', model: 'A4 Avant 1.8 TFSI', firstRegistrationYear: 2012, mileageKm: 180_000, fuelType: 'petrol', transmission: 'automatic' },
    });

    await create('altbau', privat, {
      title: 'Helle 3-Zimmer-Altbauwohnung', categoryId: category['immobilien/wohnungen/mietwohnungen'], priceCents: 110_000, locationId: place.wien7,
      attributes: { livingAreaSqm: 75, rooms: 3, features: ['balcony', 'elevator', 'cellar'] },
    });
    await create('garconniere', privat, {
      title: 'Garçonnière nahe Uni', categoryId: category['immobilien/wohnungen/mietwohnungen'], priceCents: 55_000, locationId: place.graz,
      attributes: { livingAreaSqm: 35, rooms: 1, features: ['elevator'] },
    });
    await create('eigentum', firma, {
      title: 'Eigentumswohnung mit Terrasse', categoryId: category['immobilien/wohnungen/eigentumswohnungen'], priceCents: 45_000_000, locationId: place.wien1,
      attributes: { livingAreaSqm: 92, rooms: 3, features: ['terrace', 'balcony', 'elevator'] },
    });

    const job = { employmentType: 'employee', workplaceType: 'hybrid' };
    const noPrice = { priceType: 'ON_REQUEST' };
    await create('entwickler', firma, {
      ...noPrice, title: 'Softwareentwickler/in Java', categoryId: category['jobs/vollzeit'], locationId: place.wien1,
      attributes: { ...job, jobTitle: 'Softwareentwickler/in', jobField: 'it', salaryGross: 56_000, salaryPeriod: 'year' },
    });
    await create('buero', privat, {
      ...noPrice, title: 'Bürokraft Vollzeit', categoryId: category['jobs/vollzeit'], locationId: place.graz,
      attributes: { ...job, jobTitle: 'Bürokraft', jobField: 'office', salaryGross: 2_100, salaryPeriod: 'month', workplaceType: 'onsite' },
    });
    await flushSearch();
  });

  afterAll(async () => {
    await Promise.all([app.close(), fallback.close()]);
  });

  it('nutzt Meilisearch und findet trotz Tippfehler', async () => {
    const result = await search({ q: 'fahrad' });
    expect(result.engine).toBe('meilisearch');
    // Titeltreffer zuerst, die übrigen Räder über den Kategorienamen „Fahrräder“
    expect(titles(result)[0]).toBe('Damen Fahrrad 28 Zoll, 7-Gang');
    expect(result.total).toBe(4);
    expect(titles(await search({ q: 'golf diesel' }))).toEqual(['VW Golf 2.0 TDI Highline']);
    // Kategorie- und Zusatzangaben sind durchsuchbar
    expect(titles(await search({ q: 'Fahrräder', sortierung: 'preis_auf' }))).toEqual([
      'Rennrad Carbon 56 cm', 'Kinderrad 20 Zoll blau', 'Damen Fahrrad 28 Zoll, 7-Gang', 'E-Bike Trekking mit neuem Akku',
    ]);
  });

  it('zeigt nie Entwürfe, pausierte, gelöschte oder abgelaufene Inserate', async () => {
    const all = await search({ pageSize: 50 });
    expect(all.total).toBe(11);
    expect(all.items.map((i) => i.id)).not.toContain(ids.entwurf);
    expect(all.items.map((i) => i.id)).not.toContain(ids.pausiert);
    expect((await search({ q: 'pausiertes' })).total).toBe(0);
  });

  it('Fahrräder im Umkreis von 25 km um 1010 Wien, nach Entfernung', async () => {
    const result = await search({ kategorie: 'marktplatz/sport-freizeit/fahrraeder', plz: '1010', umkreis: 25, sortierung: 'entfernung' });
    expect(titles(result)).toEqual(['Damen Fahrrad 28 Zoll, 7-Gang', 'E-Bike Trekking mit neuem Akku']);
    expect(result.location).toMatchObject({ postalCode: '1010', place: 'Wien' });
    expect(result.items[0]!.distanceKm).toBeLessThan(3);
    expect(result.items[1]!.distanceKm).toBeGreaterThan(10);
    expect(result.items[1]!.distanceKm).toBeLessThan(25);

    const wider = await search({ kategorie: 'marktplatz/sport-freizeit/fahrraeder', ort: place.wien1!, umkreis: 100 });
    expect(titles(wider)).toContain('Kinderrad 20 Zoll blau');
    expect(titles(wider)).not.toContain('Rennrad Carbon 56 cm');
    // Ohne Umkreis: genau diese PLZ
    expect(titles(await search({ plz: '1070' })).sort()).toEqual(['Damen Fahrrad 28 Zoll, 7-Gang', 'Helle 3-Zimmer-Altbauwohnung']);
  });

  it('allgemeine Filter: Preis, Bundesland, Anbieter, Zustand', async () => {
    const bikes = { kategorie: 'marktplatz/sport-freizeit/fahrraeder' };
    expect(titles(await search({ ...bikes, preis_bis: 100, sortierung: 'preis_ab' }))).toEqual(['Kinderrad 20 Zoll blau', 'Rennrad Carbon 56 cm']);
    expect(titles(await search({ ...bikes, preis_ab: 100, preis_bis: 500 }))).toEqual(['Damen Fahrrad 28 Zoll, 7-Gang']);
    expect(titles(await search({ ...bikes, bundesland: 'niederoesterreich', sortierung: 'preis_auf' }))).toEqual([
      'Kinderrad 20 Zoll blau', 'E-Bike Trekking mit neuem Akku',
    ]);
    expect(titles(await search({ ...bikes, anbieter: 'gewerblich' }))).toEqual(['E-Bike Trekking mit neuem Akku']);
    expect((await search({ ...bikes, anbieter: 'privat' })).total).toBe(3);
    expect(titles(await search({ ...bikes, zustand: 'wie-neu,akzeptabel', sortierung: 'preis_auf' }))).toEqual([
      'Kinderrad 20 Zoll blau', 'E-Bike Trekking mit neuem Akku',
    ]);
    expect(titles(await search({ ...bikes, radtyp: 'kids,road', sortierung: 'preis_auf' }))).toEqual(['Rennrad Carbon 56 cm', 'Kinderrad 20 Zoll blau']);
  });

  it('Auto & Motor: Marke, Modell, Erstzulassung, Kilometer, Kraftstoff, Getriebe, Leistung', async () => {
    const cars = { bereich: 'auto-motor' };
    expect(titles(await search({ ...cars, kraftstoff: 'diesel' }))).toEqual(['VW Golf 2.0 TDI Highline']);
    expect(titles(await search({ ...cars, kilometer_bis: 100_000, erstzulassung_ab: 2015 }))).toEqual(['VW Golf 2.0 TDI Highline']);
    expect(titles(await search({ ...cars, marke: 'audi,bmw' }))).toEqual(['Audi A4 Avant 1.8 TFSI']);
    expect(titles(await search({ ...cars, modell: 'avant' }))).toEqual(['Audi A4 Avant 1.8 TFSI']);
    expect(titles(await search({ ...cars, getriebe: 'automatic' }))).toEqual(['Audi A4 Avant 1.8 TFSI']);
    expect(titles(await search({ kategorie: 'auto-motor/gebrauchtwagen', leistung_ab: 100 }))).toEqual(['VW Golf 2.0 TDI Highline']);
  });

  it('Immobilien: Kaufen/Mieten, Fläche, Zimmer, Monatsmiete, Ausstattung', async () => {
    const estate = { bereich: 'immobilien' };
    expect(titles(await search({ ...estate, angebot: 'BUY' }))).toEqual(['Eigentumswohnung mit Terrasse']);
    expect(titles(await search({ ...estate, angebot: 'RENT', preis_bis: 1000 }))).toEqual(['Garçonnière nahe Uni']);
    expect(titles(await search({ ...estate, zimmer_ab: 2, wohnflaeche_bis: 80 }))).toEqual(['Helle 3-Zimmer-Altbauwohnung']);
    expect(titles(await search({ ...estate, ausstattung: 'balcony,elevator', sortierung: 'preis_auf' }))).toEqual([
      'Helle 3-Zimmer-Altbauwohnung', 'Eigentumswohnung mit Terrasse',
    ]);
    expect((await search({ ...estate, ausstattung: 'balcony,garden' })).total).toBe(0);
  });

  it('Jobs: Berufsbereich, Arbeitsort, Gehalt (Jahresgehalt auf Monat umgerechnet)', async () => {
    const jobs = { bereich: 'jobs' };
    expect(titles(await search({ ...jobs, gehalt_ab: 3000 }))).toEqual(['Softwareentwickler/in Java']);
    expect(titles(await search({ ...jobs, gehalt_bis: 3000 }))).toEqual(['Bürokraft Vollzeit']);
    expect(titles(await search({ ...jobs, berufsbereich: 'office' }))).toEqual(['Bürokraft Vollzeit']);
    expect(titles(await search({ ...jobs, arbeitsort: 'hybrid' }))).toEqual(['Softwareentwickler/in Java']);
    expect(titles(await search({ ...jobs, beschaeftigung: 'employee', bundesland: 'wien' }))).toEqual(['Softwareentwickler/in Java']);
  });

  it('lehnt ungültige Suchparameter mit 400 ab', async () => {
    for (const query of [
      { umkreis: 30, plz: '1010' },
      { umkreis: 10 },
      { kategorie: 'gibt/es/nicht' },
      { kategorie: 'auto-motor', kraftstoff: 'kerosin' },
      { ort: 999_999_999 },
      { plz: '9999' },
      { preis_ab: 'billig' },
      { seite: 0 },
      { q: 'x'.repeat(101) },
    ]) {
      const res = await request(server()).get('/v1/listings').query(query).expect(400);
      expect(res.body.errors?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('versteht weiterhin die alten Parameter und Seiten', async () => {
    const parent = (await prisma.category.findUniqueOrThrow({ where: { path: 'marktplatz/sport-freizeit' } })).id;
    expect((await search({ categoryId: parent })).total).toBe(4);
    expect((await search({ kategorie: parent })).total).toBe(4);
    expect((await search({ vertical: 'JOBS' })).total).toBe(2);
    expect((await search({ state: 'steiermark' })).total).toBe(4);
    const page1 = await search({ pageSize: 5 });
    const page3 = await search({ pageSize: 5, seite: 3 });
    expect(page1.totalPages).toBe(3);
    expect(page3.items).toHaveLength(1);
    expect(new Set([...page1.items, ...page3.items].map((i) => i.id)).size).toBe(6);
  });

  it('liefert im Ausweichbetrieb (PostgreSQL) dieselben Treffer', async () => {
    const queries: Record<string, string | number>[] = [
      { pageSize: 50 },
      { kategorie: 'marktplatz/sport-freizeit/fahrraeder', plz: '1010', umkreis: 25, sortierung: 'entfernung' },
      { kategorie: 'marktplatz/sport-freizeit/fahrraeder', preis_bis: 100, sortierung: 'preis_ab' },
      { kategorie: 'marktplatz/sport-freizeit/fahrraeder', zustand: 'wie-neu,akzeptabel', anbieter: 'gewerblich' },
      { bereich: 'auto-motor', kilometer_bis: 100_000, erstzulassung_ab: 2015, modell: 'golf' },
      { bereich: 'immobilien', ausstattung: 'balcony,elevator', sortierung: 'preis_auf' },
      { bereich: 'immobilien', angebot: 'RENT', zimmer_ab: 1, preis_bis: 1000 },
      { bereich: 'jobs', gehalt_ab: 3000 },
      { q: 'rennrad' },
      { plz: '1070' },
    ];
    for (const query of queries) {
      const meili = await search(query);
      const postgres = await search(query, fallback.getHttpServer());
      expect(postgres.engine).toBe('postgres');
      expect({ query, titles: titles(postgres), total: postgres.total }).toEqual({ query, titles: titles(meili), total: meili.total });
    }
  });

  it('aktualisiert den Index bei Änderungen und bleibt bei einem Ausfall bedienbar', async () => {
    const owner = await prisma.listing.findUniqueOrThrow({ where: { id: ids.damenrad }, select: { sellerId: true } });
    const seller = await tokenFor({ id: owner.sellerId });
    // Bearbeiten → neuer Titel ist sofort suchbar
    await request(server()).patch(`/v1/listings/${ids.damenrad}`).set(seller.auth).send({ title: 'Hollandrad Damen 28 Zoll' }).expect(200);
    await flushSearch();
    expect(titles(await search({ q: 'hollandrad' }))).toEqual(['Hollandrad Damen 28 Zoll']);
    // Pausieren → verschwindet, Fortsetzen → wieder da
    await request(server()).post(`/v1/listings/${ids.damenrad}/pause`).set(seller.auth).expect(200);
    await flushSearch();
    expect((await search({ q: 'hollandrad' })).total).toBe(0);
    await request(server()).post(`/v1/listings/${ids.damenrad}/resume`).set(seller.auth).expect(200);
    await flushSearch();
    expect((await search({ q: 'hollandrad' })).total).toBe(1);
    // Löschen → verschwindet
    await request(server()).delete(`/v1/listings/${ids.damenrad}`).set(seller.auth).expect(204);
    await flushSearch();
    expect((await search({ q: 'hollandrad' })).total).toBe(0);

    // Meilisearch nicht erreichbar: Anlegen funktioniert trotzdem, die Aktualisierung wird vorgemerkt
    const res = await request(fallback.getHttpServer())
      .post('/v1/listings')
      .set(seller.auth)
      .send({
        publish: true, title: 'Mountainbike Fully 29 Zoll', description: 'Wenig gefahren, frisch serviciert, inkl. Pedale.',
        categoryId: category['marktplatz/sport-freizeit/fahrraeder'], priceType: 'FIXED', priceCents: 75_000, condition: 'GOOD', locationId: place.graz,
      })
      .expect(201);
    const fallbackIndex = fallback.get((await import('../src/search/search-index.service.js')).SearchIndexService);
    await fallbackIndex.flush();
    expect(fallbackIndex.pendingIds()).toContain(res.body.id);
    expect((await search({ q: 'mountainbike' }, fallback.getHttpServer())).total).toBe(1);
    expect((await search({ q: 'mountainbike' })).total).toBe(0);

    // Abgleich beim Start bzw. Neuindizierung holen es nach und entfernen veraltete Einträge
    expect(await searchIndex.reconcile()).toEqual({ added: 1, removed: 0 });
    expect((await search({ q: 'mountainbike' })).total).toBe(1);
    await searchIndex.client!.waitForTask(await searchIndex.client!.addDocuments(searchIndex.indexUid, [{ id: 'veraltet', title: 'Mountainbike veraltet', expiresAt: 4_102_444_800 }]));
    const result = await searchIndex.reindexAll();
    expect(result.indexed).toBe(11);
    expect((await search({ q: 'mountainbike' })).total).toBe(1);
  });
});
