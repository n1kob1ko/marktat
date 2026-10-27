import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { RealtimeEvent } from '@marktat/shared';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, drainJobs, mailsTo, mailText, publishListing, resetData, signIn } from './helpers.js';

type Account = Awaited<ReturnType<typeof signIn>>;

describe('Nachrichten', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  /** Verkäufer mit Inserat, Interessent schreibt die erste Nachricht */
  async function startConversation(body = 'Hallo, ist das Rad noch zu haben?') {
    const seller = await signIn(app, { metadata: { display_name: 'Verena Verkauf' } });
    const buyer = await signIn(app, { metadata: { display_name: 'Konrad Kauf' } });
    const listing = await publishListing(app, seller.auth);
    const res = await request(server()).post(`/v1/listings/${listing.id}/conversations`).set(buyer.auth).send({ body }).expect(201);
    return { seller, buyer, listing, conversationId: res.body.conversationId as string, first: res.body.message };
  }

  const send = (account: Account, conversationId: string, body: string) =>
    request(server()).post(`/v1/conversations/${conversationId}/messages`).set(account.auth).send({ body });

  it('verlangt eine Anmeldung', async () => {
    await request(server()).get('/v1/conversations').expect(401);
    await request(server()).get('/v1/me/unread').expect(401);
    await request(server()).get('/v1/me/events').expect(401);
    await request(server()).post('/v1/listings/abcdefghijklmnopqrstuvwxy/conversations').send({ body: 'Hallo' }).expect(401);
  });

  it('führt eine Unterhaltung zwischen zwei Konten mit Ungelesen-Status', async () => {
    const { seller, buyer, listing, conversationId, first } = await startConversation();
    expect(first).toMatchObject({ body: 'Hallo, ist das Rad noch zu haben?', mine: true, readAt: null });

    // Verkäufer sieht die Unterhaltung als ungelesen
    expect((await request(server()).get('/v1/me/unread').set(seller.auth).expect(200)).body).toEqual({ messages: 1, conversations: 1 });
    const inbox = await request(server()).get('/v1/conversations').set(seller.auth).expect(200);
    expect(inbox.body.total).toBe(1);
    expect(inbox.body.items[0]).toMatchObject({
      id: conversationId,
      role: 'seller',
      partner: { displayName: 'Konrad Kauf', inactive: false },
      listing: { id: listing.id, title: listing.title, available: true },
      lastMessage: { body: 'Hallo, ist das Rad noch zu haben?', mine: false },
      unreadCount: 1,
    });

    const page = await request(server()).get(`/v1/conversations/${conversationId}/messages`).set(seller.auth).expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].mine).toBe(false);

    const read = await request(server()).post(`/v1/conversations/${conversationId}/read`).set(seller.auth).expect(200);
    expect(read.body).toEqual({ messages: 0, conversations: 0 });

    const reply = await send(seller, conversationId, 'Ja, gerne. Wann möchtest du vorbeikommen?').expect(201);
    expect(reply.body.mine).toBe(true);
    expect((await request(server()).get('/v1/me/unread').set(buyer.auth).expect(200)).body.messages).toBe(1);

    // Zweite Nachricht zum selben Inserat setzt die Unterhaltung fort
    const again = await request(server()).post(`/v1/listings/${listing.id}/conversations`).set(buyer.auth).send({ body: 'Morgen um 18 Uhr?' }).expect(201);
    expect(again.body.conversationId).toBe(conversationId);
    expect(await prisma.conversation.count()).toBe(1);

    const buyerView = await request(server()).get(`/v1/conversations/${conversationId}/messages`).set(buyer.auth).expect(200);
    expect(buyerView.body.items.map((m: { mine: boolean }) => m.mine)).toEqual([true, false, true]);
    // Lesebestätigung für die eigene erste Nachricht
    expect(buyerView.body.items[0].readAt).not.toBeNull();

    const detail = await request(server()).get(`/v1/listings/${listing.id}`).set(buyer.auth).expect(200);
    expect(detail.body.conversationId).toBe(conversationId);

    // Filter und Suche
    const buying = await request(server()).get('/v1/conversations?filter=kaufen').set(buyer.auth).expect(200);
    expect(buying.body.total).toBe(1);
    expect((await request(server()).get('/v1/conversations?filter=verkaufen').set(buyer.auth).expect(200)).body.total).toBe(0);
    expect((await request(server()).get('/v1/conversations?q=verena').set(buyer.auth).expect(200)).body.total).toBe(1);
    expect((await request(server()).get('/v1/conversations?q=rennrad').set(buyer.auth).expect(200)).body.total).toBe(1);
    expect((await request(server()).get('/v1/conversations?q=kinderwagen').set(buyer.auth).expect(200)).body.total).toBe(0);
    expect((await request(server()).get('/v1/conversations?filter=ungelesen').set(seller.auth).expect(200)).body.total).toBe(1);
  });

  it('blättert ältere und neuere Nachrichten', async () => {
    const { seller, buyer, conversationId } = await startConversation('Nachricht 0');
    const base = Date.now();
    await prisma.message.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({
        conversationId,
        senderId: i % 2 ? seller.id : buyer.id,
        recipientId: i % 2 ? buyer.id : seller.id,
        body: `Nachricht ${i + 1}`,
        createdAt: new Date(base + (i + 1) * 1000),
      })),
    });
    const newest = await request(server()).get(`/v1/conversations/${conversationId}/messages`).set(buyer.auth).expect(200);
    expect(newest.body.items).toHaveLength(30);
    expect(newest.body.hasMore).toBe(true);
    expect(newest.body.items.at(-1).body).toBe('Nachricht 40');
    const older = await request(server())
      .get(`/v1/conversations/${conversationId}/messages?before=${newest.body.items[0].id}`)
      .set(buyer.auth)
      .expect(200);
    expect(older.body.items.map((m: { body: string }) => m.body)).toEqual(Array.from({ length: 11 }, (_, i) => `Nachricht ${i}`));
    expect(older.body.hasMore).toBe(false);
    const newer = await request(server())
      .get(`/v1/conversations/${conversationId}/messages?after=${newest.body.items.at(-3).id}`)
      .set(buyer.auth)
      .expect(200);
    expect(newer.body.items.map((m: { body: string }) => m.body)).toEqual(['Nachricht 39', 'Nachricht 40']);
    await request(server()).get(`/v1/conversations/${conversationId}/messages?before=abcdefghijklmnopqrstuvwxy`).set(buyer.auth).expect(400);
  });

  it('gibt fremde Unterhaltungen nicht preis, auch nicht über manipulierte IDs', async () => {
    const { conversationId, first, seller } = await startConversation();
    const stranger = await signIn(app);
    await request(server()).get(`/v1/conversations/${conversationId}`).set(stranger.auth).expect(404);
    await request(server()).get(`/v1/conversations/${conversationId}/messages`).set(stranger.auth).expect(404);
    await send(stranger, conversationId, 'Ich lese mit').expect(404);
    await request(server()).post(`/v1/conversations/${conversationId}/read`).set(stranger.auth).expect(404);
    await request(server()).post(`/v1/conversations/${conversationId}/report`).set(stranger.auth).send({ reason: 'SPAM' }).expect(404);
    expect((await request(server()).get('/v1/conversations').set(stranger.auth).expect(200)).body.total).toBe(0);

    for (const id of ['1', "' OR '1'='1", '..%2F..%2Fusers', 'a'.repeat(200), first.id]) {
      await request(server()).get(`/v1/conversations/${id}`).set(stranger.auth).expect(404);
    }
    // Nachrichten-ID aus fremder Unterhaltung als Cursor in der eigenen
    const own = await startConversation();
    await request(server()).get(`/v1/conversations/${own.conversationId}/messages?before=${first.id}`).set(own.buyer.auth).expect(400);

    // Mitlesen über das Feld recipientId/senderId im Body ist wirkungslos
    const res = await request(server())
      .post(`/v1/conversations/${conversationId}/messages`)
      .set(seller.auth)
      .send({ body: 'Antwort', recipientId: stranger.id, senderId: stranger.id, conversationId: own.conversationId })
      .expect(400);
    expect(res.body.message).toBeDefined();
    expect(await prisma.message.count({ where: { OR: [{ senderId: stranger.id }, { recipientId: stranger.id }] } })).toBe(0);
  });

  it('verhindert Nachrichten an sich selbst und zu nicht verfügbaren Inseraten', async () => {
    const seller = await signIn(app);
    const buyer = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    const own = await request(server()).post(`/v1/listings/${listing.id}/conversations`).set(seller.auth).send({ body: 'Hallo ich' }).expect(400);
    expect(own.body.message).toContain('eigene Anzeige');

    await request(server()).post('/v1/listings/abcdefghijklmnopqrstuvwxy/conversations').set(buyer.auth).send({ body: 'Hallo' }).expect(404);

    const paused = await publishListing(app, seller.auth, { title: 'Pausiertes Rad' });
    await request(server()).post(`/v1/listings/${paused.id}/pause`).set(seller.auth).expect(200);
    await request(server()).post(`/v1/listings/${paused.id}/conversations`).set(buyer.auth).send({ body: 'Hallo' }).expect(404);

    // Laufende Unterhaltung bleibt nach dem Löschen des Inserats erhalten
    const res = await request(server()).post(`/v1/listings/${listing.id}/conversations`).set(buyer.auth).send({ body: 'Noch da?' }).expect(201);
    await request(server()).delete(`/v1/listings/${listing.id}`).set(seller.auth).expect(204);
    await request(server()).post(`/v1/listings/${listing.id}/conversations`).set(buyer.auth).send({ body: 'Hallo?' }).expect(404);
    const detail = await request(server()).get(`/v1/conversations/${res.body.conversationId}`).set(buyer.auth).expect(200);
    expect(detail.body.listing.available).toBe(false);
    await send(seller, res.body.conversationId, 'Leider schon verkauft.').expect(201);

    expect(await prisma.conversation.count({ where: { buyerId: seller.id } })).toBe(0);
  });

  it('prüft Länge und Inhalt der Nachricht und speichert HTML nur als Text', async () => {
    const { buyer, conversationId } = await startConversation();
    await send(buyer, conversationId, '').expect(400);
    await send(buyer, conversationId, '   \n\n  ').expect(400);
    await send(buyer, conversationId, 'x'.repeat(2001)).expect(400);
    await send(buyer, conversationId, 'x'.repeat(2000)).expect(201);
    await request(server()).post(`/v1/conversations/${conversationId}/messages`).set(buyer.auth).send({ body: 42 }).expect(400);

    const html = '<img src=x onerror=alert(1)>\r\n\r\n\r\n\r\nNeue Zeile‮\u0007  ';
    const res = await send(buyer, conversationId, html).expect(201);
    // Gespeichert wird der Text; maskiert wird bei der Anzeige (React), Steuer- und Richtungszeichen fallen weg
    expect(res.body.body).toBe('<img src=x onerror=alert(1)>\n\nNeue Zeile');
  });

  it('bremst Spam: Nachrichten pro Minute und neue Unterhaltungen pro Stunde', async () => {
    const { buyer, conversationId } = await startConversation('Nachricht 1');
    for (let i = 2; i <= 10; i++) await send(buyer, conversationId, `Nachricht ${i}`).expect(201);
    const blocked = await send(buyer, conversationId, 'Nachricht 11').expect(429);
    expect(blocked.body.message).toContain('sehr schnell');

    const spammer = await signIn(app);
    const seller = await signIn(app);
    // Ältere Unterhaltungen direkt anlegen, damit nur die Grenze für neue Unterhaltungen greift
    for (let i = 0; i < 10; i++) {
      const listing = await prisma.listing.findFirstOrThrow({ where: { title: 'Rennrad Carbon 56 cm' } });
      const copy = await prisma.listing.create({
        data: { ...listing, id: undefined, sellerId: seller.id, slug: `kopie-${i}`, attributes: listing.attributes ?? undefined },
      });
      await prisma.conversation.create({ data: { listingId: copy.id, buyerId: spammer.id, sellerId: seller.id } });
    }
    const fresh = await publishListing(app, seller.auth, { title: 'Noch ein Rad' });
    await request(server()).post(`/v1/listings/${fresh.id}/conversations`).set(spammer.auth).send({ body: 'Hallo' }).expect(429);
  });

  it('speichert eine erneut abgeschickte Nachricht (gleiche clientId) nur einmal', async () => {
    const seller = await signIn(app);
    const buyer = await signIn(app);
    const listing = await publishListing(app, seller.auth);
    const first = { body: 'Ist das Rad noch da?', clientId: randomUUID() };
    const start = () => request(server()).post(`/v1/listings/${listing.id}/conversations`).set(buyer.auth).send(first);
    const [a, b] = await Promise.all([start(), start()]);
    const retry = await start().expect(201);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(new Set([a.body.message.id, b.body.message.id, retry.body.message.id]).size).toBe(1);
    const conversationId = retry.body.conversationId as string;

    const reply = { body: 'Ja, noch da.', clientId: randomUUID() };
    const sendReply = () => request(server()).post(`/v1/conversations/${conversationId}/messages`).set(seller.auth).send(reply);
    const [c, d] = await Promise.all([sendReply(), sendReply()]);
    expect([c.status, d.status]).toEqual([201, 201]);
    expect(c.body.id).toBe(d.body.id);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(2);
    // Ungelesen zählt die Nachricht nur einmal
    expect((await request(server()).get('/v1/me/unread').set(seller.auth).expect(200)).body.messages).toBe(1);

    // Ohne clientId (ältere Clients) bleibt alles wie bisher; dieselbe clientId in einer anderen Unterhaltung ist ein Fehler
    await send(seller, conversationId, 'Noch eine Frage?').expect(201);
    const otherListing = await publishListing(app, seller.auth, { title: 'Kinderrad 20 Zoll' });
    await request(server()).post(`/v1/listings/${otherListing.id}/conversations`).set(buyer.auth).send(first).expect(409);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(3);
  });

  it('blockiert in beide Richtungen und hebt die Blockierung wieder auf', async () => {
    const { seller, buyer, listing, conversationId } = await startConversation();
    await request(server()).post(`/v1/users/${buyer.id}/block`).set(seller.auth).expect(204);
    await request(server()).post(`/v1/users/${buyer.id}/block`).set(seller.auth).expect(204);
    await request(server()).post(`/v1/users/${seller.id}/block`).set(seller.auth).expect(400);
    await request(server()).post('/v1/users/kein-uuid/block').set(seller.auth).expect(404);

    const sellerDetail = await request(server()).get(`/v1/conversations/${conversationId}`).set(seller.auth).expect(200);
    expect(sellerDetail.body).toMatchObject({ blockedByMe: true });
    expect(sellerDetail.body.sendBlockedReason).toBeTruthy();
    await send(seller, conversationId, 'Hallo').expect(403);
    await send(buyer, conversationId, 'Hallo?').expect(403);
    await request(server()).post(`/v1/listings/${listing.id}/conversations`).set(buyer.auth).send({ body: 'Hallo?' }).expect(403);

    const blocks = await request(server()).get('/v1/me/blocks').set(seller.auth).expect(200);
    expect(blocks.body).toEqual([expect.objectContaining({ id: buyer.id, displayName: 'Konrad Kauf' })]);

    await request(server()).delete(`/v1/users/${buyer.id}/block`).set(seller.auth).expect(204);
    await send(buyer, conversationId, 'Wieder da').expect(201);
  });

  it('nimmt Meldungen an und begrenzt sie', async () => {
    const { seller, buyer, conversationId } = await startConversation();
    await request(server()).post(`/v1/conversations/${conversationId}/report`).set(seller.auth).send({ reason: 'GIBTS_NICHT' }).expect(400);
    const res = await request(server())
      .post(`/v1/conversations/${conversationId}/report`)
      .set(seller.auth)
      .send({ reason: 'FRAUD', details: 'Will per Vorkasse zahlen.' })
      .expect(201);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(report).toMatchObject({ reporterId: seller.id, reportedId: buyer.id, reason: 'FRAUD', status: 'OPEN', conversationId });
  });

  it('schickt eine E-Mail je ungelesener Unterhaltung und respektiert die Einstellung', async () => {
    const { seller, buyer, conversationId, listing } = await startConversation();
    await send(buyer, conversationId, 'Und noch eine Frage').expect(201);
    await drainJobs();
    let mails = await mailsTo(seller.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.Subject).toBe(`Neue Nachricht von Konrad Kauf zu „${listing.title}“`);
    const text = await mailText(mails[0]!.ID);
    expect(text).toContain(`/nachrichten/${conversationId}`);
    // Privatsphäre: der Nachrichtentext steht nicht in der E-Mail
    expect(text).not.toContain('ist das Rad noch zu haben');

    // Weitere Nachricht, solange ungelesen: keine zweite E-Mail
    await send(buyer, conversationId, 'Hallo?').expect(201);
    await drainJobs();
    expect(await mailsTo(seller.email)).toHaveLength(1);

    // Nach dem Lesen beginnt eine neue Runde
    await request(server()).post(`/v1/conversations/${conversationId}/read`).set(seller.auth).expect(200);
    await send(buyer, conversationId, 'Noch eine Nachricht').expect(201);
    await drainJobs();
    mails = await mailsTo(seller.email);
    expect(mails).toHaveLength(2);

    // Abgeschaltet: keine E-Mail an den Interessenten
    const settings = await request(server()).patch('/v1/me/notifications').set(buyer.auth).send({ notifyMessagesByEmail: false }).expect(200);
    expect(settings.body).toMatchObject({ notifyMessagesByEmail: false, notifySearchesByEmail: true });
    await request(server()).patch('/v1/me/notifications').set(buyer.auth).send({ notifyMessagesByEmail: 'nein' }).expect(400);
    await request(server()).patch('/v1/me/notifications').set(buyer.auth).send({ email: 'x@example.at' }).expect(400);
    await send(seller, conversationId, 'Antwort ohne E-Mail').expect(201);
    await drainJobs();
    expect(await mailsTo(buyer.email)).toHaveLength(0);
  });

  it('liefert neue Nachrichten und Lesebestätigungen in Echtzeit (SSE)', async () => {
    const { seller, buyer, conversationId } = await startConversation();
    await new Promise<void>((resolve) => server().listen(0, '127.0.0.1', resolve));
    const { port } = server().address() as AddressInfo;
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/me/events`, { headers: seller.auth, signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const next = async (): Promise<RealtimeEvent> => {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = chunk.split('\n').find((line) => line.startsWith('data: '));
          if (data) return JSON.parse(data.slice(6)) as RealtimeEvent;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('Stream beendet');
        buffer += decoder.decode(value, { stream: true });
      }
    };
    try {
      expect(await next()).toEqual({ type: 'ready', unread: { messages: 1, conversations: 1 } });
      await send(buyer, conversationId, 'Echtzeit!').expect(201);
      const event = await next();
      expect(event).toMatchObject({ type: 'message', message: { conversationId, body: 'Echtzeit!', mine: false }, unread: { messages: 2 } });

      // Fremde Ereignisse kommen nicht an: eine andere Unterhaltung
      const other = await startConversation('Andere Unterhaltung');
      await send(other.seller, other.conversationId, 'Nicht für Verena').expect(201);

      await request(server()).post(`/v1/conversations/${conversationId}/read`).set(seller.auth).expect(200);
      expect(await next()).toMatchObject({ type: 'read', conversationId, byMe: true, unread: { messages: 0 } });
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  });

  it('hält private Nachrichten aus dem öffentlichen Suchindex', async () => {
    const { buyer, conversationId } = await startConversation('Geheimwort Zebrastreifen');
    await send(buyer, conversationId, 'Zebrastreifen nochmal').expect(201);
    const search = await request(server()).get('/v1/listings?q=Zebrastreifen').expect(200);
    expect(search.body.total).toBe(0);
  });
});
