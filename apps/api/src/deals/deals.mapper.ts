import {
  AFFILIATE_NETWORK_LABELS,
  DEAL_VERIFY_DAYS,
  displayHost,
  lowestRecordedPrice,
  type DealAffiliateInfo,
  type DealDetail,
  type DealDisplayStatus,
  type DealStoreView,
  type DealSummary,
  type MerchantDeal,
} from '@marktat/shared';
import { Prisma } from '../generated/prisma/client.js';
import { locationInclude, toLocationSummary } from '../geo/geo.service.js';
import type { MediaUrls } from '../images/media.js';
import { logoUrl } from '../users/users.mapper.js';

const DAY_MS = 86_400_000;

export const dealInclude = {
  category: { select: { slug: true, name: true, relatedCategoryPath: true } },
  merchant: {
    select: { id: true, displayName: true, companyName: true, logoKey: true, accountType: true, status: true, deletedAt: true, dealsBlockedAt: true },
  },
  affiliateProgram: { select: { id: true, network: true, name: true, status: true, membership: true, allowImages: true } },
  affiliateFeed: { select: { id: true, status: true } },
  stores: {
    where: { store: { deletedAt: null } },
    include: { store: { include: { location: { include: locationInclude } } } },
  },
} satisfies Prisma.DealInclude;

/** Felder für isDealPublic ohne die übrigen Relationen */
export const dealVisibilityInclude = {
  merchant: { select: { status: true, deletedAt: true, accountType: true, dealsBlockedAt: true } },
  affiliateProgram: { select: { status: true, membership: true } },
  affiliateFeed: { select: { status: true } },
} satisfies Prisma.DealInclude;

export type DealWithRelations = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

/** Ab wann ein Deal ohne erneute Bestätigung nicht mehr als aktuell gilt */
export function verifiedSince(now = new Date()) {
  return new Date(now.getTime() - DEAL_VERIFY_DAYS * DAY_MS);
}

/**
 * Öffentlich sichtbar: aktiv, begonnen, nicht abgelaufen, in den letzten DEAL_VERIFY_DAYS bestätigt, nicht ausverkauft,
 * Link nicht als defekt erkannt – und je nach Herkunft:
 * - Händlerdeal: Händler aktiv, gewerblich und nicht für Deals gesperrt
 * - Affiliate-Deal: Programm vom Team freigegeben, Partnerschaft im Netzwerk aktiv, Feed aktiv
 * Dieselbe Regel gilt in SQL (dealVisibleSql) und im Suchindex.
 */
export function publicDealWhere(now = new Date()): Prisma.DealWhereInput {
  return {
    status: 'ACTIVE',
    deletedAt: null,
    startsAt: { lte: now },
    endsAt: { gt: now },
    lastVerifiedAt: { gt: verifiedSince(now) },
    availability: { not: 'SOLD_OUT' },
    linkStatus: { not: 'BROKEN' },
    // In AND, damit Aufrufer eigene OR-Bedingungen ergänzen können
    AND: [
      {
        OR: [
          { merchant: { is: { status: 'ACTIVE', deletedAt: null, accountType: 'BUSINESS', dealsBlockedAt: null } } },
          { source: 'AFFILIATE', affiliateProgram: { is: { status: 'APPROVED', membership: 'JOINED' } }, affiliateFeed: { is: { status: 'ACTIVE' } } },
        ],
      },
    ],
  };
}

/** Verknüpfungen für dealVisibleSql: dl (deals), mu (Händlerkonto), ap (Partnerprogramm), af (Feed des Netzwerks) */
export function dealJoinsSql(): Prisma.Sql {
  return Prisma.sql`LEFT JOIN users mu ON mu.id = dl.merchant_id
    LEFT JOIN affiliate_programs ap ON ap.id = dl.affiliate_program_id
    LEFT JOIN affiliate_feeds af ON af.id = dl.affiliate_feed_id`;
}

/** Anbietername in SQL (Händlerkonto bzw. Programm) */
export const dealSellerSql = Prisma.sql`COALESCE(mu.company_name, mu.display_name, ap.name)`;

/** SQL-Gegenstück zu publicDealWhere (mit dealJoinsSql) */
export function dealVisibleSql(): Prisma.Sql {
  return Prisma.sql`dl.status = 'ACTIVE' AND dl.deleted_at IS NULL
    AND dl.starts_at <= (now() AT TIME ZONE 'UTC') AND dl.ends_at > (now() AT TIME ZONE 'UTC')
    AND dl.last_verified_at > ((now() AT TIME ZONE 'UTC') - ${`${DEAL_VERIFY_DAYS} days`}::interval)
    AND dl.availability <> 'SOLD_OUT' AND dl.link_status <> 'BROKEN'
    AND (
      (mu.id IS NOT NULL AND mu.status = 'ACTIVE' AND mu.deleted_at IS NULL AND mu.account_type = 'BUSINESS' AND mu.deals_blocked_at IS NULL)
      OR (dl.source = 'AFFILIATE' AND ap.status = 'APPROVED' AND ap.membership = 'JOINED' AND af.status = 'ACTIVE')
    )`;
}

type VisibilityFields = Pick<DealWithRelations, 'status' | 'deletedAt' | 'startsAt' | 'endsAt' | 'lastVerifiedAt' | 'availability' | 'linkStatus' | 'source'> & {
  merchant: Pick<NonNullable<DealWithRelations['merchant']>, 'status' | 'deletedAt' | 'accountType' | 'dealsBlockedAt'> | null;
  affiliateProgram: Pick<NonNullable<DealWithRelations['affiliateProgram']>, 'status' | 'membership'> | null;
  affiliateFeed: Pick<NonNullable<DealWithRelations['affiliateFeed']>, 'status'> | null;
};

/** Anbieter darf gezeigt werden (Händlerkonto bzw. freigegebenes Programm mit aktiver Partnerschaft) */
export function isDealOwnerVisible(deal: Omit<VisibilityFields, 'status' | 'deletedAt' | 'startsAt' | 'endsAt' | 'lastVerifiedAt' | 'availability' | 'linkStatus'>): boolean {
  if (deal.source === 'AFFILIATE') {
    return deal.affiliateProgram?.status === 'APPROVED' && deal.affiliateProgram.membership === 'JOINED' && deal.affiliateFeed?.status === 'ACTIVE';
  }
  const merchant = deal.merchant;
  return Boolean(merchant && merchant.status === 'ACTIVE' && !merchant.deletedAt && merchant.accountType === 'BUSINESS' && !merchant.dealsBlockedAt);
}

export function isDealPublic(deal: VisibilityFields, now = new Date()): boolean {
  return (
    deal.status === 'ACTIVE' &&
    !deal.deletedAt &&
    deal.startsAt <= now &&
    deal.endsAt > now &&
    deal.lastVerifiedAt !== null &&
    deal.lastVerifiedAt > verifiedSince(now) &&
    deal.availability !== 'SOLD_OUT' &&
    deal.linkStatus !== 'BROKEN' &&
    isDealOwnerVisible(deal)
  );
}

/** Status für Händler und Team, inklusive der abgeleiteten Zustände */
export function dealDisplayStatus(
  deal: Pick<DealWithRelations, 'status' | 'startsAt' | 'endsAt' | 'lastVerifiedAt' | 'availability'>,
  now = new Date(),
): DealDisplayStatus {
  if ((deal.status === 'ACTIVE' || deal.status === 'PAUSED') && deal.endsAt <= now) return 'EXPIRED';
  if (deal.status !== 'ACTIVE') return deal.status;
  if (deal.startsAt > now) return 'SCHEDULED';
  if (deal.availability === 'SOLD_OUT') return 'SOLD_OUT';
  if (!deal.lastVerifiedAt || deal.lastVerifiedAt <= verifiedSince(now)) return 'UNVERIFIED';
  return 'ACTIVE';
}

export function merchantName(merchant: Pick<NonNullable<DealWithRelations['merchant']>, 'companyName' | 'displayName'>) {
  return merchant.companyName ?? merchant.displayName;
}

/** Anbieter eines Deals: Händlerkonto bzw. Händler laut Affiliate-Netzwerk */
export function dealSellerName(deal: Pick<DealWithRelations, 'merchant' | 'affiliateProgram'>): string {
  if (deal.merchant) return merchantName(deal.merchant);
  return deal.affiliateProgram?.name ?? 'Unbekannter Händler';
}

export function dealAffiliateInfo(deal: Pick<DealWithRelations, 'source' | 'affiliateProgram'>): DealAffiliateInfo | null {
  if (deal.source !== 'AFFILIATE' || !deal.affiliateProgram) return null;
  const network = deal.affiliateProgram.network;
  return { network, networkName: AFFILIATE_NETWORK_LABELS[network], advertiserName: deal.affiliateProgram.name };
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export type Center = { latitude: number; longitude: number } | null;

function storeViews(deal: DealWithRelations, center: Center): DealStoreView[] {
  const views = deal.stores.map(({ store }) => ({
    id: store.id,
    name: store.name,
    street: store.street,
    location: toLocationSummary(store.location),
    openingHours: store.openingHours,
    distanceKm: center ? distanceKm(center, store.location) : null,
  }));
  return center ? views.sort((a, b) => a.distanceKm! - b.distanceKm!) : views.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function imageUrl(deal: DealWithRelations, urls: MediaUrls, variant: 'thumb' | 'large', now: Date) {
  // Affiliate: Bild des Händlers unverändert über die API (nur wenn das Programm Bilder erlaubt)
  if (deal.source === 'AFFILIATE') {
    if (!deal.externalImageUrl || !deal.affiliateProgram?.allowImages) return null;
    return urls.url('deal', `deals/${deal.id}/partner-image`, deal.id, deal.externalImageUrl, 'large', false);
  }
  if (!deal.imageKey) return null;
  return urls.url('deal', `deals/${deal.id}/image`, deal.id, deal.imageKey, variant, !isDealPublic(deal, now));
}

export function toDealSummary(deal: DealWithRelations, urls: MediaUrls, center: Center = null, now = new Date()): DealSummary {
  const stores = storeViews(deal, center);
  const nearest = stores[0];
  return {
    id: deal.id,
    slug: deal.slug,
    title: deal.title,
    imageUrl: imageUrl(deal, urls, 'thumb', now),
    channel: deal.channel,
    category: { slug: deal.category.slug, name: deal.category.name },
    merchant: deal.merchant ? { id: deal.merchant.id, name: merchantName(deal.merchant), logoUrl: logoUrl(deal.merchant) } : null,
    affiliate: dealAffiliateInfo(deal),
    sellerName: dealSellerName(deal),
    priceCents: deal.priceCents,
    unitPriceText: deal.unitPriceText,
    referencePriceCents: deal.discountPercent !== null ? deal.referencePriceCents : null,
    referencePriceType: deal.discountPercent !== null ? deal.referencePriceType : null,
    discountPercent: deal.discountPercent,
    availability: deal.availability,
    startsAt: deal.startsAt.toISOString(),
    endsAt: deal.endsAt.toISOString(),
    lastVerifiedAt: deal.lastVerifiedAt?.toISOString() ?? null,
    // Affiliate: Ziel ist der Tracking-Link des Netzwerks – angezeigt wird stattdessen der Händler (affiliate)
    urlHost: deal.url && deal.source !== 'AFFILIATE' ? displayHost(deal.url) : null,
    isAffiliateLink: deal.isAffiliateLink,
    storeCount: stores.length,
    nearestStore: nearest
      ? { name: nearest.name, postalCode: nearest.location.postalCode, place: nearest.location.place, distanceKm: nearest.distanceKm ?? null }
      : null,
  };
}

export function toDealDetail(
  deal: DealWithRelations,
  urls: MediaUrls,
  options: { priceRecords: { priceCents: number; recordedAt: Date }[]; viewerId?: string; isFavorite?: boolean; center?: Center; webUrl: string },
  now = new Date(),
): DealDetail {
  // Neueste zuerst: Seit wann gilt der aktuelle Preis? Davor erfasste Preise (max. 30 Tage) ergeben den Vergleich.
  const records = options.priceRecords;
  const changed = records.findIndex((record) => record.priceCents !== deal.priceCents);
  const currentSince = changed > 0 ? records[changed - 1]!.recordedAt : null;
  const largeImageUrl = imageUrl(deal, urls, 'large', now);
  const affiliate = dealAffiliateInfo(deal);
  return {
    ...toDealSummary(deal, urls, options.center ?? null, now),
    description: deal.description,
    largeImageUrl,
    url: deal.url,
    brand: deal.brand,
    gtin: deal.gtin,
    shippingNote: deal.shippingNote,
    referencePriceSource: deal.discountPercent !== null ? deal.referencePriceSource : null,
    referencePriceEvidenceUrl: deal.discountPercent !== null ? deal.referencePriceEvidenceUrl : null,
    imageRights: deal.imageKey ? deal.imageRights : null,
    imageCredit: deal.imageKey ? deal.imageCredit : affiliate && largeImageUrl ? `Produktbild: ${affiliate.advertiserName} (über ${affiliate.networkName})` : null,
    stores: storeViews(deal, options.center ?? null),
    priceHistory: records.slice(0, 20).map((record) => ({ priceCents: record.priceCents, recordedAt: record.recordedAt.toISOString() })),
    lowestRecordedPrice30d: currentSince ? lowestRecordedPrice(records, currentSince) : null,
    source: deal.source,
    publishedAt: deal.publishedAt?.toISOString() ?? null,
    status: dealDisplayStatus(deal, now),
    isOwner: deal.merchantId !== null && options.viewerId === deal.merchantId,
    isFavorite: options.isFavorite ?? false,
    linkStatus: deal.linkStatus,
    relatedCategoryPath: deal.category.relatedCategoryPath,
    merchantProfileUrl: deal.merchantId ? `${options.webUrl}/haendler/${deal.merchantId}` : null,
  };
}

export function toMerchantDeal(deal: DealWithRelations, urls: MediaUrls, now = new Date()): MerchantDeal {
  return {
    ...toDealSummary(deal, urls, null, now),
    status: dealDisplayStatus(deal, now),
    verifyBy: deal.lastVerifiedAt ? new Date(deal.lastVerifiedAt.getTime() + DEAL_VERIFY_DAYS * DAY_MS).toISOString() : null,
    linkStatus: deal.linkStatus,
    source: deal.source,
    externalId: deal.externalId,
    viewCount: deal.viewCount,
    clickCount: deal.clickCount,
    reviewReason: deal.reviewReason,
    updatedAt: deal.updatedAt.toISOString(),
  };
}
