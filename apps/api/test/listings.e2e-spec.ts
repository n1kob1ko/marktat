import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, flushSearch, mailsTo, mailText, resetData, signIn, tokenFor } from './helpers.js';
import { ListingRemindersService } from '../src/listings/listing-reminders.service.js';

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
    const leaf = await prisma.category.findUniqueOrThrow({ where: { path: 'marktplatz/sport-sportgeraete/fahrraeder' } });
    leafCategoryId = leaf.id;
    parentCategoryId = leaf.parentId!;
    locationId = (await prisma.location.findFirstOrThrow({ where: { postalCode: '8010', place: 'Graz' } })).id;
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

    await flushSearch();
    const list = await request(server()).get('/v1/listings').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(res.body.id);
  });

  it('legt bei wiederholtem Abschicken desselben Formulars kein zweites Inserat an', async () => {
    const seller = await tokenFor();
    const clientRequestId = randomUUID();
    const body = { ...complete(), clientRequestId };
    // Doppelklick: beide Anfragen gleichzeitig, danach eine Wiederholung nach „Verbindungsabbruch“
    const [a, b] = await Promise.all([
      request(server()).post('/v1/listings').set(seller.auth).send(body),
      request(server()).post('/v1/listings').set(seller.auth).send(body),
    ]);
    const retry = await request(server()).post('/v1/listings').set(seller.auth).send(body).expect(201);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expect(new Set([a.body.id, b.body.id, retry.body.id]).size).toBe(1);
    expect(await prisma.listing.count({ where: { sellerId: seller.id } })).toBe(1);
    // Auch die (kostenlose) Buchung gibt es nur einmal
    expect(await prisma.booking.count({ where: { userId: seller.id } })).toBe(1);

    // Neues Formular (neue Kennung) = neues Inserat; dieselbe Kennung bei einer anderen Person stört nicht
    await request(server()).post('/v1/listings').set(seller.auth).send({ ...complete(), clientRequestId: randomUUID() }).expect(201);
    const other = await tokenFor();
    await request(server()).post('/v1/listings').set(other.auth).send(body).expect(201);
    expect(await prisma.listing.count()).toBe(3);
    await request(server()).post('/v1/listings').set(seller.auth).send({ ...complete(), clientRequestId: 'kein-uuid' }).expect(400);
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
    await flushSearch();
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

  it('reserviert ein Inserat (bleibt suchbar) und markiert es als verkauft (Seite bleibt erreichbar, Suche nicht)', async () => {
    const seller = await tokenFor();
    const stranger = await tokenFor();
    const { body: listing } = await request(server()).post('/v1/listings').set(seller.auth).send(complete()).expect(201);

    // Reservieren: Kennzeichnung in Suche und auf der Seite, Fremde dürfen nicht
    await request(server()).post(`/v1/listings/${listing.id}/reserve`).set(stranger.auth).expect(404);
    const reserved = await request(server()).post(`/v1/listings/${listing.id}/reserve`).set(seller.auth).expect(200);
    expect(reserved.body.reserved).toBe(true);
    expect(reserved.body.status).toBe('ACTIVE');
    await flushSearch();
    const results = await request(server()).get('/v1/listings').expect(200);
    expect(results.body.items.find((item: { id: string }) => item.id === listing.id)?.reserved).toBe(true);
    const pub = await request(server()).get(`/v1/listings/${listing.id}`).expect(200);
    expect(pub.body.reserved).toBe(true);
    const unreserved = await request(server()).post(`/v1/listings/${listing.id}/unreserve`).set(seller.auth).expect(200);
    expect(unreserved.body.reserved).toBe(false);

    // Verkauft: raus aus der Suche, Seite öffentlich mit Status SOLD, keine Merkliste mehr
    await request(server()).post(`/v1/listings/${listing.id}/sold`).set(stranger.auth).expect(404);
    const sold = await request(server()).post(`/v1/listings/${listing.id}/sold`).set(seller.auth).expect(200);
    expect(sold.body.status).toBe('SOLD');
    expect(sold.body.soldAt).not.toBeNull();
    await flushSearch();
    expect((await request(server()).get('/v1/listings').expect(200)).body.total).toBe(0);
    const soldPage = await request(server()).get(`/v1/listings/${listing.id}`).expect(200);
    expect(soldPage.body.status).toBe('SOLD');
    expect(soldPage.body.images).toEqual([]);
    await request(server()).get(`/v1/listings/${listing.id}/related`).expect(200);
    // Verkauft lässt sich nicht reservieren oder pausieren; nach 30 Tagen ist die Seite weg
    await request(server()).post(`/v1/listings/${listing.id}/reserve`).set(seller.auth).expect(409);
    await request(server()).post(`/v1/listings/${listing.id}/pause`).set(seller.auth).expect(409);
    await prisma.listing.update({ where: { id: listing.id }, data: { soldAt: new Date(Date.now() - 31 * 86_400_000) } });
    await request(server()).get(`/v1/listings/${listing.id}`).expect(404);
    const mine = await request(server()).get('/v1/listings/mine').set(seller.auth).expect(200);
    expect(mine.body[0].status).toBe('SOLD');

    // Erneut veröffentlichen: wieder aktiv, Markierungen weg
    const relisted = await request(server()).post(`/v1/listings/${listing.id}/publish`).set(seller.auth).expect(200);
    expect(relisted.body.status).toBe('ACTIVE');
    expect(relisted.body.soldAt).toBeNull();
    expect(relisted.body.reserved).toBe(false);
  });

  it('erinnert per E-Mail vor dem Ablauf und meldet den Ablauf – je einmal und nur mit Einstellung', async () => {
    const seller = await signIn(app, { metadata: { display_name: 'Erika Erinnert' } });
    const quiet = await signIn(app);
    await request(server()).patch('/v1/me/notifications').set(quiet.auth).send({ notifyListingsByEmail: false }).expect(200);
    const soon = (await request(server()).post('/v1/listings').set(seller.auth).send(complete()).expect(201)).body;
    const later = (await request(server()).post('/v1/listings').set(seller.auth).send({ ...complete(), title: 'Citybike später' }).expect(201)).body;
    const quietOne = (await request(server()).post('/v1/listings').set(quiet.auth).send(complete()).expect(201)).body;
    const day = 86_400_000;
    const now = new Date();
    await prisma.listing.update({ where: { id: soon.id }, data: { expiresAt: new Date(now.getTime() + 2 * day) } });
    await prisma.listing.update({ where: { id: quietOne.id }, data: { expiresAt: new Date(now.getTime() + 2 * day) } });

    const reminders = app.get(ListingRemindersService);
    expect(await reminders.run(now)).toEqual({ reminded: 1, expired: 0 });
    const mails = await mailsTo(seller.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.Subject).toMatch(/läuft am .* ab$/);
    const text = await mailText(mails[0]!.ID);
    expect(text).toContain(soon.title);
    expect(text).not.toContain(later.title);
    expect(text).toContain('/konto/anzeigen');
    expect(await mailsTo(quiet.email)).toHaveLength(0);
    // Zweiter Lauf: keine zweite Erinnerung
    expect(await reminders.run(now)).toEqual({ reminded: 0, expired: 0 });

    // Abgelaufen: ein Hinweis, danach Ruhe; Verlängern setzt beides zurück
    await prisma.listing.update({ where: { id: soon.id }, data: { expiresAt: new Date(now.getTime() - 1000) } });
    expect(await reminders.run(now)).toEqual({ reminded: 0, expired: 1 });
    expect(await reminders.run(now)).toEqual({ reminded: 0, expired: 0 });
    const all = await mailsTo(seller.email);
    expect(all.map((m) => m.Subject).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/ist abgelaufen$/)]));
    await request(server()).post(`/v1/listings/${soon.id}/publish`).set(seller.auth).expect(200);
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: soon.id } });
    expect(row.expiryReminderAt).toBeNull();
    expect(row.expiredNoticeAt).toBeNull();
    // Lange abgelaufene Anzeigen (vor Einführung) bekommen keinen nachträglichen Hinweis
    await prisma.listing.update({ where: { id: later.id }, data: { expiresAt: new Date(now.getTime() - 10 * day) } });
    expect(await reminders.run(now)).toEqual({ reminded: 0, expired: 0 });
  });

  it('blendet abgelaufene Inserate aus und erlaubt Verlängerung', async () => {
    const seller = await tokenFor();
    const { body: listing } = await request(server()).post('/v1/listings').set(seller.auth).send(complete()).expect(201);
    await prisma.listing.update({ where: { id: listing.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await flushSearch();
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
    const vienna = (await prisma.location.findFirstOrThrow({ where: { postalCode: '1010', place: 'Wien' } })).id;
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

    await flushSearch();
    const byText = await request(server()).get('/v1/listings').query({ q: 'rennrad' }).expect(200);
    expect(byText.body.total).toBe(1);
    const byParent = await request(server()).get('/v1/listings').query({ categoryId: parentCategoryId }).expect(200);
    expect(byParent.body.total).toBe(2);
    const byState = await request(server()).get('/v1/listings').query({ state: 'wien' }).expect(200);
    expect(byState.body.items.map((i: { title: string }) => i.title)).toEqual(['Stadtrad mit Korb']);
    const byVertical = await request(server()).get('/v1/listings').query({ vertical: 'JOBS' }).expect(200);
    expect(byVertical.body.total).toBe(0);
  });

  it('schlägt eine Preisspanne aus ähnlichen Inseraten vor – erst in der Nähe, sonst österreichweit', async () => {
    const seller = await tokenFor();
    const vienna = (await prisma.location.findFirstOrThrow({ where: { postalCode: '1010', place: 'Wien' } })).id;
    const post = (priceCents: number, extra: Record<string, unknown> = {}) =>
      request(server()).post('/v1/listings').set(seller.auth).send({ ...complete(), priceCents, ...extra }).expect(201);

    // Zu wenige Inserate: keine Spanne, nur die Anzahl
    await post(10_000);
    await post(20_000);
    let hint = await request(server()).get('/v1/listings/price-hint').query({ kategorie: leafCategoryId, ort: locationId }).expect(200);
    expect(hint.body).toMatchObject({ count: 2, scope: 'austria', lowCents: null, medianCents: null, highCents: null });

    // Entwürfe, „Zu verschenken“ und andere Kategorien zählen nicht mit
    await post(99_000, { publish: false });
    await post(0, { priceType: 'FREE', priceCents: undefined });
    await post(30_000);
    await post(40_000);
    hint = await request(server()).get('/v1/listings/price-hint').query({ kategorie: leafCategoryId, ort: locationId }).expect(200);
    expect(hint.body).toEqual({ count: 4, scope: 'nearby', radiusKm: 50, lowCents: 17_500, medianCents: 25_000, highCents: 32_500 });

    // Wien ist weit weg von Graz: österreichweite Spanne
    hint = await request(server()).get('/v1/listings/price-hint').query({ kategorie: leafCategoryId, ort: vienna }).expect(200);
    expect(hint.body).toMatchObject({ count: 4, scope: 'austria', radiusKm: null, medianCents: 25_000 });

    // Oberkategorien haben eigene Inserate nicht: leer statt Fehler; unbekannte Kategorie und falsche Eingaben werden abgewiesen
    hint = await request(server()).get('/v1/listings/price-hint').query({ kategorie: parentCategoryId }).expect(200);
    expect(hint.body).toMatchObject({ count: 0, medianCents: null });
    await request(server()).get('/v1/listings/price-hint').query({ kategorie: 'gibtesnicht' }).expect(404);
    await request(server()).get('/v1/listings/price-hint').expect(400);
    await request(server()).get('/v1/listings/price-hint').query({ kategorie: leafCategoryId, ort: 'abc' }).expect(400);
  });

  it('sucht Orte über PLZ und Namen', async () => {
    const byCode = await request(server()).get('/v1/geo/locations').query({ q: '6020' }).expect(200);
    expect(byCode.body[0]).toMatchObject({ place: 'Innsbruck', state: 'Tirol' });
    const byName = await request(server()).get('/v1/geo/locations').query({ q: 'klagen' }).expect(200);
    expect(byName.body[0]).toMatchObject({ postalCode: '9020', place: 'Klagenfurt am Wörthersee' });
  });

  it('kennt das vollständige PLZ-Verzeichnis mit Ortsteilen und Hauptorten', async () => {
    const linz = await request(server()).get('/v1/geo/locations').query({ q: '4020' }).expect(200);
    expect(linz.body[0]).toMatchObject({ place: 'Linz', district: 'Linz (Stadt)', state: 'Oberösterreich' });
    expect(linz.body.map((l: { place: string }) => l.place)).toContain('Leonding');

    const combined = await request(server()).get('/v1/geo/locations').query({ q: '1010 Wien' }).expect(200);
    expect(combined.body).toEqual([expect.objectContaining({ postalCode: '1010', place: 'Wien', municipality: null, state: 'Wien' })]);

    const saint = await request(server()).get('/v1/geo/locations').query({ q: 'sankt veit an der g' }).expect(200);
    expect(saint.body).toContainEqual(expect.objectContaining({ postalCode: '9300', place: 'St. Veit an der Glan', state: 'Kärnten' }));

    const district = await request(server()).get('/v1/geo/locations').query({ q: 'wilten' }).expect(200);
    expect(district.body[0]).toMatchObject({ postalCode: '6020', place: 'Wilten', municipality: 'Innsbruck' });

    const wildcard = await request(server()).get('/v1/geo/locations').query({ q: '%_' }).expect(200);
    expect(wildcard.body).toEqual([]);

    const total = await prisma.location.count();
    expect(total).toBeGreaterThan(20_000);
    const vienna = await request(server()).get('/v1/geo/locations').query({ q: 'wien' }).expect(200);
    expect(vienna.body.slice(0, 3).map((l: { postalCode: string }) => l.postalCode)).toEqual(['1010', '1020', '1030']);
  });
});
