import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, resetData, tokenFor } from './helpers.js';

/** Kategorieabhängige Zusatzangaben (Phase 3): Pflichtfelder, Entwürfe, Kategoriewechsel, Manipulation, Altbestand. */
describe('Inserate mit Zusatzangaben', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let locationId: number;
  const categories: Record<string, string> = {};

  const PATHS = {
    car: 'auto-motor/gebrauchtwagen',
    rent: 'immobilien/wohnungen/mietwohnungen',
    buy: 'immobilien/wohnungen/eigentumswohnungen',
    plot: 'immobilien/grundstuecke',
    job: 'jobs/vollzeit',
    bike: 'marktplatz/sport-freizeit/fahrraeder',
    service: 'marktplatz/dienstleistungen/handwerk',
  } as const;

  const carAttributes = {
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

  const base = (kind: keyof typeof PATHS) => ({
    title: 'Testinserat mit Zusatzangaben',
    description: 'Ausführliche Beschreibung mit mindestens zwanzig Zeichen.',
    categoryId: categories[kind],
    priceType: 'FIXED',
    priceCents: 1_490_000,
    locationId,
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    for (const [kind, path] of Object.entries(PATHS)) {
      categories[kind] = (await prisma.category.findUniqueOrThrow({ where: { path } })).id;
    }
    locationId = (await prisma.location.findFirstOrThrow({ where: { postalCode: '1010' } })).id;
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const errorPaths = (body: { errors?: { path: string }[] }) => (body.errors ?? []).map((e) => e.path).sort();

  it('veröffentlicht einen Gebrauchtwagen mit allen Angaben und zeigt Kurzinfos in der Liste', async () => {
    const seller = await tokenFor();
    const res = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('car'), publish: true, attributes: carAttributes })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'ACTIVE', vertical: 'VEHICLES', attributes: carAttributes, condition: null });

    const list = await request(server()).get('/v1/listings').expect(200);
    expect(list.body.items[0]).toMatchObject({
      vertical: 'VEHICLES',
      facts: ['03/2019', '85.000 km', 'Benzin'],
      priceSuffix: null,
      salary: null,
      category: { path: PATHS.car },
    });
  });

  it('nennt fehlende Pflichtangaben gemeinsam mit den übrigen Feldfehlern', async () => {
    const seller = await tokenFor();
    const res = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('car'), publish: true, attributes: { brand: 'vw', model: 'Golf' } })
      .expect(400);
    expect(res.body.message).toBe('Das Inserat ist noch nicht vollständig.');
    expect(errorPaths(res.body)).toEqual([
      'attributes.firstRegistrationYear',
      'attributes.fuelType',
      'attributes.mileageKm',
      'attributes.transmission',
      'attributes.vehicleCondition',
    ]);
    expect(res.body.errors.find((e: { path: string }) => e.path === 'attributes.mileageKm').message).toBe('Bitte gib „Kilometerstand“ an.');
  });

  it('speichert unvollständige Entwürfe und veröffentlicht erst nach dem Ergänzen', async () => {
    const seller = await tokenFor();
    const { body: draft } = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('car'), publish: false, attributes: { brand: 'vw', mileageKm: 85_000 } })
      .expect(201);
    expect(draft).toMatchObject({ status: 'DRAFT', attributes: { brand: 'vw', mileageKm: 85_000 } });

    const incomplete = await request(server()).post(`/v1/listings/${draft.id}/publish`).set(seller.auth).expect(400);
    expect(errorPaths(incomplete.body)).toContain('attributes.model');

    // Auch Entwürfe dürfen keine ungültigen Werte enthalten
    const invalid = await request(server())
      .patch(`/v1/listings/${draft.id}`)
      .set(seller.auth)
      .send({ attributes: { ...carAttributes, mileageKm: -1 } })
      .expect(400);
    expect(invalid.body.errors).toEqual([{ path: 'attributes.mileageKm', message: 'Kilometerstand muss zwischen 0 und 2.000.000 km liegen.' }]);

    await request(server()).patch(`/v1/listings/${draft.id}`).set(seller.auth).send({ attributes: carAttributes }).expect(200);
    const published = await request(server()).post(`/v1/listings/${draft.id}/publish`).set(seller.auth).expect(200);
    expect(published.body).toMatchObject({ status: 'ACTIVE', attributes: carAttributes });
  });

  it('weist manipulierte Anfragen ab und speichert nichts', async () => {
    const seller = await tokenFor();
    const send = (body: object) => request(server()).post('/v1/listings').set(seller.auth).send({ ...base('car'), publish: false, ...body });

    const foreign = await send({ attributes: { ...carAttributes, livingAreaSqm: 80 } }).expect(400);
    expect(foreign.body.errors).toEqual([{ path: 'attributes.livingAreaSqm', message: 'Diese Angabe passt nicht zur gewählten Kategorie.' }]);

    const wrongTypes = await send({ attributes: { mileageKm: '85000', fuelType: 'kerosin', brand: ['vw'], firstRegistrationYear: 2019.5 } }).expect(400);
    expect(errorPaths(wrongTypes.body)).toEqual([
      'attributes.brand',
      'attributes.firstRegistrationYear',
      'attributes.fuelType',
      'attributes.mileageKm',
    ]);

    const condition = await send({ attributes: carAttributes, condition: 'GOOD' }).expect(400);
    expect(condition.body.errors).toEqual([{ path: 'condition', message: 'Für diese Kategorie gibt es keine Zustandsangabe.' }]);

    const nested = await send({ attributes: { brand: { $gt: '' } } }).expect(400);
    expect(nested.body.message).toBeTruthy();
    const huge = await send({ attributes: { model: 'x'.repeat(501) } }).expect(400);
    expect(huge.body.message).toBeTruthy();

    const withoutCategory = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ publish: false, title: 'Ohne Kategorie', attributes: { mileageKm: 5 } })
      .expect(400);
    expect(withoutCategory.body.errors[0].message).toBe('Für diese Kategorie gibt es keine Zusatzangaben.');

    const fixed = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('rent'), publish: false, attributes: { offerType: 'BUY' } })
      .expect(400);
    expect(fixed.body.errors[0].message).toBe('In dieser Kategorie ist „Angebotsart“ immer „Miete“.');

    expect(await prisma.listing.count()).toBe(0);
  });

  it('setzt bei Mietwohnungen die Angebotsart und kennzeichnet die Miete pro Monat', async () => {
    const seller = await tokenFor();
    const { body } = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({
        ...base('rent'),
        publish: true,
        priceCents: 95_000,
        attributes: { livingAreaSqm: 72.5, rooms: 2.5, floor: '3', operatingCosts: 180.5, features: ['elevator', 'balcony'] },
      })
      .expect(201);
    expect(body.attributes).toEqual({ offerType: 'RENT', livingAreaSqm: 72.5, rooms: 2.5, floor: '3', operatingCosts: 180.5, features: ['balcony', 'elevator'] });
    expect(body.priceSuffix).toBe('pro Monat');
    expect(body.facts).toEqual(['72,5 m²', 'Zimmer: 2,5']);

    // Grundstücke: Angebotsart ist frei wählbar, aber Pflicht
    const plot = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('plot'), publish: true, attributes: { plotAreaSqm: 800 } })
      .expect(400);
    expect(errorPaths(plot.body)).toEqual(['attributes.offerType']);
  });

  it('übernimmt beim Kategoriewechsel nur passende Angaben', async () => {
    const seller = await tokenFor();
    const { body: draft } = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('rent'), publish: false, attributes: { livingAreaSqm: 72, rooms: 3, features: ['balcony', 'pets-allowed'] } })
      .expect(201);

    // Miete → Eigentum: Fläche und Zimmer bleiben, „Haustiere erlaubt“ und die Angebotsart passen nicht mehr
    const toBuy = await request(server()).patch(`/v1/listings/${draft.id}`).set(seller.auth).send({ categoryId: categories.buy }).expect(200);
    expect(toBuy.body.attributes).toEqual({ offerType: 'BUY', livingAreaSqm: 72, rooms: 3, features: ['balcony'] });

    // → Gebrauchtwagen: keine Wohnungsangaben im Auto-Inserat
    const toCar = await request(server()).patch(`/v1/listings/${draft.id}`).set(seller.auth).send({ categoryId: categories.car }).expect(200);
    expect(toCar.body).toMatchObject({ vertical: 'VEHICLES', attributes: {} });

    // Mit neuen Angaben im selben Schritt werden genau diese gespeichert
    const withValues = await request(server())
      .patch(`/v1/listings/${draft.id}`)
      .set(seller.auth)
      .send({ categoryId: categories.bike, attributes: { bikeType: 'road' }, condition: 'GOOD' })
      .expect(200);
    expect(withValues.body).toMatchObject({ vertical: 'MARKETPLACE', attributes: { bikeType: 'road' }, condition: 'GOOD' });
  });

  it('entfernt den Artikelzustand beim Wechsel in eine Kategorie ohne Zustand', async () => {
    const seller = await tokenFor();
    const { body: draft } = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('bike'), publish: false, condition: 'GOOD', attributes: { bikeType: 'city' } })
      .expect(201);
    const moved = await request(server()).patch(`/v1/listings/${draft.id}`).set(seller.auth).send({ categoryId: categories.service }).expect(200);
    expect(moved.body).toMatchObject({ condition: null, attributes: {} });
  });

  it('hält aktive Inserate beim Bearbeiten und Kategoriewechsel vollständig', async () => {
    const seller = await tokenFor();
    const { body: listing } = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('car'), publish: true, attributes: carAttributes })
      .expect(201);

    const missing = await request(server())
      .patch(`/v1/listings/${listing.id}`)
      .set(seller.auth)
      .send({ attributes: { ...carAttributes, mileageKm: undefined } })
      .expect(400);
    expect(errorPaths(missing.body)).toEqual(['attributes.mileageKm']);

    const moved = await request(server()).patch(`/v1/listings/${listing.id}`).set(seller.auth).send({ categoryId: categories.rent }).expect(400);
    expect(errorPaths(moved.body)).toEqual(['attributes.livingAreaSqm', 'attributes.rooms']);

    const edited = await request(server())
      .patch(`/v1/listings/${listing.id}`)
      .set(seller.auth)
      .send({ title: 'VW Golf mit Service-Heft', attributes: { ...carAttributes, mileageKm: 86_000 } })
      .expect(200);
    expect(edited.body).toMatchObject({ status: 'ACTIVE', title: 'VW Golf mit Service-Heft', attributes: { mileageKm: 86_000 } });

    const stored = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(stored.attributes).toEqual({ ...carAttributes, mileageKm: 86_000 });
  });

  it('speichert bei Jobs keinen Preis und zeigt das Gehalt', async () => {
    const seller = await tokenFor();
    const attributes = {
      jobTitle: 'Bürokauffrau/-mann',
      employmentType: 'employee',
      weeklyHours: 38.5,
      workplaceType: 'hybrid',
      salaryGross: 2400,
      salaryPeriod: 'month',
      overpayment: true,
    };
    const missingSalary = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('job'), publish: true, attributes: { ...attributes, salaryGross: undefined } })
      .expect(400);
    expect(errorPaths(missingSalary.body)).toEqual(['attributes.salaryGross']);

    const { body } = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...base('job'), publish: true, priceType: 'FIXED', priceCents: 999, attributes })
      .expect(201);
    expect(body).toMatchObject({ vertical: 'JOBS', priceType: 'ON_REQUEST', priceCents: null, attributes });
    expect(body.salary.replace(/\u00a0/g, ' ')).toBe('€ 2.400 brutto/Monat');
  });

  it('zeigt Altbestand weiter an und verlangt Pflichtangaben erst beim Bearbeiten', async () => {
    const seller = await tokenFor();
    // Inserat aus Phase 1: Auto ohne Zusatzangaben, dazu ein Feld, das es nicht mehr gibt
    const { body: created } = await request(server()).post('/v1/listings').set(seller.auth).send({ ...base('car'), publish: true, attributes: carAttributes }).expect(201);
    await prisma.listing.update({ where: { id: created.id }, data: { attributes: { legacyField: 'x', mileageKm: 'viel' } } });

    const detail = await request(server()).get(`/v1/listings/${created.id}`).expect(200);
    expect(detail.body.facts).toEqual([]);
    await request(server()).post(`/v1/listings/${created.id}/pause`).set(seller.auth).expect(200);
    await request(server()).post(`/v1/listings/${created.id}/resume`).set(seller.auth).expect(200);

    const titleOnly = await request(server()).patch(`/v1/listings/${created.id}`).set(seller.auth).send({ title: 'Neuer Titel für den Golf' }).expect(400);
    expect(errorPaths(titleOnly.body)).toContain('attributes.mileageKm');

    await request(server())
      .patch(`/v1/listings/${created.id}`)
      .set(seller.auth)
      .send({ title: 'Neuer Titel für den Golf', attributes: carAttributes })
      .expect(200);
    const stored = await prisma.listing.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.attributes).toEqual(carAttributes);
  });

  it('lässt Fremde keine Zusatzangaben ändern', async () => {
    const seller = await tokenFor();
    const stranger = await tokenFor();
    const { body: listing } = await request(server()).post('/v1/listings').set(seller.auth).send({ ...base('car'), publish: true, attributes: carAttributes }).expect(201);
    await request(server())
      .patch(`/v1/listings/${listing.id}`)
      .set(stranger.auth)
      .send({ attributes: { ...carAttributes, mileageKm: 1 } })
      .expect(404);
    const stored = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(stored.attributes).toEqual(carAttributes);
  });

  it('liefert den Kategoriepfad im Kategoriebaum', async () => {
    const tree = await request(server()).get('/v1/categories').expect(200);
    const vehicles = tree.body.find((c: { path: string }) => c.path === 'auto-motor/gebrauchtwagen');
    expect(vehicles).toMatchObject({ vertical: 'VEHICLES', children: [] });
  });
});
