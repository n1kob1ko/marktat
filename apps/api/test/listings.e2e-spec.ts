import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, resetData, tokenFor } from './helpers.js';

describe('Inserate', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let leafCategoryId: string;
  let parentCategoryId: string;
  let locationId: number;

  const complete = () => ({
    publish: true,
    title: 'Rennrad Carbon 56 cm',
    description: 'Sehr leichtes Rennrad, Shimano 105, regelmäßig gewartet.',
    categoryId: leafCategoryId,
    priceType: 'NEGOTIABLE',
    priceCents: 89_000,
    condition: 'GOOD',
    locationId,
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    const leaf = await prisma.category.findUniqueOrThrow({ where: { path: 'marktplatz/sport-freizeit/fahrraeder' } });
    leafCategoryId = leaf.id;
    parentCategoryId = leaf.parentId!;
    locationId = (await prisma.location.findFirstOrThrow({ where: { postalCode: '8010' } })).id;
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  it('verlangt eine Anmeldung zum Anlegen', async () => {
    await request(server()).post('/v1/listings').send(complete()).expect(401);
  });

  it('veröffentlicht ein vollständiges Inserat mit Ablaufdatum', async () => {
    const seller = await tokenFor();
    const res = await request(server()).post('/v1/listings').set(seller.auth).send(complete()).expect(201);
    expect(res.body).toMatchObject({
      status: 'ACTIVE',
      title: 'Rennrad Carbon 56 cm',
      slug: 'rennrad-carbon-56-cm',
      priceCents: 89_000,
      isOwner: true,
      location: { postalCode: '8010', place: 'Graz', state: 'Steiermark' },
    });
    const days = (Date.parse(res.body.expiresAt) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(60);

    const list = await request(server()).get('/v1/listings').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(res.body.id);
  });

  it('meldet Feldfehler auf Deutsch', async () => {
    const seller = await tokenFor();
    const res = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...complete(), title: 'Rad', priceCents: undefined })
      .expect(400);
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toContain('title');
    expect(paths).toContain('priceCents');
  });

  it('verlangt beim Veröffentlichen eine Unterkategorie', async () => {
    const seller = await tokenFor();
    const res = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ ...complete(), categoryId: parentCategoryId })
      .expect(400);
    expect(res.body.message).toBe('Bitte wähle eine Unterkategorie.');
  });

  it('speichert Entwürfe, die nur der Eigentümer sieht', async () => {
    const seller = await tokenFor();
    const stranger = await tokenFor();
    const draft = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ publish: false, title: 'Sofa' })
      .expect(201);
    expect(draft.body.status).toBe('DRAFT');

    await request(server()).get(`/v1/listings/${draft.body.id}`).expect(404);
    await request(server()).get(`/v1/listings/${draft.body.id}`).set(stranger.auth).expect(404);
    await request(server()).get(`/v1/listings/${draft.body.id}`).set(seller.auth).expect(200);
    const list = await request(server()).get('/v1/listings').expect(200);
    expect(list.body.total).toBe(0);
    const mine = await request(server()).get('/v1/listings/mine').set(seller.auth).expect(200);
    expect(mine.body).toHaveLength(1);
  });

  it('veröffentlicht einen Entwurf erst, wenn er vollständig ist', async () => {
    const seller = await tokenFor();
    const { body: draft } = await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({ publish: false, title: 'Rennrad Carbon 56 cm', categoryId: leafCategoryId })
      .expect(201);
    const incomplete = await request(server()).post(`/v1/listings/${draft.id}/publish`).set(seller.auth).expect(400);
    expect(incomplete.body.message).toBe('Das Inserat ist noch nicht vollständig.');

    const { publish: _publish, ...fields } = complete();
    await request(server()).patch(`/v1/listings/${draft.id}`).set(seller.auth).send(fields).expect(200);
    const published = await request(server()).post(`/v1/listings/${draft.id}/publish`).set(seller.auth).expect(200);
    expect(published.body.status).toBe('ACTIVE');
  });

  it('verhindert, dass Fremde Inserate bearbeiten, pausieren oder löschen', async () => {
    const seller = await tokenFor();
    const stranger = await tokenFor();
    const { body: listing } = await request(server()).post('/v1/listings').set(seller.auth).send(complete()).expect(201);

    await request(server()).patch(`/v1/listings/${listing.id}`).set(stranger.auth).send({ title: 'Gekapert!' }).expect(404);
    await request(server()).post(`/v1/listings/${listing.id}/pause`).set(stranger.auth).expect(404);
    await request(server()).delete(`/v1/listings/${listing.id}`).set(stranger.auth).expect(404);

    const unchanged = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(unchanged.title).toBe('Rennrad Carbon 56 cm');
    expect(unchanged.status).toBe('ACTIVE');
  });

  it('pausiert, setzt fort und löscht ein Inserat', async () => {
    const seller = await tokenFor();
    const { body: listing } = await request(server()).post('/v1/listings').set(seller.auth).send(complete()).expect(201);

    const paused = await request(server()).post(`/v1/listings/${listing.id}/pause`).set(seller.auth).expect(200);
    expect(paused.body.status).toBe('PAUSED');
    await request(server()).get(`/v1/listings/${listing.id}`).expect(404);

    const resumed = await request(server()).post(`/v1/listings/${listing.id}/resume`).set(seller.auth).expect(200);
    expect(resumed.body.status).toBe('ACTIVE');

    await request(server()).delete(`/v1/listings/${listing.id}`).set(seller.auth).expect(204);
    await request(server()).get(`/v1/listings/${listing.id}`).set(seller.auth).expect(404);
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.status).toBe('DELETED');
    expect(row.deletedAt).not.toBeNull();
  });

  it('blendet abgelaufene Inserate aus und erlaubt Verlängerung', async () => {
    const seller = await tokenFor();
    const { body: listing } = await request(server()).post('/v1/listings').set(seller.auth).send(complete()).expect(201);
    await prisma.listing.update({ where: { id: listing.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await request(server()).get('/v1/listings').expect(200)).body.total).toBe(0);
    const mine = await request(server()).get('/v1/listings/mine').set(seller.auth).expect(200);
    expect(mine.body[0].status).toBe('EXPIRED');

    const renewed = await request(server()).post(`/v1/listings/${listing.id}/publish`).set(seller.auth).expect(200);
    expect(renewed.body.status).toBe('ACTIVE');
    expect(Date.parse(renewed.body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('filtert nach Suchbegriff, Kategorie und Bundesland', async () => {
    const seller = await tokenFor();
    await request(server()).post('/v1/listings').set(seller.auth).send(complete()).expect(201);
    const vienna = (await prisma.location.findFirstOrThrow({ where: { postalCode: '1010' } })).id;
    await request(server())
      .post('/v1/listings')
      .set(seller.auth)
      .send({
        ...complete(),
        title: 'Stadtrad mit Korb',
        description: 'Bequemes Hollandrad mit Korb und Nabendynamo.',
        locationId: vienna,
      })
      .expect(201);

    const byText = await request(server()).get('/v1/listings').query({ q: 'rennrad' }).expect(200);
    expect(byText.body.total).toBe(1);
    const byParent = await request(server()).get('/v1/listings').query({ categoryId: parentCategoryId }).expect(200);
    expect(byParent.body.total).toBe(2);
    const byState = await request(server()).get('/v1/listings').query({ state: 'wien' }).expect(200);
    expect(byState.body.items.map((i: { title: string }) => i.title)).toEqual(['Stadtrad mit Korb']);
  });

  it('sucht Orte über PLZ und Namen', async () => {
    const byCode = await request(server()).get('/v1/geo/locations').query({ q: '6020' }).expect(200);
    expect(byCode.body[0]).toMatchObject({ place: 'Innsbruck', state: 'Tirol' });
    const byName = await request(server()).get('/v1/geo/locations').query({ q: 'klagen' }).expect(200);
    expect(byName.body[0]).toMatchObject({ postalCode: '9020' });
  });
});
