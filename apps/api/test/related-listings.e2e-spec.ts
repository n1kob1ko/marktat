import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, publishListing, resetData, signIn } from './helpers.js';

describe('Anzeigenseite: ähnliche Inserate, mehr vom Anbieter, Kartenpunkt', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const place = (postalCode: string, name: string) =>
    prisma.location
      .findFirstOrThrow({ where: { postalCode, place: name } })
      .then((location) => location.id);
  const category = (path: string) =>
    prisma.category.findUniqueOrThrow({ where: { path } }).then((row) => row.id);

  it('liefert ähnliche Inserate nach Entfernung, weitere vom Anbieter und den Ortsmittelpunkt', async () => {
    const [anna, bernd, carla, dora] = await Promise.all([
      signIn(app),
      signIn(app),
      signIn(app),
      signIn(app),
    ]);
    const [wien, albersdorf, zubehoer] = await Promise.all([
      place('1010', 'Wien'),
      place('8200', 'Albersdorf'),
      category('marktplatz/sport-sportgeraete/fahrradzubehoer-teile'),
    ]);

    // Anna: das angesehene Rad in Graz, ein zweites Rad, ein pausiertes Inserat
    const main = await publishListing(app, anna.auth, { title: 'Rennrad Carbon 56 cm' });
    const second = await publishListing(app, anna.auth, { title: 'Kinderrad 20 Zoll' });
    const paused = await publishListing(app, anna.auth, { title: 'Trekkingrad alt' });
    await request(server()).post(`/v1/listings/${paused.id}/pause`).set(anna.auth).expect(200);

    // Andere Anbieter: Wien (weit), Albersdorf (nah), Zubehör (übergeordnete Kategorie)
    const far = await publishListing(app, bernd.auth, { title: 'Stadtrad Wien', locationId: wien });
    const near = await publishListing(app, carla.auth, {
      title: 'Gravelbike Albersdorf',
      locationId: albersdorf,
    });
    const parts = await publishListing(app, dora.auth, {
      title: 'Fahrradhelm Größe M',
      categoryId: zubehoer,
      condition: 'LIKE_NEW',
    });

    const detail = await request(server()).get(`/v1/listings/${main.id}`).expect(200);
    expect(detail.body.mapPoint).toEqual({
      latitude: expect.closeTo(47.07, 1),
      longitude: expect.closeTo(15.44, 1),
    });

    const res = await request(server()).get(`/v1/listings/${main.id}/related`).expect(200);
    // Gleiche Kategorie zuerst, nächstgelegene vorne; zu wenige → auch aus „Sport/Sportgeräte“
    expect(res.body.similar.map((item: { id: string }) => item.id)).toEqual([
      near.id,
      far.id,
      parts.id,
    ]);
    const [nearItem, farItem] = res.body.similar;
    expect(nearItem.distanceKm).toBeGreaterThan(5);
    expect(nearItem.distanceKm).toBeLessThan(40);
    expect(farItem.distanceKm).toBeGreaterThan(100);
    // Annas eigene Inserate tauchen nicht unter „ähnlich“ auf, das pausierte nirgends
    expect(res.body.fromSeller.map((item: { id: string }) => item.id)).toEqual([second.id]);
    expect(res.body.sellerTotal).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain(paused.id);
  });

  it('liefert zu nicht öffentlichen oder unbekannten Inseraten leere Listen', async () => {
    const anna = await signIn(app);
    const listing = await publishListing(app, anna.auth);
    await publishListing(app, anna.auth, { title: 'Zweites Rad' });
    await request(server()).post(`/v1/listings/${listing.id}/pause`).set(anna.auth).expect(200);

    const empty = { similar: [], fromSeller: [], sellerTotal: 0 };
    await request(server()).get(`/v1/listings/${listing.id}/related`).expect(200, empty);
    await request(server()).get('/v1/listings/gibtesnicht0000000000000/related').expect(200, empty);
  });
});
