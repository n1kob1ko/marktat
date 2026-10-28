import http from 'node:http';

/**
 * Testserver mit den Schnittstellen von Awin (Feedliste, Produktfeed als CSV, Publisher-Promotions-API, Produktbild)
 * für affiliate.spec.ts. Läuft nur lokal; die API muss dafür mit diesen Werten gestartet sein (docs/affiliate.md):
 *   AWIN_ENABLED=true AWIN_PUBLISHER_ID=123456 AWIN_API_TOKEN=e2e-api-token-0123456789
 *   AWIN_FEED_API_KEY=e2e-feed-key-0123456789 AWIN_API_URL=http://127.0.0.1:<port> AWIN_PRODUCTDATA_URL=http://127.0.0.1:<port>
 *   OUTBOUND_ALLOW_PRIVATE=true
 * Keine echten Zugangsdaten, kein Internet.
 */

export const FAKE_AWIN = { publisherId: '123456', apiToken: 'e2e-api-token-0123456789', feedKey: 'e2e-feed-key-0123456789' };

const IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAkCAIAAABAJy5dAAAAM0lEQVR42u3OAQkAAAgDsHeyk+FMaQ2FwQIs1XNKhISEhISEhISEhISEhISEhISEhD6FFlwuhLmYQcfSAAAAAElFTkSuQmCC',
  'base64',
);

const HEADER = ['aw_product_id', 'merchant_product_id', 'merchant_id', 'merchant_name', 'product_name', 'description', 'search_price', 'rrp_price', 'currency', 'aw_deep_link', 'merchant_image_url', 'in_stock', 'brand_name', 'merchant_category'];

const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export interface FakeAdvertiser {
  id: string;
  name: string;
  feedId: string;
  products: { sku: string; name: string; price: string; rrp?: string }[];
  voucher?: { title: string; code: string };
}

/** „Last Imported“ wie in der Feedliste (Wiener Ortszeit) */
function viennaNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() - 3600_000));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:00`;
}

export async function startFakeAwin(port: number, advertisers: FakeAdvertiser[]) {
  const base = `http://127.0.0.1:${port}`;
  const lastImported = viennaNow();
  const stats = { feedDownloads: 0, promotionCalls: 0, imageCalls: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', base);
    if (req.method === 'GET' && url.pathname === `/datafeed/list/apikey/${FAKE_AWIN.feedKey}`) {
      const rows = [
        ['Advertiser ID', 'Advertiser Name', 'Primary Region', 'Membership Status', 'Feed ID', 'Feed Name', 'Language', 'Vertical', 'Last Imported', 'Last Checked', 'No of products', 'URL'],
        ...advertisers.map((a) => [a.id, a.name, 'AT', 'Joined', a.feedId, `${a.name} AT`, 'de', 'Retail', lastImported, lastImported, String(a.products.length), `${base}/datafeed/download/apikey/${FAKE_AWIN.feedKey}/fid/${a.feedId}/format/csv/`]),
      ];
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.end(rows.map((r) => r.map(cell).join(',')).join('\n'));
      return;
    }
    const download = /^\/datafeed\/download\/apikey\/([^/]+)\/fid\/(\d+)\//.exec(url.pathname);
    if (req.method === 'GET' && download) {
      if (download[1] !== FAKE_AWIN.feedKey) return void res.writeHead(403).end();
      stats.feedDownloads++;
      const advertiser = advertisers.find((a) => a.feedId === download[2]);
      const lines = (advertiser?.products ?? []).map((p) =>
        [
          `9${p.sku}`,
          p.sku,
          advertiser!.id,
          advertiser!.name,
          p.name,
          'Testprodukt aus dem Awin-Testserver.',
          p.price,
          p.rrp ?? '',
          'EUR',
          `https://www.awin1.com/pclick.php?p=9${p.sku}&a=${FAKE_AWIN.publisherId}&m=${advertiser!.id}`,
          `${base}/img/${p.sku}.png`,
          '1',
          'Klangwerk',
          'Elektronik > Audio > Kopfhörer',
        ]
          .map(cell)
          .join(','),
      );
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.end([HEADER.join(','), ...lines].join('\n'));
      return;
    }
    if (req.method === 'POST' && url.pathname === `/publisher/${FAKE_AWIN.publisherId}/promotions`) {
      stats.promotionCalls++;
      if (req.headers.authorization !== `Bearer ${FAKE_AWIN.apiToken}`) return void res.writeHead(401).end();
      req.resume();
      req.on('end', () => {
        const data = advertisers
          .filter((a) => a.voucher)
          .map((a) => ({
            promotionId: `p${a.id}`,
            type: 'voucher',
            advertiser: { id: a.id, name: a.name, joined: true },
            title: a.voucher!.title,
            description: 'Gültig für alle Bestellungen im Testzeitraum.',
            terms: 'Nicht mit anderen Aktionen kombinierbar.',
            startDate: '2026-01-01T00:00:00Z',
            endDate: '2099-12-31T23:59:59Z',
            url: 'https://shop.example.at/aktion',
            urlTracking: `https://www.awin1.com/cread.php?awinmid=${a.id}&awinaffid=${FAKE_AWIN.publisherId}`,
            voucher: { code: a.voucher!.code, exclusive: false },
          }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data, pagination: { page: 1, pageSize: 200, total: data.length } }));
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
      stats.imageCalls++;
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(IMAGE);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { stats, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
