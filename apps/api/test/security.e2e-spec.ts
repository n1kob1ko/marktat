import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { resetEnvCache } from '../src/config/env.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { SupabaseAdminClient } from '../src/privacy/supabase-admin.client.js';
import { createTestApp, mfaToken, resetData, signIn, signInAs } from './helpers.js';

/**
 * Zwei-Faktor-Anmeldung: Die API prüft das Sicherheitsniveau aus dem Supabase-Token (aal, amr) selbst –
 * unabhängig davon, was die Web-App anzeigt.
 */
describe('Zwei-Faktor-Anmeldung und Bestätigung kritischer Aktionen', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const factors = new Map<string, { id: string; type: string; verified: boolean; friendlyName: string | null; createdAt: string }[]>();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    // Supabase-Admin-API ersetzen: Faktoren je Konto im Speicher
    const authAdmin = app.get(SupabaseAdminClient);
    vi.spyOn(authAdmin, 'listFactors').mockImplementation(async (userId) => factors.get(userId) ?? []);
    vi.spyOn(authAdmin, 'deleteFactor').mockImplementation(async (userId, factorId) => {
      factors.set(userId, (factors.get(userId) ?? []).filter((f) => f.id !== factorId));
    });
  });
  beforeEach(async () => {
    factors.clear();
    await resetData(prisma);
  });
  afterEach(() => {
    process.env.STAFF_MFA_REQUIRED = 'false';
    resetEnvCache();
  });
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const requireMfa = () => {
    process.env.STAFF_MFA_REQUIRED = 'true';
    resetEnvCache();
  };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('verlangt bei 2FA-Pflicht für den Admin-Bereich eine bestätigte Sitzung', async () => {
    requireMfa();
    const moderator = await signInAs(app, 'MODERATOR');
    const password = await mfaToken(moderator, null);
    const res = await request(server()).get('/v1/admin/reports').set(bearer(password.token)).expect(403);
    expect(res.body).toMatchObject({ code: 'MFA_REQUIRED' });
    expect(res.body.message).toMatch(/Zwei-Faktor/);

    const confirmed = await mfaToken(moderator, 60 * 60);
    await request(server()).get('/v1/admin/reports').set(bearer(confirmed.token)).expect(200);
  });

  it('meldet Sicherheitsniveau und Pflicht in /me – auch ohne 2FA erreichbar (sonst keine Einrichtung möglich)', async () => {
    requireMfa();
    const admin = await signInAs(app, 'ADMIN');
    const password = await mfaToken(admin, null);
    const me = await request(server()).get('/v1/me').set(bearer(password.token)).expect(200);
    expect(me.body.security).toEqual({ level: 'aal1', mfaRequired: true, stepUpMaxAgeMinutes: 10 });
    const user = await signIn(app);
    const plain = await request(server()).get('/v1/me').set(user.auth).expect(200);
    expect(plain.body.security.mfaRequired).toBe(false);
  });

  it('lässt normale Konten von der 2FA-Pflicht unberührt', async () => {
    requireMfa();
    const user = await signIn(app);
    await request(server()).get('/v1/me/favorites').set(user.auth).expect(200);
  });

  it('verlangt für kritische Aktionen einen frischen Code, für normale Moderation nicht', async () => {
    const admin = await signInAs(app, 'ADMIN');
    const target = await signIn(app);
    const old = await mfaToken(admin, 30 * 60);
    const role = await request(server()).put(`/v1/admin/users/${target.id}/role`).set(bearer(old.token)).send({ role: 'MODERATOR' }).expect(403);
    expect(role.body.code).toBe('STEP_UP_REQUIRED');
    const price = await request(server()).put('/v1/admin/billing/products/highlight').set(bearer(old.token)).send({}).expect(403);
    expect(price.body.code).toBe('STEP_UP_REQUIRED');
    // Lesen und normale Moderation gehen mit der bestätigten Sitzung
    await request(server()).get('/v1/admin/reports').set(bearer(old.token)).expect(200);

    const fresh = await mfaToken(admin, 30);
    await request(server()).put(`/v1/admin/users/${target.id}/role`).set(bearer(fresh.token)).send({ role: 'MODERATOR' }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe('MODERATOR');
  });

  it('erlaubt die Rückkehr zum kostenlosen Betrieb ohne Code, das Einschalten nicht', async () => {
    const admin = await signInAs(app, 'ADMIN');
    const old = await mfaToken(admin, 30 * 60);
    await request(server()).put('/v1/admin/billing/mode').set(bearer(old.token)).send({ mode: 'FREE' }).expect(200);
    const paid = await request(server()).put('/v1/admin/billing/mode').set(bearer(old.token)).send({ mode: 'PAID', confirmation: 'KOSTENPFLICHTIG' }).expect(403);
    expect(paid.body.code).toBe('STEP_UP_REQUIRED');
    const settings = await prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings.billingMode).toBe('FREE');
  });

  it('setzt die 2FA eines anderen Kontos zurück (Aussperr-Schutz) und protokolliert das', async () => {
    const admin = await signInAs(app, 'ADMIN');
    const moderator = await signInAs(app, 'MODERATOR');
    factors.set(moderator.id, [{ id: 'f1', type: 'totp', verified: true, friendlyName: 'Handy', createdAt: new Date().toISOString() }]);
    const fresh = await mfaToken(admin, 10);

    const list = await request(server()).get(`/v1/admin/users/${moderator.id}/mfa`).set(bearer(fresh.token)).expect(200);
    expect(list.body.factors).toEqual([expect.objectContaining({ friendlyName: 'Handy', type: 'totp' })]);
    expect(JSON.stringify(list.body)).not.toContain('f1');

    // Moderation darf das nicht, die eigene 2FA setzt man so nicht zurück
    const modToken = await mfaToken(moderator, 10);
    await request(server()).post(`/v1/admin/users/${admin.id}/mfa/reset`).set(bearer(modToken.token)).expect(403);
    await request(server()).post(`/v1/admin/users/${admin.id}/mfa/reset`).set(bearer(fresh.token)).expect(403);

    const reset = await request(server()).post(`/v1/admin/users/${moderator.id}/mfa/reset`).set(bearer(fresh.token)).expect(200);
    expect(reset.body).toEqual({ removedFactors: 1 });
    expect(factors.get(moderator.id)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const audit = await prisma.auditLog.findFirst({ where: { action: 'admin.mfa_reset', entityId: moderator.id } });
    expect(audit).toMatchObject({ actorId: admin.id, metadata: { removedFactors: 1 } });
  });

  it('protokolliert eigene 2FA-Änderungen mit dem Stand aus Supabase, nicht mit Angaben des Clients', async () => {
    const moderator = await signInAs(app, 'MODERATOR');
    factors.set(moderator.id, [
      { id: 'a', type: 'totp', verified: true, friendlyName: 'Handy', createdAt: new Date().toISOString() },
      { id: 'b', type: 'totp', verified: false, friendlyName: 'Abgebrochen', createdAt: new Date().toISOString() },
    ]);
    const token = await mfaToken(moderator, 5);
    const res = await request(server()).post('/v1/me/mfa/events').set(bearer(token.token)).send({ event: 'enrolled', verifiedFactors: 99 }).expect(200);
    expect(res.body).toEqual({ verifiedFactors: 1 });
    await request(server()).post('/v1/me/mfa/events').set(bearer(token.token)).send({ event: 'gelöscht' }).expect(400);
    const user = await signIn(app);
    await request(server()).post('/v1/me/mfa/events').set(user.auth).send({ event: 'enrolled' }).expect(403);
  });
});
