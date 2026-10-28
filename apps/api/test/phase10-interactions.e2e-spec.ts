import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { SavedSearchesService } from '../src/saved-searches/saved-searches.service.js';
import { createTestApp, flushSearch, mailsTo, mailText, publishDeal, resetData, signIn, signInAs, signInMerchant } from './helpers.js';

const HOUR_MS = 3_600_000;

/** Phase 10, Schritt 5: Merkliste und gespeicherte Suchen für Deals und Anbieterprofile */
describe('Merkliste und gespeicherte Suchen für Deals und Dienstleistungen', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  async function provider(headline = 'Webentwicklung für kleine Betriebe', overrides: Record<string, unknown> = {}) {
    const account = await signIn(app);
    const saved = await request(server())
      .put('/v1/me/service-profile')
      .set(account.auth)
      .send({
        headline,
        summary: 'Websites, Webshops und Wartung – persönlich und verständlich erklärt.',
        description: 'Ich entwickle Websites und Webshops für kleine Unternehmen in ganz Österreich, von der Planung bis zum Betrieb.',
        categorySlugs: ['webentwicklung'],
        skills: [],
        austriaWide: false,
        remote: true,
        priceType: 'ON_REQUEST',
        availability: 'AVAILABLE',
        ...overrides,
      })
      .expect(200);
    await request(server()).post('/v1/me/service-profile/publish').set(account.auth).send({ confirmed: true }).expect(200);
    return { account, id: saved.body.profile.id as string };
  }

  describe('Merkliste', () => {
    it('merkt Deals idempotent, zeigt den Status auf der Detailseite und behält abgelaufene ohne Bild', async () => {
      const merchant = await signInMerchant(app);
      const deal = await publishDeal(app, merchant.auth);
      const user = await signIn(app);
      await request(server()).put(`/v1/me/favorites/deals/${deal.id}`).expect(401);
      await request(server()).put(`/v1/me/favorites/deals/${deal.id}`).set(merchant.auth).expect(400);
      await request(server()).put('/v1/me/favorites/deals/abcdefghijklmnopqrstuvwx').set(user.auth).expect(404);
      await request(server()).put(`/v1/me/favorites/deals/${deal.id}`).set(user.auth).expect(204);
      await request(server()).put(`/v1/me/favorites/deals/${deal.id}`).set(user.auth).expect(204);

      expect((await request(server()).get(`/v1/deals/${deal.id}`).set(user.auth).expect(200)).body.isFavorite).toBe(true);
      expect((await request(server()).get(`/v1/deals/${deal.id}`).expect(200)).body.isFavorite).toBe(false);
      const list = await request(server()).get('/v1/me/favorites/deals').set(user.auth).expect(200);
      expect(list.body).toMatchObject({ total: 1, items: [{ deal: { id: deal.id }, available: true }] });
      // Die Merkliste für Inserate bleibt getrennt
      expect((await request(server()).get('/v1/me/favorites').set(user.auth).expect(200)).body.total).toBe(0);

      await prisma.deal.update({ where: { id: deal.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
      const expired = await request(server()).get('/v1/me/favorites/deals').set(user.auth).expect(200);
      expect(expired.body.items[0]).toMatchObject({ available: false, deal: { id: deal.id, imageUrl: null } });
      // Abgelaufene lassen sich nicht neu merken, aber entfernen
      const other = await signIn(app);
      await request(server()).put(`/v1/me/favorites/deals/${deal.id}`).set(other.auth).expect(404);
      await request(server()).delete(`/v1/me/favorites/deals/${deal.id}`).set(user.auth).expect(204);
      expect(await prisma.dealFavorite.count()).toBe(0);
    });

    it('merkt Anbieterprofile, nicht das eigene, und blendet pausierte als nicht verfügbar aus', async () => {
      const { account: owner, id } = await provider();
      const user = await signIn(app);
      await request(server()).put(`/v1/me/favorites/services/${id}`).set(owner.auth).expect(400);
      await request(server()).put(`/v1/me/favorites/services/${id}`).set(user.auth).expect(204);
      expect((await request(server()).get(`/v1/services/${id}`).set(user.auth).expect(200)).body.isFavorite).toBe(true);
      expect((await request(server()).get('/v1/me/favorites/services').set(user.auth).expect(200)).body.items[0]).toMatchObject({ profile: { id }, available: true });

      await request(server()).post('/v1/me/service-profile/pause').set(owner.auth).expect(200);
      expect((await request(server()).get('/v1/me/favorites/services').set(user.auth).expect(200)).body.items[0]).toMatchObject({ available: false });
      // Gelöschte Profile verschwinden aus der Merkliste
      await request(server()).delete('/v1/me/service-profile').set(owner.auth).expect(204);
      expect((await request(server()).get('/v1/me/favorites/services').set(user.auth).expect(200)).body.total).toBe(0);

      const exported = await request(server()).get('/v1/me/export').set(user.auth).expect(200);
      expect(exported.body).toHaveProperty('dealFavorites');
      expect(exported.body).toHaveProperty('serviceFavorites');
    });
  });

  describe('Gespeicherte Suchen', () => {
    it('speichert Deal- und Anbietersuchen getrennt von Inseratssuchen und prüft die Parameter', async () => {
      const user = await signIn(app);
      const deal = await request(server())
        .post('/v1/me/searches')
        .set(user.auth)
        .send({ kind: 'DEALS', name: 'Notebooks', params: { q: 'Notebook', rabatt_ab: '20', seite: '3' }, notify: true })
        .expect(201);
      expect(deal.body).toMatchObject({ kind: 'DEALS', params: { q: 'Notebook', rabatt_ab: '20' } });
      expect(deal.body.params).not.toHaveProperty('seite');
      // Gleiche Parameter als Inseratssuche sind eine andere Suche
      await request(server()).post('/v1/me/searches').set(user.auth).send({ name: 'Notebooks', params: { q: 'Notebook' } }).expect(201);
      await request(server()).post('/v1/me/searches').set(user.auth).send({ kind: 'DEALS', name: 'Doppelt', params: { rabatt_ab: '20', q: 'Notebook' } }).expect(409);

      const service = await request(server())
        .post('/v1/me/searches')
        .set(user.auth)
        .send({ kind: 'SERVICES', name: 'Webentwicklung remote', params: { kategorie: 'webentwicklung', remote: 'ja' } })
        .expect(201);
      expect(service.body).toMatchObject({ kind: 'SERVICES', params: { kategorie: 'webentwicklung', remote: 'ja' } });
      await request(server()).post('/v1/me/searches').set(user.auth).send({ kind: 'SERVICES', name: 'Leer', params: {} }).expect(400);
      const bad = await request(server()).post('/v1/me/searches').set(user.auth).send({ kind: 'SERVICES', name: 'Kaputt', params: { kategorie: 'gibt-es-nicht' } }).expect(400);
      expect(bad.body.errors[0]).toMatchObject({ path: 'kategorie' });
      await request(server()).post('/v1/me/searches').set(user.auth).send({ kind: 'IRGENDWAS', name: 'x', params: { q: 'x' } }).expect(400);

      const list = await request(server()).get('/v1/me/searches').set(user.auth).expect(200);
      expect(list.body.map((s: { kind: string }) => s.kind).sort()).toEqual(['DEALS', 'LISTINGS', 'SERVICES']);
    });

    it('schickt für Deals und Anbieter höchstens eine Sammelmail am Tag', async () => {
      const alerts = app.get(SavedSearchesService);
      const user = await signIn(app);
      await request(server()).post('/v1/me/searches').set(user.auth).send({ kind: 'DEALS', name: 'Notebook-Deals', params: { q: 'Notebook' }, notify: true }).expect(201);
      await request(server()).post('/v1/me/searches').set(user.auth).send({ kind: 'SERVICES', name: 'Webentwicklung', params: { kategorie: 'webentwicklung' }, notify: true }).expect(201);

      const merchant = await signInMerchant(app);
      await publishDeal(app, merchant.auth);
      await publishDeal(app, merchant.auth, { title: 'Notebook 13 Zoll, leicht', url: 'https://shop.example.at/notebook-13' });
      await publishDeal(app, merchant.auth, { title: 'Kaffeemaschine', description: 'Vollautomat.', categorySlug: 'haushalt-kueche', url: 'https://shop.example.at/kaffee' });
      await provider();
      await flushSearch();

      // Innerhalb der ersten 24 Stunden: noch keine Prüfung, also keine Einzelmails
      expect((await alerts.runAlerts(new Date(Date.now() + 10 * 60_000))).checked).toBe(0);

      const nextDay = new Date(Date.now() + 25 * HOUR_MS);
      expect(await alerts.runAlerts(nextDay)).toEqual({ checked: 2, notified: 2 });
      const mails = await mailsTo(user.email);
      expect(mails.map((m) => m.Subject).sort()).toEqual(['2 neue Deals für „Notebook-Deals“', 'Ein neues Anbieterprofil für „Webentwicklung“']);
      const dealMail = mails.find((m) => m.Subject.includes('Deals'))!;
      const text = await mailText(dealMail.ID);
      expect(text).toContain('Notebook 13 Zoll');
      expect(text).not.toContain('Kaffeemaschine');
      expect(text).toContain('/deals?');

      // Neuer Deal kurz danach: erst am nächsten Tag wieder geprüft
      await publishDeal(app, merchant.auth, { title: 'Notebook 17 Zoll', url: 'https://shop.example.at/notebook-17' });
      expect((await alerts.runAlerts(new Date(nextDay.getTime() + HOUR_MS))).checked).toBe(0);
      expect(await mailsTo(user.email)).toHaveLength(2);
    });
  });

  describe('Admin-Übersicht', () => {
    it('zählt Deals, Anbieterprofile, offene Qualifikationen und Projektaufträge', async () => {
      const merchant = await signInMerchant(app);
      const deal = await publishDeal(app, merchant.auth);
      await publishDeal(app, merchant.auth, { title: 'Notebook 13 Zoll, leicht', url: 'https://shop.example.at/notebook-13' });
      await prisma.deal.update({ where: { id: deal.id }, data: { status: 'PENDING_REVIEW' } });
      const { account, id } = await provider();
      await request(server())
        .post('/v1/me/service-profile/qualifications')
        .set(account.auth)
        .send({ title: 'Zertifikat Barrierefreies Webdesign', issuer: 'Testakademie', reference: 'BW-1' })
        .expect(201);
      await prisma.serviceProfile.update({ where: { id }, data: { status: 'PENDING_REVIEW' } });

      const moderator = await signInAs(app, 'MODERATOR');
      const dashboard = await request(server()).get('/v1/admin/dashboard').set(moderator.auth).expect(200);
      expect(dashboard.body.moderation).toMatchObject({
        deals: { active: 1, pendingReview: 1, feedsPending: 0 },
        services: { active: 0, pendingReview: 1, qualificationsOpen: 1 },
        projects: { active: 0, pendingReview: 0 },
      });
    });
  });
});
