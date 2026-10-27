import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { createTestApp, mailsTo, publishListing, resetData, signIn } from './helpers.js';

/**
 * Ausfall von Redis (Warteschlange, Echtzeit, Rate-Limit): Die Plattform bleibt benutzbar.
 * Früher hingen Start und Senden, bis Redis zurück war – Nutzer schickten erneut ab und erzeugten Doppelte.
 */
describe('Ausfallsicherheit ohne Redis', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    // Port ohne Dienst: Verbindungen schlagen sofort fehl, wie bei gestopptem Redis-Container
    ({ app, prisma } = await createTestApp({ env: { REDIS_URL: 'redis://127.0.0.1:6399' } }));
  }, 20_000);
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  it('meldet Redis als ausgefallen, bleibt aber bereit', async () => {
    const res = await request(server()).get('/v1/health/ready').expect(200);
    expect(res.body).toMatchObject({ status: 'degraded', checks: { database: 'ok', redis: 'down' } });
  });

  it('nimmt Inserate und Nachrichten schnell an und verschickt die E-Mail ersatzweise im Prozess', async () => {
    const seller = await signIn(app, { metadata: { display_name: 'Verena Verkauf' } });
    const buyer = await signIn(app);
    const listing = await publishListing(app, seller.auth);

    const started = Date.now();
    await request(server()).post(`/v1/listings/${listing.id}/conversations`).set(buyer.auth).send({ body: 'Noch zu haben?' }).expect(201);
    expect(Date.now() - started).toBeLessThan(5_000);

    await app.get(JobsService).drain();
    const mails = await mailsTo(seller.email);
    expect(mails).toHaveLength(1);
  });
});
