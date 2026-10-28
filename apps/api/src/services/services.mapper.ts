import type {
  PortfolioItemView,
  QualificationView,
  ServiceCategoryView,
  ServiceProfileDetail,
  ServiceProfileSummary,
  ServiceProviderRef,
} from '@marktat/shared';
import type { Prisma, ServiceCategory } from '../generated/prisma/client.js';
import { locationInclude, toLocationSummary } from '../geo/geo.service.js';
import type { MediaUrls } from '../images/media.js';
import { portfolioImageUrl, serviceProfileImageUrl } from './service-images.js';

const providerSelect = {
  id: true,
  displayName: true,
  accountType: true,
  companyName: true,
  companyAddress: true,
  companyRegisterNumber: true,
  vatId: true,
  status: true,
  deletedAt: true,
  logoKey: true,
  createdAt: true,
} as const;

export const serviceProfileInclude = {
  user: { select: providerSelect },
  location: { include: locationInclude },
  categories: { include: { category: true } },
  qualifications: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ServiceProfileInclude;

export const serviceProfileDetailInclude = {
  ...serviceProfileInclude,
  portfolio: { include: { category: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.ServiceProfileInclude;

export type ServiceProfileRow = Prisma.ServiceProfileGetPayload<{ include: typeof serviceProfileInclude }>;
export type ServiceProfileDetailRow = Prisma.ServiceProfileGetPayload<{ include: typeof serviceProfileDetailInclude }>;

type Center = { latitude: number; longitude: number } | null;

export function toServiceCategoryView(category: ServiceCategory): ServiceCategoryView {
  return {
    slug: category.slug,
    name: category.name,
    groupSlug: category.groupSlug,
    groupName: category.groupName,
    regulated: category.regulated,
    relatedCategoryPath: category.relatedCategoryPath,
  };
}

export function providerName(user: Pick<ServiceProfileRow['user'], 'accountType' | 'companyName' | 'displayName' | 'deletedAt'>) {
  if (user.deletedAt) return 'Gelöschtes Konto';
  return user.accountType === 'BUSINESS' && user.companyName ? user.companyName : user.displayName;
}

function toProvider(user: ServiceProfileRow['user']): ServiceProviderRef {
  return { id: user.id, name: providerName(user), business: user.accountType === 'BUSINESS', memberSince: user.createdAt.toISOString() };
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

function sortedCategories(profile: ServiceProfileRow) {
  return profile.categories.map((c) => c.category).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function toServiceProfileSummary(profile: ServiceProfileRow, urls: MediaUrls, center: Center = null): ServiceProfileSummary {
  return {
    id: profile.id,
    headline: profile.headline,
    summary: profile.summary,
    provider: toProvider(profile.user),
    imageUrl: serviceProfileImageUrl(profile, urls, 'thumb'),
    categories: sortedCategories(profile).map(toServiceCategoryView),
    skills: profile.skills,
    location: profile.location ? toLocationSummary(profile.location) : null,
    serviceRadiusKm: profile.serviceRadiusKm,
    austriaWide: profile.austriaWide,
    remote: profile.remote,
    priceType: profile.priceType,
    priceCents: profile.priceCents,
    availability: profile.availability,
    hasVerifiedQualification: profile.qualifications.some((q) => q.status === 'VERIFIED'),
    distanceKm: center && profile.location ? distanceKm(center, profile.location) : null,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function toQualificationView(qualification: ServiceProfileRow['qualifications'][number], includeReference: boolean): QualificationView {
  return {
    id: qualification.id,
    title: qualification.title,
    issuer: qualification.issuer,
    // Nachweisnummern erscheinen öffentlich erst nach der Prüfung durch das Team
    reference: includeReference || qualification.status === 'VERIFIED' ? qualification.reference : null,
    status: qualification.status,
    reviewedAt: qualification.reviewedAt?.toISOString() ?? null,
  };
}

function toPortfolioItem(profile: ServiceProfileDetailRow, item: ServiceProfileDetailRow['portfolio'][number], urls: MediaUrls): PortfolioItemView {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category ? toServiceCategoryView(item.category) : null,
    url: item.url,
    imageUrl: portfolioImageUrl(profile, item, urls, 'large'),
    imageRights: item.imageRights,
    imageCredit: item.imageCredit,
    hidden: item.hiddenAt !== null,
  };
}

/**
 * Detailansicht. `privileged` (Inhaber:in oder Team): auch ausgeblendete Portfolio-Einträge, nicht bestätigte
 * Qualifikationen mit Nachweis-Angabe. Öffentlich: abgelehnte Qualifikationen und ausgeblendete Einträge fehlen.
 */
export function toServiceProfileDetail(
  profile: ServiceProfileDetailRow,
  urls: MediaUrls,
  options: { privileged: boolean; isOwner: boolean; conversationId: string | null; isFavorite?: boolean },
): ServiceProfileDetail {
  const { user } = profile;
  const business = user.accountType === 'BUSINESS';
  return {
    ...toServiceProfileSummary(profile, urls),
    imageUrl: serviceProfileImageUrl(profile, urls, 'large'),
    status: profile.status,
    description: profile.description,
    experienceYears: profile.experienceYears,
    website: profile.website,
    availabilityNote: profile.availabilityNote,
    portfolio: profile.portfolio.filter((item) => options.privileged || !item.hiddenAt).map((item) => toPortfolioItem(profile, item, urls)),
    qualifications: profile.qualifications
      .filter((q) => options.privileged || q.status !== 'REJECTED')
      .map((q) => toQualificationView(q, options.privileged)),
    imprint:
      business && user.companyName && !user.deletedAt
        ? { companyName: user.companyName, companyAddress: user.companyAddress, companyRegisterNumber: user.companyRegisterNumber, vatId: user.vatId }
        : null,
    regulatedCategories: sortedCategories(profile)
      .filter((c) => c.regulated)
      .map((c) => c.name),
    publishedAt: profile.publishedAt?.toISOString() ?? null,
    isOwner: options.isOwner,
    conversationId: options.conversationId,
    isFavorite: options.isFavorite ?? false,
    moderation: null,
  };
}
