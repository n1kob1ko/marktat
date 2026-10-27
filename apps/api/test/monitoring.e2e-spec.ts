import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ListingsService } from '../src/listings/listings.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, resetData, signIn, signInAs } from './helpers.js';

describe('Systemzustand und Fehlerübersicht', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  it('meldet öffentlich nur den Zustand je Komponente, ohne Details', async () => {
    const res = await request(server()).get('/v1/health/ready').expect(200);
    expect(res.body.status).toMatch(/^(ok|degraded)$/);
    expect(res.body.checks.database).toBe('ok');
    expect(Object.keys(res.body.checks).sort()).toEqual(['auth', 'database', 'mail', 'redis', 'search']);
    expect(JSON.stringify(res.body)).not.toMatch(/latency|detail/i);
    await request(server()).get('/v1/health').expect(200, { status: 'ok', database: 'ok' });
  });

  it('setzt eine Anfrage-ID und übernimmt nur gültige IDs vom Aufrufer', async () => {
    const own = await request(server()).get('/v1/health').set('X-Request-Id', 'proxy-1234abcd').expect(200);
    expect(own.headers['x-request-id']).toBe('proxy-1234abcd');
    const invalid = await request(server()).get('/v1/health').set('X-Request-Id', '<script>').expect(200);
    expect(invalid.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fasst unerwartete Fehler datensparsam zusammen und zeigt sie nur Administratoren', async () => {
    const user = await signIn(app);
    vi.spyOn(app.get(ListingsService), 'findMine').mockRejectedValue(new Error(`Verbindung zu anna@example.at für Konto ${user.id} abgebrochen`));
    const first = await request(server()).get('/v1/listings/mine').set(user.auth).expect(500);
    expect(first.body).toEqual({ statusCode: 500, message: expect.stringContaining('unerwarteter Fehler'), requestId: first.headers['x-request-id'] });
    await request(server()).get('/v1/listings/mine').set(user.auth).expect(500);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const events = await prisma.errorEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'http', route: 'GET /v1/listings/mine', count: 2 });
    // Keine E-Mail-Adresse, keine Konto-ID
    expect(events[0]!.message).not.toContain('anna@example.at');
    expect(events[0]!.message).not.toContain(user.id);

    await request(server()).get('/v1/admin/system').set(user.auth).expect(403);
    const moderator = await signInAs(app, 'MODERATOR');
    await request(server()).get('/v1/admin/system').set(moderator.auth).expect(403);
    const admin = await signInAs(app, 'ADMIN');
    const system = await request(server()).get('/v1/admin/system').set(admin.auth).expect(200);
    expect(system.body.checks.database).toMatchObject({ status: 'ok', critical: true });
    expect(system.body.errors).toEqual([expect.objectContaining({ route: 'GET /v1/listings/mine', count: 2 })]);
    expect(system.body.process).toMatchObject({ environment: 'test' });

    await request(server()).delete(`/v1/admin/system/errors/${system.body.errors[0].id}`).set(admin.auth).expect(204);
    expect(await prisma.errorEvent.count()).toBe(0);
  });

  it('meldet eine ausgefallene Suche als eingeschränkt, nicht als Ausfall', async () => {
    const fallback = await createTestApp({ meiliUrl: 'http://127.0.0.1:9' });
    try {
      const res = await request(fallback.app.getHttpServer()).get('/v1/health/ready').expect(200);
      expect(res.body).toMatchObject({ status: 'degraded', checks: { search: 'down', database: 'ok' } });
    } finally {
      await fallback.app.close();
    }
  });
});
