import {
  carryOverAttributes,
  categoryAttributeSchema,
  formatSalary,
  listingFacts,
  priceSuffix,
  type ListingAttributes,
  type ListingDetail,
  type ListingModerationInfo,
  type ListingStatus,
  type ListingSummary,
} from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { toLocationSummary, locationInclude } from '../geo/geo.service.js';
import { toPublicSeller } from '../users/users.mapper.js';
import type { ImageUrls } from '../images/image-urls.js';

export const listingInclude = {
  category: { select: { id: true, name: true, slug: true, path: true } },
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
      logoKey: true,
      createdAt: true,
      status: true,
      deletedAt: true,
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
  return effectiveStatus(listing) !== 'ACTIVE' || listing.seller.status !== 'ACTIVE' || listing.seller.deletedAt !== null;
}

export function toListingSummary(listing: ListingWithRelations, urls: ImageUrls): ListingSummary {
  const main = listing.images[0];
  const schema = categoryAttributeSchema(listing.category?.path);
  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    priceType: listing.priceType,
    priceCents: listing.priceCents === null ? null : Number(listing.priceCents),
    status: effectiveStatus(listing),
    vertical: listing.vertical,
    category: listing.category ?? { id: '', name: 'Ohne Kategorie', slug: '', path: '' },
    location: listing.location ? toLocationSummary(listing.location) : null,
    imageUrl: main ? urls.url(main.id, 'thumb', needsSignedUrls(listing)) : null,
    isBusiness: listing.seller.accountType === 'BUSINESS',
    facts: listingFacts(schema, listing.attributes),
    priceSuffix: priceSuffix(schema, listing.attributes),
    salary: schema.price === 'none' ? formatSalary(carryOverAttributes(schema, listing.attributes), true) : null,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    createdAt: listing.createdAt.toISOString(),
    ...promotionState(listing),
  };
}

/** Zusatzleistungen wirken nur bis zu ihrem Ende – unabhängig davon, wann der Ablaufjob zuletzt lief. */
export function promotionState(
  listing: Pick<ListingWithRelations, 'highlightedUntil' | 'topUntil' | 'highlightPaid' | 'topPaid' | 'bumpedAt'>,
  now = new Date(),
) {
  const highlighted = listing.highlightedUntil !== null && listing.highlightedUntil > now;
  const top = listing.topUntil !== null && listing.topUntil > now;
  return {
    highlighted,
    top,
    sponsored: (highlighted && listing.highlightPaid) || (top && listing.topPaid),
    bumpedAt: listing.bumpedAt?.toISOString() ?? null,
  };
}

export interface ViewerState {
  isFavorite: boolean;
  conversationId: string | null;
  /** Nur für Eigentümer und Moderation */
  moderation?: ListingModerationInfo | null;
}

export function toListingDetail(
  listing: ListingWithRelations,
  urls: ImageUrls,
  viewerId?: string,
  viewer: ViewerState = { isFavorite: false, conversationId: null },
): ListingDetail {
  const signed = needsSignedUrls(listing);
  return {
    ...toListingSummary(listing, urls),
    description: listing.description,
    images: listing.images.map((image, index) => urls.toDto(image, index, signed)),
    condition: listing.condition,
    attributes: (listing.attributes ?? {}) as ListingAttributes,
    expiresAt: listing.expiresAt?.toISOString() ?? null,
    updatedAt: listing.updatedAt.toISOString(),
    seller: toPublicSeller(listing.seller),
    isOwner: viewerId === listing.sellerId,
    isFavorite: viewer.isFavorite,
    conversationId: viewer.conversationId,
    moderation: viewer.moderation ?? null,
  };
}
