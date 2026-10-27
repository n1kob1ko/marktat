import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, publishListing, resetData, signIn } from './helpers.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const FAKE_ID = 'abcdefghijklmnopqrstuvwxy';

/** Alle registrierten Routen aus dem Express-Router (so fällt eine neue, ungeschützte Admin-Route sofort auf) */
function routes(app: NestExpressApplication): { method: Method; path: string }[] {
  const router = app.getHttpAdapter().getInstance().router as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  return router.stack.flatMap((layer) =>
    layer.route ? Object.keys(layer.route.methods).map((method) => ({ method: method as Method, path: layer.route!.path })) : [],
  );
}

/**
 * Berechtigungen: Admin-Routen nur für das Team, fremde Daten (IDOR) nie lesbar oder änderbar.
 * Ergänzt die fachlichen Tests der einzelnen Module um eine vollständige Liste aus Sicht eines normalen Kontos.
 */
describe('Berechtigungen', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const call = (method: Method, path: string, auth?: Record<string, string>) => {
    const req = request(server())[method](path);
    if (auth) req.set(auth);
    return method === 'get' || method === 'delete' ? req : req.send({});
  };

  it('sperrt jede Admin-Route für Gäste (401) und normale Konten (403)', async () => {
    const admin = routes(app).filter((r) => r.path.startsWith('/v1/admin'));
    expect(admin.length).toBeGreaterThanOrEqual(28);
    const user = await signIn(app);
    const open: string[] = [];
    for (const { method, path } of admin) {
      const url = path.replace(/:\w+/g, FAKE_ID);
      const guest = await call(method, url);
      const plain = await call(method, url, user.auth);
      if (guest.status !== 401 || plain.status !== 403) open.push(`${method.toUpperCase()} ${path}: Gast ${guest.status}, Konto ${plain.status}`);
    }
    expect(open).toEqual([]);
  });

  it('verlangt für alle persönlichen Routen eine Anmeldung', async () => {
    const own = routes(app).filter((r) => r.path.startsWith('/v1/me') || r.path.startsWith('/v1/conversations') || r.path.startsWith('/v1/bookings'));
    expect(own.length).toBeGreaterThan(20);
    const open: string[] = [];
    for (const { method, path } of own) {
      const res = await call(method, path.replace(/:\w+/g, FAKE_ID));
      if (res.status !== 401) open.push(`${method.toUpperCase()} ${path}: ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it('gibt fremde Inserate, Entwürfe, Bilder, Statistiken und Buchungen nicht heraus', async () => {
    const owner = await signIn(app);
    const other = await signIn(app);
    const listing = await publishListing(app, owner.auth);
    const draft = await publishListing(app, owner.auth, { publish: false, title: 'Geheimer Entwurf' });
    const booking = await request(server())
      .post(`/v1/listings/${listing.id}/bookings`)
      .set(owner.auth)
      .send({ product: 'highlight', idempotencyKey: crypto.randomUUID() })
      .expect(201);
    const bookingsBefore = await prisma.booking.count();

    const attempts: [Method, string, Record<string, unknown>?][] = [
      ['get', `/v1/listings/${draft.id}`],
      ['get', `/v1/listings/${draft.id}/images`],
      ['patch', `/v1/listings/${listing.id}`, { title: 'Übernommen' }],
      ['post', `/v1/listings/${draft.id}/publish`],
      ['post', `/v1/listings/${listing.id}/pause`],
      ['post', `/v1/listings/${listing.id}/resume`],
      ['post', `/v1/listings/${listing.id}/resubmit`],
      ['delete', `/v1/listings/${listing.id}`],
      ['post', `/v1/listings/${listing.id}/images/uploads`, { contentType: 'image/jpeg', size: 1000 }],
      ['put', `/v1/listings/${listing.id}/images/order`, { imageIds: [FAKE_ID] }],
      ['post', `/v1/listings/${listing.id}/images/${FAKE_ID}/main`],
      ['delete', `/v1/listings/${listing.id}/images/${FAKE_ID}`],
      ['get', `/v1/listings/${listing.id}/stats`],
      ['get', `/v1/listings/${listing.id}/promotions`],
      ['post', `/v1/listings/${listing.id}/bookings`, { product: 'top', idempotencyKey: crypto.randomUUID() }],
      ['post', `/v1/bookings/${booking.body.booking.id}/confirm`],
      ['post', `/v1/bookings/${booking.body.booking.id}/cancel`],
    ];
    const leaks: string[] = [];
    for (const [method, path, body] of attempts) {
      const req = request(server())[method](path).set(other.auth);
      const res = await (body ? req.send(body) : req);
      if (![403, 404].includes(res.status)) leaks.push(`${method.toUpperCase()} ${path}: ${res.status}`);
    }
    expect(leaks).toEqual([]);

    // Nichts verändert
    const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after).toMatchObject({ title: listing.title, status: 'ACTIVE', deletedAt: null });
    expect(await prisma.booking.count()).toBe(bookingsBefore);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.body.booking.id } })).toMatchObject({ status: booking.body.booking.status });
  });

  it('gibt fremde Unterhaltungen, Suchaufträge, Entscheidungen und Kontodaten nicht heraus', async () => {
    const seller = await signIn(app);
    const buyer = await signIn(app);
    const stranger = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    const conversation = await request(server())
      .post(`/v1/listings/${listing.id}/conversations`)
      .set(buyer.auth)
      .send({ body: 'Hallo, ist das Rad noch zu haben?' })
      .expect(201);
    const conversationId = conversation.body.conversationId as string;
    const search = await request(server())
      .post('/v1/me/searches')
      .set(buyer.auth)
      .send({ name: 'Räder', params: { q: 'Rad' }, labels: ['„Rad“'] })
      .expect(201);
    const decision = await prisma.moderationDecision.create({
      data: { userId: seller.id, listingId: listing.id, action: 'LISTING_REJECTED', statement: 'Test' },
    });

    const attempts: [Method, string, Record<string, unknown>?][] = [
      ['get', `/v1/conversations/${conversationId}`],
      ['get', `/v1/conversations/${conversationId}/messages`],
      ['post', `/v1/conversations/${conversationId}/messages`, { body: 'Eingeschleust' }],
      ['post', `/v1/conversations/${conversationId}/read`],
      ['post', `/v1/conversations/${conversationId}/report`, { reason: 'SPAM', details: 'Test', goodFaith: true }],
      ['patch', `/v1/me/searches/${search.body.id}`, { name: 'Übernommen' }],
      ['get', `/v1/me/decisions/${decision.id}`],
      ['post', `/v1/me/decisions/${decision.id}/appeal`, { body: 'Einspruch einer fremden Person mit genug Text' }],
    ];
    const leaks: string[] = [];
    for (const [method, path, body] of attempts) {
      const req = request(server())[method](path).set(stranger.auth);
      const res = await (body ? req.send(body) : req);
      if (![403, 404].includes(res.status)) leaks.push(`${method.toUpperCase()} ${path}: ${res.status}`);
    }
    expect(leaks).toEqual([]);
    // Löschen ist idempotent (204 auch ohne Treffer) – entscheidend ist, dass die fremde Suche bleibt (unten geprüft)
    await request(server()).delete(`/v1/me/searches/${search.body.id}`).set(stranger.auth).expect(204);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(1);
    expect(await prisma.savedSearch.findUnique({ where: { id: search.body.id } })).toMatchObject({ name: 'Räder' });

    // Eigene Listen der fremden Person bleiben leer
    for (const path of ['/v1/conversations', '/v1/me/searches', '/v1/me/favorites', '/v1/me/notifications', '/v1/me/decisions', '/v1/listings/mine']) {
      const res = await request(server()).get(path).set(stranger.auth).expect(200);
      const items = Array.isArray(res.body) ? res.body : res.body.items;
      expect({ path, items }).toEqual({ path, items: [] });
    }
    // Datenexport enthält nur eigene Daten
    const exported = await request(server()).get('/v1/me/export').set(stranger.auth).expect(200);
    const text = JSON.stringify(exported.body);
    expect(text).not.toContain(seller.email);
    expect(text).not.toContain(buyer.email);
    expect(text).not.toContain('ist das Rad noch zu haben');
  });

  it('zeigt im öffentlichen Profil keine E-Mail-Adresse oder Kontodetails', async () => {
    const seller = await signIn(app);
    await publishListing(app, seller.auth);
    const res = await request(server()).get(`/v1/users/${seller.id}`).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(seller.email);
    expect(res.body).not.toHaveProperty('role');
    expect(res.body).not.toHaveProperty('notifyMessages');
  });
});
