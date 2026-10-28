import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DEAL_FEED_MAX_FAILURES, toCsv } from '@marktat/shared';
import { DealFeedService } from '../src/deals/deal-feed.service.js';
import { DealImportService } from '../src/deals/deal-import.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, flushSearch, publishDeal, resetData, signIn, signInAs, signInMerchant, viennaDayOffset } from './helpers.js';

type Account = Awaited<ReturnType<typeof signIn>>;

const day = (offset: number) => viennaDayOffset(offset).split('-').reverse().join('.');
const HEADER = ['artikelnummer', 'titel', 'kategorie', 'preis', 'ende', 'link', 'vergleichspreis', 'vergleichspreis_art', 'vergleichspreis_quelle'];

function csv(rows: string[][], header = HEADER, delimiter = ';') {
  return [header, ...rows].map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(delimiter)).join('\r\n');
}

describe('Deal-Importe und Produktfeeds', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const upload = (account: Account, body: string | Buffer, name = 'angebote.csv') =>
    request(server()).post(`/v1/me/deal-imports?datei=${encodeURIComponent(name)}`).set(account.auth).set('Content-Type', 'text/csv').send(body);
  const visibleIds = async () => {
    await flushSearch();
    return ((await request(server()).get('/v1/deals').expect(200)).body.items as { id: string }[]).map((d) => d.id);
  };

  describe('CSV-Import', () => {
    it('zeigt eine Vorschau mit Fehlern je Zeile und übernimmt erst nach Bestätigung', async () => {
      const merchant = await signInMerchant(app);
      const file = csv([
        ['NB-1', 'Notebook 15 Zoll, 16 GB RAM', 'Elektronik & Computer', '599,00', day(10), 'https://shop.example.at/nb', '799,00', 'uvp', 'UVP laut Hersteller 10/2026'],
        ['TV-1', 'Fernseher 55 Zoll OLED', 'tv-audio', '1.099,00', day(10), 'https://shop.example.at/tv', '', '', ''],
        ['', 'Ohne Artikelnummer', 'tv-audio', '10', day(10), 'https://shop.example.at/x', '', '', ''],
        ['FALSCH-1', 'Falsche Kategorie hier', 'Raumfahrt', 'gratis', '31.02.2026', 'http://shop.example.at/y', '', '', ''],
        ['NB-1', 'Doppelte Nummer in Datei', 'tv-audio', '10', day(10), 'https://shop.example.at/z', '', '', ''],
      ]);
      const preview = await upload(merchant, file).expect(201);
      expect(preview.body).toMatchObject({ status: 'PREVIEW', fileName: 'angebote.csv', missingFields: [], hasReferencePrices: true });
      expect(preview.body.counts).toMatchObject({ total: 5, create: 2, error: 3 });
      const rows = preview.body.rows as { line: number; action: string; messages: string[] }[];
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'CREATE', 'ERROR', 'ERROR', 'ERROR']);
      expect(rows[2].messages.join(' ')).toContain('Artikelnummer fehlt');
      expect(rows[3].messages.join(' ')).toMatch(/Raumfahrt/);
      expect(rows[3].messages.join(' ')).toMatch(/kein gültiger Betrag/);
      expect(rows[4].messages.join(' ')).toContain('bereits in Zeile 2');
      // Vorschau übernimmt nichts
      expect(await prisma.deal.count()).toBe(0);

      // Vergleichspreise ohne Bestätigung → diese Zeile wird nicht übernommen
      const committed = await request(server()).post(`/v1/me/deal-imports/${preview.body.id}/commit`).set(merchant.auth).send({ publish: true }).expect(200);
      expect(committed.body.status).toBe('COMMITTED');
      expect(committed.body.counts).toMatchObject({ create: 1, error: 4 });
      expect(committed.body.rows[0].messages[0]).toContain('nicht bestätigt');
      // Doppelklick: zweite Übernahme wird abgelehnt
      await request(server()).post(`/v1/me/deal-imports/${preview.body.id}/commit`).set(merchant.auth).send({ publish: true }).expect(409);
      const stored = await prisma.dealImport.findUniqueOrThrow({ where: { id: preview.body.id } });
      expect(stored.rawText).toBeNull();

      const deals = await prisma.deal.findMany();
      expect(deals).toHaveLength(1);
      expect(deals[0]).toMatchObject({ externalId: 'TV-1', status: 'ACTIVE', source: 'CSV', priceCents: 109_900, lastImportId: preview.body.id });
      expect(await visibleIds()).toEqual([deals[0].id]);

      const again = await upload(merchant, file).expect(201);
      const done = await request(server()).post(`/v1/me/deal-imports/${again.body.id}/commit`).set(merchant.auth).send({ publish: true, confirmReferencePrices: true }).expect(200);
      expect(done.body.counts).toMatchObject({ create: 1, unchanged: 1, error: 3 });
      const notebook = await prisma.deal.findFirstOrThrow({ where: { externalId: 'NB-1' } });
      expect(notebook).toMatchObject({ referencePriceCents: 79_900, referencePriceType: 'RRP', discountPercent: 25 });
      expect(notebook.referenceConfirmedAt).not.toBeNull();

      const history = await request(server()).get('/v1/me/deal-imports').set(merchant.auth).expect(200);
      expect(history.body.map((h: { status: string }) => h.status)).toEqual(['COMMITTED', 'COMMITTED']);
    });

    it('aktualisiert über die Artikelnummer statt doppelt anzulegen und nennt die Änderungen', async () => {
      const merchant = await signInMerchant(app);
      const first = await upload(merchant, csv([['K-1', 'Kaffeemaschine mit Mahlwerk', 'haushalt-kueche', '299', day(10), 'https://shop.example.at/k', '', '', '']])).expect(201);
      await request(server()).post(`/v1/me/deal-imports/${first.body.id}/commit`).set(merchant.auth).send({ publish: true }).expect(200);
      const deal = await prisma.deal.findFirstOrThrow({ where: { externalId: 'K-1' } });
      const startsAt = deal.startsAt;

      // Gleicher Titel ohne Artikelnummer-Treffer → Warnung „mögliches Doppel“
      const second = await upload(
        merchant,
        csv([
          ['K-1', 'Kaffeemaschine mit Mahlwerk', 'haushalt-kueche', '279', day(20), 'https://shop.example.at/k', '', '', ''],
          ['K-2', 'Kaffeemaschine mit Mahlwerk', 'haushalt-kueche', '279', day(20), 'https://shop.example.at/k2', '', '', ''],
        ]),
      ).expect(201);
      expect(second.body.rows[0]).toMatchObject({ action: 'UPDATE', dealId: deal.id, changes: ['Preis', 'Ende'] });
      expect(second.body.rows[1].action).toBe('CREATE');
      expect(second.body.rows[1].warnings[0]).toContain('Mögliches Doppel');
      await request(server()).post(`/v1/me/deal-imports/${second.body.id}/commit`).set(merchant.auth).send({ publish: true }).expect(200);
      const updated = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
      expect(updated).toMatchObject({ priceCents: 27_900, status: 'ACTIVE', lastImportId: second.body.id });
      // Ohne Spalte „beginn“ bleibt der bisherige Beginn erhalten
      expect(updated.startsAt).toEqual(startsAt);
      expect(await prisma.deal.count({ where: { externalId: 'K-1' } })).toBe(1);
      // Preisänderung wird in der eigenen Preisaufzeichnung festgehalten
      const prices = await prisma.dealPriceRecord.findMany({ where: { dealId: deal.id }, orderBy: { recordedAt: 'asc' } });
      expect(prices.map((p) => p.priceCents)).toEqual([29_900, 27_900]);

      // Ein gelöschter Deal gibt seine Artikelnummer frei
      await request(server()).delete(`/v1/me/deals/${deal.id}`).set(merchant.auth).expect(204);
      const third = await upload(merchant, csv([['K-1', 'Kaffeemaschine mit Mahlwerk', 'haushalt-kueche', '279', day(20), 'https://shop.example.at/k', '', '', '']])).expect(201);
      expect(third.body.rows[0].action).toBe('CREATE');
    });

    it('überspringt vom Team abgelehnte Deals und importiert ohne Berechtigung nur als Entwurf', async () => {
      const merchant = await signInMerchant(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const deal = await publishDeal(app, merchant.auth, { externalId: 'R-1' });
      const version = (await request(server()).get(`/v1/admin/deals/${deal.id}`).set(moderator.auth).expect(200)).body.version;
      await request(server())
        .post(`/v1/admin/deals/${deal.id}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'REJECT', reason: 'MISLEADING', ground: 'ILLEGAL', statement: 'Der Vergleichspreis ist nicht belegt und wurde so nie verlangt.', version })
        .expect(201);
      const preview = await upload(merchant, csv([['R-1', 'Notebook 15 Zoll, 16 GB RAM', 'elektronik-computer', '499', day(10), 'https://shop.example.at/nb', '', '', '']])).expect(201);
      expect(preview.body.rows[0].action).toBe('SKIP');

      const neu = await signIn(app, { metadata: { display_name: 'Neu GmbH', account_type: 'BUSINESS', company_name: 'Neu GmbH' } });
      const file = csv([['E-1', 'Entwurf aus der Datei', 'drogerie', '4,99', day(10), 'https://shop.example.at/e', '', '', '']]);
      const draftPreview = await upload(neu, file).expect(201);
      const refused = await request(server()).post(`/v1/me/deal-imports/${draftPreview.body.id}/commit`).set(neu.auth).send({ publish: true }).expect(403);
      expect(refused.body.message).toContain('Entwurf');
      // Vorschau bleibt erhalten → als Entwurf übernehmen
      await request(server()).post(`/v1/me/deal-imports/${draftPreview.body.id}/commit`).set(neu.auth).send({ publish: false }).expect(200);
      expect((await prisma.deal.findFirstOrThrow({ where: { externalId: 'E-1' } })).status).toBe('DRAFT');

      const privat = await signIn(app);
      await upload(privat, file).expect(403);
    });

    it('ordnet Spalten zu, erkennt Windows-1252 und schützt fremde Importe', async () => {
      const merchant = await signInMerchant(app);
      const other = await signInMerchant(app, 'Andere GmbH');
      const file = csv(
        [['G-1', 'Gartenschlauch 25 m', 'baumarkt-garten', '24,90', day(7), 'https://shop.example.at/g', 'Größe M']],
        ['Nr', 'Bezeichnung', 'Rubrik', 'Preis', 'Bis', 'Link', 'Hinweis'],
      );
      const preview = await upload(merchant, Buffer.from(file, 'latin1')).expect(201);
      expect(preview.body.headers).toContain('Hinweis');
      expect(preview.body.missingFields).toEqual(expect.arrayContaining(['externalId', 'category']));
      expect(preview.body.rows[0].action).toBe('ERROR');
      await request(server()).post(`/v1/me/deal-imports/${preview.body.id}/commit`).set(merchant.auth).send({ publish: true }).expect(400);
      await request(server()).put(`/v1/me/deal-imports/${preview.body.id}/mapping`).set(merchant.auth).send({ externalId: 'Gibt es nicht' }).expect(400);
      const mapped = await request(server())
        .put(`/v1/me/deal-imports/${preview.body.id}/mapping`)
        .set(merchant.auth)
        .send({ externalId: 'Nr', title: 'Bezeichnung', category: 'Rubrik', price: 'Preis', endsOn: 'Bis', url: 'Link', description: 'Hinweis' })
        .expect(200);
      expect(mapped.body.missingFields).toEqual([]);
      expect(mapped.body.rows[0].action).toBe('CREATE');

      // Fremde Importe: nicht sichtbar, nicht änderbar
      await request(server()).get(`/v1/me/deal-imports/${preview.body.id}`).set(other.auth).expect(404);
      await request(server()).post(`/v1/me/deal-imports/${preview.body.id}/commit`).set(other.auth).send({ publish: true }).expect(404);
      await request(server()).delete(`/v1/me/deal-imports/${preview.body.id}`).set(other.auth).expect(404);

      await request(server()).post(`/v1/me/deal-imports/${preview.body.id}/commit`).set(merchant.auth).send({ publish: true }).expect(200);
      const deal = await prisma.deal.findFirstOrThrow({ where: { externalId: 'G-1' } });
      expect(deal.description).toBe('Größe M');
    });

    it('lehnt leere, kaputte und zu große Dateien ab; Vorschauen verfallen', async () => {
      const merchant = await signInMerchant(app);
      await upload(merchant, '').expect(400);
      const broken = await upload(merchant, 'artikelnummer;titel\n"offen;ohne Ende').expect(400);
      expect(broken.body.message).toBeTruthy();
      await upload(merchant, Buffer.alloc(2 * 1024 * 1024 + 10, 'a')).expect(413);
      await request(server()).post('/v1/me/deal-imports').set(merchant.auth).set('Content-Type', 'application/json').send({ a: 1 }).expect(400);

      const preview = await upload(merchant, csv([['V-1', 'Verfallende Vorschau', 'drogerie', '4,99', day(7), 'https://shop.example.at/v', '', '', '']])).expect(201);
      await prisma.dealImport.update({ where: { id: preview.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await app.get(DealImportService).expirePreviews()).toBe(1);
      const expired = await prisma.dealImport.findUniqueOrThrow({ where: { id: preview.body.id } });
      expect(expired).toMatchObject({ status: 'EXPIRED', rawText: null });
      await request(server()).post(`/v1/me/deal-imports/${preview.body.id}/commit`).set(merchant.auth).send({ publish: true }).expect(409);

      const cancelled = await upload(merchant, csv([['V-2', 'Verworfene Vorschau', 'drogerie', '4,99', day(7), 'https://shop.example.at/v', '', '', '']])).expect(201);
      await request(server()).delete(`/v1/me/deal-imports/${cancelled.body.id}`).set(merchant.auth).expect(204);
      expect((await prisma.dealImport.findUniqueOrThrow({ where: { id: cancelled.body.id } })).rawText).toBeNull();
    });

    it('zeigt dem Team fehlgeschlagene Importe und Importe mit Fehlerzeilen', async () => {
      const merchant = await signInMerchant(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const preview = await upload(merchant, csv([['X-1', 'Kategorie gibt es nicht', 'Raumfahrt', '1', day(7), 'https://shop.example.at/x', '', '', '']])).expect(201);
      await request(server()).post(`/v1/me/deal-imports/${preview.body.id}/commit`).set(merchant.auth).send({ publish: true }).expect(200);
      await request(server()).get('/v1/admin/deal-imports').set(merchant.auth).expect(403);
      const list = await request(server()).get('/v1/admin/deal-imports').set(moderator.auth).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ id: preview.body.id, merchant: { name: 'Elektro Huber GmbH' } });
      const detail = await request(server()).get(`/v1/admin/deal-imports/${preview.body.id}`).set(moderator.auth).expect(200);
      expect(detail.body.rows[0].action).toBe('ERROR');
    });
  });

  describe('Produktfeeds', () => {
    const FEED = {
      name: 'Hauptfeed',
      url: 'https://feeds.example.at/angebote.csv',
      format: 'CSV',
      intervalHours: 6,
      licenseNote: 'Eigener Feed unseres Webshops, alle Daten von uns erstellt.',
      licenseConfirmed: true,
      referencePricesConfirmed: false,
    };

    async function feedServer() {
      const state = { status: 200, body: '', etag: '"v1"', requests: [] as { inm?: string; ua?: string }[] };
      const target = http.createServer((req, res) => {
        state.requests.push({ inm: req.headers['if-none-match'] as string | undefined, ua: req.headers['user-agent'] });
        if (state.status === 200 && req.headers['if-none-match'] === state.etag) {
          res.writeHead(304).end();
          return;
        }
        res.writeHead(state.status, { 'content-type': 'text/csv; charset=utf-8', etag: state.etag }).end(state.status === 200 ? state.body : 'Fehler');
      });
      await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
      return { state, target, url: `http://127.0.0.1:${(target.address() as AddressInfo).port}/feed.csv` };
    }

    it('ruft erst nach der Freigabe ab, aktualisiert, bestätigt bei 304 und beendet fehlende Angebote', async () => {
      const merchant = await signInMerchant(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const { state, target, url } = await feedServer();
      try {
        state.body = csv([
          ['F-1', 'Akkuschrauber 18 V Set', 'baumarkt-garten', '89,00', day(10), 'https://shop.example.at/as', '', '', ''],
          ['F-2', 'Laubbläser kabellos', 'baumarkt-garten', '129,00', day(10), 'https://shop.example.at/lb', '', '', ''],
        ]);
        await request(server()).post('/v1/me/deal-feeds').set(merchant.auth).send({ ...FEED, licenseConfirmed: false }).expect(400);
        await request(server()).post('/v1/me/deal-feeds').set(merchant.auth).send({ ...FEED, intervalHours: 1 }).expect(400);
        await request(server()).post('/v1/me/deal-feeds').set(merchant.auth).send({ ...FEED, url: 'http://feeds.example.at/x.csv' }).expect(400);
        const created = await request(server()).post('/v1/me/deal-feeds').set(merchant.auth).send(FEED).expect(201);
        expect(created.body.status).toBe('PENDING');
        // Nur im Test: lokale Adresse (die Eingabeprüfung erlaubt nur öffentliche https-Adressen)
        await prisma.dealFeed.update({ where: { id: created.body.id }, data: { url } });

        const feeds = app.get(DealFeedService);
        expect(await feeds.runDue()).toEqual({ processed: 0 });
        expect(state.requests).toHaveLength(0);

        // Probeabruf geht vor der Freigabe, übernimmt aber nichts
        const preview = await request(server()).post(`/v1/me/deal-feeds/${created.body.id}/preview`).set(merchant.auth).expect(200);
        expect(preview.body.counts).toMatchObject({ create: 2 });
        expect(await prisma.deal.count()).toBe(0);
        expect(state.requests[0].ua).toContain('MarktAT-Feedabruf');

        // Eigene Feeds kann niemand aus dem Team freigeben, der sie selbst eingereicht hat; Händler können nicht freigeben
        await request(server()).post(`/v1/admin/deal-feeds/${created.body.id}/review`).set(merchant.auth).send({ decision: 'APPROVE' }).expect(403);
        const pending = await request(server()).get('/v1/admin/deal-feeds?status=PENDING').set(moderator.auth).expect(200);
        expect(pending.body.map((f: { id: string }) => f.id)).toEqual([created.body.id]);
        const approved = await request(server()).post(`/v1/admin/deal-feeds/${created.body.id}/review`).set(moderator.auth).send({ decision: 'APPROVE', note: 'Eigener Shop' }).expect(200);
        expect(approved.body.status).toBe('APPROVED');

        expect(await feeds.runDue()).toEqual({ processed: 1 });
        const deals = await prisma.deal.findMany({ orderBy: { externalId: 'asc' } });
        expect(deals.map((d) => [d.externalId, d.status, d.source, d.feedId])).toEqual([
          ['F-1', 'ACTIVE', 'FEED', created.body.id],
          ['F-2', 'ACTIVE', 'FEED', created.body.id],
        ]);
        // Frühestens nach dem eingestellten Abstand wieder
        expect(await feeds.runDue()).toEqual({ processed: 0 });

        // 304: unverändert → gilt als Bestätigung
        await prisma.dealFeed.update({ where: { id: created.body.id }, data: { nextFetchAt: new Date() } });
        await prisma.deal.updateMany({ data: { lastVerifiedAt: new Date(Date.now() - 5 * 86_400_000) } });
        const notModified = await feeds.runDue();
        expect(notModified.processed).toBe(1);
        expect(state.requests.at(-1)?.inm).toBe('"v1"');
        const verified = await prisma.deal.findMany();
        expect(verified.every((d) => Date.now() - d.lastVerifiedAt!.getTime() < 60_000)).toBe(true);

        // Neue Version: F-1 billiger, F-2 fehlt → beendet
        state.etag = '"v2"';
        state.body = csv([['F-1', 'Akkuschrauber 18 V Set', 'baumarkt-garten', '79,00', day(10), 'https://shop.example.at/as', '', '', '']]);
        await prisma.dealFeed.update({ where: { id: created.body.id }, data: { nextFetchAt: new Date() } });
        await feeds.runDue();
        const after = new Map((await prisma.deal.findMany()).map((d) => [d.externalId, d]));
        expect(after.get('F-1')).toMatchObject({ status: 'ACTIVE', priceCents: 7_900 });
        expect(after.get('F-2')?.status).toBe('EXPIRED');
        expect(await visibleIds()).toEqual([after.get('F-1')!.id]);
        const last = await prisma.dealImport.findFirstOrThrow({ where: { feedId: created.body.id }, orderBy: { createdAt: 'desc' } });
        expect(last.counts).toMatchObject({ update: 1, ended: 1 });

        // Neue Adresse → neue Freigabe nötig
        const changed = await request(server()).put(`/v1/me/deal-feeds/${created.body.id}`).set(merchant.auth).send({ ...FEED, url: 'https://feeds.example.at/neu.csv' }).expect(200);
        expect(changed.body.status).toBe('PENDING');
      } finally {
        target.close();
      }
    });

    it('lässt vom Team ausgeblendete Deals in Prüfung, wenn sie aus dem Feed fallen, und hält angehaltene Feeds an', async () => {
      const merchant = await signInMerchant(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const { state, target, url } = await feedServer();
      try {
        state.body = csv([
          ['F-1', 'Akkuschrauber 18 V Set', 'baumarkt-garten', '89,00', day(10), 'https://shop.example.at/as', '', '', ''],
          ['F-2', 'Laubbläser kabellos', 'baumarkt-garten', '129,00', day(10), 'https://shop.example.at/lb', '', '', ''],
        ]);
        const created = await request(server()).post('/v1/me/deal-feeds').set(merchant.auth).send(FEED).expect(201);
        await prisma.dealFeed.update({ where: { id: created.body.id }, data: { url } });
        await request(server()).post(`/v1/admin/deal-feeds/${created.body.id}/review`).set(moderator.auth).send({ decision: 'APPROVE' }).expect(200);
        const feeds = app.get(DealFeedService);
        await feeds.runDue();
        const hidden = await prisma.deal.findFirstOrThrow({ where: { externalId: 'F-2' } });
        const version = (await request(server()).get(`/v1/admin/deals/${hidden.id}`).set(moderator.auth).expect(200)).body.version;
        await request(server())
          .post(`/v1/admin/deals/${hidden.id}/decisions`)
          .set(moderator.auth)
          .send({ decision: 'HIDE', reason: 'MISLEADING', ground: 'TERMS', statement: 'Der Vergleichspreis ist nicht belegt, das Angebot bleibt bis zur Klärung ausgeblendet.', version })
          .expect(201);
        expect((await prisma.deal.findUniqueOrThrow({ where: { id: hidden.id } })).status).toBe('PENDING_REVIEW');

        // F-2 fällt aus dem Feed: bleibt in Prüfung (nicht „abgelaufen“, das ließe sich verlängern)
        state.etag = '"v2"';
        state.body = csv([['F-1', 'Akkuschrauber 18 V Set', 'baumarkt-garten', '89,00', day(10), 'https://shop.example.at/as', '', '', '']]);
        await prisma.dealFeed.update({ where: { id: created.body.id }, data: { nextFetchAt: new Date() } });
        await feeds.runDue();
        expect(await prisma.deal.findUniqueOrThrow({ where: { id: hidden.id } })).toMatchObject({ status: 'PENDING_REVIEW' });
        await request(server()).post(`/v1/me/deals/${hidden.id}/extend`).set(merchant.auth).send({ endsOn: viennaDayOffset(20) }).expect(409);
        expect(await visibleIds()).not.toContain(hidden.id);

        // Vom Team angehalten: der Händler kann nicht selbst fortsetzen
        await request(server()).post(`/v1/admin/deal-feeds/${created.body.id}/review`).set(moderator.auth).send({ decision: 'PAUSE', note: 'Herkunft klären' }).expect(200);
        await request(server()).post(`/v1/me/deal-feeds/${created.body.id}/resume`).set(merchant.auth).expect(409);
      } finally {
        target.close();
      }
    });

    it('hält einen Feed nach wiederholten Fehlern an und verbirgt fremde Feeds', async () => {
      const merchant = await signInMerchant(app);
      const other = await signInMerchant(app, 'Andere GmbH');
      const moderator = await signInAs(app, 'MODERATOR');
      const { state, target, url } = await feedServer();
      try {
        state.status = 500;
        const created = await request(server()).post('/v1/me/deal-feeds').set(merchant.auth).send(FEED).expect(201);
        await prisma.dealFeed.update({ where: { id: created.body.id }, data: { url } });
        await request(server()).post(`/v1/admin/deal-feeds/${created.body.id}/review`).set(moderator.auth).send({ decision: 'APPROVE' }).expect(200);
        await request(server()).get(`/v1/me/deal-feeds`).set(other.auth).expect(200).expect([]);
        await request(server()).post(`/v1/me/deal-feeds/${created.body.id}/pause`).set(other.auth).expect(404);
        await request(server()).post(`/v1/me/deal-feeds/${created.body.id}/preview`).set(other.auth).expect(404);

        const feeds = app.get(DealFeedService);
        for (let i = 1; i <= DEAL_FEED_MAX_FAILURES; i++) {
          await prisma.dealFeed.update({ where: { id: created.body.id }, data: { nextFetchAt: new Date() } });
          await feeds.runDue();
        }
        const failing = await prisma.dealFeed.findUniqueOrThrow({ where: { id: created.body.id } });
        expect(failing).toMatchObject({ status: 'FAILING', consecutiveFailures: DEAL_FEED_MAX_FAILURES, nextFetchAt: null });
        expect(failing.lastError).toContain('HTTP 500');
        expect(await feeds.runDue()).toEqual({ processed: 0 });
        const failures = await request(server()).get('/v1/admin/deal-imports').set(moderator.auth).expect(200);
        expect(failures.body.length).toBe(DEAL_FEED_MAX_FAILURES);

        // Händler setzt fort, nachdem der Fehler behoben ist
        state.status = 200;
        state.body = csv([['F-9', 'Rasentrimmer 600 W', 'baumarkt-garten', '59,00', day(10), 'https://shop.example.at/rt', '', '', '']]);
        const resumed = await request(server()).post(`/v1/me/deal-feeds/${created.body.id}/resume`).set(merchant.auth).expect(200);
        expect(resumed.body).toMatchObject({ status: 'APPROVED', consecutiveFailures: 0 });
        await feeds.runDue();
        expect(await prisma.deal.count({ where: { feedId: created.body.id, status: 'ACTIVE' } })).toBe(1);
      } finally {
        target.close();
      }
    });

    it('übernimmt Vergleichspreise aus Feeds nur mit Bestätigung', async () => {
      const merchant = await signInMerchant(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const { state, target, url } = await feedServer();
      try {
        state.body = csv([['P-1', 'Staubsauger beutellos', 'haushalt-kueche', '149,00', day(10), 'https://shop.example.at/st', '199,00', '30_tage', '']]);
        const created = await request(server()).post('/v1/me/deal-feeds').set(merchant.auth).send(FEED).expect(201);
        await prisma.dealFeed.update({ where: { id: created.body.id }, data: { url } });
        await request(server()).post(`/v1/admin/deal-feeds/${created.body.id}/review`).set(moderator.auth).send({ decision: 'APPROVE' }).expect(200);
        const feeds = app.get(DealFeedService);
        await feeds.runDue();
        expect(await prisma.deal.count()).toBe(0);

        await request(server()).put(`/v1/me/deal-feeds/${created.body.id}`).set(merchant.auth).send({ ...FEED, url: 'https://feeds.example.at/angebote.csv', referencePricesConfirmed: true }).expect(200);
        // Gleiche Adresse (nach dem Test-Umbau) → bleibt freigegeben
        await prisma.dealFeed.update({ where: { id: created.body.id }, data: { url, nextFetchAt: new Date(), status: 'APPROVED', approvedAt: new Date() } });
        await feeds.runDue();
        expect(await prisma.deal.findFirstOrThrow({ where: { externalId: 'P-1' } })).toMatchObject({ referencePriceType: 'LOWEST_30_DAYS', discountPercent: 25 });
      } finally {
        target.close();
      }
    });
  });

  it('schreibt Fehlerlisten ohne ausführbare Formeln', () => {
    const out = toCsv([['zeile', 'meldung'], ['2', '=HYPERLINK("https://böse.example")'], ['3', '+1+1'], ['4', '@SUMME(A1)'], ['5', '-2']]);
    expect(out).not.toMatch(/;=|;\+|;@/);
    expect(out).toContain("'=HYPERLINK");
  });
});
