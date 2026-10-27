import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, publishListing, resetData, signIn } from './helpers.js';

describe('Sitemap', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  it('enthält nur öffentlich sichtbare Inserate und Händler mit aktiven Inseraten', async () => {
    const privateSeller = await signIn(app);
    const dealer = await signIn(app, { metadata: { display_name: 'Rad Huber', account_type: 'BUSINESS', company_name: 'Rad Huber GmbH' } });
    const idleDealer = await signIn(app, { metadata: { display_name: 'Leer', account_type: 'BUSINESS', company_name: 'Leer GmbH' } });
    const active = await publishListing(app, privateSeller.auth);
    const dealerListing = await publishListing(app, dealer.auth, { title: 'Gravelbike 54 cm' });
    const expired = await publishListing(app, privateSeller.auth, { title: 'Altes Rad' });
    await prisma.listing.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const draft = await request(app.getHttpServer()).post('/v1/listings').set(privateSeller.auth).send({ publish: false, title: 'Entwurf Rad' }).expect(201);

    const res = await request(app.getHttpServer()).get('/v1/seo/sitemap').expect(200);
    const ids = res.body.listings.map((l: { id: string }) => l.id);
    expect(ids.sort()).toEqual([active.id, dealerListing.id].sort());
    expect(ids).not.toContain(draft.body.id);
    expect(res.body.dealers.map((d: { id: string }) => d.id)).toEqual([dealer.id]);
    expect(res.body.dealers).not.toContainEqual(expect.objectContaining({ id: idleDealer.id }));
    expect(res.body.categories).toContain('marktplatz/sport-freizeit/fahrraeder');
    expect(res.headers['cache-control']).toContain('max-age=900');
  });
});
