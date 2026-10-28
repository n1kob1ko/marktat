import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PROJECT_MAX_CONTACTS, PROJECT_MAX_OPEN } from '@marktat/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, drainJobs, resetData, signIn, signInAs } from './helpers.js';

type Account = Awaited<ReturnType<typeof signIn>>;

const DAY_MS = 86_400_000;
const STATEMENT = 'Der Auftrag beschreibt ein Arbeitsverhältnis und keine selbstständige Leistung.';
const DESCRIPTION = 'Wir suchen jemanden, der unsere bestehende Vereinswebsite auf ein modernes System umzieht und uns kurz einschult.';

describe('Projektaufträge', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const searchIds = async (query = '') => ((await request(server()).get(`/v1/projects?${query}`).expect(200)).body.items as { id: string }[]).map((p) => p.id);

  async function locationId(postalCode: string, place: string) {
    return (await prisma.location.findFirstOrThrow({ where: { postalCode, place } })).id;
  }

  function projectBody(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Umzug unserer Vereinswebsite',
      description: DESCRIPTION,
      categorySlug: 'webentwicklung',
      remote: true,
      budgetType: 'FIXED',
      budgetCents: 80_000,
      timeframe: 'bis Ende Dezember',
      ...overrides,
    };
  }

  /** Veröffentlichter Auftrag eines (neuen) Kontos */
  async function project(overrides: Record<string, unknown> = {}, account?: Account) {
    const owner = account ?? (await signIn(app, { metadata: { display_name: 'Verein Sonnenschein' } }));
    const created = await request(server()).post('/v1/me/projects').set(owner.auth).send(projectBody(overrides)).expect(201);
    await request(server()).post(`/v1/me/projects/${created.body.id}/publish`).set(owner.auth).send({ confirmed: true }).expect(200);
    return { owner, id: created.body.id as string };
  }

  /** Konto mit veröffentlichtem Anbieterprofil – nur solche dürfen auf Aufträge antworten */
  async function provider(name = 'Webentwicklerin Wanda') {
    const account = await signIn(app, { metadata: { display_name: name } });
    await request(server())
      .put('/v1/me/service-profile')
      .set(account.auth)
      .send({
        headline: 'Webentwicklung für Vereine',
        summary: 'Websites für Vereine und kleine Betriebe.',
        description: 'Ich baue und betreue Websites für Vereine und kleine Betriebe in ganz Österreich, verständlich erklärt.',
        categorySlugs: ['webentwicklung'],
        skills: [],
        austriaWide: false,
        remote: true,
        priceType: 'ON_REQUEST',
        availability: 'AVAILABLE',
      })
      .expect(200);
    await request(server()).post('/v1/me/service-profile/publish').set(account.auth).send({ confirmed: true }).expect(200);
    return account;
  }

  async function adminVersion(moderator: Account, id: string) {
    return (await request(server()).get(`/v1/admin/projects/${id}`).set(moderator.auth).expect(200)).body.version as string;
  }

  describe('Eigene Aufträge', () => {
    it('legt einen Entwurf an, prüft die Angaben und veröffentlicht erst nach Bestätigung für 30 Tage', async () => {
      const owner = await signIn(app);
      await request(server()).post('/v1/me/projects').send(projectBody()).expect(401);
      const invalid = await request(server())
        .post('/v1/me/projects')
        .set(owner.auth)
        .send(projectBody({ title: 'Hi', description: 'zu kurz', remote: false, budgetType: 'HOURLY', budgetCents: null }))
        .expect(400);
      expect((invalid.body.errors as { path: string }[]).map((e) => e.path)).toEqual(expect.arrayContaining(['title', 'description', 'budgetCents', 'locationId']));
      await request(server()).post('/v1/me/projects').set(owner.auth).send(projectBody({ categorySlug: 'gibt-es-nicht' })).expect(400);

      const created = await request(server()).post('/v1/me/projects').set(owner.auth).send(projectBody({ budgetType: 'OPEN', budgetCents: 50_000 })).expect(201);
      expect(created.body).toMatchObject({ status: 'DRAFT', budgetType: 'OPEN', budgetCents: null, isOwner: true, contactCount: 0, publishedAt: null });
      const id = created.body.id as string;
      expect(await searchIds()).toEqual([]);
      const stranger = await signIn(app);
      await request(server()).get(`/v1/projects/${id}`).set(stranger.auth).expect(404);
      await request(server()).patch(`/v1/me/projects/${id}`).set(stranger.auth).send(projectBody()).expect(404);

      await request(server()).post(`/v1/me/projects/${id}/publish`).set(owner.auth).send({}).expect(400);
      const published = await request(server()).post(`/v1/me/projects/${id}/publish`).set(owner.auth).send({ confirmed: true }).expect(200);
      expect(published.body).toMatchObject({ status: 'ACTIVE', isPublic: true, expired: false });
      const runDays = (new Date(published.body.expiresAt).getTime() - Date.now()) / DAY_MS;
      expect(runDays).toBeGreaterThan(29.9);
      expect(runDays).toBeLessThanOrEqual(30);
      await request(server()).post(`/v1/me/projects/${id}/publish`).set(owner.auth).send({ confirmed: true }).expect(409);
      expect(await searchIds()).toEqual([id]);

      const visitor = await request(server()).get(`/v1/projects/${id}`).expect(200);
      expect(visitor.body).toMatchObject({ id, client: { name: 'Testperson', business: false }, isOwner: false, contact: null, moderation: null });
      expect((await prisma.serviceProject.findUniqueOrThrow({ where: { id } })).viewCount).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: { in: ['project.created', 'project.published'] }, entityId: id } })).toBe(2);
    });

    it('begrenzt gleichzeitig offene Aufträge; pausieren, fortsetzen, beenden und löschen', async () => {
      const owner = await signIn(app);
      const ids: string[] = [];
      for (let i = 0; i < PROJECT_MAX_OPEN; i++) ids.push((await project({ title: `Auftrag Nummer ${i + 1}` }, owner)).id);
      const extra = await request(server()).post('/v1/me/projects').set(owner.auth).send(projectBody({ title: 'Ein Auftrag zu viel' })).expect(201);
      const limit = await request(server()).post(`/v1/me/projects/${extra.body.id}/publish`).set(owner.auth).send({ confirmed: true }).expect(409);
      expect(limit.body.message).toContain(`${PROJECT_MAX_OPEN} offene Aufträge`);
      const mine = await request(server()).get('/v1/me/projects').set(owner.auth).expect(200);
      expect(mine.body).toMatchObject({ openCount: PROJECT_MAX_OPEN, maxOpen: PROJECT_MAX_OPEN });
      expect(mine.body.projects).toHaveLength(PROJECT_MAX_OPEN + 1);

      const [first, second] = ids as [string, string];
      await request(server()).post(`/v1/me/projects/${first}/resume`).set(owner.auth).expect(409);
      await request(server()).post(`/v1/me/projects/${first}/pause`).set(owner.auth).expect(200);
      expect(await searchIds()).not.toContain(first);
      await request(server()).get(`/v1/projects/${first}`).expect(404);
      await request(server()).post(`/v1/me/projects/${first}/resume`).set(owner.auth).expect(200);
      expect(await searchIds()).toContain(first);

      // Beenden gibt einen Platz frei; beendete Aufträge sind nicht mehr bearbeitbar
      const closed = await request(server()).post(`/v1/me/projects/${first}/close`).set(owner.auth).expect(200);
      expect(closed.body).toMatchObject({ status: 'CLOSED', isPublic: false });
      expect(closed.body.closedAt).not.toBeNull();
      await request(server()).patch(`/v1/me/projects/${first}`).set(owner.auth).send(projectBody()).expect(409);
      await request(server()).post(`/v1/me/projects/${first}/close`).set(owner.auth).expect(409);
      await request(server()).post(`/v1/me/projects/${extra.body.id}/publish`).set(owner.auth).send({ confirmed: true }).expect(200);

      await request(server()).delete(`/v1/me/projects/${second}`).set(owner.auth).expect(204);
      await request(server()).get(`/v1/me/projects/${second}`).set(owner.auth).expect(404);
      expect(await searchIds()).not.toContain(second);
      expect((await prisma.serviceProject.findUniqueOrThrow({ where: { id: second } })).status).toBe('DELETED');
    });

    it('verlängert erst in den letzten 7 Tagen; abgelaufene Aufträge verschwinden aus der Suche', async () => {
      const { owner, id } = await project();
      const early = await request(server()).post(`/v1/me/projects/${id}/extend`).set(owner.auth).expect(409);
      expect(early.body.message).toContain('letzten 7 Tagen');

      await prisma.serviceProject.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
      expect(await searchIds()).toEqual([]);
      await request(server()).get(`/v1/projects/${id}`).expect(404);
      const expired = await request(server()).get(`/v1/me/projects/${id}`).set(owner.auth).expect(200);
      expect(expired.body).toMatchObject({ status: 'ACTIVE', expired: true, isPublic: false });
      expect((await request(server()).get('/v1/me/projects').set(owner.auth).expect(200)).body.openCount).toBe(0);

      const extended = await request(server()).post(`/v1/me/projects/${id}/extend`).set(owner.auth).expect(200);
      expect(extended.body).toMatchObject({ expired: false, isPublic: true });
      expect(await searchIds()).toEqual([id]);
    });
  });

  describe('Suche', () => {
    it('filtert nach Begriff, Bereich, Kategorie, Ort mit Umkreis und remote', async () => {
      const graz = await locationId('8010', 'Graz');
      const wien = await locationId('1010', 'Wien');
      const web = await project();
      const maler = await project({ title: 'Stiegenhaus ausmalen', description: 'Unser Stiegenhaus im Altbau (drei Stockwerke) soll neu ausgemalt werden, Farbe stellen wir bei.', categorySlug: 'maler', remote: false, locationId: graz, budgetType: 'OPEN' });
      const nachhilfe = await project({ title: 'Mathe-Nachhilfe für die Matura', description: 'Mein Sohn braucht bis zur Matura im Mai wöchentlich Nachhilfe in Mathematik, gerne bei uns zu Hause.', categorySlug: 'nachhilfe', remote: false, locationId: wien, budgetType: 'HOURLY', budgetCents: 3_500 });

      expect((await searchIds()).sort()).toEqual([web.id, maler.id, nachhilfe.id].sort());
      expect(await searchIds('q=stiegenhaus')).toEqual([maler.id]);
      expect(await searchIds('q=vereinswebsite%20modernes')).toEqual([web.id]);
      expect(await searchIds('bereich=haus-handwerk')).toEqual([maler.id]);
      expect(await searchIds('kategorie=nachhilfe')).toEqual([nachhilfe.id]);
      expect(await searchIds('remote=ja')).toEqual([web.id]);
      expect(await searchIds('plz=8010')).toEqual([maler.id]);
      const leibnitz = await locationId('8430', 'Leibnitz');
      expect(await searchIds(`ort=${leibnitz}`)).toEqual([]);
      expect(await searchIds(`ort=${leibnitz}&umkreis=50`)).toEqual([maler.id]);
      // Mit „remote“ schränkt der Ort nicht ein
      expect(await searchIds('plz=8010&remote=ja')).toEqual([web.id]);

      const byDistance = await request(server()).get('/v1/projects?plz=1010&umkreis=200&sortierung=entfernung').expect(200);
      expect(byDistance.body.items[0]).toMatchObject({ id: nachhilfe.id, distanceKm: 0, budgetType: 'HOURLY', budgetCents: 3_500 });
      expect(byDistance.body.location).toMatchObject({ postalCode: '1010' });

      const bad = await request(server()).get('/v1/projects?kategorie=x&umkreis=7').expect(400);
      expect((bad.body.errors as { path: string }[]).map((e) => e.path).sort()).toEqual(['kategorie', 'umkreis']);

      await prisma.user.update({ where: { id: maler.owner.id }, data: { status: 'SUSPENDED' } });
      expect(await searchIds('kategorie=maler')).toEqual([]);
    });
  });

  describe('Antworten über die Nachrichten', () => {
    it('lässt nur Anbieter:innen mit sichtbarem Profil antworten, ohne Selbstkontakt und mit Blockieren', async () => {
      const { owner, id } = await project();
      const noProfile = await signIn(app);
      const detailWithout = await request(server()).get(`/v1/projects/${id}`).set(noProfile.auth).expect(200);
      expect(detailWithout.body.contact).toMatchObject({ allowed: false, reason: expect.stringContaining('Anbieterprofil') });
      await request(server()).post(`/v1/projects/${id}/conversations`).set(noProfile.auth).send({ body: 'Ich kann das!' }).expect(403);
      await request(server()).post(`/v1/projects/${id}/conversations`).send({ body: 'Ich kann das!' }).expect(401);
      await request(server()).post(`/v1/projects/${id}/conversations`).set(owner.auth).send({ body: 'Ich selbst' }).expect(400);

      const wanda = await provider();
      expect((await request(server()).get(`/v1/projects/${id}`).set(wanda.auth).expect(200)).body.contact).toEqual({ allowed: true, reason: null });
      const clientId = randomUUID();
      const started = await request(server()).post(`/v1/projects/${id}/conversations`).set(wanda.auth).send({ body: 'Gerne übernehme ich den Umzug, wann passt ein Telefonat?', clientId }).expect(201);
      const again = await request(server()).post(`/v1/projects/${id}/conversations`).set(wanda.auth).send({ body: 'Gerne übernehme ich den Umzug, wann passt ein Telefonat?', clientId }).expect(201);
      expect(again.body).toEqual(started.body);
      expect((await request(server()).get(`/v1/projects/${id}`).set(wanda.auth).expect(200)).body.conversationId).toBe(started.body.conversationId);

      const inbox = await request(server()).get('/v1/conversations').set(owner.auth).expect(200);
      expect(inbox.body.items[0]).toMatchObject({
        id: started.body.conversationId,
        listing: null,
        subject: { kind: 'project', id, title: 'Umzug unserer Vereinswebsite', available: true, href: `/dienstleistungen/projekte/${id}` },
      });
      expect((await request(server()).get('/v1/conversations?q=Vereinswebsite').set(wanda.auth).expect(200)).body.total).toBe(1);
      expect((await request(server()).get('/v1/me/projects').set(owner.auth).expect(200)).body.projects[0]).toMatchObject({ id, contactCount: 1 });
      await drainJobs();

      // Blockieren verhindert weitere Nachrichten
      await request(server()).post(`/v1/users/${wanda.id}/block`).set(owner.auth).expect(204);
      await request(server()).post(`/v1/projects/${id}/conversations`).set(wanda.auth).send({ body: 'Noch eine Frage' }).expect(403);
      await request(server()).delete(`/v1/users/${wanda.id}/block`).set(owner.auth).expect(204);

      // Beendet: keine neuen Anfragen, die Unterhaltung bleibt
      await request(server()).post(`/v1/me/projects/${id}/close`).set(owner.auth).expect(200);
      const late = await provider('Spät Dran');
      await request(server()).post(`/v1/projects/${id}/conversations`).set(late.auth).send({ body: 'Hallo' }).expect(404);
      const kept = await request(server()).get(`/v1/conversations/${started.body.conversationId}`).set(wanda.auth).expect(200);
      expect(kept.body.subject).toMatchObject({ kind: 'project', available: false });
    });

    it(`nimmt höchstens ${PROJECT_MAX_CONTACTS} Anfragen je Auftrag an`, async () => {
      const { owner, id } = await project();
      const users = Array.from({ length: PROJECT_MAX_CONTACTS }, (_, i) => ({ id: randomUUID(), email: `anbieter-${i}@example.at`, displayName: `Anbieter ${i}` }));
      await prisma.user.createMany({ data: users });
      await prisma.conversation.createMany({ data: users.map((u) => ({ projectId: id, buyerId: u.id, sellerId: owner.id })) });

      const wanda = await provider();
      const detail = await request(server()).get(`/v1/projects/${id}`).set(wanda.auth).expect(200);
      expect(detail.body).toMatchObject({ acceptsContacts: false, contact: { allowed: false, reason: expect.stringContaining('viele Anfragen') } });
      const full = await request(server()).post(`/v1/projects/${id}/conversations`).set(wanda.auth).send({ body: 'Ich hätte Zeit.' }).expect(409);
      expect(full.body.message).toContain('viele Anfragen');
      expect(await prisma.conversation.count({ where: { projectId: id } })).toBe(PROJECT_MAX_CONTACTS);
    });
  });

  describe('Meldung und Moderation', () => {
    it('nimmt Meldungen an; die Moderation blendet aus, lehnt ab und gibt per Einspruch wieder frei', async () => {
      const { owner, id } = await project();
      const reporter = await signIn(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const admin = await signInAs(app, 'ADMIN');
      const body = { reason: 'MISLEADING', details: 'Das ist eigentlich eine Stellenanzeige mit fixen Arbeitszeiten.', goodFaith: true };
      await request(server()).post(`/v1/projects/${id}/report`).set(owner.auth).send(body).expect(403);
      const report = await request(server()).post(`/v1/projects/${id}/report`).set(reporter.auth).send(body).expect(201);
      await request(server()).post(`/v1/projects/${id}/report`).set(reporter.auth).send(body).expect(409);

      const reports = await request(server()).get('/v1/admin/reports?target=PROJECT').set(moderator.auth).expect(200);
      expect(reports.body.items[0]).toMatchObject({ id: report.body.id, targetType: 'PROJECT', project: { id, status: 'ACTIVE' } });
      const reviewList = await request(server()).get('/v1/admin/projects').set(moderator.auth).expect(200);
      expect(reviewList.body.items[0]).toMatchObject({ id, openReports: 1, contactCount: 0 });
      const detail = await request(server()).get(`/v1/admin/projects/${id}`).set(moderator.auth).expect(200);
      expect(detail.body).toMatchObject({ project: { id }, client: { id: owner.id, email: null }, reports: [{ id: report.body.id }] });
      expect((await request(server()).get(`/v1/admin/projects/${id}`).set(admin.auth).expect(200)).body.client.email).toBe(owner.email);

      // Ausblenden: unsichtbar, Meldung bleibt in Prüfung
      let version = await adminVersion(moderator, id);
      await request(server()).post(`/v1/admin/projects/${id}/decisions`).set(owner.auth).send({ decision: 'HIDE', reason: 'MISLEADING', ground: 'TERMS', statement: STATEMENT, version }).expect(403);
      await request(server()).post(`/v1/admin/projects/${id}/decisions`).set(moderator.auth).send({ decision: 'HIDE', reason: 'MISLEADING', ground: 'TERMS', statement: STATEMENT, version }).expect(201);
      await request(server()).post(`/v1/admin/projects/${id}/decisions`).set(moderator.auth).send({ decision: 'HIDE', reason: 'MISLEADING', ground: 'TERMS', statement: STATEMENT, version }).expect(409);
      expect(await searchIds()).toEqual([]);
      expect((await prisma.report.findUniqueOrThrow({ where: { id: report.body.id } })).status).toBe('IN_REVIEW');

      // Ablehnen: Meldung erledigt, Auftraggeber:in sieht die Begründung
      version = await adminVersion(moderator, id);
      const reject = await request(server())
        .post(`/v1/admin/projects/${id}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'REJECT', reason: 'MISLEADING', ground: 'TERMS', statement: STATEMENT, version })
        .expect(201);
      expect(reject.body).toMatchObject({ action: 'PROJECT_REJECTED', project: { id, title: 'Umzug unserer Vereinswebsite' } });
      const own = await request(server()).get(`/v1/me/projects/${id}`).set(owner.auth).expect(200);
      expect(own.body).toMatchObject({ status: 'REJECTED', moderation: { action: 'PROJECT_REJECTED' } });
      await request(server()).post(`/v1/me/projects/${id}/resubmit`).set(owner.auth).expect(409);
      await drainJobs();
      const notes = await prisma.notification.findMany({ where: { userId: { in: [owner.id, reporter.id] } } });
      expect(notes.map((n) => n.type).sort()).toEqual(['PROJECT_HIDDEN', 'PROJECT_REJECTED', 'REPORT_HANDLED']);
      expect(notes.find((n) => n.type === 'REPORT_HANDLED')!.body).toContain('den Projektauftrag „Umzug unserer Vereinswebsite“');

      // Einspruch stattgegeben: wieder sichtbar
      await request(server()).post(`/v1/me/decisions/${reject.body.id}/appeal`).set(owner.auth).send({ body: 'Es geht um ein einmaliges Projekt, Arbeitszeiten gibt es keine.' }).expect(201);
      const appeal = await prisma.appeal.findFirstOrThrow({ where: { decisionId: reject.body.id } });
      await request(server()).post(`/v1/admin/appeals/${appeal.id}/decision`).set(admin.auth).send({ outcome: 'REVERSED', response: 'Es handelt sich um ein einmaliges Vorhaben.' }).expect(201);
      expect(await searchIds()).toEqual([id]);
      const decisions = await request(server()).get('/v1/me/decisions').set(owner.auth).expect(200);
      expect(decisions.body.map((d: { action: string }) => d.action)).toEqual(['PROJECT_RESTORED', 'PROJECT_REJECTED', 'PROJECT_HIDDEN']);
    });

    it('überarbeitete, abgelehnte Aufträge lassen sich erneut einreichen und freigeben', async () => {
      const { owner, id } = await project();
      const moderator = await signInAs(app, 'MODERATOR');
      const version = await adminVersion(moderator, id);
      await request(server()).post(`/v1/admin/projects/${id}/decisions`).set(moderator.auth).send({ decision: 'REJECT', reason: 'SPAM', ground: 'TERMS', statement: STATEMENT, version }).expect(201);
      await request(server()).patch(`/v1/me/projects/${id}`).set(owner.auth).send(projectBody({ title: 'Umzug der Vereinswebsite – überarbeitet' })).expect(200);
      const resubmitted = await request(server()).post(`/v1/me/projects/${id}/resubmit`).set(owner.auth).expect(200);
      expect(resubmitted.body).toMatchObject({ status: 'PENDING_REVIEW', reviewReason: expect.stringContaining('erneut eingereicht') });
      const pending = await request(server()).get('/v1/admin/projects').set(moderator.auth).expect(200);
      expect(pending.body.items.map((p: { id: string }) => p.id)).toEqual([id]);

      const current = await adminVersion(moderator, id);
      const restore = await request(server())
        .post(`/v1/admin/projects/${id}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'RESTORE', statement: 'Der Auftrag beschreibt jetzt ein einmaliges Vorhaben.', version: current })
        .expect(201);
      expect(restore.body.action).toBe('PROJECT_RESTORED');
      expect(await searchIds()).toEqual([id]);
    });

    it('sperrt Admin-Routen für normale Konten und ohne Anmeldung', async () => {
      const user = await signIn(app);
      const routes: [string, string][] = [
        ['get', '/v1/admin/projects'],
        ['get', '/v1/admin/projects/abcdefghijklmnopqrstuvwx'],
        ['post', '/v1/admin/projects/abcdefghijklmnopqrstuvwx/decisions'],
      ];
      for (const [method, path] of routes) {
        await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method]!(path).expect(401);
        await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method]!(path).set(user.auth).expect(403);
      }
    });
  });

  describe('Datenschutz', () => {
    it('exportiert Aufträge und entfernt sie samt Unterhaltungen beim Löschen des Kontos', async () => {
      const { owner, id } = await project();
      const exported = await request(server()).get('/v1/me/export').set(owner.auth).expect(200);
      expect(exported.body.projects).toMatchObject([{ id, title: 'Umzug unserer Vereinswebsite', status: 'ACTIVE' }]);

      const wanda = await provider();
      await request(server()).post(`/v1/projects/${id}/conversations`).set(wanda.auth).send({ body: 'Anfrage' }).expect(201);
      expect((await request(server()).get('/v1/me/export').set(wanda.auth).expect(200)).body.conversations[0].project).toEqual({ id, title: 'Umzug unserer Vereinswebsite' });
      const decision = await prisma.moderationDecision.create({ data: { action: 'PROJECT_HIDDEN', userId: owner.id, projectId: id, statement: STATEMENT } });
      await prisma.user.update({ where: { id: owner.id }, data: { status: 'DELETED', deletedAt: new Date() } });
      const { AccountDeletionService } = await import('../src/privacy/account-deletion.service.js');
      const deletions = app.get(AccountDeletionService) as unknown as { runStep(step: string, userId: string): Promise<void> };
      await deletions.runStep('images', owner.id);
      await deletions.runStep('data', owner.id);
      expect(await prisma.serviceProject.count()).toBe(0);
      expect(await prisma.conversation.count()).toBe(0);
      expect((await prisma.moderationDecision.findUniqueOrThrow({ where: { id: decision.id } })).projectId).toBeNull();
    });
  });
});
