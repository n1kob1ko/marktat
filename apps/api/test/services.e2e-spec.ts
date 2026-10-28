import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, drainJobs, resetData, signIn, signInAs } from './helpers.js';

type Account = Awaited<ReturnType<typeof signIn>>;

const STATEMENT = 'Die angegebene Qualifikation ist nicht belegt und wurde nicht erteilt.';
const DESCRIPTION = 'Ich entwickle Websites und Webshops für kleine Unternehmen in ganz Österreich, von der Planung bis zum Betrieb.';

describe('Dienstleistungen', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const searchIds = async (query = '') => ((await request(server()).get(`/v1/services?${query}`).expect(200)).body.items as { id: string }[]).map((p) => p.id);

  async function locationId(postalCode: string, place: string) {
    return (await prisma.location.findFirstOrThrow({ where: { postalCode, place } })).id;
  }

  function profileBody(overrides: Record<string, unknown> = {}) {
    return {
      headline: 'Webentwicklung für kleine Betriebe',
      summary: 'Websites, Webshops und Wartung – persönlich und verständlich erklärt.',
      description: DESCRIPTION,
      categorySlugs: ['webentwicklung', 'seo'],
      skills: ['TypeScript', 'React', 'typescript'],
      austriaWide: false,
      remote: true,
      priceType: 'HOURLY',
      priceCents: 6_500,
      availability: 'AVAILABLE',
      ...overrides,
    };
  }

  /** Konto mit veröffentlichtem Anbieterprofil */
  async function provider(overrides: Record<string, unknown> = {}, user?: Parameters<typeof signIn>[1]) {
    const account = await signIn(app, user);
    const saved = await request(server()).put('/v1/me/service-profile').set(account.auth).send(profileBody(overrides)).expect(200);
    await request(server()).post('/v1/me/service-profile/publish').set(account.auth).send({ confirmed: true }).expect(200);
    return { account, id: saved.body.profile.id as string };
  }

  /** Gewerbliches Konto mit Firmenanschrift (Impressum) und veröffentlichtem Profil */
  async function businessProvider(company: string, overrides: Record<string, unknown> = {}) {
    const account = await signIn(app, { metadata: { display_name: company, account_type: 'BUSINESS', company_name: company } });
    await request(server()).patch('/v1/me').set(account.auth).send({ companyAddress: 'Ring 1, 1010 Wien' }).expect(200);
    const saved = await request(server()).put('/v1/me/service-profile').set(account.auth).send(profileBody(overrides)).expect(200);
    await request(server()).post('/v1/me/service-profile/publish').set(account.auth).send({ confirmed: true }).expect(200);
    return { account, id: saved.body.profile.id as string };
  }

  async function adminVersion(moderator: Account, id: string) {
    return (await request(server()).get(`/v1/admin/services/${id}`).set(moderator.auth).expect(200)).body.version as string;
  }

  describe('Profil im bestehenden Konto', () => {
    it('legt ein Profil als Entwurf an, prüft die Angaben und veröffentlicht erst nach Bestätigung', async () => {
      const user = await signIn(app);
      expect((await request(server()).get('/v1/me/service-profile').set(user.auth).expect(200)).body).toEqual({ profile: null, missingAccountFields: [] });
      await request(server()).get('/v1/me/service-profile').expect(401);

      const invalid = await request(server())
        .put('/v1/me/service-profile')
        .set(user.auth)
        .send(profileBody({ priceType: 'HOURLY', priceCents: null, remote: false, categorySlugs: ['gibt-es-nicht'] }))
        .expect(400);
      const paths = (invalid.body.errors as { path: string }[]).map((e) => e.path);
      expect(paths).toEqual(expect.arrayContaining(['categorySlugs.0', 'priceCents', 'locationId']));

      const saved = await request(server()).put('/v1/me/service-profile').set(user.auth).send(profileBody()).expect(200);
      expect(saved.body.profile).toMatchObject({ status: 'DRAFT', skills: ['TypeScript', 'React'], remote: true, priceCents: 6_500, isOwner: true });
      expect(saved.body.profile.categories.map((c: { slug: string }) => c.slug).sort()).toEqual(['seo', 'webentwicklung']);
      expect(await searchIds()).toEqual([]);
      // Entwurf ist für andere nicht sichtbar
      const other = await signIn(app);
      await request(server()).get(`/v1/services/${saved.body.profile.id}`).set(other.auth).expect(404);

      await request(server()).post('/v1/me/service-profile/publish').set(user.auth).send({}).expect(400);
      const published = await request(server()).post('/v1/me/service-profile/publish').set(user.auth).send({ confirmed: true }).expect(200);
      expect(published.body.profile).toMatchObject({ status: 'ACTIVE' });
      expect(await searchIds()).toEqual([saved.body.profile.id]);
      await request(server()).post('/v1/me/service-profile/publish').set(user.auth).send({ confirmed: true }).expect(409);

      // „auf Anfrage“ braucht keinen Betrag, Wechsel löscht den alten Betrag
      const onRequest = await request(server()).put('/v1/me/service-profile').set(user.auth).send(profileBody({ priceType: 'ON_REQUEST', priceCents: 9_000 })).expect(200);
      expect(onRequest.body.profile).toMatchObject({ status: 'ACTIVE', priceType: 'ON_REQUEST', priceCents: null });
    });

    it('verlangt bei gewerblichen Konten Firmenname und Anschrift (Impressum) und zeigt sie öffentlich an', async () => {
      const firma = await signIn(app, { metadata: { display_name: 'Maler Gruber', account_type: 'BUSINESS', company_name: 'Maler Gruber e.U.' } });
      const graz = await locationId('8010', 'Graz');
      await request(server()).put('/v1/me/service-profile').set(firma.auth).send(profileBody({ categorySlugs: ['maler'], remote: false, locationId: graz, serviceRadiusKm: 30 })).expect(200);
      const missing = await request(server()).post('/v1/me/service-profile/publish').set(firma.auth).send({ confirmed: true }).expect(409);
      expect(missing.body.message).toContain('Firmenanschrift');
      await request(server()).patch('/v1/me').set(firma.auth).send({ companyAddress: 'Annenstraße 1, 8020 Graz' }).expect(200);
      const published = await request(server()).post('/v1/me/service-profile/publish').set(firma.auth).send({ confirmed: true }).expect(200);

      const visitor = await request(server()).get(`/v1/services/${published.body.profile.id}`).expect(200);
      expect(visitor.body).toMatchObject({
        provider: { name: 'Maler Gruber e.U.', business: true },
        imprint: { companyName: 'Maler Gruber e.U.', companyAddress: 'Annenstraße 1, 8020 Graz' },
        regulatedCategories: ['Maler'],
        isOwner: false,
        conversationId: null,
        moderation: null,
      });
      expect((await prisma.serviceProfile.findUniqueOrThrow({ where: { id: published.body.profile.id } })).viewCount).toBe(1);
    });

    it('pausiert, setzt fort und löscht das Profil, ohne das Konto anzutasten; neu anlegen beginnt als Entwurf', async () => {
      const { account, id } = await provider();
      await request(server()).post('/v1/me/service-profile/resume').set(account.auth).expect(409);
      await request(server()).post('/v1/me/service-profile/pause').set(account.auth).expect(200);
      expect(await searchIds()).toEqual([]);
      await request(server()).get(`/v1/services/${id}`).expect(404);
      await request(server()).post('/v1/me/service-profile/resume').set(account.auth).expect(200);
      expect(await searchIds()).toEqual([id]);

      await request(server()).post('/v1/me/service-profile/qualifications').set(account.auth).send({ title: 'Zertifikat Webentwicklung' }).expect(201);
      await request(server()).delete('/v1/me/service-profile').set(account.auth).expect(204);
      expect(await searchIds()).toEqual([]);
      expect((await request(server()).get('/v1/me/service-profile').set(account.auth).expect(200)).body.profile).toBeNull();
      expect(await prisma.serviceQualification.count()).toBe(0);
      await request(server()).get('/v1/me').set(account.auth).expect(200);

      const again = await request(server()).put('/v1/me/service-profile').set(account.auth).send(profileBody()).expect(200);
      expect(again.body.profile).toMatchObject({ id, status: 'DRAFT', qualifications: [], portfolio: [] });
    });
  });

  describe('Suche und Filter', () => {
    it('filtert nach Bereich, Kategorie, Begriff, Ort mit Umkreis, remote, Preis, Verfügbarkeit und Anbieterart', async () => {
      const graz = await locationId('8010', 'Graz');
      const wien = await locationId('1010', 'Wien');
      const web = await provider({ remote: true, austriaWide: false, priceCents: 6_500 });
      const maler = await provider(
        { headline: 'Malerarbeiten in Graz und Umgebung', categorySlugs: ['maler'], skills: ['Fassade'], remote: false, locationId: graz, serviceRadiusKm: 20, priceCents: 4_500 },
      );
      const nachhilfe = await provider({ headline: 'Mathe-Nachhilfe in Wien', categorySlugs: ['nachhilfe'], skills: [], remote: false, locationId: wien, priceType: 'ON_REQUEST', priceCents: null, availability: 'UNAVAILABLE' });
      const sauber = await businessProvider('Sauber GmbH', { headline: 'Reinigung österreichweit', categorySlugs: ['reinigung'], skills: [], remote: false, austriaWide: true, priceType: 'FIXED', priceCents: 12_000 });
      const sauberProfile = { id: sauber.id };

      const all = await searchIds();
      expect(all.sort()).toEqual([web.id, maler.id, nachhilfe.id, sauberProfile.id].sort());
      expect(await searchIds('bereich=haus-handwerk')).toEqual(expect.arrayContaining([maler.id, sauberProfile.id]));
      expect((await searchIds('bereich=haus-handwerk')).length).toBe(2);
      expect(await searchIds('kategorie=nachhilfe')).toEqual([nachhilfe.id]);
      expect(await searchIds('q=fassade')).toEqual([maler.id]);
      expect(await searchIds('q=sauber')).toEqual([sauberProfile.id]);
      expect(await searchIds('remote=ja')).toEqual([web.id]);
      expect((await searchIds('verfuegbar=ja')).sort()).toEqual([web.id, maler.id, sauberProfile.id].sort());
      expect((await searchIds('preis_bis=50')).sort()).toEqual([maler.id]);
      expect(await searchIds('anbieter=gewerblich')).toEqual([sauberProfile.id]);
      expect((await searchIds('anbieter=privat')).length).toBe(3);

      // Graz: Malerin vor Ort (Einsatzradius 20 km) und österreichweite Reinigung; Wien liegt weit weg
      expect((await searchIds('plz=8010')).sort()).toEqual([maler.id, sauberProfile.id].sort());
      // Leibnitz liegt rund 33 km von Graz – außerhalb des Einsatzradius, nur mit größerem Umkreis
      const leibnitz = await locationId('8430', 'Leibnitz');
      expect(await searchIds(`ort=${leibnitz}`)).toEqual([sauberProfile.id]);
      expect((await searchIds(`ort=${leibnitz}&umkreis=50`)).sort()).toEqual([maler.id, sauberProfile.id].sort());
      // Remote-Profile ohne Ort erscheinen bei einer Ortssuche nur mit „remote“, dann unabhängig vom Ort
      expect(await searchIds('plz=1010&umkreis=10')).not.toContain(web.id);
      expect(await searchIds('plz=1010&umkreis=10&remote=ja')).toEqual([web.id]);
      const byDistance = await request(server()).get(`/v1/services?plz=1010&umkreis=200&sortierung=entfernung`).expect(200);
      expect(byDistance.body.items[0]).toMatchObject({ id: nachhilfe.id, distanceKm: 0 });
      expect(byDistance.body.location).toMatchObject({ postalCode: '1010' });

      const bad = await request(server()).get('/v1/services?kategorie=x&umkreis=7&preis_bis=abc&anbieter=egal').expect(400);
      expect((bad.body.errors as { path: string }[]).map((e) => e.path).sort()).toEqual(['anbieter', 'kategorie', 'preis_bis', 'umkreis'].sort());

      // Gesperrte Konten verschwinden aus der Suche
      await prisma.user.update({ where: { id: maler.account.id }, data: { status: 'SUSPENDED' } });
      expect(await searchIds('kategorie=maler')).toEqual([]);
    });

    it('liefert die Kategorien mit Hinweis auf reglementierte Tätigkeiten und Verweis auf die Kleinanzeigen', async () => {
      const categories = (await request(server()).get('/v1/services/categories').expect(200)).body as { slug: string; regulated: boolean; relatedCategoryPath: string | null }[];
      expect(categories.length).toBe(26);
      expect(categories.find((c) => c.slug === 'elektriker')).toMatchObject({ regulated: true, relatedCategoryPath: 'marktplatz/dienstleistungen/handwerk' });
      expect(categories.find((c) => c.slug === 'webentwicklung')).toMatchObject({ regulated: false });
    });
  });

  describe('Portfolio und Qualifikationen', () => {
    it('nimmt Bilder nur mit Angabe der Rechte an und blendet ausgeblendete Einträge öffentlich aus', async () => {
      const { account, id } = await provider();
      const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 20, g: 120, b: 200 } } }).png().toBuffer();

      // Profilbild
      await request(server()).put('/v1/media/service-profile').set(account.auth).set('Content-Type', 'image/png').send(png).expect(400);
      await request(server()).put('/v1/media/service-profile?rechte=LICENSED').set(account.auth).set('Content-Type', 'image/png').send(png).expect(400);
      const withImage = await request(server()).put('/v1/media/service-profile?rechte=OWN').set(account.auth).set('Content-Type', 'image/png').send(png).expect(200);
      expect(withImage.body.profile).toMatchObject({ imageRights: 'OWN' });
      const imageUrl = new URL(withImage.body.profile.imageUrl as string);
      await request(server()).get(imageUrl.pathname + imageUrl.search).expect(302);

      // Portfolio-Eintrag mit Bild
      const created = await request(server())
        .post('/v1/me/service-profile/portfolio')
        .set(account.auth)
        .send({ title: 'Webshop Bäckerei', description: 'Shop mit Abholung', categorySlug: 'webentwicklung', url: 'https://example.at/referenz' })
        .expect(201);
      const itemId = created.body.id as string;
      const stranger = await signIn(app);
      await request(server()).put(`/v1/media/service-portfolio/${itemId}?rechte=OWN`).set(stranger.auth).set('Content-Type', 'image/png').send(png).expect(404);
      const uploaded = await request(server())
        .put(`/v1/media/service-portfolio/${itemId}?rechte=CLIENT_PERMISSION`)
        .set(account.auth)
        .set('Content-Type', 'image/png')
        .send(png)
        .expect(200);
      const item = uploaded.body.profile.portfolio[0];
      expect(item).toMatchObject({ id: itemId, title: 'Webshop Bäckerei', imageRights: 'CLIENT_PERMISSION', hidden: false, category: { slug: 'webentwicklung' } });
      const itemUrl = new URL(item.imageUrl as string);
      await request(server()).get(itemUrl.pathname + itemUrl.search).expect(302);

      // Moderation blendet den Eintrag aus: öffentlich weg, Bild nur noch signiert, Inhaber:in sieht ihn markiert
      const moderator = await signInAs(app, 'MODERATOR');
      await request(server()).post(`/v1/admin/service-portfolio/${itemId}/decisions`).set(moderator.auth).send({ decision: 'HIDE', statement: STATEMENT }).expect(400);
      const hide = await request(server())
        .post(`/v1/admin/service-portfolio/${itemId}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'HIDE', reason: 'OTHER', ground: 'TERMS', statement: 'Das Bild stammt erkennbar nicht von dir und ist ohne Nutzungsrecht.' })
        .expect(201);
      expect(hide.body).toMatchObject({ action: 'PORTFOLIO_ITEM_HIDDEN', serviceProfile: { id }, canAppeal: true });
      expect((await request(server()).get(`/v1/services/${id}`).expect(200)).body.portfolio).toEqual([]);
      await request(server()).get(itemUrl.pathname).expect(404);
      const own = await request(server()).get('/v1/me/service-profile').set(account.auth).expect(200);
      expect(own.body.profile.portfolio[0]).toMatchObject({ id: itemId, hidden: true });
      await drainJobs();
      expect((await prisma.notification.findMany({ where: { userId: account.id } })).map((n) => n.type)).toEqual(['PORTFOLIO_ITEM_HIDDEN']);

      // Einspruch mit Erfolg: Eintrag wieder sichtbar
      const admin = await signInAs(app, 'ADMIN');
      await request(server()).post(`/v1/me/decisions/${hide.body.id}/appeal`).set(account.auth).send({ body: 'Das Foto habe ich selbst beim Kunden gemacht, die Freigabe liegt vor.' }).expect(201);
      const appeal = await prisma.appeal.findFirstOrThrow({ where: { decisionId: hide.body.id } });
      await request(server()).post(`/v1/admin/appeals/${appeal.id}/decision`).set(admin.auth).send({ outcome: 'REVERSED', response: 'Die Freigabe des Kunden wurde nachgewiesen.' }).expect(201);
      expect((await request(server()).get(`/v1/services/${id}`).expect(200)).body.portfolio).toHaveLength(1);

      // Löschen entfernt den Eintrag
      await request(server()).delete(`/v1/me/service-profile/portfolio/${itemId}`).set(account.auth).expect(200);
      expect(await prisma.servicePortfolioItem.count()).toBe(0);
    });

    it('zeigt Qualifikationen erst nach Prüfung durch das Team als geprüft, Nachweisnummern nur dann öffentlich', async () => {
      const { account, id } = await provider({ categorySlugs: ['elektriker'] });
      for (let i = 0; i < 5; i++) {
        await request(server()).post('/v1/me/service-profile/qualifications').set(account.auth).send({ title: `Nachweis ${i + 1}`, issuer: 'WKO', reference: `GISA ${1000 + i}` }).expect(201);
      }
      await request(server()).post('/v1/me/service-profile/qualifications').set(account.auth).send({ title: 'Zu viel' }).expect(409);
      const [first, second] = await prisma.serviceQualification.findMany({ where: { profileId: id }, orderBy: { createdAt: 'asc' } });

      const before = await request(server()).get(`/v1/services/${id}`).expect(200);
      expect(before.body).toMatchObject({ hasVerifiedQualification: false, regulatedCategories: ['Elektriker'] });
      expect(before.body.qualifications[0]).toMatchObject({ status: 'CLAIMED', reference: null });

      const moderator = await signInAs(app, 'MODERATOR');
      await request(server()).post(`/v1/admin/service-qualifications/${first!.id}/review`).set(account.auth).send({ decision: 'VERIFY' }).expect(403);
      const list = await request(server()).get('/v1/admin/services?filter=qualifications').set(moderator.auth).expect(200);
      expect(list.body.items[0]).toMatchObject({ id, pendingQualifications: 5 });
      await request(server()).post(`/v1/admin/service-qualifications/${first!.id}/review`).set(moderator.auth).send({ decision: 'VERIFY', note: 'GISA-Eintrag abgeglichen' }).expect(201);
      await request(server()).post(`/v1/admin/service-qualifications/${first!.id}/review`).set(moderator.auth).send({ decision: 'VERIFY' }).expect(409);
      const detail = await request(server()).post(`/v1/admin/service-qualifications/${second!.id}/review`).set(moderator.auth).send({ decision: 'REJECT' }).expect(201);
      expect(detail.body.qualifications.slice(0, 2)).toMatchObject([
        { status: 'VERIFIED', reviewNote: 'GISA-Eintrag abgeglichen', reviewedBy: { id: moderator.id } },
        { status: 'REJECTED', reference: 'GISA 1001' },
      ]);

      const after = await request(server()).get(`/v1/services/${id}`).expect(200);
      expect(after.body.hasVerifiedQualification).toBe(true);
      expect(after.body.qualifications).toHaveLength(4);
      expect(after.body.qualifications[0]).toMatchObject({ status: 'VERIFIED', reference: 'GISA 1000' });
      await drainJobs();
      expect(await prisma.notification.count({ where: { userId: account.id, type: 'QUALIFICATION_REVIEWED' } })).toBe(2);
      const audit = await prisma.auditLog.findMany({ where: { action: { in: ['admin.qualification_verified', 'admin.qualification_rejected'] } } });
      expect(audit).toHaveLength(2);
    });
  });

  describe('Kontakt, Meldung und Moderation', () => {
    it('schreibt Anbieter:innen über die bestehenden Nachrichten an, mit Blockieren und ohne Selbstkontakt', async () => {
      const { account: owner, id } = await provider();
      const client = await signIn(app, { metadata: { display_name: 'Kundin Kim' } });
      await request(server()).post(`/v1/services/${id}/conversations`).set(owner.auth).send({ body: 'Hallo ich selbst' }).expect(400);
      const started = await request(server()).post(`/v1/services/${id}/conversations`).set(client.auth).send({ body: 'Können Sie meinen Webshop übernehmen?', clientId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b' }).expect(201);
      const again = await request(server()).post(`/v1/services/${id}/conversations`).set(client.auth).send({ body: 'Können Sie meinen Webshop übernehmen?', clientId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b' }).expect(201);
      expect(again.body).toEqual(started.body);

      const detail = await request(server()).get(`/v1/services/${id}`).set(client.auth).expect(200);
      expect(detail.body.conversationId).toBe(started.body.conversationId);
      const conversations = await request(server()).get('/v1/conversations').set(owner.auth).expect(200);
      expect(conversations.body.items[0]).toMatchObject({
        id: started.body.conversationId,
        role: 'seller',
        listing: null,
        subject: { kind: 'service', id, title: 'Webentwicklung für kleine Betriebe', available: true, href: `/dienstleistungen/${id}` },
      });
      const found = await request(server()).get('/v1/conversations?q=kleine%20Betriebe').set(client.auth).expect(200);
      expect(found.body.total).toBe(1);

      await drainJobs();
      await request(server()).post(`/v1/users/${client.id}/block`).set(owner.auth).expect(204);
      await request(server()).post(`/v1/services/${id}/conversations`).set(client.auth).send({ body: 'Noch eine Frage' }).expect(403);
      await request(server()).delete(`/v1/users/${client.id}/block`).set(owner.auth).expect(204);

      // Pausiertes Profil kann nicht neu angeschrieben werden; die Unterhaltung bleibt erhalten
      await request(server()).post('/v1/me/service-profile/pause').set(owner.auth).expect(200);
      const other = await signIn(app);
      await request(server()).post(`/v1/services/${id}/conversations`).set(other.auth).send({ body: 'Hallo' }).expect(404);
      const kept = await request(server()).get(`/v1/conversations/${started.body.conversationId}`).set(client.auth).expect(200);
      expect(kept.body.subject).toMatchObject({ kind: 'service', available: false });
    });

    it('nimmt Meldungen an; die Moderation blendet aus, lehnt ab und gibt per Einspruch wieder frei', async () => {
      const { account: owner, id } = await provider();
      const reporter = await signIn(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const admin = await signInAs(app, 'ADMIN');
      const body = { reason: 'MISLEADING', details: 'Die angegebene Ausbildung gibt es so nicht.', goodFaith: true };
      await request(server()).post(`/v1/services/${id}/report`).set(owner.auth).send(body).expect(403);
      const report = await request(server()).post(`/v1/services/${id}/report`).set(reporter.auth).send(body).expect(201);
      await request(server()).post(`/v1/services/${id}/report`).set(reporter.auth).send(body).expect(409);

      const reports = await request(server()).get('/v1/admin/reports?target=SERVICE_PROFILE').set(moderator.auth).expect(200);
      expect(reports.body.items[0]).toMatchObject({ id: report.body.id, targetType: 'SERVICE_PROFILE', serviceProfile: { id, status: 'ACTIVE' } });
      const reviewList = await request(server()).get('/v1/admin/services').set(moderator.auth).expect(200);
      expect(reviewList.body.items[0]).toMatchObject({ id, openReports: 1 });

      // Ausblenden: Meldung bleibt in Prüfung, Profil unsichtbar
      let version = await adminVersion(moderator, id);
      await request(server()).post(`/v1/admin/services/${id}/decisions`).set(owner.auth).send({ decision: 'HIDE', reason: 'MISLEADING', ground: 'TERMS', statement: STATEMENT, version }).expect(403);
      await request(server()).post(`/v1/admin/services/${id}/decisions`).set(moderator.auth).send({ decision: 'HIDE', reason: 'MISLEADING', ground: 'TERMS', statement: STATEMENT, version }).expect(201);
      await request(server()).post(`/v1/admin/services/${id}/decisions`).set(moderator.auth).send({ decision: 'HIDE', reason: 'MISLEADING', ground: 'TERMS', statement: STATEMENT, version }).expect(409);
      expect(await searchIds()).toEqual([]);
      expect((await prisma.report.findUniqueOrThrow({ where: { id: report.body.id } })).status).toBe('IN_REVIEW');

      // Ablehnen: Meldung erledigt, Inhaber:in sieht die Begründung
      version = await adminVersion(moderator, id);
      const reject = await request(server())
        .post(`/v1/admin/services/${id}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'REJECT', reason: 'MISLEADING', ground: 'TERMS', statement: STATEMENT, version })
        .expect(201);
      expect(reject.body).toMatchObject({ action: 'SERVICE_PROFILE_REJECTED', serviceProfile: { id } });
      const own = await request(server()).get('/v1/me/service-profile').set(owner.auth).expect(200);
      expect(own.body.profile).toMatchObject({ status: 'REJECTED', moderation: { action: 'SERVICE_PROFILE_REJECTED', canResubmit: false } });
      await request(server()).post('/v1/me/service-profile/resubmit').set(owner.auth).expect(409);
      await drainJobs();
      const notes = await prisma.notification.findMany({ where: { userId: { in: [owner.id, reporter.id] } } });
      expect(notes.map((n) => n.type).sort()).toEqual(['REPORT_HANDLED', 'SERVICE_PROFILE_HIDDEN', 'SERVICE_PROFILE_REJECTED']);
      const handled = notes.find((n) => n.type === 'REPORT_HANDLED')!;
      expect(handled.body).toContain('das Anbieterprofil „Webentwicklung für kleine Betriebe“');

      // Einspruch stattgegeben: wieder sichtbar
      await request(server()).post(`/v1/me/decisions/${reject.body.id}/appeal`).set(owner.auth).send({ body: 'Mein Abschluss ist echt, das Zeugnis kann ich jederzeit vorlegen.' }).expect(201);
      const appeal = await prisma.appeal.findFirstOrThrow({ where: { decisionId: reject.body.id } });
      await request(server()).post(`/v1/admin/appeals/${appeal.id}/decision`).set(admin.auth).send({ outcome: 'REVERSED', response: 'Das Zeugnis wurde vorgelegt und ist echt.' }).expect(201);
      expect(await searchIds()).toEqual([id]);
      const decisions = await request(server()).get('/v1/me/decisions').set(owner.auth).expect(200);
      expect(decisions.body.map((d: { action: string }) => d.action)).toEqual(['SERVICE_PROFILE_RESTORED', 'SERVICE_PROFILE_REJECTED', 'SERVICE_PROFILE_HIDDEN']);
    });

    it('überarbeitete, abgelehnte Profile lassen sich erneut einreichen', async () => {
      const { account: owner, id } = await provider();
      const moderator = await signInAs(app, 'MODERATOR');
      const version = await adminVersion(moderator, id);
      await request(server()).post(`/v1/admin/services/${id}/decisions`).set(moderator.auth).send({ decision: 'REJECT', reason: 'SPAM', ground: 'TERMS', statement: STATEMENT, version }).expect(201);
      await request(server()).put('/v1/me/service-profile').set(owner.auth).send(profileBody({ headline: 'Webentwicklung – überarbeitet' })).expect(200);
      const resubmitted = await request(server()).post('/v1/me/service-profile/resubmit').set(owner.auth).expect(200);
      expect(resubmitted.body.profile).toMatchObject({ status: 'PENDING_REVIEW', reviewReason: expect.stringContaining('erneut eingereicht') });
      const current = await adminVersion(moderator, id);
      const restore = await request(server())
        .post(`/v1/admin/services/${id}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'RESTORE', statement: 'Die Angaben sind jetzt korrekt und belegt.', version: current })
        .expect(201);
      expect(restore.body.action).toBe('SERVICE_PROFILE_RESTORED');
      expect(await searchIds()).toEqual([id]);
    });

    it('sperrt Admin-Routen für normale Konten und ohne Anmeldung', async () => {
      const user = await signIn(app);
      const routes: [string, string][] = [
        ['get', '/v1/admin/services'],
        ['get', '/v1/admin/services/abcdefghijklmnopqrstuvwx'],
        ['post', '/v1/admin/services/abcdefghijklmnopqrstuvwx/decisions'],
        ['post', '/v1/admin/service-portfolio/abcdefghijklmnopqrstuvwx/decisions'],
        ['post', '/v1/admin/service-qualifications/abcdefghijklmnopqrstuvwx/review'],
      ];
      for (const [method, path] of routes) {
        await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method]!(path).expect(401);
        await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method]!(path).set(user.auth).expect(403);
      }
    });
  });

  describe('Datenschutz', () => {
    it('exportiert das Profil und entfernt es beim Löschen des Kontos', async () => {
      const { account, id } = await provider();
      await request(server()).post('/v1/me/service-profile/portfolio').set(account.auth).send({ title: 'Referenzprojekt' }).expect(201);
      const exported = await request(server()).get('/v1/me/export').set(account.auth).expect(200);
      expect(exported.body.serviceProfile).toMatchObject({ id, headline: 'Webentwicklung für kleine Betriebe', portfolio: [{ title: 'Referenzprojekt' }] });

      const client = await signIn(app);
      await request(server()).post(`/v1/services/${id}/conversations`).set(client.auth).send({ body: 'Anfrage' }).expect(201);
      const decision = await prisma.moderationDecision.create({ data: { action: 'SERVICE_PROFILE_HIDDEN', userId: account.id, serviceProfileId: id, statement: STATEMENT } });
      await prisma.user.update({ where: { id: account.id }, data: { status: 'DELETED', deletedAt: new Date() } });
      const { AccountDeletionService } = await import('../src/privacy/account-deletion.service.js');
      const deletions = app.get(AccountDeletionService) as unknown as { runStep(step: string, userId: string): Promise<void> };
      await deletions.runStep('images', account.id);
      await deletions.runStep('data', account.id);
      expect(await prisma.serviceProfile.count()).toBe(0);
      expect(await prisma.conversation.count()).toBe(0);
      expect((await prisma.moderationDecision.findUniqueOrThrow({ where: { id: decision.id } })).serviceProfileId).toBeNull();
    });
  });
});
