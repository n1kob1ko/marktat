import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { vi } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service.js';
import { AccountDeletionService, DELETION_STEPS, MAX_DELETION_ATTEMPTS } from '../src/privacy/account-deletion.service.js';
import { RetentionService } from '../src/privacy/retention.service.js';
import { SupabaseAdminClient } from '../src/privacy/supabase-admin.client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type { SearchIndexService } from '../src/search/search-index.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/storage/storage.types.js';
import { createTestApp, drainJobs, indexedIds, publishListing, resetData, signIn, signInAs, tokenFor } from './helpers.js';

const PASSWORD = 'Sicheres-Passwort-2026';
const AUTH_URL = `${process.env.SUPABASE_URL ?? 'http://localhost:54321'}/auth/v1`;
const DAY_MS = 86_400_000;

/** Echtes Konto in Supabase Auth (lokaler GoTrue-Container), damit Passwortprüfung und Löschung echt laufen */
async function createAuthUser(email: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${AUTH_URL}/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: 'Lena Löschen' } }),
  });
  if (!res.ok) throw new Error(`GoTrue: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

async function authUserExists(id: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${AUTH_URL}/admin/users/${id}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  return res.status === 200;
}

describe('Datenschutz: Export und Kontolöschung', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let searchIndex: SearchIndexService;
  let storage: ObjectStorage;

  beforeAll(async () => {
    ({ app, prisma, searchIndex } = await createTestApp());
    storage = app.get<ObjectStorage>(OBJECT_STORAGE);
  });
  beforeEach(() => resetData(prisma));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  /** Konto mit echtem Auth-Konto, Inserat mit Bild, Unterhaltung, Merkliste, Suche, Meldung */
  async function richAccount() {
    const email = `loeschen-${randomUUID().slice(0, 8)}@example.at`;
    const id = await createAuthUser(email);
    const user = await signIn(app, { id, email, metadata: { display_name: 'Lena Löschen' } });
    const partner = await signIn(app, { metadata: { display_name: 'Paul Partner' } });
    const listing = await publishListing(app, user.auth, { title: 'Kinderwagen Bugaboo' });
    const otherListing = await publishListing(app, partner.auth, { title: 'Laufrad für Kinder' });
    // Bild direkt im (lokalen) Speicher anlegen
    const storageKey = `images/${listing.id}/bild1`;
    for (const variant of ['large', 'thumb']) await storage.put(`${storageKey}/${variant}.webp`, Buffer.from('bild'), 'image/webp');
    await prisma.listingImage.create({ data: { listingId: listing.id, status: 'READY', storageKey, declaredType: 'image/jpeg', declaredSize: 4, width: 10, height: 10 } });

    const conv = await request(server()).post(`/v1/listings/${otherListing.id}/conversations`).set(user.auth).send({ body: 'Ist das Laufrad noch da?' }).expect(201);
    await request(server()).post(`/v1/conversations/${conv.body.conversationId}/messages`).set(partner.auth).send({ body: 'Ja, meine Nummer ist 0664 1234567' }).expect(201);
    await request(server()).put(`/v1/me/favorites/${otherListing.id}`).set(user.auth).expect(204);
    await request(server()).put(`/v1/me/favorites/${listing.id}`).set(partner.auth).expect(204);
    await request(server()).post('/v1/me/searches').set(user.auth).send({ name: 'Kinderwagen', params: { q: 'kinderwagen' }, notify: true }).expect(201);
    await request(server())
      .post(`/v1/listings/${otherListing.id}/report`)
      .set(user.auth)
      .send({ reason: 'MISLEADING', details: 'Das Laufrad ist laut Foto beschädigt.', goodFaith: true })
      .expect(201);
    return { user, partner, listing, otherListing, conversationId: conv.body.conversationId as string, storageKey };
  }

  const deleteAccount = (auth: Record<string, string>, body: Record<string, unknown> = {}) =>
    request(server()).post('/v1/me/deletion').set(auth).send({ password: PASSWORD, confirmation: 'löschen', ...body });

  it('exportiert alle eigenen Daten, aber keine Nachrichten oder Kontaktdaten anderer', async () => {
    const { user, partner, listing } = await richAccount();
    const res = await request(server()).get('/v1/me/export').set(user.auth).expect(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="marktat-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    const data = res.body;
    expect(data.profile).toMatchObject({ id: user.id, email: user.email, displayName: 'Lena Löschen' });
    expect(data.settings).toEqual({ notifyMessagesByEmail: true, notifySearchesByEmail: true });
    expect(data.listings.map((l: { id: string }) => l.id)).toContain(listing.id);
    expect(data.favorites).toHaveLength(1);
    expect(data.savedSearches[0]).toMatchObject({ name: 'Kinderwagen', notify: true });
    expect(data.conversations[0]).toMatchObject({ myRole: 'Interessent', partner: 'Paul Partner', receivedMessages: 1 });
    expect(data.conversations[0].myMessages).toEqual([expect.objectContaining({ body: 'Ist das Laufrad noch da?' })]);
    expect(data.reportsMade[0]).toMatchObject({ reason: 'Irreführende Angaben' });
    expect(data.activity.length).toBeGreaterThan(0);
    const json = JSON.stringify(data);
    expect(json).not.toContain('0664 1234567');
    expect(json).not.toContain(partner.email);
    expect(json).not.toContain(partner.id);
    expect(await prisma.auditLog.count({ where: { action: 'privacy.export', actorId: user.id } })).toBe(1);
    await request(server()).get('/v1/me/export').expect(401);
  });

  it('löscht ein Konto vollständig: Auth, Inserate, Bilder, Suchindex, Nachrichten – nach erneuter Anmeldung', async () => {
    const { user, partner, listing, otherListing, conversationId, storageKey } = await richAccount();
    expect(await indexedIds(searchIndex)).toContain(listing.id);

    await deleteAccount(user.auth, { confirmation: 'ja' }).expect(400);
    await deleteAccount(user.auth, { password: 'falsch-falsch-1' }).expect(403);
    await deleteAccount(user.auth, { extra: true }).expect(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');

    const res = await deleteAccount(user.auth).expect(202);
    expect(['PENDING', 'COMPLETED']).toContain(res.body.status);
    await drainJobs();

    const deletion = await prisma.accountDeletion.findUniqueOrThrow({ where: { userId: user.id } });
    expect(deletion).toMatchObject({ status: 'COMPLETED', lastError: null });
    expect([...deletion.completedSteps].sort()).toEqual([...DELETION_STEPS].sort());
    expect(await authUserExists(user.id)).toBe(false);

    // Platzhalter ohne personenbezogene Daten
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ status: 'DELETED', displayName: 'Gelöschtes Konto', email: `geloescht-${user.id}@deleted.invalid`, bio: null, phone: null });
    // Inhalte weg
    expect(await prisma.listing.count({ where: { sellerId: user.id } })).toBe(0);
    expect(await prisma.conversation.count({ where: { id: conversationId } })).toBe(0);
    expect(await prisma.message.count({ where: { OR: [{ senderId: user.id }, { recipientId: user.id }] } })).toBe(0);
    expect(await prisma.favorite.count({ where: { OR: [{ userId: user.id }, { listingId: listing.id }] } })).toBe(0);
    expect(await prisma.savedSearch.count({ where: { userId: user.id } })).toBe(0);
    expect(await storage.head(`${storageKey}/large.webp`)).toBeNull();
    expect(await indexedIds(searchIndex)).not.toContain(listing.id);
    expect(await indexedIds(searchIndex)).toContain(otherListing.id);
    // Meldung bleibt für die Moderation, aber ohne Verweis auf die meldende Person
    const report = await prisma.report.findFirstOrThrow({ where: { listingId: otherListing.id } });
    expect(report.reporterId).toBeNull();
    // Das alte Token funktioniert nicht mehr, die Partnerin sieht die Unterhaltung nicht mehr
    await request(server()).get('/v1/me').set(user.auth).expect(403);
    const inbox = await request(server()).get('/v1/conversations').set(partner.auth).expect(200);
    expect(inbox.body.total).toBe(0);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: user.id, action: { startsWith: 'privacy.' } } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['privacy.deletion_requested', 'privacy.deletion_completed']));
  });

  it('begrenzt Passwortversuche und schützt das letzte Admin-Konto', async () => {
    const email = `admin-${randomUUID().slice(0, 8)}@example.at`;
    const id = await createAuthUser(email);
    const admin = await signInAs(app, 'ADMIN', { id, email });
    const conflict = await deleteAccount(admin.auth).expect(409);
    expect(conflict.body.message).toContain('letzte aktive Administratorkonto');
    for (let i = 0; i < 5; i++) await deleteAccount(admin.auth, { password: `falsch-${i}-passwort` }).expect(403);
    await deleteAccount(admin.auth).expect(429);
    // Aufräumen im lokalen GoTrue
    await app.get(SupabaseAdminClient).deleteUser(id);
  });

  it('markiert dauerhaft fehlschlagende Löschungen, ohne das Konto wieder zu öffnen, und lässt sie erneut starten', async () => {
    const email = `fehler-${randomUUID().slice(0, 8)}@example.at`;
    const id = await createAuthUser(email);
    const user = await signIn(app, { id, email });
    const listing = await publishListing(app, user.auth);
    const authAdmin = app.get(SupabaseAdminClient);
    const realDelete = authAdmin.deleteUser.bind(authAdmin);
    const spy = vi.spyOn(authAdmin, 'deleteUser').mockRejectedValue(new Error(`Supabase down für ${email}`));

    await deleteAccount(user.auth).expect(202);
    const deletions = app.get(AccountDeletionService);
    const { id: deletionId } = await prisma.accountDeletion.findUniqueOrThrow({ where: { userId: user.id } });
    for (let i = 0; i < MAX_DELETION_ATTEMPTS; i++) await deletions.process(deletionId).catch(() => undefined);
    await app.get(JobsService).clear();

    const failed = await prisma.accountDeletion.findUniqueOrThrow({ where: { id: deletionId } });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toContain('auth:');
    expect(failed.lastError).not.toContain(email);
    // Kein inkonsistenter Zustand: Konto bleibt gesperrt und unsichtbar
    await request(server()).get('/v1/me').set(user.auth).expect(403);
    await request(server()).get(`/v1/listings/${listing.id}`).expect(404);

    const admin = await signInAs(app, 'ADMIN');
    const dashboard = await request(server()).get('/v1/admin/dashboard').set(admin.auth).expect(200);
    expect(dashboard.body.system.deletions.failed).toBe(1);
    spy.mockImplementation(realDelete);
    await request(server()).post(`/v1/admin/deletions/${user.id}/retry`).set(admin.auth).expect(200);
    await drainJobs();
    expect((await prisma.accountDeletion.findUniqueOrThrow({ where: { id: deletionId } })).status).toBe('COMPLETED');
    expect(await authUserExists(user.id)).toBe(false);
  });

  it('löscht abgelaufene Daten nach den Fristen und behält wirksame Entscheidungen', async () => {
    const user = await signIn(app);
    const moderator = await signInAs(app, 'MODERATOR');
    const old = new Date(Date.now() - 800 * DAY_MS);
    await prisma.notification.create({ data: { userId: user.id, type: 'REPORT_HANDLED', title: 'Alt', body: 'Alt', readAt: old, createdAt: old } });
    await prisma.notification.create({ data: { userId: user.id, type: 'REPORT_HANDLED', title: 'Neu', body: 'Neu' } });
    await prisma.auditLog.create({ data: { action: 'user.profile_updated', actorId: user.id, createdAt: old } });
    await prisma.report.create({ data: { reporterId: user.id, reason: 'SPAM', status: 'DISMISSED', handledAt: old, createdAt: old } });
    // Wirksame Sperre bleibt, auch wenn sie alt ist
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    const inForce = await prisma.moderationDecision.create({ data: { action: 'ACCOUNT_SUSPENDED', userId: user.id, moderatorId: moderator.id, statement: 'Alte, noch wirksame Sperre.', createdAt: old } });
    const expired = await prisma.moderationDecision.create({ data: { action: 'LISTING_RESTORED', userId: user.id, moderatorId: moderator.id, statement: 'Alte Freigabe.', createdAt: old } });

    const result = await app.get(RetentionService).run();
    expect(result).toMatchObject({ notifications: 1, auditLogs: 1, reports: 1, decisions: 1 });
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.moderationDecision.findUnique({ where: { id: inForce.id } })).not.toBeNull();
    expect(await prisma.moderationDecision.findUnique({ where: { id: expired.id } })).toBeNull();
  });

  it('erlaubt gesperrten Konten Export und Löschung, aber keine fremden Löschaufträge', async () => {
    const user = await signIn(app);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    await request(server()).get('/v1/me/export').set(user.auth).expect(200);
    const stranger = await tokenFor();
    await request(server()).post(`/v1/admin/deletions/${user.id}/retry`).set(stranger.auth).expect(403);
  });
});
