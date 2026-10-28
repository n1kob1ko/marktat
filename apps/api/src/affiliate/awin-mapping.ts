import {
  AFFILIATE_URL_MAX_LENGTH,
  DEAL_MAX_PRICE_CENTS,
  dealEndsAt,
  dealStartsAt,
  isCalendarDay,
  isSafeExternalUrl,
  type AffiliateSkipReason,
  type DealAvailability,
} from '@marktat/shared';

/**
 * Zeilen aus Awin-Produktfeeds (Legacy-Format mit aw_*-Spalten und „Enhanced“-Format nach Google-Vorbild) in ein
 * einheitliches Produkt umwandeln. Bewusst streng: Was sich nicht sicher lesen lässt, wird übersprungen und gezählt –
 * nie geraten. Rabatte aus dem Feed („savings_percent“, „product_price_old“) werden nie übernommen.
 */

export interface AwinProduct {
  /** Stabile Artikelnummer je Programm (Händler-Artikelnummer, sonst Awin-Produkt-ID) */
  externalId: string;
  title: string;
  description: string;
  brand: string | null;
  gtin: string | null;
  priceCents: number;
  /** UVP laut Feed (nur verwendet, wenn das Programm Vergleichspreise erlaubt) */
  rrpCents: number | null;
  /** Tracking-Link des Netzwerks */
  url: string;
  imageUrl: string | null;
  availability: DealAvailability;
  validFrom: Date | null;
  validTo: Date | null;
  /** Kategorie(n) laut Feed, für die Zuordnung */
  categoryText: string;
  shippingNote: string | null;
}

export type MappedRow = { ok: true; product: AwinProduct } | { ok: false; reason: AffiliateSkipReason };

const pick = (row: Record<string, string>, ...names: string[]) => {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
};

/** „12.99“, „1,299.00“, „1.299,00“, „15.00 EUR“ → Cent; null, wenn unklar */
export function parsePriceCents(input: string): { cents: number; currency: string | null } | null {
  const currency = /\b([A-Z]{3})\b/.exec(input)?.[1] ?? (input.includes('€') ? 'EUR' : null);
  let value = input.replace(/[A-Za-z€$£\s]/g, '');
  if (!value || !/^\d[\d.,]*$/.test(value)) return null;
  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Das spätere Zeichen ist das Dezimaltrennzeichen
    value = lastDot > lastComma ? value.replace(/,/g, '') : value.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    // Nur Komma: Dezimal bei 1–2 Nachkommastellen, sonst Tausender
    value = /,\d{1,2}$/.test(value) && value.split(',').length === 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if (lastDot >= 0 && value.split('.').length > 2) {
    return null;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return { cents: Math.round(amount * 100), currency };
}

/** Datum aus Feeds: „2026-11-02“, „2026-11-02T10:00:00“, „2026-11-02 10:00:00“, ISO mit Zeitzone */
export function parseFeedDate(input: string, edge: 'start' | 'end'): Date | null {
  const value = input.trim();
  if (!value || value.startsWith('0000')) return null;
  if (isCalendarDay(value)) return edge === 'start' ? dealStartsAt(value) : dealEndsAt(value);
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!match || !isCalendarDay(match[1]!)) return null;
  if (match[5]) {
    const date = new Date(value.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  // Ohne Zeitzone: Wiener Zeit (Tagesbeginn + Uhrzeit)
  const start = dealStartsAt(match[1]!);
  return new Date(start.getTime() + (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0)) * 1000);
}

const cleanText = (value: string) =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    // Steuerzeichen außer Zeilenumbruch
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Auf eine Länge kürzen, möglichst an einer Wortgrenze */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const safeUrl = (value: string) => (value && isSafeExternalUrl(value, AFFILIATE_URL_MAX_LENGTH) ? value : null);
/** Nur Tests: Bilder vom lokalen Testserver */
const testImageUrl = (value: string, allowPrivate: boolean) => (allowPrivate && /^http:\/\/127\.0\.0\.1:\d+\//.test(value) ? value : null);

function availabilityOf(row: Record<string, string>): DealAvailability {
  const inStock = pick(row, 'in_stock', 'is_for_sale');
  if (inStock === '1' || inStock.toLowerCase() === 'yes' || inStock.toLowerCase() === 'true') return 'IN_STOCK';
  if (inStock === '0' || inStock.toLowerCase() === 'no' || inStock.toLowerCase() === 'false') return 'SOLD_OUT';
  const status = pick(row, 'availability', 'stock_status').toLowerCase().replace(/[_-]/g, ' ');
  if (!status) return 'UNKNOWN';
  if (status.includes('out of stock') || status.includes('nicht') || status.includes('ausverkauft') || status === 'discontinued') return 'SOLD_OUT';
  if (status.includes('limited') || status.includes('wenige')) return 'LIMITED';
  if (status.includes('in stock') || status.includes('lagernd') || status.includes('verfügbar') || status === 'available') return 'IN_STOCK';
  return 'UNKNOWN';
}

/** Eine Feedzeile umwandeln (Spaltennamen in Kleinbuchstaben) */
export function mapAwinRow(row: Record<string, string>, now = new Date(), options: { allowPrivateImages?: boolean } = {}): MappedRow {
  const externalId = pick(row, 'merchant_product_id', 'id', 'aw_product_id').slice(0, 100);
  if (!externalId) return { ok: false, reason: 'missingId' };
  const title = truncate(cleanText(pick(row, 'product_name', 'title')).replace(/\s+/g, ' '), 120);
  if (title.length < 3) return { ok: false, reason: 'missingTitle' };

  // Enhanced: Aktionspreis nur innerhalb seines Zeitraums
  let priceText = pick(row, 'search_price', 'store_price', 'display_price');
  if (!priceText) {
    const sale = pick(row, 'sale_price');
    const [saleFrom, saleTo] = pick(row, 'sale_price_effective_date').split('/');
    const from = saleFrom ? parseFeedDate(saleFrom, 'start') : null;
    const to = saleTo ? parseFeedDate(saleTo, 'end') : null;
    const saleActive = sale && (!from || from <= now) && (!to || to > now);
    priceText = saleActive ? sale : pick(row, 'price');
  }
  const price = priceText ? parsePriceCents(priceText) : null;
  if (!price || price.cents <= 0 || price.cents > DEAL_MAX_PRICE_CENTS) return { ok: false, reason: 'invalidPrice' };
  const currency = (pick(row, 'currency') || price.currency || 'EUR').toUpperCase();
  if (currency !== 'EUR') return { ok: false, reason: 'wrongCurrency' };

  const url = safeUrl(pick(row, 'aw_deep_link'));
  if (!url) return { ok: false, reason: 'invalidLink' };

  const validFrom = parseFeedDate(pick(row, 'valid_from'), 'start');
  const validTo = parseFeedDate(pick(row, 'valid_to', 'expiration_date'), 'end');
  if (validTo && validTo <= now) return { ok: false, reason: 'expired' };

  const rrp = pick(row, 'rrp_price');
  const rrpParsed = rrp ? parsePriceCents(rrp) : null;
  const gtin = pick(row, 'ean', 'product_gtin', 'gtin', 'upc').replace(/\s/g, '');
  const delivery = pick(row, 'delivery_cost');
  const deliveryParsed = delivery ? parsePriceCents(delivery) : null;

  return {
    ok: true,
    product: {
      externalId,
      title,
      description: truncate(cleanText(pick(row, 'description', 'product_short_description')), 3000),
      brand: truncate(cleanText(pick(row, 'brand_name', 'brand')), 60) || null,
      gtin: /^\d{8,14}$/.test(gtin) ? gtin : null,
      priceCents: price.cents,
      rrpCents: rrpParsed && rrpParsed.cents > 0 && (rrpParsed.currency ?? 'EUR') === 'EUR' ? rrpParsed.cents : null,
      url,
      imageUrl: (() => {
        const image = pick(row, 'merchant_image_url', 'large_image', 'image_link', 'aw_image_url');
        return safeUrl(image) ?? testImageUrl(image, options.allowPrivateImages ?? false);
      })(),
      availability: availabilityOf(row),
      validFrom,
      validTo,
      categoryText: [pick(row, 'merchant_category', 'product_type'), pick(row, 'category_name', 'google_product_category')].filter(Boolean).join(' > '),
      shippingNote:
        deliveryParsed && deliveryParsed.currency !== 'USD'
          ? deliveryParsed.cents === 0
            ? 'Versandkostenfrei laut Händler'
            : `Versand ab ${(deliveryParsed.cents / 100).toFixed(2).replace('.', ',')} € laut Händler`
          : null,
    },
  };
}

/** Kategorie anhand von Schlagwörtern in Feed-Kategorie und Titel (Reihenfolge = Vorrang) */
const CATEGORY_KEYWORDS: [slug: string, pattern: RegExp][] = [
  ['smartphones-tablets', /\b(smartphone|handy|mobiltelefon|mobile phone|tablet|ipad|iphone)/i],
  ['gaming', /\b(gaming|konsole|console|playstation|xbox|nintendo|videospiel|video game)/i],
  ['tv-audio', /\b(fernseh|tv\b|television|audio|kopfhörer|headphone|lautsprecher|speaker|soundbar|hifi|hi-fi)/i],
  ['elektronik-computer', /\b(elektronik|electronic|computer|laptop|notebook|pc\b|monitor|drucker|printer|kamera|camera|zubehör computer)/i],
  ['autozubehoer', /\b(auto\b|autozubehör|kfz|car accessor|reifen|tyre|tire|motorrad)/i],
  ['baby-familie', /\b(baby|kinderwagen|windel|spielzeug|toy|kinder)/i],
  ['mode-schuhe', /\b(mode|fashion|bekleidung|clothing|schuh|shoe|sneaker|jacke|kleid|shirt|hose|tasche|bag|schmuck|jewel|uhr\b|watch)/i],
  ['sport-freizeit', /\b(sport|fitness|fahrrad|bike|outdoor|camping|wander|ski\b|laufen|running)/i],
  ['drogerie', /\b(drogerie|kosmetik|cosmetic|beauty|parfum|perfume|pflege|hygiene|gesundheit|health)/i],
  ['lebensmittel', /\b(lebensmittel|food|getränk|drink|wein|wine|kaffee|coffee|tee\b|snack)/i],
  ['moebel-wohnen', /\b(möbel|furniture|wohnen|home decor|deko|lampe|leuchte|teppich|bett|sofa|matratze)/i],
  ['baumarkt-garten', /\b(baumarkt|garten|garden|werkzeug|tool|diy|heimwerk)/i],
  ['haushalt-kueche', /\b(haushalt|household|küche|kitchen|kochen|staubsauger|vacuum|waschmaschine|kühlschrank|appliance)/i],
  ['reisen-freizeit', /\b(reise|travel|hotel|urlaub|flug|flight|ticket|freizeitpark)/i],
];

export function matchDealCategory(product: Pick<AwinProduct, 'categoryText' | 'title'>): string | null {
  for (const [slug, pattern] of CATEGORY_KEYWORDS) if (pattern.test(product.categoryText)) return slug;
  for (const [slug, pattern] of CATEGORY_KEYWORDS) if (pattern.test(product.title)) return slug;
  return null;
}

/** Feldwerte, deren Änderung den Deal ändert (für „unverändert“ ohne Schreibzugriff) */
export function productHash(product: AwinProduct, extra: string): string {
  return JSON.stringify([
    product.title,
    product.description,
    product.brand,
    product.gtin,
    product.priceCents,
    product.rrpCents,
    product.url,
    product.imageUrl,
    product.availability,
    product.validFrom?.getTime() ?? null,
    product.validTo?.getTime() ?? null,
    product.shippingNote,
    extra,
  ]);
}
