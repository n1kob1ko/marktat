import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { AffiliateSyncService } from '../src/affiliate/affiliate-sync.service.js';
import { mapAwinRow, parseFeedDate, parsePriceCents } from '../src/affiliate/awin-mapping.js';
import { resetEnvCache } from '../src/config/env.js';
import { DealMaintenanceService } from '../src/deals/deal-maintenance.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, drainJobs, flushSearch, mfaToken, resetData, signIn, signInAs } from './helpers.js';

/**
 * Zentrale Affiliate-Deals (Awin) gegen einen lokalen Testserver mit den Schnittstellen von Awin (Feedliste,
 * Produktfeed als gzip-CSV, Publisher-Promotions-API, Produktbilder). Keine echten Zugangsdaten, kein Internet.
 */

const FEED_KEY = 'test-feed-key-0123456789';
const API_TOKEN = 'test-api-token-0123456789';
const PUBLISHER = '123456';
const LEGACY_HEADER = [
  'aw_product_id',
  'merchant_product_id',
  'merchant_id',
  'merchant_name',
  'product_name',
  'description',
  'search_price',
  'rrp_price',
  'currency',
  'aw_deep_link',
  'merchant_image_url',
  'in_stock',
  'valid_from',
  'valid_to',
  'ean',
  'brand_name',
  'merchant_category',
  'delivery_cost',
  'savings_percent',
  'product_price_old',
];

type Product = Record<string, string>;

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

function feedCsv(products: Product[]) {
  return [LEGACY_HEADER.join(','), ...products.map((p) => LEGACY_HEADER.map((h) => csvCell(p[h] ?? '')).join(','))].join('\n');
}

/** „Last Imported“ wie in der Feedliste (Wiener Ortszeit), vor `hoursAgo` Stunden */
function imported(hoursAgo: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() - hoursAgo * 3600_000));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:00`;
}

const deepLink = (id: string) => `https://www.awin1.com/pclick.php?p=${id}&a=${PUBLISHER}&m=1001`;

function product(id: string, overrides: Product = {}): Product {
  return {
    aw_product_id: `9${id}`,
    merchant_product_id: `SKU-${id}`,
    merchant_id: '1001',
    merchant_name: 'Testshop Elektro',
    product_name: `Kabelloser Kopfhörer Modell ${id}`,
    description: '<p>Bluetooth-Kopfhörer mit <b>Geräuschunterdrückung</b>.</p>',
    search_price: '79.99',
    currency: 'EUR',
    aw_deep_link: deepLink(id),
    in_stock: '1',
    ean: '4006381333931',
    brand_name: 'Klangwerk',
    merchant_category: 'Elektronik > Audio > Kopfhörer',
    delivery_cost: '0.00',
    // Rabattangaben im Feed werden nie übernommen
    savings_percent: '60',
    product_price_old: '199.99',
    ...overrides,
  };
}

interface FakeState {
  lastImported: Record<string, string>;
  feeds: Record<string, Product[]>;
  downloads: Record<string, number>;
  failDownloads: number;
  failStatus: number;
  rateLimitPromotions: number;
  promotions: unknown[];
  promotionCalls: number;
  membership: Record<string, string>;
  image: Buffer;
  imageCalls: number;
}

async function fakeAwin() {
  const state: FakeState = {
    lastImported: { '501': imported(6), '502': imported(6), '601': imported(6) },
    feeds: { '501': [], '502': [], '601': [] },
    downloads: {},
    failDownloads: 0,
    failStatus: 500,
    rateLimitPromotions: 0,
    promotions: [],
    promotionCalls: 0,
    membership: { '1001': 'Joined', '1002': 'Joined', '2001': 'Not Joined' },
    image: await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3366aa' } }).jpeg().toBuffer(),
    imageCalls: 0,
  };
  let base = '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === `/datafeed/list/apikey/${FEED_KEY}`) {
      const rows = [
        ['Advertiser ID', 'Advertiser Name', 'Primary Region', 'Membership Status', 'Feed ID', 'Feed Name', 'Language', 'Vertical', 'Last Imported', 'Last Checked', 'No of products', 'URL'],
        ['1001', 'Testshop Elektro', 'AT', state.membership['1001']!, '501', 'Elektronik AT', 'de', 'Retail', state.lastImported['501']!, '2026-10-28 05:00:00', '3', `${base}/datafeed/download/apikey/${FEED_KEY}/fid/501/format/csv/compression/gzip/`],
        ['1002', 'Modehaus Test', 'AT', state.membership['1002']!, '502', 'Mode AT', 'de', '', state.lastImported['502']!, '2026-10-28 05:00:00', '2', `${base}/datafeed/download/apikey/${FEED_KEY}/fid/502/format/csv/`],
        ['2001', 'Nicht beigetreten GmbH', 'DE', state.membership['2001']!, '601', 'Alles DE', 'de', '', state.lastImported['601']!, '', '1', `${base}/datafeed/download/apikey/${FEED_KEY}/fid/601/format/csv/`],
      ];
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.end(rows.map((r) => r.map(csvCell).join(',')).join('\n'));
      return;
    }
    const download = /^\/datafeed\/download\/apikey\/([^/]+)\/fid\/(\d+)\//.exec(url.pathname);
    if (req.method === 'GET' && download) {
      if (download[1] !== FEED_KEY) return void res.writeHead(403).end();
      const fid = download[2]!;
      state.downloads[fid] = (state.downloads[fid] ?? 0) + 1;
      if (state.failDownloads > 0) {
        state.failDownloads--;
        return void res.writeHead(state.failStatus).end('Fehler');
      }
      const csv = feedCsv(state.feeds[fid] ?? []);
      if (url.pathname.includes('/compression/gzip/')) {
        res.writeHead(200, { 'content-type': 'application/x-gzip' });
        res.end(gzipSync(Buffer.from(csv)));
      } else {
        res.writeHead(200, { 'content-type': 'text/csv' });
        res.end(csv);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === `/publisher/${PUBLISHER}/promotions`) {
      state.promotionCalls++;
      if (req.headers.authorization !== `Bearer ${API_TOKEN}`) return void res.writeHead(401).end();
      if (state.rateLimitPromotions > 0) {
        state.rateLimitPromotions--;
        return void res.writeHead(429).end();
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(body) as { filters: { regionCodes: string[]; membership: string } };
        expect(parsed.filters).toMatchObject({ regionCodes: ['AT'], membership: 'joined' });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: state.promotions, pagination: { page: 1, pageSize: 200, total: state.promotions.length } }));
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
      state.imageCalls++;
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(state.image);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { state, server, base };
}

const AWIN_ENV = ['AWIN_ENABLED', 'AWIN_PUBLISHER_ID', 'AWIN_API_TOKEN', 'AWIN_FEED_API_KEY', 'AWIN_API_URL', 'AWIN_PRODUCTDATA_URL', 'AWIN_MAX_PRODUCTS_PER_FEED'] as const;

describe('Affiliate-Deals (Awin)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let fake: Awaited<ReturnType<typeof fakeAwin>>;
  const original = Object.fromEntries(AWIN_ENV.map((key) => [key, process.env[key]]));

  function setAwinEnv(values: Partial<Record<(typeof AWIN_ENV)[number], string>>) {
    for (const key of AWIN_ENV) delete process.env[key];
    Object.assign(process.env, values);
    resetEnvCache();
  }
  const liveEnv = () => ({
    AWIN_ENABLED: 'true',
    AWIN_PUBLISHER_ID: PUBLISHER,
    AWIN_API_TOKEN: API_TOKEN,
    AWIN_FEED_API_KEY: FEED_KEY,
    AWIN_API_URL: fake.base,
    AWIN_PRODUCTDATA_URL: fake.base,
  });

  beforeAll(async () => {
    fake = await fakeAwin();
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetData(prisma);
    setAwinEnv(liveEnv());
    fake.state.downloads = {};
    fake.state.failDownloads = 0;
    fake.state.promotions = [];
    fake.state.membership = { '1001': 'Joined', '1002': 'Joined', '2001': 'Not Joined' };
    fake.state.lastImported = { '501': imported(6), '502': imported(6), '601': imported(6) };
  });
  afterAll(async () => {
    setAwinEnv(Object.fromEntries(Object.entries(original).filter(([, v]) => v !== undefined)) as Record<string, string>);
    await app.close();
    fake.server.close();
  });

  const server = () => app.getHttpServer();
  const sync = () => app.get(AffiliateSyncService);
  const searchIds = async (query = '') => {
    await flushSearch();
    return ((await request(server()).get(`/v1/deals?${query}`).expect(200)).body as { items: { id: string }[] }).items.map((d) => d.id);
  };
  const overview = async (admin: { auth: Record<string, string> }) => (await request(server()).get('/v1/admin/affiliate').set(admin.auth).expect(200)).body;
  const approveNote = 'Programmbedingungen am 28.10.2026 geprüft: Bilder und UVP dürfen gezeigt werden.';

  /** Programm 1001 (Elektronik) freigeben und seinen Feed aktivieren */
  async function approveElectronics(admin: { auth: Record<string, string> }, flags: Partial<{ allowImages: boolean; allowReferencePrices: boolean; allowVouchers: boolean }> = {}) {
    await sync().syncFeedList();
    const program = await prisma.affiliateProgram.findFirstOrThrow({ where: { externalId: '1001' }, include: { feeds: true } });
    await request(server())
      .post(`/v1/admin/affiliate/programs/${program.id}/review`)
      .set(admin.auth)
      .send({ decision: 'APPROVE', note: approveNote, allowImages: true, allowReferencePrices: true, allowVouchers: false, ...flags })
      .expect(200);
    await request(server()).post(`/v1/admin/affiliate/feeds/${program.feeds[0]!.id}/review`).set(admin.auth).send({ decision: 'ACTIVATE' }).expect(200);
    return { program, feed: program.feeds[0]! };
  }

  describe('Zuordnung der Feedzeilen', () => {
    it('liest Preise streng und übernimmt keine Rabattangaben aus dem Feed', () => {
      expect(parsePriceCents('79.99')).toEqual({ cents: 7999, currency: null });
      expect(parsePriceCents('1,299.00')).toEqual({ cents: 129_900, currency: null });
      expect(parsePriceCents('1.299,00 EUR')).toEqual({ cents: 129_900, currency: 'EUR' });
      expect(parsePriceCents('gratis')).toBeNull();
      expect(parsePriceCents('1.2.3')).toBeNull();
      const now = new Date('2026-10-28T10:00:00Z');
      const ok = mapAwinRow(product('1'), now);
      expect(ok).toMatchObject({ ok: true, product: { externalId: 'SKU-1', priceCents: 7999, rrpCents: null, description: 'Bluetooth-Kopfhörer mit Geräuschunterdrückung .', gtin: '4006381333931' } });
      expect(mapAwinRow(product('2', { search_price: '0' }), now)).toEqual({ ok: false, reason: 'invalidPrice' });
      expect(mapAwinRow(product('3', { currency: 'GBP' }), now)).toEqual({ ok: false, reason: 'wrongCurrency' });
      expect(mapAwinRow(product('4', { aw_deep_link: 'javascript:alert(1)' }), now)).toEqual({ ok: false, reason: 'invalidLink' });
      expect(mapAwinRow(product('5', { valid_to: '2026-10-01' }), now)).toEqual({ ok: false, reason: 'expired' });
      expect(mapAwinRow(product('6', { merchant_product_id: '', aw_product_id: '' }), now)).toEqual({ ok: false, reason: 'missingId' });
      // Enhanced-Format (Google-Spalten)
      expect(
        mapAwinRow({ id: 'E-1', title: 'Laufschuh Pro', price: '120.00 EUR', sale_price: '89.00 EUR', sale_price_effective_date: '2026-10-01T00:00:00Z/2026-11-30T23:59:59Z', aw_deep_link: deepLink('E1'), availability: 'in stock', product_type: 'Sport > Laufen' }, now),
      ).toMatchObject({ ok: true, product: { externalId: 'E-1', priceCents: 8900, availability: 'IN_STOCK' } });
    });
  });

  describe('Ohne Freigabe und ohne Zugangsdaten', () => {
    it('ruft ohne AWIN_ENABLED nichts ab und meldet das in der Übersicht', async () => {
      setAwinEnv({});
      const admin = await signInAs(app, 'ADMIN');
      const body = await overview(admin);
      expect(body.config).toMatchObject({ enabled: false, scheduled: false, missing: ['AWIN_PUBLISHER_ID', 'AWIN_API_TOKEN', 'AWIN_FEED_API_KEY'] });
      expect(body.warnings[0].message).toContain('Liveimport ist aus');
      await request(server()).post('/v1/admin/affiliate/sync').set(admin.auth).send({ kind: 'ALL' }).expect(409);
      expect(await sync().syncPromotions()).toBeNull();
      expect(fake.state.promotionCalls).toBe(0);
    });

    it('legt Programme und Feeds nur zur Prüfung an – ohne Freigabe erscheint nichts', async () => {
      fake.state.feeds['501'] = [product('1')];
      await sync().syncAll();
      const programs = await prisma.affiliateProgram.findMany({ include: { feeds: true }, orderBy: { externalId: 'asc' } });
      expect(programs.map((p) => [p.externalId, p.status, p.membership])).toEqual([
        ['1001', 'PENDING', 'JOINED'],
        ['1002', 'PENDING', 'JOINED'],
        ['2001', 'PENDING', 'NOT_JOINED'],
      ]);
      expect(programs.flatMap((p) => p.feeds.map((f) => f.status))).toEqual(['PENDING', 'PENDING', 'PENDING']);
      expect(fake.state.downloads).toEqual({});
      expect(await prisma.deal.count()).toBe(0);
      // Gespeichert wird nie die Download-Adresse mit dem Schlüssel
      const stored = JSON.stringify(await prisma.affiliateFeed.findMany()) + JSON.stringify(await prisma.affiliateSyncRun.findMany());
      expect(stored).not.toContain(FEED_KEY);
    });

    it('Freigabe nur durch die Administration, mit Dokumentation und aktiver Partnerschaft', async () => {
      const admin = await signInAs(app, 'ADMIN');
      const moderator = await signInAs(app, 'MODERATOR');
      await sync().syncFeedList();
      const joined = await prisma.affiliateProgram.findFirstOrThrow({ where: { externalId: '1001' } });
      const notJoined = await prisma.affiliateProgram.findFirstOrThrow({ where: { externalId: '2001' } });
      const body = { decision: 'APPROVE', note: approveNote, allowImages: false, allowReferencePrices: false, allowVouchers: false };
      await request(server()).get('/v1/admin/affiliate').set(moderator.auth).expect(200);
      await request(server()).post(`/v1/admin/affiliate/programs/${joined.id}/review`).set(moderator.auth).send(body).expect(403);
      await request(server()).post(`/v1/admin/affiliate/programs/${joined.id}/review`).set(admin.auth).send({ ...body, note: 'passt' }).expect(400);
      await request(server()).post(`/v1/admin/affiliate/programs/${notJoined.id}/review`).set(admin.auth).send(body).expect(409);
      // Mit 2FA: frische Bestätigung nötig (wie andere kritische Admin-Aktionen)
      const stale = await mfaToken(admin, 3600);
      await request(server()).post(`/v1/admin/affiliate/programs/${joined.id}/review`).set(stale.auth).send(body).expect(403);
      const approved = await request(server()).post(`/v1/admin/affiliate/programs/${joined.id}/review`).set(admin.auth).send(body).expect(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', approvalNote: approveNote, reviewedBy: 'Testperson' });
      const feed = approved.body.feeds[0];
      await request(server()).post(`/v1/admin/affiliate/feeds/${feed.id}/review`).set(moderator.auth).send({ decision: 'ACTIVATE' }).expect(403);
      const other = await prisma.affiliateFeed.findFirstOrThrow({ where: { externalId: '502' } });
      await request(server()).post(`/v1/admin/affiliate/feeds/${other.id}/review`).set(admin.auth).send({ decision: 'ACTIVATE' }).expect(409);
      const audit = await prisma.auditLog.findMany({ where: { action: 'admin.affiliate_program_approve' } });
      expect(audit).toHaveLength(1);
    });
  });

  describe('Produktfeed', () => {
    it('übernimmt freigegebene Produkte als Affiliate-Deals ohne Händlerkonto, mit Kennzeichnung und ohne Doppelte', async () => {
      const admin = await signInAs(app, 'ADMIN');
      fake.state.feeds['501'] = [
        product('1', { rrp_price: '99.99', merchant_image_url: `${fake.base}/img/1.jpg` }),
        product('1', { search_price: '1.00' }),
        product('2', { search_price: '19.99', rrp_price: '99.00' }),
        product('3', { search_price: 'auf Anfrage' }),
        product('4', { currency: 'USD' }),
        product('5', { in_stock: '0' }),
        product('6', { valid_to: '2020-01-01' }),
        product('7', { merchant_category: 'Mode > Schuhe', product_name: 'Sneaker Classic' }),
      ];
      const { program, feed } = await approveElectronics(admin);
      await sync().syncAll();
      expect(fake.state.downloads).toEqual({ '501': 1 });

      const deals = await prisma.deal.findMany({ orderBy: { externalId: 'asc' }, include: { category: true } });
      expect(deals.map((d) => [d.externalId, d.status, d.source, d.merchantId, d.affiliateProgramId, d.discountPercent])).toEqual([
        ['SKU-1', 'ACTIVE', 'AFFILIATE', null, program.id, 20],
        // UVP-Vergleich mit 79 % Rabatt: erst nach Prüfung durch das Team
        ['SKU-2', 'PENDING_REVIEW', 'AFFILIATE', null, program.id, 79],
        ['SKU-7', 'ACTIVE', 'AFFILIATE', null, program.id, null],
      ]);
      expect(deals.map((d) => d.category.slug)).toEqual(['tv-audio', 'tv-audio', 'mode-schuhe']);
      expect(deals[0]).toMatchObject({ priceCents: 7999, referencePriceType: 'RRP', referencePriceSource: 'UVP laut Produktfeed von Testshop Elektro (Awin)', isAffiliateLink: true, url: deepLink('1') });
      // Rabatte aus dem Feed (savings_percent, product_price_old) zählen nicht
      expect(deals[2]!.referencePriceCents).toBeNull();

      const run = await prisma.affiliateSyncRun.findFirstOrThrow({ where: { kind: 'FEED' } });
      expect(run).toMatchObject({ status: 'PARTIAL', feedId: feed.id });
      expect(run.stats).toMatchObject({ rows: 8, created: 3, review: 1, skipped: { invalidPrice: 1, wrongCurrency: 1, outOfStock: 1, expired: 1 } });

      expect((await searchIds()).sort()).toEqual([deals[0]!.id, deals[2]!.id].sort());
      const detail = await request(server()).get(`/v1/deals/${deals[0]!.id}`).expect(200);
      expect(detail.body).toMatchObject({
        merchant: null,
        affiliate: { network: 'AWIN', networkName: 'Awin', advertiserName: 'Testshop Elektro' },
        sellerName: 'Testshop Elektro',
        isAffiliateLink: true,
        urlHost: null,
        merchantProfileUrl: null,
        source: 'AFFILIATE',
        discountPercent: 20,
        referencePriceType: 'RRP',
        imageCredit: 'Produktbild: Testshop Elektro (über Awin)',
      });
      // Suche über den Händlernamen laut Netzwerk
      expect(await searchIds('q=Testshop')).toContain(deals[0]!.id);

      // Bild: unverändert über die API, ohne direkte Verbindung der Besucher zum Händler
      const image = await request(server()).get(new URL(detail.body.imageUrl).pathname).buffer(true).expect(200);
      expect(image.headers['content-type']).toBe('image/jpeg');
      expect(Buffer.compare(image.body as Buffer, fake.state.image)).toBe(0);
      await request(server()).get(`/v1/deals/${deals[1]!.id}/partner-image/large`).expect(404);

      // „Zum Angebot“ liefert den Tracking-Link; die Linkprüfung ruft ihn nie auf (sonst zählten Fake-Klicks)
      const click = await request(server()).post(`/v1/deals/${deals[0]!.id}/click`).expect(200);
      expect(click.body.url).toBe(deepLink('1'));
      expect(await app.get(DealMaintenanceService).checkLinks()).toEqual({ checked: 0, broken: 0 });

      // Überblick für das Team
      const body = await overview(admin);
      expect(body.counts).toMatchObject({ activeDeals: 2, connectedPrograms: 1, pendingPrograms: 2, inReview: 1, withoutImage: 2 });
      expect(body.programs.find((p: { externalId: string }) => p.externalId === '1001')).toMatchObject({ activeDeals: 2, feeds: [{ status: 'ACTIVE', productCount: 3 }] });
      expect(body.runs[0]).toMatchObject({ kind: 'FEED', status: 'PARTIAL', feedName: 'Elektronik AT', stats: { created: 3 } });
    });

    it('zeigt Bilder nur, wenn das Programm sie erlaubt', async () => {
      const admin = await signInAs(app, 'ADMIN');
      fake.state.feeds['501'] = [product('1', { merchant_image_url: `${fake.base}/img/1.jpg` })];
      await approveElectronics(admin, { allowImages: false, allowReferencePrices: false });
      await sync().syncAll();
      const deal = await prisma.deal.findFirstOrThrow();
      const detail = await request(server()).get(`/v1/deals/${deal.id}`).expect(200);
      expect(detail.body).toMatchObject({ imageUrl: null, largeImageUrl: null, imageCredit: null, discountPercent: null });
      const calls = fake.state.imageCalls;
      await request(server()).get(`/v1/deals/${deal.id}/partner-image/large`).expect(404);
      expect(fake.state.imageCalls).toBe(calls);
    });

    it('lädt nur bei neuem Stand, aktualisiert Preise und beendet Produkte, die nicht mehr im Feed sind', async () => {
      const admin = await signInAs(app, 'ADMIN');
      fake.state.feeds['501'] = [product('1'), product('2', { search_price: '49.00' })];
      await approveElectronics(admin, { allowReferencePrices: false });
      await sync().syncAll();
      const [first, second] = await prisma.deal.findMany({ orderBy: { externalId: 'asc' } });
      // „Zuletzt geprüft“ ist der Datenstand bei Awin, nicht der Zeitpunkt des Downloads
      expect(first!.lastVerifiedAt!.toISOString()).toBe(parseFeedDate(fake.state.lastImported['501']!, 'start')!.toISOString());

      // Gleicher Stand laut Feedliste: kein erneuter Download
      await prisma.affiliateFeed.updateMany({ data: { lastFetchedAt: new Date(Date.now() - 4 * 3600_000), nextFetchAt: null } });
      await sync().syncAll();
      expect(fake.state.downloads).toEqual({ '501': 1 });

      // Neuer Stand, aber der letzte Download ist keine 3 Stunden her: noch nicht (Schonung von Awin)
      fake.state.lastImported['501'] = imported(1);
      fake.state.feeds['501'] = [product('1', { search_price: '69.99' })];
      await prisma.affiliateFeed.updateMany({ data: { lastFetchedAt: new Date(Date.now() - 3600_000) } });
      await sync().syncAll();
      expect(fake.state.downloads).toEqual({ '501': 1 });
      // Preis geändert, Produkt 2 entfernt
      await prisma.affiliateFeed.updateMany({ data: { lastFetchedAt: new Date(Date.now() - 4 * 3600_000), nextFetchAt: null } });
      await sync().syncAll();
      expect(fake.state.downloads).toEqual({ '501': 2 });

      const updated = await prisma.deal.findUniqueOrThrow({ where: { id: first!.id } });
      expect(updated).toMatchObject({ priceCents: 6999, status: 'ACTIVE' });
      expect((await prisma.dealPriceRecord.findMany({ where: { dealId: first!.id }, orderBy: { id: 'asc' } })).map((r) => r.priceCents)).toEqual([7999, 6999]);
      expect(await prisma.deal.findUniqueOrThrow({ where: { id: second!.id } })).toMatchObject({ status: 'EXPIRED' });
      expect(await searchIds()).toEqual([first!.id]);
      await request(server()).get(`/v1/deals/${second!.id}`).expect(404);

      // Produkt wieder im Feed: wird erneut aktiv statt doppelt angelegt
      fake.state.lastImported['501'] = imported(0.5);
      fake.state.feeds['501'] = [product('1', { search_price: '69.99' }), product('2', { search_price: '49.00' })];
      await prisma.affiliateFeed.updateMany({ data: { lastFetchedAt: new Date(Date.now() - 4 * 3600_000), nextFetchAt: null } });
      await sync().syncAll();
      expect(await prisma.deal.count()).toBe(2);
      expect(await prisma.deal.findUniqueOrThrow({ where: { id: second!.id } })).toMatchObject({ status: 'ACTIVE' });
    });

    it('blendet Angebote aus, wenn Programm oder Feed angehalten wird oder die Partnerschaft endet', async () => {
      const admin = await signInAs(app, 'ADMIN');
      fake.state.feeds['501'] = [product('1')];
      const { program, feed } = await approveElectronics(admin);
      await sync().syncAll();
      const deal = await prisma.deal.findFirstOrThrow();
      expect(await searchIds()).toEqual([deal.id]);

      await request(server()).post(`/v1/admin/affiliate/feeds/${feed.id}/review`).set(admin.auth).send({ decision: 'PAUSE', note: 'Kurz prüfen' }).expect(200);
      expect(await searchIds()).toEqual([]);
      await request(server()).get(`/v1/deals/${deal.id}`).expect(404);
      await request(server()).post(`/v1/admin/affiliate/feeds/${feed.id}/review`).set(admin.auth).send({ decision: 'ACTIVATE' }).expect(200);
      expect(await searchIds()).toEqual([deal.id]);

      await request(server()).post(`/v1/admin/affiliate/programs/${program.id}/review`).set(admin.auth).send({ decision: 'PAUSE', note: 'Vertrag wird geprüft' }).expect(200);
      expect(await searchIds()).toEqual([]);
      await request(server()).post(`/v1/admin/affiliate/programs/${program.id}/review`).set(admin.auth).send({ decision: 'APPROVE', note: approveNote, allowImages: true, allowReferencePrices: true, allowVouchers: false }).expect(200);
      expect(await searchIds()).toEqual([deal.id]);

      // Partnerschaft bei Awin beendet: Feed verschwindet aus der Liste, Angebote enden
      fake.state.membership['1001'] = 'Suspended';
      await sync().syncFeedList();
      expect(await prisma.affiliateProgram.findUniqueOrThrow({ where: { id: program.id } })).toMatchObject({ membership: 'SUSPENDED' });
      expect(await searchIds()).toEqual([]);
      const body = await overview(admin);
      expect(body.warnings.map((w: { message: string }) => w.message)).toContain('Testshop Elektro: freigegeben, aber laut Awin keine aktive Partnerschaft – Angebote sind ausgeblendet.');
    });

    it('wiederholt Fehler mit Wartezeit, hält den Feed nach fünf Fehlschlägen an und verrät nie den Schlüssel', async () => {
      const admin = await signInAs(app, 'ADMIN');
      fake.state.feeds['501'] = [product('1')];
      const { feed } = await approveElectronics(admin);
      // Ein vorübergehender Fehler: zweiter Versuch klappt
      fake.state.failDownloads = 1;
      await sync().syncAll();
      expect(fake.state.downloads).toEqual({ '501': 2 });
      expect(await prisma.deal.count()).toBe(1);

      // Dauerhafte Fehler
      fake.state.lastImported['501'] = imported(2);
      for (let i = 1; i <= 5; i++) {
        fake.state.failDownloads = 3;
        await prisma.affiliateFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: new Date(Date.now() - 4 * 3600_000), nextFetchAt: null } });
        await sync().syncAll();
        const current = await prisma.affiliateFeed.findUniqueOrThrow({ where: { id: feed.id } });
        expect(current.consecutiveFailures).toBe(i);
        if (i < 5) expect(current.nextFetchAt!.getTime()).toBeGreaterThan(Date.now() + (2 ** (i - 1) - 0.1) * 3600_000);
      }
      const failing = await prisma.affiliateFeed.findUniqueOrThrow({ where: { id: feed.id } });
      expect(failing).toMatchObject({ status: 'FAILING', nextFetchAt: null });
      expect(failing.lastError).toContain('HTTP 500');
      const runs = await prisma.affiliateSyncRun.findMany({ where: { kind: 'FEED', status: 'FAILED' } });
      expect(runs).toHaveLength(5);
      expect(JSON.stringify(runs) + failing.lastError).not.toContain(FEED_KEY);
      const body = await overview(admin);
      expect(body.counts.failingFeeds).toBe(1);
      expect(body.warnings.some((w: { level: string; message: string }) => w.level === 'error' && w.message.includes('angehalten nach wiederholten Fehlern'))).toBe(true);
      expect(await prisma.errorEvent.count()).toBeGreaterThan(0);
    });

    it('trennt Affiliate-Deals strikt von Händlerkonten', async () => {
      const admin = await signInAs(app, 'ADMIN');
      const merchant = await signIn(app, { metadata: { display_name: 'Händler', account_type: 'BUSINESS', company_name: 'Echter Händler GmbH' } });
      fake.state.feeds['501'] = [product('1')];
      await approveElectronics(admin);
      await sync().syncAll();
      const deal = await prisma.deal.findFirstOrThrow();
      // Datenbank: Affiliate-Deal mit Händlerkonto ist unmöglich
      await expect(prisma.deal.update({ where: { id: deal.id }, data: { merchantId: merchant.id } })).rejects.toThrow(/deals_owner_check/);
      const adminWithMfa = await mfaToken(admin, 10);
      await request(server()).put(`/v1/admin/deals/${deal.id}/merchant`).set(adminWithMfa.auth).send({ merchantId: merchant.id, note: 'Bitte dem Händler zuordnen.' }).expect(409);
      // Händlerseite und eigene Deals des Händlers enthalten das Angebot nicht
      expect(await searchIds(`haendler=${merchant.id}`)).toEqual([]);
      const own = await request(server()).get('/v1/me/deals').set(merchant.auth).expect(200);
      expect(own.body.deals).toEqual([]);
    });

    it('Meldung und Moderation funktionieren ohne betroffenes Konto', async () => {
      const admin = await signInAs(app, 'ADMIN');
      const moderator = await signInAs(app, 'MODERATOR');
      const reporter = await signIn(app);
      fake.state.feeds['501'] = [product('1')];
      await approveElectronics(admin);
      await sync().syncAll();
      const deal = await prisma.deal.findFirstOrThrow();
      await request(server()).post(`/v1/deals/${deal.id}/report`).set(reporter.auth).send({ reason: 'MISLEADING', details: 'Preis stimmt im Shop nicht.', goodFaith: true }).expect(201);
      const detail = await request(server()).get(`/v1/admin/deals/${deal.id}`).set(moderator.auth).expect(200);
      expect(detail.body).toMatchObject({ merchant: null, affiliate: { programName: 'Testshop Elektro', networkName: 'Awin', feedName: 'Elektronik AT', externalId: 'SKU-1' } });
      await request(server())
        .post(`/v1/admin/deals/${deal.id}/decisions`)
        .set(moderator.auth)
        .send({ decision: 'HIDE', reason: 'MISLEADING', ground: 'TERMS', statement: 'Der Preis im Shop weicht vom Feed ab und wird geprüft.', version: detail.body.version })
        .expect(201);
      expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ status: 'PENDING_REVIEW' });
      expect(await prisma.moderationDecision.count()).toBe(0);
      expect(await searchIds()).toEqual([]);
      // Ein neuer Feedstand hebt die Entscheidung des Teams nicht auf
      fake.state.lastImported['501'] = imported(2);
      fake.state.feeds['501'] = [product('1', { search_price: '75.00' })];
      await prisma.affiliateFeed.updateMany({ data: { lastFetchedAt: new Date(Date.now() - 4 * 3600_000), nextFetchAt: null } });
      await sync().syncAll();
      expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ status: 'PENDING_REVIEW', priceCents: 7500 });
      await drainJobs();
    });

    it('übernimmt höchstens AWIN_MAX_PRODUCTS_PER_FEED Produkte und beendet dann nichts', async () => {
      const admin = await signInAs(app, 'ADMIN');
      setAwinEnv({ ...liveEnv(), AWIN_MAX_PRODUCTS_PER_FEED: '2' });
      fake.state.feeds['501'] = [product('1'), product('2'), product('3')];
      await approveElectronics(admin);
      await sync().syncAll();
      expect(await prisma.deal.count()).toBe(2);
      const run = await prisma.affiliateSyncRun.findFirstOrThrow({ where: { kind: 'FEED' } });
      expect(run.stats).toMatchObject({ truncated: true, skipped: { limit: 1 } });
    });
  });

  describe('Aktionen und Gutscheine', () => {
    const promotion = (id: string, advertiser: string, overrides: Record<string, unknown> = {}) => ({
      promotionId: id,
      type: 'voucher',
      advertiser: { id: advertiser, name: advertiser === '1001' ? 'Testshop Elektro' : 'Modehaus Test', joined: true },
      title: `Aktion ${id}: 10 € Rabatt ab 50 €`,
      description: 'Gültig für Neukunden.',
      terms: 'Nicht mit anderen Aktionen kombinierbar.',
      startDate: '2026-10-01T00:00:00Z',
      endDate: '2099-12-31T23:59:59Z',
      url: 'https://shop.example.at/aktion',
      urlTracking: `https://www.awin1.com/cread.php?awinmid=${advertiser}&awinaffid=${PUBLISHER}&ued=x`,
      voucher: { code: 'ZEHN10', exclusive: false },
      ...overrides,
    });

    it('zeigt nur Aktionen freigegebener Programme, Gutscheincodes nur mit Erlaubnis, und blendet Entfallenes aus', async () => {
      const admin = await signInAs(app, 'ADMIN');
      await approveElectronics(admin, { allowVouchers: false });
      fake.state.promotions = [promotion('77', '1001'), promotion('78', '1002'), promotion('79', '1001', { endDate: '2020-01-01T00:00:00Z' })];
      fake.state.rateLimitPromotions = 1;
      const stats = await sync().syncPromotions();
      expect(stats).toMatchObject({ promotions: 2, skipped: { expired: 1 } });
      const list = await request(server()).get('/v1/affiliate/promotions').expect(200);
      expect(list.body).toEqual([expect.objectContaining({ title: 'Aktion 77: 10 € Rabatt ab 50 €', voucherCode: null, advertiserName: 'Testshop Elektro', networkName: 'Awin', type: 'VOUCHER' })]);

      // Gutscheine erlaubt: Code erscheint nach dem nächsten Abruf
      const program = await prisma.affiliateProgram.findFirstOrThrow({ where: { externalId: '1001' } });
      await request(server()).post(`/v1/admin/affiliate/programs/${program.id}/review`).set(admin.auth).send({ decision: 'APPROVE', note: approveNote, allowImages: true, allowReferencePrices: true, allowVouchers: true }).expect(200);
      await sync().syncPromotions();
      expect((await request(server()).get('/v1/affiliate/promotions').expect(200)).body[0]).toMatchObject({ voucherCode: 'ZEHN10' });

      // Nicht mehr bei Awin: ausgeblendet
      fake.state.promotions = [promotion('78', '1002')];
      await sync().syncPromotions();
      expect((await request(server()).get('/v1/affiliate/promotions').expect(200)).body).toEqual([]);
      expect(await prisma.affiliatePromotion.count({ where: { hiddenAt: { not: null } } })).toBe(1);
    });

    it('manueller Abruf nur für die Administration, über die Warteschlange', async () => {
      const admin = await signInAs(app, 'ADMIN');
      const moderator = await signInAs(app, 'MODERATOR');
      fake.state.feeds['501'] = [product('1')];
      await approveElectronics(admin);
      await request(server()).post('/v1/admin/affiliate/sync').set(moderator.auth).send({ kind: 'ALL' }).expect(403);
      await request(server()).post('/v1/admin/affiliate/sync').set(admin.auth).send({ kind: 'ALL' }).expect(202);
      await drainJobs();
      expect(await prisma.deal.count()).toBe(1);
      const body = await overview(admin);
      expect(body.lastSuccessfulSync).not.toBeNull();
      expect(body.runs.some((r: { manual: boolean; kind: string }) => r.manual && r.kind === 'FEED')).toBe(true);
    });
  });
});
