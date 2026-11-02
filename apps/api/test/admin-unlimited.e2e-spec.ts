import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DEAL_FEED_MAX_PER_MERCHANT, PROJECT_MAX_OPEN } from '@marktat/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { MESSAGE_LIMITS } from '../src/messages/messages.service.js';
import { createTestApp, publishDeal, publishListing, resetData, restoreBillingDefaults, signIn, signInAs } from './helpers.js';

const FEED = {
  name: 'Hauptfeed',
  url: 'https://feeds.example.at/angebote.csv',
  format: 'CSV',
  intervalHours: 6,
  licenseNote: 'Eigener Feed unseres Webshops, alle Daten von uns erstellt.',
  licenseConfirmed: true,
  referencePricesConfirmed: false,
};
const key = () => randomBytes(16).toString('hex');

describe('Administratorkonten ohne Limits', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetData(prisma);
    await restoreBillingDefaults(prisma);
  });
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const changeType = (auth: Record<string, string>, accountType: string) =>
    request(server()).patch('/v1/me/account-type').set(auth).send({ accountType });

  it('nur Administratorkonten können den Kontotyp selbst wechseln', async () => {
    const user = await signIn(app);
    await changeType(user.auth, 'BUSINESS').expect(403);
    const moderator = await signInAs(app, 'MODERATOR');
    await changeType(moderator.auth, 'BUSINESS').expect(403);

    const admin = await signInAs(app, 'ADMIN');
    await changeType(admin.auth, 'GEWERBE').expect(400);
    const res = await changeType(admin.auth, 'BUSINESS').expect(200);
    expect(res.body.accountType).toBe('BUSINESS');
    // Das Protokoll wird asynchron geschrieben
    await vi.waitFor(async () => {
      const log = await prisma.auditLog.findFirst({ where: { action: 'user.account_type_changed', actorId: admin.id } });
      expect(log?.metadata).toMatchObject({ from: 'PRIVATE', to: 'BUSINESS' });
    });

    expect((await changeType(admin.auth, 'PRIVATE').expect(200)).body.accountType).toBe('PRIVATE');
  });

  it('gewerbliches Administratorkonto veröffentlicht Deals ohne Händlerangaben und Bestätigung', async () => {
    const admin = await signInAs(app, 'ADMIN');
    // Privat gibt es keine Deals – auch nicht für Administratoren
    await expect(publishDeal(app, admin.auth)).rejects.toThrow(/Deal nicht angelegt: 403/);

    await changeType(admin.auth, 'BUSINESS').expect(200);
    const eligibility = await request(server()).get('/v1/me/dealer-eligibility').set(admin.auth).expect(200);
    expect(eligibility.body).toEqual({ business: true, missingFields: [], certified: true, blocked: false, eligible: true });

    const deal = await publishDeal(app, admin.auth);
    expect(deal.status).toBe('ACTIVE');
    const page = await request(server()).get(`/v1/deals/${deal.id}`).expect(200);
    expect(page.body.id).toBe(deal.id);

    // Ein normales gewerbliches Konto braucht weiterhin alle Angaben
    const shop = await signIn(app, { metadata: { display_name: 'Shop', account_type: 'BUSINESS', company_name: 'Shop GmbH' } });
    const shopEligibility = await request(server()).get('/v1/me/dealer-eligibility').set(shop.auth).expect(200);
    expect(shopEligibility.body).toMatchObject({ eligible: false, certified: false, missingFields: ['Geschäftsadresse', 'Telefonnummer'] });
  });

  it('Anbieterprofil: gewerbliches Administratorkonto braucht keine Firmenangaben', async () => {
    const admin = await signInAs(app, 'ADMIN');
    await changeType(admin.auth, 'BUSINESS').expect(200);
    const me = await request(server()).get('/v1/me/service-profile').set(admin.auth).expect(200);
    expect(me.body.missingAccountFields).toEqual([]);

    const shop = await signIn(app, { metadata: { display_name: 'Shop', account_type: 'BUSINESS' } });
    const shopMe = await request(server()).get('/v1/me/service-profile').set(shop.auth).expect(200);
    expect(shopMe.body.missingAccountFields).toEqual(['Firmenname', 'Firmenanschrift']);
  });

  it('keine Höchstzahl an Produktfeeds', async () => {
    const admin = await signInAs(app, 'ADMIN');
    await changeType(admin.auth, 'BUSINESS').expect(200);
    for (let i = 0; i <= DEAL_FEED_MAX_PER_MERCHANT; i++) {
      await request(server()).post('/v1/me/deal-feeds').set(admin.auth).send({ ...FEED, name: `Feed ${i}`, url: `https://feeds.example.at/${i}.csv` }).expect(201);
    }
  });

  it('keine Spam-Bremse bei Nachrichten', async () => {
    const seller = await signIn(app);
    const admin = await signInAs(app, 'ADMIN');
    const listing = await publishListing(app, seller.auth);
    const first = await request(server()).post(`/v1/listings/${listing.id}/conversations`).set(admin.auth).send({ body: 'Nachricht 1' }).expect(201);
    for (let i = 2; i <= MESSAGE_LIMITS.perMinute + 2; i++) {
      await request(server()).post(`/v1/conversations/${first.body.conversationId}/messages`).set(admin.auth).send({ body: `Nachricht ${i}` }).expect(201);
    }
  });

  it('keine Höchstzahl bei Top-Anzeigen und kein Mindestabstand beim Hochschieben', async () => {
    const admin = await signInAs(app, 'ADMIN');
    const listings = [];
    for (let i = 0; i < 3; i++) listings.push(await publishListing(app, admin.auth, { title: `Mountainbike Nummer ${i + 1}` }));
    for (const listing of listings) {
      await request(server()).post(`/v1/listings/${listing.id}/bookings`).set(admin.auth).send({ product: 'top', idempotencyKey: key() }).expect(201);
    }
    await request(server()).post(`/v1/listings/${listings[0]!.id}/bookings`).set(admin.auth).send({ product: 'bump', idempotencyKey: key() }).expect(201);

    // Gleiches Szenario für ein normales Konto: die dritte Top-Anzeige ist zu viel
    const seller = await signIn(app);
    const own = [];
    for (let i = 0; i < 3; i++) own.push(await publishListing(app, seller.auth, { title: `Citybike Nummer ${i + 1}` }));
    await request(server()).post(`/v1/listings/${own[0]!.id}/bookings`).set(seller.auth).send({ product: 'top', idempotencyKey: key() }).expect(201);
    await request(server()).post(`/v1/listings/${own[1]!.id}/bookings`).set(seller.auth).send({ product: 'top', idempotencyKey: key() }).expect(201);
    await request(server()).post(`/v1/listings/${own[2]!.id}/bookings`).set(seller.auth).send({ product: 'top', idempotencyKey: key() }).expect(409);
  });

  it('keine Rate-Limits je Konto', async () => {
    const admin = await signInAs(app, 'ADMIN');
    // Inserate anlegen: 20 je Minute für normale Konten
    for (let i = 0; i < 25; i++) {
      await request(server())
        .post('/v1/listings')
        .set(admin.auth)
        .send({ title: `Sofa Nummer ${i}`, publish: false })
        .expect((res) => {
          if (res.status === 429) throw new Error(`Rate-Limit nach ${i} Anfragen`);
        });
    }
  });

  it(`keine Höchstzahl offener Projektaufträge (normal ${PROJECT_MAX_OPEN})`, async () => {
    const admin = await signInAs(app, 'ADMIN');
    const res = await request(server()).get('/v1/me/projects').set(admin.auth).expect(200);
    expect(res.body.maxOpen).toBeNull();
    const user = await signIn(app);
    expect((await request(server()).get('/v1/me/projects').set(user.auth).expect(200)).body.maxOpen).toBe(PROJECT_MAX_OPEN);
  });
});
