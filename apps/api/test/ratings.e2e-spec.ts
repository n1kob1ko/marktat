import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  drainJobs,
  mailsTo,
  publishListing,
  resetData,
  signIn,
  signInAs,
} from './helpers.js';

type Account = Awaited<ReturnType<typeof signIn>>;

const STATEMENT =
  'Die Bewertung enthält eine Beleidigung und verstößt damit gegen unsere Nutzungsbedingungen.';

describe('Bewertungen', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  /** Verkäuferin mit Inserat, Käufer schreibt; mit `reply` antwortet die Verkäuferin */
  async function conversation(options: { reply?: boolean } = {}) {
    const seller = await signIn(app, { metadata: { display_name: 'Verena Verkauf' } });
    const buyer = await signIn(app, { metadata: { display_name: 'Konrad Kauf' } });
    const listing = await publishListing(app, seller.auth);
    const res = await request(server())
      .post(`/v1/listings/${listing.id}/conversations`)
      .set(buyer.auth)
      .send({ body: 'Ist das Rad noch zu haben?' })
      .expect(201);
    const conversationId = res.body.conversationId as string;
    if (options.reply !== false) {
      await request(server())
        .post(`/v1/conversations/${conversationId}/messages`)
        .set(seller.auth)
        .send({ body: 'Ja, komm gerne vorbei.' })
        .expect(201);
    }
    return { seller, buyer, listing, conversationId };
  }

  const rate = (account: Account, conversationId: string, body: Record<string, unknown>) =>
    request(server())
      .put(`/v1/conversations/${conversationId}/rating`)
      .set(account.auth)
      .send(body);

  it('erlaubt Bewertungen erst, wenn beide geschrieben haben', async () => {
    const { seller, buyer, conversationId } = await conversation({ reply: false });
    const state = await request(server())
      .get(`/v1/conversations/${conversationId}/rating`)
      .set(buyer.auth)
      .expect(200);
    expect(state.body).toMatchObject({
      partner: { displayName: 'Verena Verkauf' },
      mine: null,
      theirs: null,
    });
    expect(state.body.blockedReason).toMatch(/sobald ihr beide/);
    expect(
      (
        await request(server())
          .get(`/v1/conversations/${conversationId}`)
          .set(buyer.auth)
          .expect(200)
      ).body.rating,
    ).toEqual({ canRate: false, myStars: null });
    await rate(buyer, conversationId, { stars: 5 }).expect(403);

    await request(server())
      .post(`/v1/conversations/${conversationId}/messages`)
      .set(seller.auth)
      .send({ body: 'Ja, ist noch da.' })
      .expect(201);
    expect(
      (
        await request(server())
          .get(`/v1/conversations/${conversationId}`)
          .set(buyer.auth)
          .expect(200)
      ).body.rating,
    ).toEqual({ canRate: true, myStars: null });

    // Fremde sehen die Unterhaltung nicht
    const stranger = await signIn(app);
    await request(server())
      .get(`/v1/conversations/${conversationId}/rating`)
      .set(stranger.auth)
      .expect(404);
    await rate(stranger, conversationId, { stars: 1 }).expect(404);
    await request(server()).get(`/v1/conversations/${conversationId}/rating`).expect(401);
  });

  it('bewertet, ändert, beantwortet und zeigt den Durchschnitt öffentlich', async () => {
    const { seller, buyer, listing, conversationId } = await conversation();
    await rate(buyer, conversationId, { stars: 0 }).expect(400);
    await rate(buyer, conversationId, { stars: 6 }).expect(400);
    await rate(buyer, conversationId, { stars: 4, comment: 'x'.repeat(501) }).expect(400);

    const created = await rate(buyer, conversationId, {
      stars: 4,
      comment: '  Nette Abwicklung, Rad wie beschrieben.  ',
    }).expect(200);
    expect(created.body.mine).toMatchObject({
      stars: 4,
      comment: 'Nette Abwicklung, Rad wie beschrieben.',
      raterRole: 'buyer',
      hidden: false,
      subject: { kind: 'listing', title: listing.title },
    });
    expect(
      (
        await request(server())
          .get(`/v1/conversations/${conversationId}`)
          .set(buyer.auth)
          .expect(200)
      ).body.rating,
    ).toEqual({ canRate: true, myStars: 4 });

    // Mitteilung (und E-Mail) an die Verkäuferin
    await drainJobs();
    const notes = await request(server()).get('/v1/me/notifications').set(seller.auth).expect(200);
    expect(notes.body.items[0]).toMatchObject({
      type: 'RATING_RECEIVED',
      link: '/konto/bewertungen',
    });
    expect(notes.body.items[0].body).toContain('Konrad Kauf hat dich mit 4 von 5 Sternen bewertet');
    expect(
      (await mailsTo(seller.email)).some((m) => m.Subject === 'Du hast eine neue Bewertung'),
    ).toBe(true);

    // Ändern: keine zweite Bewertung, keine zweite Mitteilung
    await rate(buyer, conversationId, { stars: 5 }).expect(200);
    expect(await prisma.rating.count()).toBe(1);
    expect((await prisma.rating.findFirstOrThrow()).comment).toBeNull();
    await drainJobs();
    expect(
      (await request(server()).get('/v1/me/notifications').set(seller.auth).expect(200)).body.items,
    ).toHaveLength(1);

    // Gegenseitig bewerten
    await rate(seller, conversationId, { stars: 3, comment: 'Kam etwas zu spät.' }).expect(200);
    const sellerView = await request(server())
      .get(`/v1/conversations/${conversationId}/rating`)
      .set(seller.auth)
      .expect(200);
    expect(sellerView.body).toMatchObject({
      mine: { stars: 3, raterRole: 'seller' },
      theirs: { stars: 5, rater: { displayName: 'Konrad Kauf' } },
    });

    // Antwort der bewerteten Person – nur sie darf antworten
    const ratingId = sellerView.body.theirs.id as string;
    await request(server())
      .put(`/v1/ratings/${ratingId}/reply`)
      .set(buyer.auth)
      .send({ body: 'Danke!' })
      .expect(404);
    await request(server())
      .put(`/v1/ratings/${ratingId}/reply`)
      .set(seller.auth)
      .send({ body: ' ' })
      .expect(400);
    const replied = await request(server())
      .put(`/v1/ratings/${ratingId}/reply`)
      .set(seller.auth)
      .send({ body: 'Danke, gute Fahrt!' })
      .expect(200);
    expect(replied.body).toMatchObject({ reply: 'Danke, gute Fahrt!' });

    // Öffentlich ohne Anmeldung
    const summary = await request(server())
      .get(`/v1/users/${seller.id}/rating-summary`)
      .expect(200);
    expect(summary.body).toEqual({ average: 5, count: 1, distribution: [0, 0, 0, 0, 1] });
    const list = await request(server()).get(`/v1/users/${seller.id}/ratings`).expect(200);
    expect(list.body).toMatchObject({
      user: { displayName: 'Verena Verkauf' },
      total: 1,
      items: [{ stars: 5, reply: 'Danke, gute Fahrt!', rater: { displayName: 'Konrad Kauf' } }],
    });
    expect(list.body.items[0]).not.toHaveProperty('hidden');
    await request(server()).get('/v1/users/not-a-uuid/ratings').expect(400);

    const mine = await request(server()).get('/v1/me/ratings').set(seller.auth).expect(200);
    expect(mine.body.summary.count).toBe(1);
    expect(mine.body.received).toHaveLength(1);
    expect(mine.body.given).toMatchObject([{ stars: 3, ratee: { displayName: 'Konrad Kauf' } }]);

    // Löschen der eigenen Bewertung
    await request(server())
      .delete(`/v1/conversations/${conversationId}/rating`)
      .set(buyer.auth)
      .expect(204);
    await request(server())
      .delete(`/v1/conversations/${conversationId}/rating`)
      .set(buyer.auth)
      .expect(404);
    expect(
      (await request(server()).get(`/v1/users/${seller.id}/rating-summary`).expect(200)).body,
    ).toEqual({ average: null, count: 0, distribution: [0, 0, 0, 0, 0] });
  });

  it('meldet Bewertungen, blendet sie per Moderation aus und hebt das nach Einspruch wieder auf', async () => {
    const { seller, buyer, conversationId } = await conversation();
    const created = await rate(buyer, conversationId, {
      stars: 1,
      comment: 'Unfreundliche Person, absolut daneben.',
    }).expect(200);
    const ratingId = created.body.mine.id as string;

    // Eigene Bewertung kann man nicht melden
    const report = {
      reason: 'HARASSMENT',
      details: 'Das ist eine reine Beleidigung ohne Bezug zum Kauf.',
      goodFaith: true,
    };
    await request(server())
      .post(`/v1/ratings/${ratingId}/report`)
      .set(buyer.auth)
      .send(report)
      .expect(403);
    await request(server())
      .post(`/v1/ratings/${ratingId}/report`)
      .set(seller.auth)
      .send(report)
      .expect(201);
    await request(server())
      .post(`/v1/ratings/${ratingId}/report`)
      .set(seller.auth)
      .send(report)
      .expect(409);

    const moderator = await signInAs(app, 'MODERATOR');
    const queue = await request(server())
      .get('/v1/admin/reports?target=RATING')
      .set(moderator.auth)
      .expect(200);
    expect(queue.body.items).toHaveLength(1);
    const detail = await request(server())
      .get(`/v1/admin/reports/${queue.body.items[0].id}`)
      .set(moderator.auth)
      .expect(200);
    expect(detail.body).toMatchObject({
      targetType: 'RATING',
      rating: {
        id: ratingId,
        stars: 1,
        hidden: false,
        rater: { displayName: 'Konrad Kauf' },
        ratee: { displayName: 'Verena Verkauf' },
      },
    });

    // Beteiligte können nicht über ihre eigene Bewertung entscheiden; Nutzer gar nicht
    await request(server())
      .post(`/v1/admin/ratings/${ratingId}/decisions`)
      .set(seller.auth)
      .send({ decision: 'HIDE', reason: 'HARASSMENT', ground: 'TERMS', statement: STATEMENT })
      .expect(403);
    await request(server())
      .post(`/v1/admin/ratings/${ratingId}/decisions`)
      .set(moderator.auth)
      .send({ decision: 'HIDE', statement: STATEMENT })
      .expect(400);
    const hidden = await request(server())
      .post(`/v1/admin/ratings/${ratingId}/decisions`)
      .set(moderator.auth)
      .send({ decision: 'HIDE', reason: 'HARASSMENT', ground: 'TERMS', statement: STATEMENT })
      .expect(201);
    expect(hidden.body).toMatchObject({
      action: 'RATING_HIDDEN',
      rating: { id: ratingId, title: 'Bewertung für Verena Verkauf' },
      canAppeal: true,
    });
    await request(server())
      .post(`/v1/admin/ratings/${ratingId}/decisions`)
      .set(moderator.auth)
      .send({ decision: 'HIDE', reason: 'HARASSMENT', ground: 'TERMS', statement: STATEMENT })
      .expect(409);

    // Nicht mehr öffentlich, nicht mehr änderbar; die Meldung ist erledigt
    expect(
      (await request(server()).get(`/v1/users/${seller.id}/ratings`).expect(200)).body.total,
    ).toBe(0);
    expect(
      (
        await request(server())
          .get(`/v1/conversations/${conversationId}/rating`)
          .set(seller.auth)
          .expect(200)
      ).body.theirs,
    ).toBeNull();
    expect(
      (
        await request(server())
          .get(`/v1/conversations/${conversationId}/rating`)
          .set(buyer.auth)
          .expect(200)
      ).body.mine,
    ).toMatchObject({ hidden: true });
    await rate(buyer, conversationId, { stars: 2 }).expect(403);
    expect((await prisma.report.findFirstOrThrow()).status).toBe('RESOLVED');
    await drainJobs();
    const buyerNotes = await request(server())
      .get('/v1/me/notifications')
      .set(buyer.auth)
      .expect(200);
    expect(buyerNotes.body.items[0]).toMatchObject({
      type: 'RATING_HIDDEN',
      title: 'Deine Bewertung wurde ausgeblendet',
    });
    const sellerNotes = await request(server())
      .get('/v1/me/notifications')
      .set(seller.auth)
      .expect(200);
    expect(sellerNotes.body.items.map((n: { type: string }) => n.type)).toEqual([
      'REPORT_HANDLED',
      'RATING_RECEIVED',
    ]);

    // Einspruch der bewertenden Person, eine andere Person hebt die Entscheidung auf
    const decisionId = hidden.body.id as string;
    await request(server())
      .post(`/v1/me/decisions/${decisionId}/appeal`)
      .set(buyer.auth)
      .send({ body: 'Das war keine Beleidigung, sondern meine ehrliche Erfahrung beim Kauf.' })
      .expect(201);
    const reviewer = await signInAs(app, 'MODERATOR');
    const appeals = await request(server()).get('/v1/admin/appeals').set(reviewer.auth).expect(200);
    await request(server())
      .post(`/v1/admin/appeals/${appeals.body.items[0].id}/decision`)
      .set(reviewer.auth)
      .send({
        outcome: 'REVERSED',
        response: 'Nach nochmaliger Prüfung ist die Bewertung eine zulässige Meinung.',
      })
      .expect(201);
    expect(
      (await prisma.rating.findUniqueOrThrow({ where: { id: ratingId } })).hiddenAt,
    ).toBeNull();
    expect(
      (await request(server()).get(`/v1/users/${seller.id}/ratings`).expect(200)).body.total,
    ).toBe(1);
  });

  it('entfernt Bewertungen mit dem Konto und zeigt keine Profile gesperrter Konten', async () => {
    const { seller, buyer, conversationId } = await conversation();
    await rate(buyer, conversationId, { stars: 5 }).expect(200);
    await prisma.user.update({ where: { id: seller.id }, data: { status: 'SUSPENDED' } });
    await request(server()).get(`/v1/users/${seller.id}/ratings`).expect(404);
    await request(server()).get(`/v1/users/${seller.id}/rating-summary`).expect(404);
    await prisma.conversation.delete({ where: { id: conversationId } });
    expect(await prisma.rating.count()).toBe(0);
  });
});
