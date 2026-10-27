import { describe, expect, it } from 'vitest';
import type { ListingDetail } from '@marktat/shared';
import { listingJsonLd, metaDescription, serializeJsonLd } from './seo';

const listing = {
  id: 'cmlisting00000000000001',
  title: 'Rennrad Carbon',
  description: 'Sehr leichtes Rennrad.\n\nShimano 105.',
  status: 'ACTIVE',
  vertical: 'MARKETPLACE',
  priceType: 'NEGOTIABLE',
  priceCents: 89_000,
  condition: 'GOOD',
  expiresAt: '2026-12-26T10:00:00.000Z',
  category: { id: 'c1', name: 'Fahrräder', slug: 'fahrraeder', path: 'marktplatz/sport-freizeit/fahrraeder' },
  images: [{ id: 'i1', url: 'https://api.example/v1/images/i1/large', thumbUrl: '', width: 1600, height: 1200, position: 0 }],
  seller: { id: 'u1', displayName: 'Verena', accountType: 'PRIVATE', companyName: null, avatarUrl: null, memberSince: '' },
} as unknown as ListingDetail;

describe('SEO-Hilfen', () => {
  it('kürzt Beschreibungen auf eine Zeile mit höchstens 155 Zeichen', () => {
    expect(metaDescription('  Zeile eins\n\nZeile zwei ', 'x')).toBe('Zeile eins Zeile zwei');
    const long = metaDescription('Wort '.repeat(60), 'x');
    expect(long.length).toBeLessThanOrEqual(155);
    expect(long.endsWith(' …')).toBe(true);
    expect(metaDescription('   ', 'Ersatz')).toBe('Ersatz');
  });

  it('beschreibt aktive Inserate als Produkt mit Angebot in Euro', () => {
    const data = listingJsonLd(listing, 'https://marktat.example')!;
    expect(data).toMatchObject({
      '@type': 'Product',
      name: 'Rennrad Carbon',
      url: 'https://marktat.example/anzeige/cmlisting00000000000001',
      offers: { price: '890.00', priceCurrency: 'EUR', itemCondition: 'https://schema.org/UsedCondition', priceValidUntil: '2026-12-26' },
    });
  });

  it('liefert nichts für Entwürfe, Jobs und Immobilien und kein Angebot bei „Preis auf Anfrage“', () => {
    expect(listingJsonLd({ ...listing, status: 'DRAFT' }, '')).toBeNull();
    expect(listingJsonLd({ ...listing, vertical: 'JOBS' }, '')).toBeNull();
    expect(listingJsonLd({ ...listing, priceType: 'ON_REQUEST', priceCents: null }, '')).not.toHaveProperty('offers');
    expect(listingJsonLd({ ...listing, priceType: 'FREE', priceCents: null }, '')).toMatchObject({ offers: { price: '0.00' } });
  });

  it('maskiert „<“, damit Inseratstexte das Skript-Element nicht beenden', () => {
    const json = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(json).not.toContain('</script>');
    expect(JSON.parse(json).name).toBe('</script><script>alert(1)</script>');
  });
});
