import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type { SearchIndexService } from '../src/search/search-index.service.js';
import { setRoleByEmail, RoleChangeError } from '../src/users/admin-role.js';
import { createTestApp, drainJobs, indexedIds, mailsTo, mailText, publishListing, resetData, signIn, signInAs, tokenFor } from './helpers.js';

type Account = Awaited<ReturnType<typeof signIn>>;

const STATEMENT = 'Die Anzeige verlangt Vorauskasse per Gutscheinkarte – das ist ein typisches Betrugsmuster.';

describe('Moderation und Admin-Bereich', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let searchIndex: SearchIndexService;

  beforeAll(async () => {
    ({ app, prisma, searchIndex } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  const report = (account: Account, listingId: string, body: Record<string, unknown> = {}) =>
    request(server())
      .post(`/v1/listings/${listingId}/report`)
      .set(account.auth)
      .send({ reason: 'FRAUD', details: 'Verlangt Vorauskasse per Gutschein.', goodFaith: true, ...body });

  async function listingVersion(moderator: Account, id: string) {
    return (await request(server()).get(`/v1/admin/listings/${id}`).set(moderator.auth).expect(200)).body.version as string;
  }

  async function decide(moderator: Account, id: string, body: Record<string, unknown>, expected = 201) {
    const version = await listingVersion(moderator, id);
    return request(server()).post(`/v1/admin/listings/${id}/decisions`).set(moderator.auth).send({ version, ...body }).expect(expected);
  }

  /** Verkäuferin mit Inserat, Meldung durch eine andere Person, eine Moderatorin */
  async function reportedListing() {
    const seller = await signIn(app, { metadata: { display_name: 'Sabine Seller' } });
    const reporter = await signIn(app, { metadata: { display_name: 'Rita Report' } });
    const moderator = await signInAs(app, 'MODERATOR', { metadata: { display_name: 'Moritz Moderation' } });
    const listing = await publishListing(app, seller.auth, { title: 'iPhone 15 Pro neu originalverpackt' });
    const res = await report(reporter, listing.id).expect(201);
    return { seller, reporter, moderator, listing, reportId: res.body.id as string };
  }

  describe('Rollen und Zugriff', () => {
    const adminRoutes: [string, string][] = [
      ['get', '/v1/admin/dashboard'],
      ['get', '/v1/admin/reports'],
      ['get', '/v1/admin/reports/abcdefghijklmnopqrstuvwx'],
      ['get', '/v1/admin/reports/abcdefghijklmnopqrstuvwx/messages'],
      ['patch', '/v1/admin/reports/abcdefghijklmnopqrstuvwx'],
      ['post', '/v1/admin/reports/abcdefghijklmnopqrstuvwx/dismiss'],
      ['get', '/v1/admin/listings'],
      ['get', '/v1/admin/listings/abcdefghijklmnopqrstuvwx'],
      ['post', '/v1/admin/listings/abcdefghijklmnopqrstuvwx/decisions'],
      ['get', '/v1/admin/users'],
      ['get', '/v1/admin/users/00000000-0000-4000-8000-000000000000'],
      ['post', '/v1/admin/users/00000000-0000-4000-8000-000000000000/decisions'],
      ['put', '/v1/admin/users/00000000-0000-4000-8000-000000000000/role'],
      ['put', '/v1/admin/users/00000000-0000-4000-8000-000000000000/reporting'],
      ['get', '/v1/admin/appeals'],
      ['get', '/v1/admin/appeals/abcdefghijklmnopqrstuvwx'],
      ['post', '/v1/admin/appeals/abcdefghijklmnopqrstuvwx/decision'],
      ['get', '/v1/admin/audit'],
      ['post', '/v1/admin/deletions/00000000-0000-4000-8000-000000000000/retry'],
    ];
    const call = (method: string, path: string) => (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method]!(path);

    it('lässt ohne Anmeldung und als normales Konto nichts im Admin-Bereich zu', async () => {
      const user = await signIn(app);
      for (const [method, path] of adminRoutes) {
        await call(method, path).expect(401);
        await call(method, path).set(user.auth).send({}).expect(403);
      }
    });

    it('ignoriert Rollen aus dem Token (user_metadata, app_metadata) und aus dem Profil', async () => {
      const forged = await tokenFor({ metadata: { display_name: 'Mallory', role: 'ADMIN' } });
      await request(server()).get('/v1/me').set(forged.auth).expect(200);
      await request(server()).get('/v1/admin/dashboard').set(forged.auth).expect(403);
      await request(server()).patch('/v1/me').set(forged.auth).send({ role: 'ADMIN' }).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: forged.id } })).role).toBe('USER');
      await request(server()).get('/v1/admin/dashboard').set(forged.auth).expect(403);
    });

    it('beschränkt Moderation auf ihren Bereich und Admin-Funktionen auf Administratoren', async () => {
      const moderator = await signInAs(app, 'MODERATOR');
      const user = await signIn(app);
      await request(server()).get('/v1/admin/dashboard').set(moderator.auth).expect(200);
      await request(server()).get('/v1/admin/reports').set(moderator.auth).expect(200);
      await request(server()).get('/v1/admin/users').set(moderator.auth).expect(403);
      await request(server()).get('/v1/admin/audit').set(moderator.auth).expect(403);
      await request(server()).put(`/v1/admin/users/${user.id}/role`).set(moderator.auth).send({ role: 'MODERATOR' }).expect(403);
      const dashboard = await request(server()).get('/v1/admin/dashboard').set(moderator.auth).expect(200);
      expect(dashboard.body.system).toBeNull();
      // Konto im Überblick: ohne E-Mail-Adresse
      const detail = await request(server()).get(`/v1/admin/users/${user.id}`).set(moderator.auth).expect(200);
      expect(detail.body.email).toBeNull();
    });

    it('vergibt Moderationsrechte nur als Admin und ADMIN nie über die API', async () => {
      const admin = await signInAs(app, 'ADMIN');
      const otherAdmin = await signInAs(app, 'ADMIN');
      const user = await signIn(app);
      await request(server()).put(`/v1/admin/users/${user.id}/role`).set(admin.auth).send({ role: 'ADMIN' }).expect(400);
      await request(server()).put(`/v1/admin/users/${admin.id}/role`).set(admin.auth).send({ role: 'MODERATOR' }).expect(403);
      await request(server()).put(`/v1/admin/users/${otherAdmin.id}/role`).set(admin.auth).send({ role: 'USER' }).expect(403);
      const res = await request(server()).put(`/v1/admin/users/${user.id}/role`).set(admin.auth).send({ role: 'MODERATOR' }).expect(200);
      expect(res.body.role).toBe('MODERATOR');
      await request(server()).get('/v1/admin/reports').set(user.auth).expect(200);
      await request(server()).put(`/v1/admin/users/${user.id}/role`).set(admin.auth).send({ role: 'USER' }).expect(200);
      await request(server()).get('/v1/admin/reports').set(user.auth).expect(403);
      const audit = await prisma.auditLog.findMany({ where: { action: 'admin.role_changed', entityId: user.id } });
      expect(audit).toHaveLength(2);
    });

    it('richtet das erste Admin-Konto nur per Kommandozeile ein und schützt den letzten Admin', async () => {
      const first = await signIn(app, { email: 'gruenderin@example.at' });
      const result = await setRoleByEmail(prisma, 'Gruenderin@Example.at', 'ADMIN');
      expect(result).toMatchObject({ from: 'USER', to: 'ADMIN', changed: true });
      await request(server()).get('/v1/admin/users').set(first.auth).expect(200);
      await expect(setRoleByEmail(prisma, 'gruenderin@example.at', 'USER')).rejects.toThrow(RoleChangeError);
      await expect(setRoleByEmail(prisma, 'niemand@example.at', 'ADMIN')).rejects.toThrow('Kein Konto');
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.role_changed', entityId: first.id } });
      expect(audit.metadata).toMatchObject({ via: 'cli', to: 'ADMIN' });
    });
  });

  describe('Meldungen zu Inseraten', () => {
    it('nimmt begründete Meldungen an und verhindert Duplikate und Missbrauch', async () => {
      const seller = await signIn(app);
      const reporter = await signIn(app);
      const listing = await publishListing(app, seller.auth);
      await report(reporter, listing.id, { details: 'kurz' }).expect(400);
      await report(reporter, listing.id, { goodFaith: false }).expect(400);
      await report(reporter, listing.id, { reason: 'GIBTS_NICHT' }).expect(400);
      await report(reporter, listing.id, { status: 'RESOLVED' }).expect(400);
      await report(seller, listing.id).expect(403);
      await report(reporter, 'abcdefghijklmnopqrstuvwx').expect(404);
      await report(reporter, '../../admin').expect(404);

      const res = await report(reporter, listing.id).expect(201);
      const stored = await prisma.report.findUniqueOrThrow({ where: { id: res.body.id }, include: { events: true } });
      expect(stored).toMatchObject({ targetType: 'LISTING', listingId: listing.id, reportedId: seller.id, reporterId: reporter.id, status: 'OPEN', priority: 'HIGH' });
      expect(stored.events.map((e) => e.type)).toEqual(['CREATED']);
      const dup = await report(reporter, listing.id, { reason: 'SPAM', details: 'Nochmal dieselbe Anzeige gemeldet.' }).expect(409);
      expect(dup.body.message).toContain('bereits gemeldet');
      expect(await prisma.auditLog.count({ where: { action: 'listing.reported' } })).toBe(1);
    });

    it('sperrt Inserate nie automatisch, auch nicht nach vielen Meldungen', async () => {
      const seller = await signIn(app);
      const listing = await publishListing(app, seller.auth);
      for (let i = 0; i < 6; i++) await report(await signIn(app), listing.id).expect(201);
      await request(server()).get(`/v1/listings/${listing.id}`).expect(200);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('ACTIVE');
      expect(await indexedIds(searchIndex)).toContain(listing.id);
      const moderator = await signInAs(app, 'MODERATOR');
      const queue = await request(server()).get('/v1/admin/reports').set(moderator.auth).expect(200);
      expect(queue.body.total).toBe(6);
      expect(queue.body.items[0].relatedOpen).toBe(5);
    });

    it('nimmt bei eingeschränkter Meldefunktion keine Meldungen an', async () => {
      const seller = await signIn(app);
      const reporter = await signIn(app);
      const admin = await signInAs(app, 'ADMIN');
      const listing = await publishListing(app, seller.auth);
      await request(server()).put(`/v1/admin/users/${reporter.id}/reporting`).set(admin.auth).send({ days: 30 }).expect(200);
      await report(reporter, listing.id).expect(403);
      await request(server()).put(`/v1/admin/users/${reporter.id}/reporting`).set(admin.auth).send({ days: 0 }).expect(200);
      await report(reporter, listing.id).expect(201);
    });
  });

  describe('Moderation von Inseraten', () => {
    it('deaktiviert ein gemeldetes Inserat mit Begründung, entfernt es aus der Suche und informiert alle', async () => {
      const { seller, reporter, moderator, listing, reportId } = await reportedListing();
      expect(await indexedIds(searchIndex)).toContain(listing.id);

      const res = await decide(moderator, listing.id, { decision: 'REJECT', reason: 'FRAUD', ground: 'TERMS', statement: STATEMENT, internalNote: 'Gutscheinbetrug' });
      expect(res.body).toMatchObject({ action: 'LISTING_REJECTED', reason: 'FRAUD', statement: STATEMENT, internalNote: 'Gutscheinbetrug', moderator: { id: moderator.id } });

      // Nicht mehr öffentlich: Detailseite, Suche, Index
      await request(server()).get(`/v1/listings/${listing.id}`).expect(404);
      await request(server()).get(`/v1/listings/${listing.id}`).set(reporter.auth).expect(404);
      expect(await indexedIds(searchIndex)).not.toContain(listing.id);
      const search = await request(server()).get('/v1/listings').query({ q: 'iPhone' }).expect(200);
      expect(search.body.items.map((i: { id: string }) => i.id)).not.toContain(listing.id);

      // Meldung erledigt, mit Verlauf
      const detail = await request(server()).get(`/v1/admin/reports/${reportId}`).set(moderator.auth).expect(200);
      expect(detail.body).toMatchObject({ status: 'RESOLVED', decision: { id: res.body.id }, handledBy: { id: moderator.id } });
      expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'STATUS_CHANGED']);

      // Eigentümerin sieht Status und Begründung (ohne interne Notiz und Namen der Moderation)
      const own = await request(server()).get(`/v1/listings/${listing.id}`).set(seller.auth).expect(200);
      expect(own.body).toMatchObject({ status: 'REJECTED', moderation: { action: 'LISTING_REJECTED', statement: STATEMENT, canResubmit: false } });
      const decisions = await request(server()).get('/v1/me/decisions').set(seller.auth).expect(200);
      expect(decisions.body[0]).toMatchObject({ id: res.body.id, canAppeal: true, listing: { id: listing.id } });
      expect(decisions.body[0]).not.toHaveProperty('internalNote');
      expect(decisions.body[0]).not.toHaveProperty('moderator');

      // Mitteilungen und E-Mails an Betroffene und Meldende
      await drainJobs();
      const sellerNotes = await request(server()).get('/v1/me/notifications').set(seller.auth).expect(200);
      expect(sellerNotes.body).toMatchObject({ unread: 1, items: [{ type: 'LISTING_REJECTED', link: `/konto/entscheidungen/${res.body.id}` }] });
      const reporterNotes = await request(server()).get('/v1/me/notifications').set(reporter.auth).expect(200);
      expect(reporterNotes.body.items[0]).toMatchObject({ type: 'REPORT_HANDLED' });
      expect(reporterNotes.body.items[0].body).not.toContain('Sabine');
      const mails = await mailsTo(seller.email);
      expect(mails.map((m) => m.Subject)).toContain('Deine Anzeige wurde deaktiviert');
      const text = await mailText(mails.find((m) => m.Subject === 'Deine Anzeige wurde deaktiviert')!.ID);
      expect(text).toContain(STATEMENT);
      expect(text).toContain('Einspruch');
      expect(text).not.toContain('Gutscheinbetrug');
      await request(server()).post('/v1/me/notifications/read').set(seller.auth).send({}).expect(200);
      expect((await request(server()).get('/v1/me/notifications').set(seller.auth).expect(200)).body.unread).toBe(0);
    });

    it('verhindert Entscheidungen auf veraltetem Stand und doppelte gleichzeitige Entscheidungen', async () => {
      const { seller, moderator, listing } = await reportedListing();
      const secondModerator = await signInAs(app, 'MODERATOR');
      const version = await listingVersion(moderator, listing.id);
      const body = { decision: 'REJECT', reason: 'FRAUD', ground: 'TERMS', statement: STATEMENT, version };
      const results = await Promise.all([
        request(server()).post(`/v1/admin/listings/${listing.id}/decisions`).set(moderator.auth).send(body),
        request(server()).post(`/v1/admin/listings/${listing.id}/decisions`).set(secondModerator.auth).send(body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.moderationDecision.count({ where: { listingId: listing.id } })).toBe(1);

      // Eigentümerin ändert das Inserat, während die Moderation noch die alte Fassung sieht
      const restoreVersion = await listingVersion(moderator, listing.id);
      await request(server()).patch(`/v1/listings/${listing.id}`).set(seller.auth).send({ title: 'iPhone 15 Pro – jetzt ehrlich beschrieben' }).expect(200);
      await request(server())
        .post(`/v1/admin/listings/${listing.id}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'RESTORE', statement: 'Nach Prüfung kein Verstoß mehr erkennbar, die Anzeige ist wieder online.', version: restoreVersion })
        .expect(409);
    });

    it('verlangt Grund und Rechtsgrundlage für Maßnahmen und lässt eigene Inserate nicht moderieren', async () => {
      const { moderator, listing } = await reportedListing();
      const version = await listingVersion(moderator, listing.id);
      const res = await request(server()).post(`/v1/admin/listings/${listing.id}/decisions`).set(moderator.auth).send({ decision: 'REJECT', statement: 'zu kurz', version }).expect(400);
      expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['ground', 'reason', 'statement']);
      const own = await publishListing(app, moderator.auth);
      await decide(moderator, own.id, { decision: 'REJECT', reason: 'SPAM', ground: 'TERMS', statement: STATEMENT }, 403);
    });

    it('blendet bis zur Prüfung aus und gibt danach wieder frei', async () => {
      const { reporter, moderator, listing, reportId } = await reportedListing();
      await decide(moderator, listing.id, { decision: 'HIDE', reason: 'FRAUD', ground: 'ILLEGAL', statement: 'Wir prüfen den Verdacht auf Betrug, bis dahin ist die Anzeige ausgeblendet.' });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('PENDING_REVIEW');
      expect(await indexedIds(searchIndex)).not.toContain(listing.id);
      expect((await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).status).toBe('IN_REVIEW');
      const review = await request(server()).get('/v1/admin/listings').set(moderator.auth).expect(200);
      expect(review.body.items.map((i: { id: string }) => i.id)).toContain(listing.id);

      await decide(moderator, listing.id, { decision: 'RESTORE', statement: 'Die Prüfung hat keinen Verstoß ergeben, die Anzeige ist wieder online.' });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('ACTIVE');
      expect(await indexedIds(searchIndex)).toContain(listing.id);
      expect((await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).status).toBe('DISMISSED');
      await drainJobs();
      const notes = await request(server()).get('/v1/me/notifications').set(reporter.auth).expect(200);
      expect(notes.body.items[0].body).toContain('keinen Verstoß');
    });

    it('lässt überarbeitete abgelehnte Inserate erneut prüfen', async () => {
      const { seller, moderator, listing } = await reportedListing();
      await decide(moderator, listing.id, { decision: 'REJECT', reason: 'MISLEADING', ground: 'TERMS', statement: 'Preis und Beschreibung passen nicht zusammen, bitte korrigieren.' });
      await request(server()).post(`/v1/listings/${listing.id}/resubmit`).set(seller.auth).expect(409);
      await request(server()).post(`/v1/listings/${listing.id}/publish`).set(seller.auth).expect(409);
      await request(server()).patch(`/v1/listings/${listing.id}`).set(seller.auth).send({ description: 'Gebrauchtes iPhone 15 Pro mit Kratzern, Preis verhandelbar.' }).expect(200);
      const own = await request(server()).get(`/v1/listings/${listing.id}`).set(seller.auth).expect(200);
      expect(own.body.moderation.canResubmit).toBe(true);
      const other = await signIn(app);
      await request(server()).post(`/v1/listings/${listing.id}/resubmit`).set(other.auth).expect(404);
      await request(server()).post(`/v1/listings/${listing.id}/resubmit`).set(seller.auth).expect(200);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('PENDING_REVIEW');
      await decide(moderator, listing.id, { decision: 'RESTORE', statement: 'Danke für die Korrektur, die Anzeige ist wieder freigegeben.' });
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('ACTIVE');
    });
  });

  describe('Einsprüche', () => {
    it('prüft Einsprüche durch eine andere Person und hebt die Maßnahme auf', async () => {
      const { seller, moderator, listing } = await reportedListing();
      const reviewer = await signInAs(app, 'MODERATOR');
      const decision = (await decide(moderator, listing.id, { decision: 'REJECT', reason: 'FRAUD', ground: 'TERMS', statement: STATEMENT })).body;

      await request(server()).post(`/v1/me/decisions/${decision.id}/appeal`).set(seller.auth).send({ body: 'zu kurz' }).expect(400);
      const stranger = await signIn(app);
      await request(server()).post(`/v1/me/decisions/${decision.id}/appeal`).set(stranger.auth).send({ body: 'Ich möchte fremde Entscheidungen anfechten.' }).expect(404);
      const appealed = await request(server())
        .post(`/v1/me/decisions/${decision.id}/appeal`)
        .set(seller.auth)
        .send({ body: 'Das Handy ist echt, ich habe die Rechnung und verlange keine Vorauskasse.' })
        .expect(201);
      expect(appealed.body).toMatchObject({ canAppeal: false, appeal: { status: 'OPEN' } });
      await request(server()).post(`/v1/me/decisions/${decision.id}/appeal`).set(seller.auth).send({ body: 'Noch ein Einspruch zur selben Entscheidung.' }).expect(409);

      const queue = await request(server()).get('/v1/admin/appeals').set(reviewer.auth).expect(200);
      expect(queue.body.total).toBe(1);
      const appealId = queue.body.items[0].id as string;
      const verdict = { outcome: 'REVERSED', response: 'Die Rechnung belegt die Echtheit, wir haben die Anzeige wieder freigegeben.' };
      // Wer entschieden hat, prüft den Einspruch nicht selbst
      await request(server()).post(`/v1/admin/appeals/${appealId}/decision`).set(moderator.auth).send(verdict).expect(403);
      await request(server()).post(`/v1/admin/appeals/${appealId}/decision`).set(reviewer.auth).send(verdict).expect(201);
      await request(server()).post(`/v1/admin/appeals/${appealId}/decision`).set(reviewer.auth).send(verdict).expect(409);

      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('ACTIVE');
      expect(await indexedIds(searchIndex)).toContain(listing.id);
      const mine = await request(server()).get(`/v1/me/decisions/${decision.id}`).set(seller.auth).expect(200);
      expect(mine.body).toMatchObject({ reversed: true, appeal: { status: 'REVERSED', response: verdict.response } });
      await drainJobs();
      const notes = await request(server()).get('/v1/me/notifications').set(seller.auth).expect(200);
      expect(notes.body.items.map((n: { type: string }) => n.type)).toEqual(['APPEAL_DECIDED', 'LISTING_REJECTED']);
    });
  });

  describe('Konten sperren', () => {
    it('sperrt ein Konto mit Begründung, blendet seine Inserate aus und lässt Einspruch zu', async () => {
      const moderator = await signInAs(app, 'MODERATOR');
      const admin = await signInAs(app, 'ADMIN');
      const target = await signIn(app);
      const listing = await publishListing(app, target.auth);
      expect(await indexedIds(searchIndex)).toContain(listing.id);

      const statement = 'Wiederholte Betrugsversuche über mehrere Anzeigen, belegt durch Meldungen.';
      const res = await request(server()).post(`/v1/admin/users/${target.id}/decisions`).set(moderator.auth).send({ decision: 'SUSPEND', reason: 'FRAUD', ground: 'TERMS', statement }).expect(201);
      expect(res.body.action).toBe('ACCOUNT_SUSPENDED');
      await request(server()).post(`/v1/admin/users/${target.id}/decisions`).set(moderator.auth).send({ decision: 'SUSPEND', reason: 'FRAUD', ground: 'TERMS', statement }).expect(409);

      await searchIndex.flush();
      expect(await indexedIds(searchIndex)).not.toContain(listing.id);
      await request(server()).get(`/v1/listings/${listing.id}`).expect(404);
      const me = await request(server()).get('/v1/me').set(target.auth).expect(200);
      expect(me.body).toMatchObject({ status: 'SUSPENDED', suspension: { decisionId: res.body.id, statement } });
      await request(server()).post('/v1/listings').set(target.auth).send({ title: 'Neue Anzeige' }).expect(403);
      await request(server()).post(`/v1/me/decisions/${res.body.id}/appeal`).set(target.auth).send({ body: 'Das war ein Missverständnis, bitte prüft das noch einmal.' }).expect(201);

      // Aufheben dürfen nur Administratoren
      const restore = { decision: 'RESTORE', statement: 'Die Sperre wird nach erneuter Prüfung aufgehoben.' };
      await request(server()).post(`/v1/admin/users/${target.id}/decisions`).set(moderator.auth).send(restore).expect(403);
      await request(server()).post(`/v1/admin/users/${target.id}/decisions`).set(admin.auth).send(restore).expect(201);
      await request(server()).get('/v1/listings/mine').set(target.auth).expect(200);
      expect(await indexedIds(searchIndex)).toContain(listing.id);
    });

    it('schützt Moderations- und Administratorkonten und den letzten Admin', async () => {
      const moderator = await signInAs(app, 'MODERATOR');
      const otherModerator = await signInAs(app, 'MODERATOR');
      const admin = await signInAs(app, 'ADMIN');
      const body = { decision: 'SUSPEND', reason: 'OTHER', ground: 'TERMS', statement: 'Test einer Sperre ohne ausreichende Berechtigung.' };
      await request(server()).post(`/v1/admin/users/${otherModerator.id}/decisions`).set(moderator.auth).send(body).expect(403);
      await request(server()).post(`/v1/admin/users/${admin.id}/decisions`).set(moderator.auth).send(body).expect(403);
      await request(server()).post(`/v1/admin/users/${moderator.id}/decisions`).set(moderator.auth).send(body).expect(403);
      await request(server()).post(`/v1/admin/users/${admin.id}/decisions`).set(admin.auth).send(body).expect(403);
      await request(server()).post(`/v1/admin/users/00000000-0000-4000-8000-000000000000/decisions`).set(admin.auth).send(body).expect(404);
      // Admins sperren sich nicht gleichzeitig gegenseitig aus
      const second = await signInAs(app, 'ADMIN');
      const results = await Promise.all([
        request(server()).post(`/v1/admin/users/${second.id}/decisions`).set(admin.auth).send(body),
        request(server()).post(`/v1/admin/users/${admin.id}/decisions`).set(second.auth).send(body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
      expect(await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
    });
  });

  describe('Private Nachrichten', () => {
    it('zeigt der Moderation nur gemeldete Unterhaltungen, nur während der Bearbeitung und protokolliert jede Einsicht', async () => {
      const seller = await signIn(app);
      const buyer = await signIn(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const listing = await publishListing(app, seller.auth);
      const conv = await request(server()).post(`/v1/listings/${listing.id}/conversations`).set(buyer.auth).send({ body: 'Zahl bitte vorab per Gutschein.' }).expect(201);
      const conversationId = conv.body.conversationId as string;

      // Kein pauschaler Zugriff: auch Staff sieht fremde Unterhaltungen nicht
      await request(server()).get(`/v1/conversations/${conversationId}`).set(moderator.auth).expect(404);
      await request(server()).get(`/v1/conversations/${conversationId}/messages`).set(moderator.auth).expect(404);

      const reportRes = await request(server()).post(`/v1/conversations/${conversationId}/report`).set(seller.auth).send({ reason: 'FRAUD' }).expect(201);
      await request(server()).post(`/v1/conversations/${conversationId}/messages`).set(buyer.auth).send({ body: 'Nach der Meldung geschrieben' }).expect(201);
      const reportId = reportRes.body.id as string;
      const detail = await request(server()).get(`/v1/admin/reports/${reportId}`).set(moderator.auth).expect(200);
      expect(detail.body).toMatchObject({ targetType: 'CONVERSATION', canViewMessages: true, reported: { id: buyer.id } });

      const messages = await request(server()).get(`/v1/admin/reports/${reportId}/messages`).set(moderator.auth).expect(200);
      expect(messages.body.messages).toEqual([expect.objectContaining({ author: 'reported', body: 'Zahl bitte vorab per Gutschein.' })]);
      expect(await prisma.auditLog.count({ where: { action: 'report.messages_viewed', actorId: moderator.id } })).toBe(1);
      const history = await request(server()).get(`/v1/admin/reports/${reportId}`).set(moderator.auth).expect(200);
      expect(history.body.events.at(-1)).toMatchObject({ type: 'NOTE', note: 'Nachrichten der Unterhaltung eingesehen', actor: { id: moderator.id } });

      await request(server()).post(`/v1/admin/reports/${reportId}/dismiss`).set(moderator.auth).send({ note: 'Kein Verstoß' }).expect(201);
      await request(server()).get(`/v1/admin/reports/${reportId}/messages`).set(moderator.auth).expect(403);
      await request(server()).post(`/v1/admin/reports/${reportId}/dismiss`).set(moderator.auth).send({}).expect(409);
    });
  });

  describe('Bearbeitung und Übersicht', () => {
    it('priorisiert, weist zu und markiert unbegründete Meldungen', async () => {
      const { moderator, reporter, reportId } = await reportedListing();
      const updated = await request(server()).patch(`/v1/admin/reports/${reportId}`).set(moderator.auth).send({ priority: 'URGENT', assign: 'me', note: 'Sehe ich mir an' }).expect(200);
      expect(updated.body).toMatchObject({ priority: 'URGENT', status: 'IN_REVIEW', assignee: { id: moderator.id } });
      expect(updated.body.events.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'PRIORITY_CHANGED', 'ASSIGNED', 'STATUS_CHANGED', 'NOTE']);
      const mine = await request(server()).get('/v1/admin/reports').query({ assignee: 'me', priority: 'URGENT' }).set(moderator.auth).expect(200);
      expect(mine.body.total).toBe(1);
      await request(server()).patch(`/v1/admin/reports/${reportId}`).set(moderator.auth).send({ priority: 'EGAL' }).expect(400);
      await request(server()).post(`/v1/admin/reports/${reportId}/dismiss`).set(moderator.auth).send({ abusive: true }).expect(201);
      const detail = await request(server()).get(`/v1/admin/reports/${reportId}`).set(moderator.auth).expect(200);
      expect(detail.body).toMatchObject({ status: 'DISMISSED', abusive: true, reporterStats: { total: 1, abusive: 1 } });
      expect(detail.body.reporter.id).toBe(reporter.id);
    });

    it('liefert Kennzahlen, Nutzersuche und Audit-Log für Administratoren', async () => {
      const { seller, listing } = await reportedListing();
      const admin = await signInAs(app, 'ADMIN');
      const dashboard = await request(server()).get('/v1/admin/dashboard').set(admin.auth).expect(200);
      expect(dashboard.body.moderation).toMatchObject({ listings: { active: 1 }, reports: { open: 1, urgent: 1, reportedListings: 1 }, appeals: { open: 0 } });
      expect(dashboard.body.system.users).toMatchObject({ total: 4, active: 4, suspended: 0, staff: 2, new7d: 4 });
      expect(dashboard.body.system.registrations).toHaveLength(14);
      expect(dashboard.body.system.jobs).toHaveProperty('failed');

      const found = await request(server()).get('/v1/admin/users').query({ q: seller.email.toUpperCase() }).set(admin.auth).expect(200);
      expect(found.body.items).toEqual([expect.objectContaining({ id: seller.id, email: seller.email, activeListings: 1, openReports: 1 })]);
      const detail = await request(server()).get(`/v1/admin/users/${seller.id}`).set(admin.auth).expect(200);
      expect(detail.body).toMatchObject({ email: seller.email, listings: [{ id: listing.id, openReports: 1 }], reportsReceived: [{ targetType: 'LISTING' }] });
      await request(server()).get('/v1/admin/users/kein-uuid').set(admin.auth).expect(404);

      const audit = await request(server()).get('/v1/admin/audit').query({ action: 'listing.' }).set(admin.auth).expect(200);
      expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['listing.reported', 'listing.published']));
      expect(audit.body.items.every((e: { action: string }) => e.action.startsWith('listing.'))).toBe(true);
    });
  });
});
