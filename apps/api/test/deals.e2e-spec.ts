import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { DealMaintenanceService, LINK_FAILURES_UNTIL_BROKEN } from '../src/deals/deal-maintenance.service.js';
import { DealSearchService } from '../src/deals/deal-search.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, drainJobs, flushSearch, publishDeal, resetData, signIn, signInAs, signInMerchant, viennaDayOffset } from './helpers.js';

type Account = Awaited<ReturnType<typeof signIn>>;

const STATEMENT = 'Der angegebene Vergleichspreis ist nicht belegt und wurde so nie verlangt.';
const DAY_MS = 86_400_000;

describe('Deals & Angebote', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetData(prisma));
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const search = async (query: string) => {
    await flushSearch();
    return (await request(server()).get(`/v1/deals?${query}`).expect(200)).body as { items: { id: string }[]; total: number; engine: string };
  };
  const searchIds = async (query = '') => (await search(query)).items.map((d) => d.id);

  async function createStore(merchant: Account, postalCode: string, place: string, name = 'Filiale') {
    const location = await prisma.location.findFirstOrThrow({ where: { postalCode, place } });
    const res = await request(server())
      .post('/v1/me/stores')
      .set(merchant.auth)
      .send({ name, street: 'Hauptplatz 1', locationId: location.id })
      .expect(201);
    return res.body.id as string;
  }

  async function adminVersion(moderator: Account, id: string) {
    return (await request(server()).get(`/v1/admin/deals/${id}`).set(moderator.auth).expect(200)).body.version as string;
  }

  describe('Berechtigung', () => {
    it('lässt nur berechtigte gewerbliche Konten veröffentlichen', async () => {
      const privat = await signIn(app);
      const base = {
        title: 'Waschmaschine 8 kg',
        categorySlug: 'haushalt-kueche',
        channel: 'ONLINE',
        url: 'https://shop.example.at/wm',
        priceCents: 39_900,
        startsOn: viennaDayOffset(0),
        endsOn: viennaDayOffset(7),
      };
      await request(server()).post('/v1/me/deals').set(privat.auth).send({ ...base, publish: false }).expect(403);

      const firma = await signIn(app, { metadata: { display_name: 'Neu GmbH', account_type: 'BUSINESS', company_name: 'Neu GmbH' } });
      // Entwurf geht immer, Veröffentlichen erst mit vollständigem Profil und Bestätigung
      const draft = await request(server()).post('/v1/me/deals').set(firma.auth).send({ ...base, publish: false }).expect(201);
      expect(draft.body.status).toBe('DRAFT');
      const missing = await request(server()).post(`/v1/me/deals/${draft.body.id}/publish`).set(firma.auth).expect(403);
      expect(missing.body.message).toContain('Geschäftsadresse');
      await request(server()).patch('/v1/me').set(firma.auth).send({ companyAddress: 'Ring 1, 1010 Wien', phone: '+43 1 123456' }).expect(200);
      const uncertified = await request(server()).post(`/v1/me/deals/${draft.body.id}/publish`).set(firma.auth).expect(403);
      expect(uncertified.body.message).toContain('bestätige');
      await request(server()).post('/v1/me/dealer-certification').set(firma.auth).send({ confirmed: false }).expect(400);
      const eligibility = await request(server()).post('/v1/me/dealer-certification').set(firma.auth).send({ confirmed: true }).expect(200);
      expect(eligibility.body).toMatchObject({ eligible: true, certified: true, blocked: false });
      const published = await request(server()).post(`/v1/me/deals/${draft.body.id}/publish`).set(firma.auth).expect(200);
      expect(published.body.status).toBe('ACTIVE');
      expect(await searchIds()).toEqual([draft.body.id]);
    });

    it('verbirgt fremde Deals und Filialen (404) und lässt nur eigene Filialen zu', async () => {
      const a = await signInMerchant(app, 'A GmbH');
      const b = await signInMerchant(app, 'B GmbH');
      const deal = await publishDeal(app, a.auth);
      const storeA = await createStore(a, '8010', 'Graz');
      await request(server()).patch(`/v1/me/deals/${deal.id}`).set(b.auth).send({ priceCents: 100 }).expect(404);
      await request(server()).post(`/v1/me/deals/${deal.id}/pause`).set(b.auth).expect(404);
      await request(server()).delete(`/v1/me/deals/${deal.id}`).set(b.auth).expect(404);
      await request(server()).delete(`/v1/me/stores/${storeA}`).set(b.auth).expect(404);
      const foreignStore = await request(server())
        .post('/v1/me/deals')
        .set(b.auth)
        .send({ publish: false, title: 'Rasenmäher im Geschäft', categorySlug: 'baumarkt-garten', channel: 'LOCAL', storeIds: [storeA], priceCents: 19_900, startsOn: viennaDayOffset(0), endsOn: viennaDayOffset(5) })
        .expect(400);
      expect(foreignStore.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'storeIds' })]));
    });
  });

  describe('Preise und Rabatte', () => {
    it('berechnet den Rabatt nur aus einer belegten Grundlage und verlangt eine Bestätigung', async () => {
      const merchant = await signInMerchant(app);
      const deal = await publishDeal(app, merchant.auth);
      // (79,90 − 59,90) / 79,90 = 25,03 % → abgerundet 25
      expect(deal.discountPercent).toBe(25);

      const invalid = async (overrides: Record<string, unknown>, path: string) => {
        const res = await request(server())
          .post('/v1/me/deals')
          .set(merchant.auth)
          .send({
            publish: true,
            title: 'Kopfhörer kabellos',
            categorySlug: 'tv-audio',
            channel: 'ONLINE',
            url: 'https://shop.example.at/kh',
            priceCents: 9_900,
            startsOn: viennaDayOffset(0),
            endsOn: viennaDayOffset(7),
            ...overrides,
          })
          .expect(400);
        expect(res.body.errors.map((e: { path: string }) => e.path), JSON.stringify(res.body)).toContain(path);
      };
      await invalid({ referencePriceCents: 12_900, referencePriceType: 'LOWEST_30_DAYS' }, 'referenceConfirmed');
      await invalid({ referencePriceCents: 9_900, referencePriceType: 'LOWEST_30_DAYS', referenceConfirmed: true }, 'referencePriceCents');
      await invalid({ referencePriceCents: 12_900, referencePriceType: 'RRP', referenceConfirmed: true }, 'referencePriceSource');
      // Marktpreisvergleich ist dem Team vorbehalten
      await invalid({ referencePriceCents: 12_900, referencePriceType: 'MARKET_CHECK', referenceConfirmed: true }, 'referencePriceType');
      await invalid({ referencePriceCents: 12_900, referenceConfirmed: true }, 'referencePriceType');
      await invalid({ url: 'http://shop.example.at/kh' }, 'url');
      await invalid({ url: 'https://127.0.0.1/kh' }, 'url');
      await invalid({ url: 'https://user:pw@shop.example.at/' }, 'url');
      await invalid({ url: 'javascript:alert(1)' }, 'url');
      await invalid({ endsOn: viennaDayOffset(120) }, 'endsOn');
      // Ein mitgeschickter Rabatt wird ignoriert: ohne Vergleichspreis gibt es keinen
      const plain = await publishDeal(app, merchant.auth, { title: 'Ohne Vergleichspreis', referencePriceCents: null, referencePriceType: null, referencePriceSource: null, discountPercent: 90 });
      expect(plain.discountPercent).toBeNull();
    });

    it('legt Deals mit sehr hohem Rabatt zur Prüfung vor und zeigt sie erst nach der Freigabe', async () => {
      const merchant = await signInMerchant(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const deal = await publishDeal(app, merchant.auth, { priceCents: 19_900, referencePriceCents: 79_900 });
      expect(deal.discountPercent).toBe(75);
      expect(deal.status).toBe('PENDING_REVIEW');
      expect(await searchIds()).toEqual([]);
      await request(server()).get(`/v1/deals/${deal.id}`).expect(404);

      const queue = await request(server()).get('/v1/admin/deals').set(moderator.auth).expect(200);
      expect(queue.body.items.map((d: { id: string }) => d.id)).toEqual([deal.id]);
      const version = await adminVersion(moderator, deal.id);
      await request(server())
        .post(`/v1/admin/deals/${deal.id}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'RESTORE', statement: 'Die UVP ist auf der Herstellerseite belegt.', version })
        .expect(201);
      expect(await searchIds()).toEqual([deal.id]);

      // Bearbeiten ohne Preisänderung löst keine erneute Prüfung aus
      const edited = await request(server()).patch(`/v1/me/deals/${deal.id}`).set(merchant.auth).send({ description: 'Nur noch wenige Stück.' }).expect(200);
      expect(edited.body.status).toBe('ACTIVE');
      // Geänderter Preis mit weiterhin sehr hohem Rabatt schon
      const repriced = await request(server()).patch(`/v1/me/deals/${deal.id}`).set(merchant.auth).send({ priceCents: 18_900 }).expect(200);
      expect(repriced.body.status).toBe('PENDING_REVIEW');
      // Sinkt der Rabatt unter die Schwelle, entfällt die automatische Prüfung
      const normal = await request(server()).patch(`/v1/me/deals/${deal.id}`).set(merchant.auth).send({ priceCents: 49_900 }).expect(200);
      expect(normal.body).toMatchObject({ status: 'ACTIVE', discountPercent: 37 });
      const history = await request(server()).get(`/v1/deals/${deal.id}`).expect(200);
      expect(history.body.priceHistory.map((p: { priceCents: number }) => p.priceCents)).toEqual([49_900, 18_900, 19_900]);
    });

    it('zeigt den niedrigsten erfassten Preis der letzten 30 Tage vor der aktuellen Preisänderung', async () => {
      const merchant = await signInMerchant(app);
      const deal = await publishDeal(app, merchant.auth, { referencePriceCents: null, referencePriceType: null, referencePriceSource: null, referenceConfirmed: undefined, priceCents: 69_900 });
      await prisma.dealPriceRecord.updateMany({ where: { dealId: deal.id }, data: { recordedAt: new Date(Date.now() - 10 * DAY_MS) } });
      await request(server()).patch(`/v1/me/deals/${deal.id}`).set(merchant.auth).send({ priceCents: 64_900 }).expect(200);
      const detail = await request(server()).get(`/v1/deals/${deal.id}`).expect(200);
      expect(detail.body).toMatchObject({ priceCents: 64_900, lowestRecordedPrice30d: 69_900, discountPercent: null, referencePriceCents: null });
    });
  });

  describe('Suche und Filter', () => {
    it('filtert nach Kategorie, Kanal, Preis, Rabatt, Händler und Umkreis – mit Meilisearch und ohne', async () => {
      const merchant = await signInMerchant(app, 'Elektro Huber GmbH');
      const other = await signInMerchant(app, 'Gartenwelt KG');
      const graz = await createStore(merchant, '8010', 'Graz', 'Graz Zentrum');
      const wien = await createStore(other, '1010', 'Wien', 'Wien Innere Stadt');
      const laptop = await publishDeal(app, merchant.auth);
      const local = await publishDeal(app, merchant.auth, {
        title: 'Fernseher 55 Zoll im Markt',
        categorySlug: 'tv-audio',
        channel: 'LOCAL',
        url: null,
        storeIds: [graz],
        priceCents: 49_900,
        referencePriceCents: null,
        referencePriceType: null,
        referencePriceSource: null,
        referenceConfirmed: undefined,
      });
      const garden = await publishDeal(app, other.auth, {
        title: 'Akku-Rasenmäher 36 V',
        categorySlug: 'baumarkt-garten',
        channel: 'BOTH',
        url: 'https://garten.example.at/maeher',
        storeIds: [wien],
        priceCents: 24_900,
        referencePriceCents: 29_900,
        referencePriceType: 'LOWEST_30_DAYS',
        referencePriceSource: null,
      });
      const draft = await request(server())
        .post('/v1/me/deals')
        .set(merchant.auth)
        .send({ publish: false, title: 'Entwurf Notebook', categorySlug: 'elektronik-computer', channel: 'ONLINE', url: 'https://shop.example.at/x', priceCents: 100, startsOn: viennaDayOffset(0), endsOn: viennaDayOffset(3) })
        .expect(201);

      const check = async () => {
        expect((await searchIds()).sort()).toEqual([laptop.id, local.id, garden.id].sort());
        expect(await searchIds('kategorie=elektronik-computer')).toEqual([laptop.id]);
        expect(await searchIds('q=rasenmäher')).toEqual([garden.id]);
        expect((await searchIds('kanal=online')).sort()).toEqual([laptop.id, garden.id].sort());
        expect((await searchIds('kanal=lokal')).sort()).toEqual([local.id, garden.id].sort());
        expect(await searchIds('preis_bis=300')).toEqual([garden.id]);
        expect(await searchIds('rabatt_ab=20')).toEqual([laptop.id]);
        expect(await searchIds(`haendler=${other.id}`)).toEqual([garden.id]);
        expect(await searchIds('bundesland=steiermark')).toEqual([local.id]);
        expect(await searchIds('plz=8010&umkreis=25')).toEqual([local.id]);
        expect(await searchIds('plz=1010&umkreis=25')).toEqual([garden.id]);
        expect(await searchIds('plz=8010&umkreis=200&sortierung=entfernung')).toEqual([local.id, garden.id]);
        expect(await searchIds('sortierung=preis_auf')).toEqual([garden.id, local.id, laptop.id]);
        expect((await searchIds()).includes(draft.body.id)).toBe(false);
      };
      expect((await search('')).engine).toBe('meilisearch');
      await check();

      const fallback = await createTestApp({ meiliUrl: 'http://127.0.0.1:1' });
      try {
        const res = await request(fallback.app.getHttpServer()).get('/v1/deals?kategorie=elektronik-computer').expect(200);
        expect(res.body).toMatchObject({ engine: 'postgres', total: 1 });
        expect(res.body.items[0].id).toBe(laptop.id);
        const near = await request(fallback.app.getHttpServer()).get('/v1/deals?plz=8010&umkreis=25').expect(200);
        expect(near.body.items.map((d: { id: string }) => d.id)).toEqual([local.id]);
      } finally {
        await fallback.app.close();
      }

      await request(server()).get('/v1/deals?umkreis=25').expect(400);
      // Ohne Ort fällt „Entfernung“ wie bei Inseraten auf „Neueste“ zurück
      await request(server()).get('/v1/deals?sortierung=entfernung').expect(200);
      await request(server()).get('/v1/deals?kanal=fax').expect(400);
    });

    it('zeigt nur aktuelle Deals: geplante, pausierte, abgelaufene, ausverkaufte und unbestätigte nicht', async () => {
      const merchant = await signInMerchant(app);
      const live = await publishDeal(app, merchant.auth);
      const scheduled = await publishDeal(app, merchant.auth, { title: 'Startet morgen', startsOn: viennaDayOffset(1), endsOn: viennaDayOffset(5) });
      const paused = await publishDeal(app, merchant.auth, { title: 'Pausierter Deal' });
      await request(server()).post(`/v1/me/deals/${paused.id}/pause`).set(merchant.auth).expect(200);
      const soldOut = await publishDeal(app, merchant.auth, { title: 'Ausverkaufter Deal', availability: 'SOLD_OUT' });
      const stale = await publishDeal(app, merchant.auth, { title: 'Lange nicht bestätigt' });
      await prisma.deal.update({ where: { id: stale.id }, data: { lastVerifiedAt: new Date(Date.now() - 15 * DAY_MS) } });
      app.get(DealSearchService).index.sync(stale.id);
      expect(await searchIds()).toEqual([live.id]);
      expect(scheduled.status).toBe('SCHEDULED');
      await request(server()).get(`/v1/deals/${stale.id}`).expect(404);

      const overview = await request(server()).get('/v1/me/deals').set(merchant.auth).expect(200);
      expect(overview.body.counts).toMatchObject({ active: 1, scheduled: 1, paused: 1, unverified: 1 });
      const verified = await request(server()).post(`/v1/me/deals/${stale.id}/verify`).set(merchant.auth).expect(200);
      expect(verified.body.status).toBe('ACTIVE');
      expect((await searchIds()).sort()).toEqual([live.id, stale.id].sort());
      expect(soldOut.status).toBe('SOLD_OUT');
    });
  });

  describe('Ablauf, Verlängerung und Linkprüfung', () => {
    it('setzt abgelaufene Deals auf „abgelaufen“ und verlängert sie mit neuer Laufzeit', async () => {
      const merchant = await signInMerchant(app);
      const deal = await publishDeal(app, merchant.auth);
      await prisma.deal.update({ where: { id: deal.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      const maintenance = app.get(DealMaintenanceService);
      expect(await maintenance.expire()).toEqual({ expired: 1 });
      expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe('EXPIRED');
      expect(await searchIds()).toEqual([]);
      await request(server()).post(`/v1/me/deals/${deal.id}/extend`).set(merchant.auth).send({ endsOn: viennaDayOffset(-1) }).expect(400);
      await request(server()).post(`/v1/me/deals/${deal.id}/extend`).set(merchant.auth).send({ endsOn: viennaDayOffset(95) }).expect(400);
      const extended = await request(server()).post(`/v1/me/deals/${deal.id}/extend`).set(merchant.auth).send({ endsOn: viennaDayOffset(30) }).expect(200);
      expect(extended.body.status).toBe('ACTIVE');
      expect(await searchIds()).toEqual([deal.id]);
      expect(await prisma.auditLog.count({ where: { action: 'deal.expired', entityId: deal.id } })).toBe(1);
    });

    it('blendet Deals erst nach mehreren eindeutigen 404-Antworten aus; Sperren und Serverfehler zählen nicht', async () => {
      const statuses = new Map<string, number>([
        ['/gone', 404],
        ['/blocked', 403],
        ['/ok', 200],
      ]);
      const target = http.createServer((req, res) => {
        if (req.method === 'HEAD' && req.url === '/ok') {
          res.writeHead(405).end();
          return;
        }
        res.writeHead(statuses.get(req.url ?? '') ?? 500).end();
      });
      await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
      try {
        const merchant = await signInMerchant(app);
        const gone = await publishDeal(app, merchant.auth, { title: 'Seite gelöscht' });
        const blocked = await publishDeal(app, merchant.auth, { title: 'Bot-Schutz' });
        const ok = await publishDeal(app, merchant.auth, { title: 'Seite vorhanden' });
        // Nur im Test: lokale Adressen (die Eingabeprüfung erlaubt nur öffentliche https-Adressen)
        for (const [id, path] of [[gone.id, '/gone'], [blocked.id, '/blocked'], [ok.id, '/ok']] as const) {
          await prisma.$executeRaw`UPDATE deals SET url = ${base + path} WHERE id = ${id}`;
        }
        const maintenance = app.get(DealMaintenanceService);
        for (let round = 1; round <= LINK_FAILURES_UNTIL_BROKEN; round++) {
          await prisma.$executeRaw`UPDATE deals SET link_checked_at = NULL`;
          await maintenance.checkLinks();
          const visible = await searchIds();
          expect(visible.includes(gone.id), `Runde ${round}`).toBe(round < LINK_FAILURES_UNTIL_BROKEN);
        }
        const rows = await prisma.deal.findMany({ select: { id: true, linkStatus: true, linkFailures: true } });
        const byId = new Map(rows.map((r) => [r.id, r]));
        expect(byId.get(gone.id)).toMatchObject({ linkStatus: 'BROKEN', linkFailures: LINK_FAILURES_UNTIL_BROKEN });
        expect(byId.get(blocked.id)).toMatchObject({ linkStatus: 'UNCHECKED', linkFailures: 0 });
        expect(byId.get(ok.id)).toMatchObject({ linkStatus: 'OK', linkFailures: 0 });
        const overview = await request(server()).get('/v1/me/deals').set(merchant.auth).expect(200);
        expect(overview.body.deals.find((d: { id: string }) => d.id === gone.id).linkStatus).toBe('BROKEN');
      } finally {
        target.close();
      }
    });
  });

  describe('Klicks, Bilder und Meldungen', () => {
    it('zählt Klicks auf „Zum Angebot“ und liefert die Händler-URL nur bei sichtbaren Deals', async () => {
      const merchant = await signInMerchant(app);
      const deal = await publishDeal(app, merchant.auth, { isAffiliateLink: true });
      const res = await request(server()).post(`/v1/deals/${deal.id}/click`).expect(200);
      expect(res.body).toEqual({ url: 'https://shop.example.at/notebook-15' });
      const detail = await request(server()).get(`/v1/deals/${deal.id}`).expect(200);
      expect(detail.body).toMatchObject({ isAffiliateLink: true, urlHost: 'shop.example.at' });
      await request(server()).post(`/v1/me/deals/${deal.id}/pause`).set(merchant.auth).expect(200);
      await request(server()).post(`/v1/deals/${deal.id}/click`).expect(404);
      expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).clickCount).toBe(1);
    });

    it('nimmt Bilder nur mit Angabe der Rechte an und liefert sichtbare Bilder öffentlich aus', async () => {
      const merchant = await signInMerchant(app);
      const deal = await publishDeal(app, merchant.auth);
      const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
      await request(server()).put(`/v1/media/deals/${deal.id}`).set(merchant.auth).set('Content-Type', 'image/png').send(png).expect(400);
      await request(server()).put(`/v1/media/deals/${deal.id}?rechte=MANUFACTURER`).set(merchant.auth).set('Content-Type', 'image/png').send(png).expect(400);
      const other = await signInMerchant(app, 'Fremd GmbH');
      await request(server()).put(`/v1/media/deals/${deal.id}?rechte=OWN`).set(other.auth).set('Content-Type', 'image/png').send(png).expect(404);
      await request(server()).put(`/v1/media/deals/${deal.id}`).set(merchant.auth).set('Content-Type', 'image/png').send(Buffer.from('kein bild')).expect(400);
      const uploaded = await request(server())
        .put(`/v1/media/deals/${deal.id}?rechte=MANUFACTURER&quelle=${encodeURIComponent('Pressebild Hersteller')}`)
        .set(merchant.auth)
        .set('Content-Type', 'image/png')
        .send(png)
        .expect(200);
      expect(uploaded.body).toMatchObject({ imageRights: 'MANUFACTURER', imageCredit: 'Pressebild Hersteller' });
      const path = new URL(uploaded.body.imageUrl as string).pathname + new URL(uploaded.body.imageUrl as string).search;
      await request(server()).get(path).expect(302);
      await request(server()).get(`/v1/deals/${deal.id}/image/original`).expect(404);
    });

    it('nimmt Meldungen an, die Moderation entscheidet begründet und ein Einspruch hebt die Entscheidung auf', async () => {
      const merchant = await signInMerchant(app);
      const reporter = await signIn(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const admin = await signInAs(app, 'ADMIN');
      const deal = await publishDeal(app, merchant.auth);
      const body = { reason: 'MISLEADING', details: 'Die UVP stimmt nicht, der Preis war nie höher.', goodFaith: true };
      await request(server()).post(`/v1/deals/${deal.id}/report`).set(merchant.auth).send(body).expect(403);
      const report = await request(server()).post(`/v1/deals/${deal.id}/report`).set(reporter.auth).send(body).expect(201);
      await request(server()).post(`/v1/deals/${deal.id}/report`).set(reporter.auth).send(body).expect(409);

      const reports = await request(server()).get('/v1/admin/reports?target=DEAL').set(moderator.auth).expect(200);
      expect(reports.body.items[0]).toMatchObject({ id: report.body.id, targetType: 'DEAL', deal: { id: deal.id, status: 'ACTIVE' } });

      const version = await adminVersion(moderator, deal.id);
      await request(server()).post(`/v1/admin/deals/${deal.id}/decisions`).set(moderator.auth).send({ decision: 'REJECT', statement: STATEMENT, version }).expect(400);
      const decision = await request(server())
        .post(`/v1/admin/deals/${deal.id}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'REJECT', reason: 'MISLEADING', ground: 'ILLEGAL', statement: STATEMENT, version })
        .expect(201);
      expect(decision.body).toMatchObject({ action: 'DEAL_REJECTED', deal: { id: deal.id } });
      expect(await searchIds()).toEqual([]);
      await drainJobs();

      const own = await request(server()).get(`/v1/deals/${deal.id}`).set(merchant.auth).expect(200);
      expect(own.body).toMatchObject({ status: 'REJECTED', moderation: { action: 'DEAL_REJECTED', canResubmit: false } });
      const notes = await prisma.notification.findMany({ where: { userId: { in: [merchant.id, reporter.id] } } });
      expect(notes.map((n) => n.type).sort()).toEqual(['DEAL_REJECTED', 'REPORT_HANDLED']);

      await request(server()).post(`/v1/me/decisions/${decision.body.id}/appeal`).set(merchant.auth).send({ body: 'Die UVP ist auf der Herstellerseite nachweisbar, siehe Preisliste.' }).expect(201);
      const appeal = await prisma.appeal.findFirstOrThrow({ where: { decisionId: decision.body.id } });
      await request(server())
        .post(`/v1/admin/appeals/${appeal.id}/decision`)
        .set(admin.auth)
        .send({ outcome: 'REVERSED', response: 'Die Preisempfehlung ist belegt, die Ablehnung war falsch.' })
        .expect(201);
      expect(await searchIds()).toEqual([deal.id]);
    });
  });

  describe('Admin-Bereich', () => {
    const adminRoutes: [string, string][] = [
      ['get', '/v1/admin/deals'],
      ['get', '/v1/admin/deals/abcdefghijklmnopqrstuvwx'],
      ['post', '/v1/admin/deals/abcdefghijklmnopqrstuvwx/decisions'],
      ['put', '/v1/admin/deals/abcdefghijklmnopqrstuvwx/merchant'],
      ['post', '/v1/admin/users/00000000-0000-4000-8000-000000000000/deals-block'],
    ];

    it('lässt ohne Anmeldung und als normales Konto nichts zu; Zuordnung nur für Administratoren', async () => {
      const user = await signIn(app);
      const moderator = await signInAs(app, 'MODERATOR');
      for (const [method, path] of adminRoutes) {
        await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method]!(path).expect(401);
        await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method]!(path).set(user.auth).send({}).expect(403);
      }
      await request(server()).put('/v1/admin/deals/abcdefghijklmnopqrstuvwx/merchant').set(moderator.auth).send({}).expect(403);
    });

    it('findet mögliche Doppelte und auffällige Rabatte', async () => {
      const merchant = await signInMerchant(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const a = await publishDeal(app, merchant.auth);
      const b = await publishDeal(app, merchant.auth, { title: 'NOTEBOOK 15 Zoll, 16 GB RAM', priceCents: 39_900 });
      await publishDeal(app, merchant.auth, { title: 'Anderes Gerät' });
      const duplicates = await request(server()).get('/v1/admin/deals?filter=duplicates').set(moderator.auth).expect(200);
      expect(duplicates.body.items.map((d: { id: string }) => d.id).sort()).toEqual([a.id, b.id].sort());
      const discount = await request(server()).get('/v1/admin/deals?filter=discount').set(moderator.auth).expect(200);
      expect(discount.body.items.map((d: { id: string }) => d.id)).toEqual([b.id]);
      const detail = await request(server()).get(`/v1/admin/deals/${a.id}`).set(moderator.auth).expect(200);
      expect(detail.body.duplicates.map((d: { id: string }) => d.id)).toEqual([b.id]);
      expect(detail.body.merchant).toMatchObject({ companyName: 'Elektro Huber GmbH', eligibility: { eligible: true } });
    });

    it('sperrt ein Händlerkonto für Deals begründet; die Freigabe dürfen nur Administratoren', async () => {
      const merchant = await signInMerchant(app);
      const moderator = await signInAs(app, 'MODERATOR');
      const admin = await signInAs(app, 'ADMIN');
      const deal = await publishDeal(app, merchant.auth);
      const block = { decision: 'BLOCK', reason: 'MISLEADING', ground: 'TERMS', statement: 'Wiederholt erfundene Vergleichspreise trotz Hinweisen.' };
      await request(server()).post(`/v1/admin/users/${merchant.id}/deals-block`).set(moderator.auth).send({ ...block, reason: undefined }).expect(400);
      const res = await request(server()).post(`/v1/admin/users/${merchant.id}/deals-block`).set(moderator.auth).send(block).expect(201);
      expect(res.body).toMatchObject({ action: 'DEALS_BLOCKED', canAppeal: true });
      await request(server()).post(`/v1/admin/users/${merchant.id}/deals-block`).set(moderator.auth).send(block).expect(409);
      expect(await searchIds()).toEqual([]);
      const eligibility = await request(server()).get('/v1/me/dealer-eligibility').set(merchant.auth).expect(200);
      expect(eligibility.body).toMatchObject({ blocked: true, eligible: false });
      await request(server()).post(`/v1/me/deals/${deal.id}/verify`).set(merchant.auth).expect(403);
      const unblock = { decision: 'UNBLOCK', statement: 'Die Preisangaben wurden korrigiert und belegt.' };
      await request(server()).post(`/v1/admin/users/${merchant.id}/deals-block`).set(moderator.auth).send(unblock).expect(403);
      await request(server()).post(`/v1/admin/users/${merchant.id}/deals-block`).set(admin.auth).send(unblock).expect(201);
      expect(await searchIds()).toEqual([deal.id]);
    });
  });
});
