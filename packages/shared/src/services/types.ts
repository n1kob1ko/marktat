import type { ListingModerationInfo, LocationSummary, Paginated } from '../types.js';
import type { PortfolioImageRights, QualificationStatus, ServiceAvailability, ServicePriceType, ServiceProfileStatus } from './enums.js';

export interface ServiceCategoryView {
  slug: string;
  name: string;
  groupSlug: string;
  groupName: string;
  regulated: boolean;
  relatedCategoryPath: string | null;
}

export interface ServiceProviderRef {
  id: string;
  name: string;
  /** Gewerblich (Firmenkonto) oder privat */
  business: boolean;
  memberSince: string;
}

/** Karte in der Suche */
export interface ServiceProfileSummary {
  id: string;
  headline: string;
  summary: string;
  provider: ServiceProviderRef;
  imageUrl: string | null;
  categories: ServiceCategoryView[];
  skills: string[];
  location: LocationSummary | null;
  serviceRadiusKm: number | null;
  austriaWide: boolean;
  remote: boolean;
  priceType: ServicePriceType;
  priceCents: number | null;
  availability: ServiceAvailability;
  /** Mindestens eine vom Team geprüfte Qualifikation */
  hasVerifiedQualification: boolean;
  distanceKm: number | null;
  updatedAt: string;
}

export interface PortfolioItemView {
  id: string;
  title: string;
  description: string | null;
  category: ServiceCategoryView | null;
  url: string | null;
  imageUrl: string | null;
  imageRights: PortfolioImageRights | null;
  imageCredit: string | null;
  /** Vom Team ausgeblendet (nur Inhaber:in und Team sehen den Eintrag) */
  hidden: boolean;
}

export interface QualificationView {
  id: string;
  title: string;
  issuer: string | null;
  /** Öffentlich nur bei geprüften Qualifikationen */
  reference: string | null;
  status: QualificationStatus;
  reviewedAt: string | null;
}

export interface ServiceProfileDetail extends ServiceProfileSummary {
  status: ServiceProfileStatus;
  description: string;
  experienceYears: number | null;
  website: string | null;
  availabilityNote: string | null;
  portfolio: PortfolioItemView[];
  qualifications: QualificationView[];
  /** Pflichtangaben gewerblicher Anbieter (ECG/DSA) */
  imprint: { companyName: string; companyAddress: string | null; companyRegisterNumber: string | null; vatId: string | null } | null;
  /** Kategorien mit möglicher Berufsberechtigung (Hinweis auf GISA) */
  regulatedCategories: string[];
  publishedAt: string | null;
  isOwner: boolean;
  /** Bestehende Unterhaltung der angemeldeten Person */
  conversationId: string | null;
  moderation: ListingModerationInfo | null;
}

export interface ServiceSearchResult extends Paginated<ServiceProfileSummary> {
  totalPages: number;
  location: LocationSummary | null;
}

/** Eigenes Profil im Konto (null, wenn noch keines angelegt ist) */
export interface MyServiceProfile {
  profile: (ServiceProfileDetail & { imageRights: PortfolioImageRights | null; imageCredit: string | null; reviewReason: string | null }) | null;
  /** Fehlende Angaben im Konto für gewerbliche Profile (Firmenname, Anschrift) */
  missingAccountFields: string[];
}
