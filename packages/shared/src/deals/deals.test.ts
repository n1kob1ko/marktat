import { describe, expect, it } from 'vitest';
import {
  DEAL_CATEGORIES,
  createDealSchema,
  dealDiscountPercent,
  dealEndsAt,
  dealSearchHref,
  dealStartsAt,
  isSafeExternalUrl,
  isValidGtin,
  lowestRecordedPrice,
  parseDayInput,
  parseDealSearchParams,
  toViennaDay,
  updateDealSchema,
} from '../index.js';

const base = {
  title: 'Notebook 15 Zoll, 16 GB RAM',
  categorySlug: 'elektronik-computer',
  channel: 'ONLINE' as const,
  url: 'https://shop.example.at/notebook-15',
  priceCents: 59_900,
  startsOn: '2026-11-02',
  endsOn: '2026-11-15',
  publish: true,
};

describe('Rabatt', () => {
  it('rechnet nur mit zulässiger Grundlage und rundet ab', () => {
    expect(dealDiscountPercent(59_900, 79_900, 'LOWEST_30_DAYS')).toBe(25); // 25,03 %
    expect(dealDiscountPercent(66_667, 100_000, 'RRP')).toBe(33); // 33,33 % → 33
    expect(dealDiscountPercent(59_900, 79_900, null)).toBeNull();
    expect(dealDiscountPercent(59_900, null, 'RRP')).toBeNull();
    expect(dealDiscountPercent(59_900, 59_900, 'RRP')).toBeNull();
    expect(dealDiscountPercent(59_900, 50_000, 'RRP')).toBeNull();
    // unter 1 % keine Rabattangabe
    expect(dealDiscountPercent(9_950, 10_000, 'RRP')).toBeNull();
  });

  it('niedrigster erfasster Preis nur aus echten Aufzeichnungen im Zeitfenster', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const records = [
      { priceCents: 50_000, recordedAt: '2026-09-01T00:00:00Z' }, // älter als 30 Tage
      { priceCents: 70_000, recordedAt: '2026-10-20T00:00:00Z' },
      { priceCents: 65_000, recordedAt: '2026-11-01T00:00:00Z' },
      { priceCents: 40_000, recordedAt: '2026-11-10T12:00:00Z' }, // aktueller Preis zählt nicht
    ];
    expect(lowestRecordedPrice(records, now)).toBe(65_000);
    expect(lowestRecordedPrice([], now)).toBeNull();
  });
});

describe('Gültigkeit in Wiener Zeit', () => {
  it('Beginn 00:00 und Ende 23:59:59,999 in Wien (Winter- und Sommerzeit)', () => {
    expect(dealStartsAt('2026-11-02').toISOString()).toBe('2026-11-01T23:00:00.000Z');
    expect(dealEndsAt('2026-11-02').toISOString()).toBe('2026-11-02T22:59:59.999Z');
    expect(dealStartsAt('2026-07-01').toISOString()).toBe('2026-06-30T22:00:00.000Z');
    // Tag der Zeitumstellung (25.10.2026)
    expect(dealEndsAt('2026-10-25').toISOString()).toBe('2026-10-25T22:59:59.999Z');
    expect(toViennaDay(new Date('2026-11-01T23:30:00Z'))).toBe('2026-11-02');
  });

  it('liest österreichische und ISO-Datumsangaben', () => {
    expect(parseDayInput('2.11.2026')).toBe('2026-11-02');
    expect(parseDayInput('2026-11-02')).toBe('2026-11-02');
    expect(parseDayInput('31.02.2026')).toBeNull();
    expect(parseDayInput('morgen')).toBeNull();
  });
});

describe('Links und Produktnummern', () => {
  it('akzeptiert nur sichere externe https-Links', () => {
    expect(isSafeExternalUrl('https://shop.example.at/produkt?id=1')).toBe(true);
    for (const bad of [
      'http://shop.example.at',
      'javascript:alert(1)',
      'https://user:pw@shop.example.at',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://localhost/',
      'https://intranet/',
      'https://shop.example.at:8443/',
      'https://shop.example.at/ a',
      'data:text/html,hi',
    ]) {
      expect(isSafeExternalUrl(bad), bad).toBe(false);
    }
  });

  it('prüft die Prüfziffer von GTIN/EAN', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('12345')).toBe(false);
  });
});

describe('Deal-Formular', () => {
  it('akzeptiert ein vollständiges Online-Angebot', () => {
    expect(createDealSchema.safeParse(base).success).toBe(true);
  });

  it('verlangt Link bzw. Filialen je nach Kanal', () => {
    const online = createDealSchema.safeParse({ ...base, url: '' });
    expect(online.success).toBe(false);
    expect(online.error!.issues.map((i) => i.path.join('.'))).toContain('url');
    const local = createDealSchema.safeParse({ ...base, channel: 'LOCAL', url: null });
    expect(local.error!.issues.map((i) => i.path.join('.'))).toContain('storeIds');
    expect(createDealSchema.safeParse({ ...base, channel: 'LOCAL', url: null, storeIds: ['s1'] }).success).toBe(true);
  });

  it('erfindet keine Rabatte: Vergleichspreis braucht Art, Bestätigung und muss höher sein', () => {
    const paths = (input: object) => createDealSchema.safeParse({ ...base, ...input }).error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(paths({ referencePriceCents: 79_900 })).toEqual(expect.arrayContaining(['referencePriceType', 'referenceConfirmed']));
    expect(paths({ referencePriceCents: 50_000, referencePriceType: 'LOWEST_30_DAYS', referenceConfirmed: true })).toContain('referencePriceCents');
    expect(paths({ referencePriceCents: 79_900, referencePriceType: 'RRP', referenceConfirmed: true })).toContain('referencePriceSource');
    expect(paths({ referencePriceCents: 79_900, referencePriceType: 'LOWEST_30_DAYS', referenceConfirmed: true })).toEqual([]);
    // Den geprüften Marktvergleich kann nur das Team setzen
    expect(paths({ referencePriceCents: 79_900, referencePriceType: 'MARKET_CHECK', referenceConfirmed: true })).toContain('referencePriceType');
  });

  it('begrenzt die Laufzeit', () => {
    const tooLong = createDealSchema.safeParse({ ...base, startsOn: '2026-11-01', endsOn: '2027-02-15' });
    expect(tooLong.error!.issues.map((i) => i.path.join('.'))).toContain('endsOn');
    const backwards = createDealSchema.safeParse({ ...base, startsOn: '2026-11-10', endsOn: '2026-11-01' });
    expect(backwards.error!.issues.map((i) => i.path.join('.'))).toContain('endsOn');
  });

  it('Bearbeiten: neuer Vergleichspreis muss bestätigt werden', () => {
    expect(updateDealSchema.safeParse({ referencePriceCents: 79_900 }).success).toBe(false);
    expect(updateDealSchema.safeParse({ referencePriceCents: 79_900, referenceConfirmed: true }).success).toBe(true);
    expect(updateDealSchema.safeParse({ title: 'Neuer Titel für den Deal' }).success).toBe(true);
  });
});

describe('Suchparameter', () => {
  it('liest alle Filter und erzeugt eine kanonische URL', () => {
    const { query, issues } = parseDealSearchParams({
      q: 'laptop',
      kategorie: 'elektronik-computer',
      kanal: 'lokal',
      plz: '1010',
      umkreis: '10',
      preis_bis: '800',
      rabatt_ab: '20',
      sortierung: 'endet_bald',
    });
    expect(issues).toEqual([]);
    expect(query).toMatchObject({ q: 'laptop', category: 'elektronik-computer', channel: 'lokal', postalCode: '1010', radiusKm: 10, priceMax: 800, discountMin: 20, sort: 'endet_bald' });
    expect(dealSearchHref(query)).toBe('/deals?q=laptop&kategorie=elektronik-computer&kanal=lokal&plz=1010&umkreis=10&preis_bis=800&rabatt_ab=20&sortierung=endet_bald');
  });

  it('meldet ungültige Werte', () => {
    const { issues } = parseDealSearchParams({ kategorie: 'gibt-es-nicht', kanal: 'post', umkreis: '7', rabatt_ab: '120', haendler: 'x' });
    expect(issues.map((i) => i.param).sort()).toEqual(['haendler', 'kanal', 'kategorie', 'rabatt_ab', 'umkreis']);
  });

  it('Kategorien haben eindeutige Slugs und Namen', () => {
    expect(new Set(DEAL_CATEGORIES.map((c) => c.slug)).size).toBe(DEAL_CATEGORIES.length);
    expect(new Set(DEAL_CATEGORIES.map((c) => c.name)).size).toBe(DEAL_CATEGORIES.length);
  });
});
