import type { ListingDetail, ListingStatus, ListingSummary } from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { toLocationSummary, locationInclude } from '../geo/geo.service.js';
import { toPublicSeller } from '../users/users.mapper.js';
import type { ImageUrls } from '../images/image-urls.js';

export const listingInclude = {
  category: { select: { id: true, name: true, slug: true } },
  location: { include: locationInclude },
  // Nur fertig verarbeitete Bilder; unverarbeitete Uploads tauchen in keiner Antwort auf.
  images: {
    where: { status: 'READY' },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, width: true, height: true, sortOrder: true },
  },
  seller: {
    select: {
      id: true,
      displayName: true,
      accountType: true,
      companyName: true,
      avatarUrl: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ListingInclude;

export type ListingWithRelations = Prisma.ListingGetPayload<{ include: typeof listingInclude }>;

/** Aktive Inserate mit abgelaufenem Datum gelten als abgelaufen, auch bevor der Hintergrundjob läuft. */
export function effectiveStatus(listing: { status: ListingStatus; expiresAt: Date | null }, now = new Date()) {
  if (listing.status === 'ACTIVE' && listing.expiresAt && listing.expiresAt <= now) return 'EXPIRED';
  return listing.status;
}

/** Öffentlich sichtbare Inserate bekommen unsignierte Bild-URLs, alle anderen signierte (nur für Eigentümer). */
function needsSignedUrls(listing: ListingWithRelations) {
  return effectiveStatus(listing) !== 'ACTIVE';
}

export function toListingSummary(listing: ListingWithRelations, urls: ImageUrls): ListingSummary {
  const main = listing.images[0];
  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    priceType: listing.priceType,
    priceCents: listing.priceCents === null ? null : Number(listing.priceCents),
    status: effectiveStatus(listing),
    category: listing.category ?? { id: '', name: 'Ohne Kategorie', slug: '' },
    location: listing.location ? toLocationSummary(listing.location) : null,
    imageUrl: main ? urls.url(main.id, 'thumb', needsSignedUrls(listing)) : null,
    isBusiness: listing.seller.accountType === 'BUSINESS',
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    createdAt: listing.createdAt.toISOString(),
  };
}

export function toListingDetail(listing: ListingWithRelations, urls: ImageUrls, viewerId?: string): ListingDetail {
  const signed = needsSignedUrls(listing);
  return {
    ...toListingSummary(listing, urls),
    description: listing.description,
    images: listing.images.map((image, index) => urls.toDto(image, index, signed)),
    condition: listing.condition,
    attributes: (listing.attributes ?? {}) as ListingDetail['attributes'],
    expiresAt: listing.expiresAt?.toISOString() ?? null,
    updatedAt: listing.updatedAt.toISOString(),
    seller: toPublicSeller(listing.seller),
    isOwner: viewerId === listing.sellerId,
  };
}
