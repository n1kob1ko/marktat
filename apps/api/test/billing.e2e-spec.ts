import { randomBytes, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { BookingsService } from '../src/billing/bookings.service.js';
import { createTestApp, flushSearch, publishListing, resetData, signIn, signInAs } from './helpers.js';

type Account = Awaited<ReturnType<typeof signIn>>;

const key = () => randomBytes(16).toString('hex');
const DAY_MS = 86_400_000;

/** Kostenloser Plattformbetrieb (Standard): Preise, Zusatzleistungen, Limits, Ablauf, Admin, Suche, Statistik. */
describe('Monetarisierung im kostenlosen Betrieb', () => {
  let app: NestExpressApplication;
  let fallback: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    // Port 9 (discard) – hier läuft kein Meilisearch: Ausweichbetrieb über PostgreSQL
    ({ app: fallback } = await createTestApp({ meiliUrl: 'http://127.0.0.1:9' }));
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => Promise.all([app.close(), fallback.close()]));

  const server = () => app.getHttpServer();
  const book = (account: Account, listingId: string, product: string, idempotencyKey = key()) =>
    request(server()).post(`/v1/listings/${listingId}/bookings`).set(account.auth).send({ product, idempotencyKey });

  /** Veröffentlichungsdatum zurücksetzen (z. B. damit Hochschieben schon erlaubt ist) */
  const age = (listingId: string, days: number) =>
    prisma.$executeRaw`UPDATE listings SET published_at = now() - make_interval(days => ${days}) WHERE id = ${listingId}`;

  it('startet kostenlos: alle Leistungen 0,00 €, Einführungsaktion ohne Befristung, keine Zahlung nötig', async () => {
    const res = await request(server()).get('/v1/billing').expect(200);
    expect(res.body.mode).toBe('FREE');
    expect(res.body.intro).toMatchObject({ title: 'Jetzt kostenlos inserieren', endsAt: null, plannedPriceCents: null });
    expect(res.body.products.map((p: { code: string }) => p.code)).toEqual(['listing', 'highlight', 'top', 'bump']);
    for (const product of res.body.products) expect(product).toMatchObject({ priceCents: 0, requiresPayment: false });
  });

  it('hält beim Veröffentlichen eine kostenlose Buchung mit Preis-Schnappschuss fest', async () => {
    const seller = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    const me = await request(server()).get('/v1/me/billing').set(seller.auth).expect(200);
    expect(me.body.mode).toBe('FREE');
    expect(me.body.history.items).toHaveLength(1);
    expect(me.body.history.items[0]).toMatchObject({ product: { code: 'listing' }, status: 'ACTIVE', priceCents: 0, billingMode: 'FREE', listing: { id: listing.id } });
    const stored = await prisma.booking.findFirstOrThrow({ where: { listingId: listing.id } });
    expect(stored.snapshot).toMatchObject({ code: 'listing', chargedCents: 0, durationDays: 60 });
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.expiresAt!.getTime() - row.publishedAt!.getTime()).toBe(60 * DAY_MS);
  });

  it('hebt kostenlos hervor – ohne Stripe, mit Laufzeit, idempotent und ohne Doppelbuchung', async () => {
    const seller = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    const idempotencyKey = key();
    const first = await book(seller, listing.id, 'highlight', idempotencyKey).expect(201);
    expect(first.body.checkoutUrl).toBeNull();
    expect(first.body.booking).toMatchObject({ status: 'ACTIVE', priceCents: 0, product: { code: 'highlight' } });
    const days = (new Date(first.body.booking.endsAt).getTime() - new Date(first.body.booking.startsAt).getTime()) / DAY_MS;
    expect(days).toBe(7);

    // Doppelt abgeschickt: gleiche Buchung
    const replay = await book(seller, listing.id, 'highlight', idempotencyKey).expect(201);
    expect(replay.body.booking.id).toBe(first.body.booking.id);
    // Neu gebucht, solange sie läuft: abgelehnt
    const again = await book(seller, listing.id, 'highlight').expect(409);
    expect(again.body.message).toContain('Läuft bereits bis');
    expect(await prisma.booking.count({ where: { kind: 'HIGHLIGHT' } })).toBe(1);

    const detail = await request(server()).get(`/v1/listings/${listing.id}`).expect(200);
    expect(detail.body).toMatchObject({ highlighted: true, top: false, sponsored: false, title: 'Rennrad Carbon 56 cm' });
    const mine = await request(server()).get('/v1/listings/mine').set(seller.auth).expect(200);
    expect(mine.body[0].promotionsUntil.highlighted).toBe(first.body.booking.endsAt);
  });

  it('nimmt keinen Preis vom Client an und lässt fremde, inaktive oder gesperrte Buchungen nicht zu', async () => {
    const seller = await signIn(app);
    const other = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    await request(server()).post(`/v1/listings/${listing.id}/bookings`).set(seller.auth).send({ product: 'top', idempotencyKey: key(), priceCents: 0 }).expect(400);
    await request(server()).post(`/v1/listings/${listing.id}/bookings`).set(seller.auth).send({ product: 'gold', idempotencyKey: key() }).expect(400);
    await book(other, listing.id, 'top').expect(404);
    await request(server()).post(`/v1/listings/${listing.id}/bookings`).send({ product: 'top', idempotencyKey: key() }).expect(401);

    await request(server()).post(`/v1/listings/${listing.id}/pause`).set(seller.auth).expect(200);
    expect((await book(seller, listing.id, 'top').expect(409)).body.message).toBe('Nur für aktive Inserate möglich.');
    await request(server()).post(`/v1/listings/${listing.id}/resume`).set(seller.auth).expect(200);

    await prisma.user.update({ where: { id: seller.id }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
    await book(seller, listing.id, 'top').expect(403);
    // Inserat selbst wird nicht über Buchungen veröffentlicht, solange es kostenlos ist
    await prisma.user.update({ where: { id: seller.id }, data: { status: 'ACTIVE', suspendedAt: null } });
    await book(seller, listing.id, 'listing').expect(400);
    expect(await prisma.booking.count({ where: { kind: { not: 'LISTING' } } })).toBe(0);
  });

  it('begrenzt gleichzeitige Top-Anzeigen je Konto und insgesamt', async () => {
    const seller = await signIn(app);
    const listings = [];
    for (let i = 0; i < 3; i++) listings.push(await publishListing(app, seller.auth, { title: `Mountainbike Nummer ${i + 1}` }));
    await book(seller, listings[0]!.id, 'top').expect(201);
    await book(seller, listings[1]!.id, 'top').expect(201);
    const third = await book(seller, listings[2]!.id, 'top').expect(409);
    expect(third.body.message).toContain('höchstens 2 gleichzeitig');

    await prisma.product.update({ where: { code: 'top' }, data: { maxActivePerUser: null, maxActiveTotal: 2 } });
    expect((await book(seller, listings[2]!.id, 'top').expect(409)).body.message).toContain('Alle Plätze');
    const options = await request(server()).get(`/v1/listings/${listings[2]!.id}/promotions`).set(seller.auth).expect(200);
    const top = options.body.find((o: { code: string }) => o.code === 'top');
    expect(top).toMatchObject({ available: false, priceCents: 0, requiresPayment: false });
  });

  it('begrenzt Buchungen je Zeitraum und je Stunde', async () => {
    const seller = await signIn(app);
    const a = await publishListing(app, seller.auth, { title: 'Kinderrad Puky 16 Zoll' });
    await prisma.product.update({ where: { code: 'highlight' }, data: { maxPerPeriod: 1, periodDays: 30 } });
    await book(seller, a.id, 'highlight').expect(201);
    await prisma.$executeRaw`UPDATE listings SET highlighted_until = NULL WHERE id = ${a.id}`;
    await prisma.booking.updateMany({ where: { listingId: a.id, kind: 'HIGHLIGHT' }, data: { status: 'EXPIRED', endsAt: new Date() } });
    const limited = await book(seller, a.id, 'highlight').expect(409);
    expect(limited.body.message).toMatch(/Limit erreicht: höchstens 1-mal in 30 Tagen – wieder möglich ab/);

    await prisma.product.update({ where: { code: 'highlight' }, data: { maxPerPeriod: null } });
    await prisma.platformSettings.update({ where: { id: 1 }, data: { maxBookingsPerHour: 1 } });
    await book(seller, a.id, 'highlight').expect(429);
  });

  it('schiebt hoch: eigener Zeitstempel, Veröffentlichungsdatum bleibt, Mindestabstand, richtige Sortierung', async () => {
    const seller = await signIn(app);
    const older = await publishListing(app, seller.auth, { title: 'Trekkingrad älter' });
    const newer = await publishListing(app, seller.auth, { title: 'Trekkingrad neuer' });
    await age(older.id, 3);
    await age(newer.id, 1);

    // Frisch veröffentlicht: noch nicht erlaubt
    const fresh = await publishListing(app, seller.auth, { title: 'Trekkingrad ganz neu' });
    expect((await book(seller, fresh.id, 'bump').expect(409)).body.message).toMatch(/^Wieder möglich ab/);

    const before = await prisma.listing.findUniqueOrThrow({ where: { id: older.id } });
    const bumped = await book(seller, older.id, 'bump').expect(201);
    expect(bumped.body.booking).toMatchObject({ status: 'COMPLETED', endsAt: null });
    const after = await prisma.listing.findUniqueOrThrow({ where: { id: older.id } });
    expect(after.publishedAt).toEqual(before.publishedAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.bumpedAt).not.toBeNull();
    expect((await book(seller, older.id, 'bump').expect(409)).body.message).toMatch(/^Wieder möglich ab/);

    await flushSearch();
    const search = await request(server()).get('/v1/listings?q=trekkingrad&sortierung=neueste').expect(200);
    expect(search.body.items.map((i: { title: string }) => i.title)).toEqual(['Trekkingrad älter', 'Trekkingrad ganz neu', 'Trekkingrad neuer']);
    expect(search.body.items[0].bumpedAt).not.toBeNull();
  });

  it('zeigt Top-Anzeigen nur in passenden Suchergebnissen und beendet Vorteile nach Ablauf', async () => {
    const seller = await signIn(app);
    const bike = await publishListing(app, seller.auth, { title: 'Gravelbike Top-Angebot', priceCents: 120_000 });
    await publishListing(app, seller.auth, { title: 'Gravelbike normal', priceCents: 80_000 });
    await book(seller, bike.id, 'top').expect(201);
    await book(seller, bike.id, 'highlight').expect(201);
    await flushSearch();

    const matching = await request(server()).get('/v1/listings?q=gravelbike').expect(200);
    expect(matching.body.topAds.map((a: { id: string }) => a.id)).toEqual([bike.id]);
    expect(matching.body.topAds[0]).toMatchObject({ top: true, highlighted: true, sponsored: false });
    // Filter werden nicht umgangen: zu teuer für preis_bis=1000
    const filtered = await request(server()).get('/v1/listings?q=gravelbike&preis_bis=1000').expect(200);
    expect(filtered.body.topAds).toEqual([]);
    expect(filtered.body.items.map((i: { title: string }) => i.title)).toEqual(['Gravelbike normal']);
    expect((await request(server()).get('/v1/listings?q=gravelbike&seite=2').expect(200)).body.topAds).toEqual([]);
    // Ausweichbetrieb ohne Meilisearch: dieselben Top-Anzeigen und Filter über PostgreSQL
    const postgres = await request(fallback.getHttpServer()).get('/v1/listings?q=gravelbike').expect(200);
    expect(postgres.body.engine).toBe('postgres');
    expect(postgres.body.topAds.map((a: { id: string }) => a.id)).toEqual([bike.id]);
    expect((await request(fallback.getHttpServer()).get('/v1/listings?q=gravelbike&preis_bis=1000').expect(200)).body.topAds).toEqual([]);

    // Abgelaufen: wirkt sofort nicht mehr, der Ablaufjob räumt auf
    await prisma.$executeRaw`UPDATE listings SET top_until = now() - interval '1 minute', highlighted_until = now() - interval '1 minute' WHERE id = ${bike.id}`;
    await prisma.booking.updateMany({ where: { listingId: bike.id, kind: { in: ['TOP_AD', 'HIGHLIGHT'] } }, data: { endsAt: new Date(Date.now() - 60_000) } });
    const expired = await request(server()).get('/v1/listings?q=gravelbike').expect(200);
    expect(expired.body.topAds).toEqual([]);
    expect((await request(fallback.getHttpServer()).get('/v1/listings?q=gravelbike').expect(200)).body.topAds).toEqual([]);
    expect(expired.body.items.find((i: { id: string }) => i.id === bike.id)).toMatchObject({ top: false, highlighted: false });
    const result = await app.get(BookingsService).expire();
    expect(result).toMatchObject({ bookings: 2, listings: 1 });
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: bike.id } });
    expect(row).toMatchObject({ topUntil: null, highlightedUntil: null });
    expect(await prisma.booking.count({ where: { listingId: bike.id, status: 'EXPIRED' } })).toBe(2);
  });

  it('zählt Aufrufe ohne Wiederholungen, eigene und Team-Aufrufe und zeigt nur dem Eigentümer die Statistik', async () => {
    const seller = await signIn(app);
    const fan = await signIn(app);
    const moderator = await signInAs(app, 'MODERATOR');
    const listing = await publishListing(app, seller.auth);
    const visitor = randomBytes(32).toString('hex');
    const view = (body: Record<string, unknown>, auth: Record<string, string> = {}) => request(server()).post(`/v1/listings/${listing.id}/views`).set(auth).send(body).expect(202);

    expect((await view({ visitor })).body).toEqual({ counted: true });
    expect((await view({ visitor })).body).toEqual({ counted: false });
    expect((await view({ visitor: randomBytes(32).toString('hex') }, seller.auth)).body).toEqual({ counted: false });
    expect((await view({ visitor: randomBytes(32).toString('hex') }, moderator.auth)).body).toEqual({ counted: false });
    expect((await view({ visitor: randomBytes(32).toString('hex') }, fan.auth)).body).toEqual({ counted: true });
    await request(server()).post(`/v1/listings/${listing.id}/views`).send({ visitor: 'keine-hex-zeichen' }).expect(400);

    await request(server()).put(`/v1/me/favorites/${listing.id}`).set(fan.auth).expect((res) => expect([200, 201, 204]).toContain(res.status));
    const stats = await request(server()).get(`/v1/listings/${listing.id}/stats`).set(seller.auth).expect(200);
    expect(stats.body).toMatchObject({ totalViews: 2, favorites: 1, interestedPeople: 1, inquiries: 0 });
    expect(stats.body.viewsByDay).toHaveLength(30);
    expect(stats.body.viewsByDay.at(-1).views).toBe(2);
    await request(server()).get(`/v1/listings/${listing.id}/stats`).set(fan.auth).expect(404);
  });

  describe('Administration', () => {
    it('erlaubt Preis- und Aktionsverwaltung nur Admins und protokolliert Änderungen', async () => {
      const moderator = await signInAs(app, 'MODERATOR');
      const user = await signIn(app);
      for (const account of [moderator, user]) {
        await request(server()).get('/v1/admin/billing').set(account.auth).expect(403);
        await request(server()).put('/v1/admin/billing/mode').set(account.auth).send({ mode: 'FREE' }).expect(403);
      }
      const admin = await signInAs(app, 'ADMIN');
      const overview = await request(server()).get('/v1/admin/billing').set(admin.auth).expect(200);
      expect(overview.body.settings.billingMode).toBe('FREE');
      expect(overview.body.stripe).toMatchObject({ usable: false });
      expect(overview.body.paidModeBlockers.length).toBeGreaterThan(0);
      const top = overview.body.products.find((p: { code: string }) => p.code === 'top');

      const update = { ...pick(top), priceCents: 990, plannedPriceCents: 990, paidEnabled: true, durationDays: 14, expectedUpdatedAt: top.updatedAt };
      const saved = await request(server()).put('/v1/admin/billing/products/top').set(admin.auth).send(update).expect(200);
      expect(saved.body).toMatchObject({ priceCents: 990, plannedPriceCents: 990, durationDays: 14, effective: { priceCents: 0, reason: 'free_mode' } });
      // Veralteter Stand wird abgelehnt
      await request(server()).put('/v1/admin/billing/products/top').set(admin.auth).send(update).expect(409);
      const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.product_updated' } });
      expect(log.metadata).toMatchObject({ changes: { priceCents: [0, 990], durationDays: [7, 14] } });

      const listingProduct = overview.body.products.find((p: { code: string }) => p.code === 'listing');
      await request(server())
        .put('/v1/admin/billing/products/listing')
        .set(admin.auth)
        .send({ ...pick(listingProduct), isActive: false, expectedUpdatedAt: listingProduct.updatedAt })
        .expect(400);
      await request(server()).put('/v1/admin/billing/products/top').set(admin.auth).send({ ...update, priceCents: -5 }).expect(400);
    });

    it('verrechnet geplante Preise nicht und ändert bestehende Buchungen nie', async () => {
      const admin = await signInAs(app, 'ADMIN');
      const seller = await signIn(app);
      const listing = await publishListing(app, seller.auth);
      const before = await book(seller, listing.id, 'top').expect(201);
      await prisma.product.update({ where: { code: 'top' }, data: { priceCents: 1990, plannedPriceCents: 1990, paidEnabled: true } });
      await prisma.product.update({ where: { code: 'highlight' }, data: { priceCents: 490, paidEnabled: true } });
      // Kostenloser Betrieb: weiterhin 0,00 €, keine Weiterleitung
      const after = await book(seller, listing.id, 'highlight').expect(201);
      expect(after.body).toMatchObject({ checkoutUrl: null, booking: { priceCents: 0, status: 'ACTIVE' } });
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: before.body.booking.id } });
      expect(stored.priceCents).toBe(0);
      // Kostenpflichtig geht ohne Stripe nicht – auch nicht mit Bestätigung
      await request(server()).put('/v1/admin/billing/mode').set(admin.auth).send({ mode: 'PAID' }).expect(400);
      const blocked = await request(server()).put('/v1/admin/billing/mode').set(admin.auth).send({ mode: 'PAID', confirmation: 'KOSTENPFLICHTIG' }).expect(409);
      expect(blocked.body.message).toContain('STRIPE_SECRET_KEY');
      expect((await prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } })).billingMode).toBe('FREE');
      expect(await prisma.payment.count()).toBe(0);
    });

    it('zeigt die Einführungsaktion mit Enddatum und schaltet nach dem Ende nichts kostenpflichtig', async () => {
      const admin = await signInAs(app, 'ADMIN');
      const settings = {
        introEnabled: true,
        introVisible: true,
        introTitle: 'Jetzt kostenlos inserieren',
        introDescription: 'Während unserer Einführungsphase kannst du deine Inserate kostenlos veröffentlichen.',
        introStartsAt: null,
        introEndsAt: new Date(Date.now() + 10 * DAY_MS).toISOString(),
        introShowPlannedPrice: true,
        maxBookingsPerHour: 20,
      };
      await prisma.product.update({ where: { code: 'listing' }, data: { plannedPriceCents: 290 } });
      await request(server()).put('/v1/admin/billing/settings').set(admin.auth).send(settings).expect(200);
      const withEnd = await request(server()).get('/v1/billing').expect(200);
      expect(withEnd.body.intro).toMatchObject({ endsAt: settings.introEndsAt, plannedPriceCents: 290 });

      await request(server())
        .put('/v1/admin/billing/settings')
        .set(admin.auth)
        .send({ ...settings, introStartsAt: new Date(Date.now() - 20 * DAY_MS).toISOString(), introEndsAt: new Date(Date.now() - DAY_MS).toISOString() })
        .expect(200);
      const ended = await request(server()).get('/v1/billing').expect(200);
      expect(ended.body.intro).toBeNull();
      expect(ended.body.mode).toBe('FREE');
      for (const product of ended.body.products) expect(product.priceCents).toBe(0);
      const seller = await signIn(app);
      await publishListing(app, seller.auth);
      expect(await prisma.booking.count({ where: { priceCents: { gt: 0 } } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'admin.billing_settings_updated' } })).toBe(2);
    });

    it('listet Buchungen gefiltert', async () => {
      const admin = await signInAs(app, 'ADMIN');
      const seller = await signIn(app, { metadata: { display_name: 'Bea Bucher' } });
      const listing = await publishListing(app, seller.auth);
      await book(seller, listing.id, 'top').expect(201);
      const all = await request(server()).get('/v1/admin/billing/bookings').set(admin.auth).expect(200);
      expect(all.body.total).toBe(2);
      const tops = await request(server()).get('/v1/admin/billing/bookings?product=top').set(admin.auth).expect(200);
      expect(tops.body.items).toHaveLength(1);
      expect(tops.body.items[0]).toMatchObject({ user: { displayName: 'Bea Bucher' }, priceCents: 0, product: { code: 'top' } });
      expect((await request(server()).get('/v1/admin/billing/bookings?price=paid').set(admin.auth).expect(200)).body.total).toBe(0);
    });
  });

  describe('Händler', () => {
    it('zeigt öffentliche Händlerprofile nur für gewerbliche Konten, mit Logo und Dashboard', async () => {
      const dealer = await signIn(app, { metadata: { display_name: 'Rad Huber', account_type: 'BUSINESS', company_name: 'Radhaus Huber GmbH' } });
      const privat = await signIn(app);
      await request(server())
        .patch('/v1/me')
        .set(dealer.auth)
        .send({ bio: 'Fahrradfachhandel seit 1987.', companyAddress: 'Annenstraße 1, 8020 Graz', phone: '+43 316 123456', showPhone: true, website: 'https://radhaus.example.at' })
        .expect(200);
      await request(server()).patch('/v1/me').set(privat.auth).send({ website: 'https://privat.example.at' }).expect(400);
      await publishListing(app, dealer.auth, { title: 'Citybike vom Händler' });

      const profile = await request(server()).get(`/v1/dealers/${dealer.id}`).expect(200);
      expect(profile.body).toMatchObject({
        companyName: 'Radhaus Huber GmbH',
        address: 'Annenstraße 1, 8020 Graz',
        phone: '+43 316 123456',
        website: 'https://radhaus.example.at',
        activeListings: 1,
        logoUrl: null,
      });
      expect(profile.body.listings.items[0].title).toBe('Citybike vom Händler');
      await request(server()).get(`/v1/dealers/${privat.id}`).expect(404);
      await request(server()).get(`/v1/dealers/${randomUUID()}`).expect(404);

      const png = await (await import('sharp')).default({ create: { width: 200, height: 120, channels: 3, background: '#0f766e' } }).png().toBuffer();
      await request(server()).put('/v1/me/logo').set(privat.auth).set('Content-Type', 'image/png').send(png).expect(403);
      await request(server()).put('/v1/me/logo').set(dealer.auth).set('Content-Type', 'image/png').send(Buffer.from('kein bild')).expect(400);
      const uploaded = await request(server()).put('/v1/me/logo').set(dealer.auth).set('Content-Type', 'image/png').send(png).expect(200);
      expect(uploaded.body.logoUrl).toMatch(new RegExp(`/v1/dealers/${dealer.id}/logo\\?v=`));
      await request(server()).get(`/v1/dealers/${dealer.id}/logo`).expect(302);

      const dashboard = await request(server()).get('/v1/me/dealer-dashboard').set(dealer.auth).expect(200);
      expect(dashboard.body).toMatchObject({ listings: { active: 1 }, activeTop: 0, activeHighlights: 0, bumps30d: 0, profileComplete: false });
      expect(dashboard.body.missingProfileFields).toEqual(['Firmenbuchnummer oder UID']);
      expect(dashboard.body.usage.map((u: { code: string }) => u.code)).toEqual(['highlight', 'top', 'bump']);
      await request(server()).get('/v1/me/dealer-dashboard').set(privat.auth).expect(403);
    });
  });
});

/** Felder eines Produkts, die das Bearbeitungsformular schickt */
function pick(product: Record<string, unknown>) {
  const fields = [
    'name', 'description', 'priceCents', 'plannedPriceCents', 'durationDays', 'forPrivate', 'forBusiness', 'isActive', 'paidEnabled',
    'promoStartsAt', 'promoEndsAt', 'maxActivePerUser', 'maxActiveTotal', 'maxPerPeriod', 'periodDays', 'cooldownHours',
  ];
  return Object.fromEntries(fields.map((f) => [f, product[f]]));
}
