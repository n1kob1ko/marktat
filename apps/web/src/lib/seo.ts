import type { DealerProfile, ItemCondition, ListingDetail } from '@marktat/shared';

/** Kurzbeschreibung für Suchergebnisse und Vorschauen: eine Zeile, höchstens 155 Zeichen */
export function metaDescription(text: string, fallback: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return fallback;
  return line.length <= 155 ? line : `${line.slice(0, 152).replace(/\s+\S*$/, '')} …`;
}

const CONDITION: Record<ItemCondition, string> = {
  NEW: 'https://schema.org/NewCondition',
  LIKE_NEW: 'https://schema.org/UsedCondition',
  GOOD: 'https://schema.org/UsedCondition',
  ACCEPTABLE: 'https://schema.org/UsedCondition',
  DEFECTIVE: 'https://schema.org/DamagedCondition',
};

/**
 * Strukturierte Daten (schema.org/Product) für Waren und Fahrzeuge. Jobs und Immobilien bekommen keine,
 * weil deren Typen (JobPosting, Accommodation) Pflichtangaben verlangen, die Inserate nicht immer haben.
 */
export function listingJsonLd(listing: ListingDetail, baseUrl: string): Record<string, unknown> | null {
  if (listing.status !== 'ACTIVE' || listing.vertical === 'JOBS' || listing.vertical === 'REAL_ESTATE') return null;
  const url = `${baseUrl}/anzeige/${listing.id}`;
  const price =
    listing.priceType === 'FREE' ? 0 : listing.priceType === 'FIXED' || listing.priceType === 'NEGOTIABLE' ? listing.priceCents : null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: metaDescription(listing.description, listing.title),
    url,
    image: listing.images.map((image) => image.url),
    category: listing.category.name,
    ...(price !== null && price !== undefined
      ? {
          offers: {
            '@type': 'Offer',
            url,
            price: (price / 100).toFixed(2),
            priceCurrency: 'EUR',
            availability: 'https://schema.org/InStock',
            ...(listing.condition ? { itemCondition: CONDITION[listing.condition] } : {}),
            ...(listing.expiresAt ? { priceValidUntil: listing.expiresAt.slice(0, 10) } : {}),
            seller: {
              '@type': listing.seller.accountType === 'BUSINESS' ? 'Organization' : 'Person',
              name: listing.seller.companyName ?? listing.seller.displayName,
            },
          },
        }
      : {}),
  };
}

export function dealerJsonLd(dealer: DealerProfile, baseUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: dealer.companyName,
    url: `${baseUrl}/haendler/${dealer.id}`,
    ...(dealer.logoUrl ? { logo: dealer.logoUrl } : {}),
    ...(dealer.description ? { description: metaDescription(dealer.description, dealer.companyName) } : {}),
    ...(dealer.address ? { address: dealer.address } : {}),
    ...(dealer.website ? { sameAs: [dealer.website] } : {}),
  };
}

/** JSON für <script type="application/ld+json">: „<“ maskieren, damit Inseratstexte das Skript nicht beenden können */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
