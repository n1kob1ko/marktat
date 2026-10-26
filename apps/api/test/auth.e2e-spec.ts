import type { NestExpressApplication } from '@nestjs/platform-express';
import { SignJWT } from 'jose';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, resetData, tokenFor } from './helpers.js';

describe('Authentifizierung und Profil', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  it('GET /v1/health ist öffentlich', async () => {
    await request(app.getHttpServer()).get('/v1/health').expect(200, { status: 'ok', database: 'ok' });
  });

  it('verlangt eine Anmeldung für /v1/me', async () => {
    const res = await request(app.getHttpServer()).get('/v1/me').expect(401);
    expect(res.body).toEqual({ statusCode: 401, message: 'Bitte melde dich an.' });
  });

  it('lehnt Tokens mit falscher Signatur ab', async () => {
    const forged = await new SignJWT({ role: 'authenticated', email: 'x@example.at' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('7c1f1a4e-1111-4111-8111-111111111111')
      .setAudience('authenticated')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('ein-ganz-anderes-secret-mit-genug-laenge-123'));
    await request(app.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('lehnt abgelaufene Tokens mit verständlicher Meldung ab', async () => {
    const expired = await new SignJWT({ role: 'authenticated', email: 'x@example.at' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('7c1f1a4e-1111-4111-8111-111111111111')
      .setAudience('authenticated')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!));
    const res = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    expect(res.body.message).toMatch(/abgelaufen/);
  });

  it('legt beim ersten Aufruf ein Profil an und übernimmt keine Rolle aus user_metadata', async () => {
    const user = await tokenFor({
      metadata: { display_name: 'Anna Huber', account_type: 'BUSINESS', company_name: 'Huber KG', role: 'ADMIN', terms_version: '2026-10' },
    });
    const res = await request(app.getHttpServer()).get('/v1/me').set(user.auth).expect(200);
    expect(res.body).toMatchObject({
      id: user.id,
      email: user.email,
      displayName: 'Anna Huber',
      accountType: 'BUSINESS',
      companyName: 'Huber KG',
      role: 'USER',
    });
    const audit = await prisma.auditLog.findFirst({ where: { actorId: user.id, action: 'user.created' } });
    expect(audit).not.toBeNull();
  });

  it('sperrt Zugriffe gesperrter Konten', async () => {
    const user = await tokenFor();
    await request(app.getHttpServer()).get('/v1/me').set(user.auth).expect(200);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    await request(app.getHttpServer()).get('/v1/me').set(user.auth).expect(403);
  });

  it('PATCH /v1/me validiert und speichert Profilfelder', async () => {
    const user = await tokenFor();
    await request(app.getHttpServer())
      .patch('/v1/me')
      .set(user.auth)
      .send({ displayName: 'X' })
      .expect(400);
    const res = await request(app.getHttpServer())
      .patch('/v1/me')
      .set(user.auth)
      .send({ displayName: 'Max Muster', bio: 'Hallo aus Graz', role: 'ADMIN' })
      .expect(200);
    expect(res.body).toMatchObject({ displayName: 'Max Muster', bio: 'Hallo aus Graz', role: 'USER' });
  });

  it('erlaubt Firmenangaben nur bei gewerblichen Konten', async () => {
    const user = await tokenFor();
    await request(app.getHttpServer())
      .patch('/v1/me')
      .set(user.auth)
      .send({ vatId: 'ATU12345678' })
      .expect(400);
  });

  it('zeigt öffentliche Profile ohne E-Mail-Adresse', async () => {
    const user = await tokenFor();
    await request(app.getHttpServer()).get('/v1/me').set(user.auth).expect(200);
    const res = await request(app.getHttpServer()).get(`/v1/users/${user.id}`).expect(200);
    expect(res.body.email).toBeUndefined();
    expect(res.body).toMatchObject({ id: user.id, activeListings: 0 });
  });
});
