import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, publishListing, resetData, signIn } from './helpers.js';

describe('Merkliste', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  it('verlangt eine Anmeldung', async () => {
    await request(server()).get('/v1/me/favorites').expect(401);
    await request(server()).put('/v1/me/favorites/abcdefghijklmnopqrstuvwxy').expect(401);
  });

  it('merkt und entfernt Inserate, idempotent und ohne Duplikate', async () => {
    const seller = await signIn(app);
    const buyer = await signIn(app);
    const listing = await publishListing(app, seller.auth);

    await request(server()).put(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(204);
    await request(server()).put(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(204);
    // Gleichzeitige Klicks
    await Promise.all([1, 2, 3].map(() => request(server()).put(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(204)));
    expect(await prisma.favorite.count({ where: { userId: buyer.id } })).toBe(1);

    const list = await request(server()).get('/v1/me/favorites').set(buyer.auth).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ available: true, listing: { id: listing.id, title: listing.title } });

    const detail = await request(server()).get(`/v1/listings/${listing.id}`).set(buyer.auth).expect(200);
    expect(detail.body.isFavorite).toBe(true);
    const lookup = await request(server()).get(`/v1/me/favorites/ids?listingIds=${listing.id},kaputt`).set(buyer.auth).expect(200);
    expect(lookup.body).toEqual({ listingIds: [listing.id], ownListingIds: [] });
    const ownLookup = await request(server()).get(`/v1/me/favorites/ids?listingIds=${listing.id}`).set(seller.auth).expect(200);
    expect(ownLookup.body).toEqual({ listingIds: [], ownListingIds: [listing.id] });

    await request(server()).delete(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(204);
    await request(server()).delete(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(204);
    const after = await request(server()).get(`/v1/listings/${listing.id}`).set(buyer.auth).expect(200);
    expect(after.body.isFavorite).toBe(false);
  });

  it('bleibt über Anmeldungen hinweg erhalten und ist pro Konto getrennt', async () => {
    const seller = await signIn(app);
    const buyer = await signIn(app);
    const other = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    await request(server()).put(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(204);

    // Neues Token für dasselbe Konto = neue Sitzung
    const again = await signIn(app, { id: buyer.id, email: buyer.email });
    const list = await request(server()).get('/v1/me/favorites').set(again.auth).expect(200);
    expect(list.body.items.map((i: { listing: { id: string } }) => i.listing.id)).toEqual([listing.id]);

    const foreign = await request(server()).get('/v1/me/favorites').set(other.auth).expect(200);
    expect(foreign.body.total).toBe(0);
    // Fremdes Entfernen wirkt nur auf die eigene Liste
    await request(server()).delete(`/v1/me/favorites/${listing.id}`).set(other.auth).expect(204);
    expect(await prisma.favorite.count({ where: { userId: buyer.id } })).toBe(1);
  });

  it('lehnt eigene, nicht vorhandene und manipulierte IDs ab', async () => {
    const seller = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    await request(server()).put(`/v1/me/favorites/${listing.id}`).set(seller.auth).expect(400);
    await request(server()).put('/v1/me/favorites/abcdefghijklmnopqrstuvwxy').set(seller.auth).expect(404);
    await request(server()).put(`/v1/me/favorites/${encodeURIComponent("' OR 1=1 --")}`).set(seller.auth).expect(404);
  });

  it('zeigt nicht mehr verfügbare Inserate ohne Bild und lässt sie nicht neu merken', async () => {
    const seller = await signIn(app);
    const buyer = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    await request(server()).put(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(204);
    await request(server()).post(`/v1/listings/${listing.id}/pause`).set(seller.auth).expect(200);

    const list = await request(server()).get('/v1/me/favorites').set(buyer.auth).expect(200);
    expect(list.body.items[0]).toMatchObject({ available: false, listing: { id: listing.id, imageUrl: null } });

    await request(server()).delete(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(204);
    await request(server()).put(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(404);
  });

  it('entfernt Merklisten-Einträge mit dem Konto', async () => {
    const seller = await signIn(app);
    const buyer = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    await request(server()).put(`/v1/me/favorites/${listing.id}`).set(buyer.auth).expect(204);
    await prisma.user.delete({ where: { id: buyer.id } });
    expect(await prisma.favorite.count()).toBe(0);
  });
});
