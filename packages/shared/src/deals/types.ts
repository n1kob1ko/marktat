import type { LocationSummary, Paginated, ListingModerationInfo } from '../types.js';
import type { AffiliateNetwork } from './affiliate.js';
import type { DealAvailability, DealChannel, DealDisplayStatus, DealImageRights, DealLinkStatus, DealSource, ReferencePriceType } from './enums.js';

/** Antwort-Typen des Deal-Bereichs. Datumsfelder als ISO-8601-Strings. */

export interface DealCategoryView {
  slug: string;
  name: string;
  icon: string;
  relatedCategoryPath: string | null;
}

export interface DealMerchant {
  id: string;
  /** Firmenname (bzw. Anzeigename) */
  name: string;
  logoUrl: string | null;
}

/** Herkunft eines zentralen Affiliate-Deals: Händler laut Netzwerk, nie ein MarktAT-Händlerkonto */
export interface DealAffiliateInfo {
  network: AffiliateNetwork;
  /** z. B. „Awin“ */
  networkName: string;
  /** Name des Händlers (Advertiser) laut Netzwerk */
  advertiserName: string;
}

export interface DealStoreView {
  id: string;
  name: string;
  street: string;
  location: LocationSummary;
  openingHours: string | null;
  /** Nur bei Suchen mit Ort: Luftlinie in km (Ortsmittelpunkt der PLZ) */
  distanceKm?: number | null;
}

export interface DealSummary {
  id: string;
  slug: string;
  title: string;
  /** Vorschaubild 480 × 360 oder null */
  imageUrl: string | null;
  channel: DealChannel;
  category: { slug: string; name: string };
  /** Händlerkonto bei MarktAT; null bei Affiliate-Deals */
  merchant: DealMerchant | null;
  /** Nur Affiliate-Deals: Händler und Datenquelle (Kennzeichnung „Werbung“) */
  affiliate: DealAffiliateInfo | null;
  /** Wer das Angebot anbietet (Firmenname des Händlerkontos bzw. Händler laut Netzwerk) */
  sellerName: string;
  priceCents: number;
  unitPriceText: string | null;
  /** Nur mit zulässiger Grundlage; sonst null */
  referencePriceCents: number | null;
  referencePriceType: ReferencePriceType | null;
  discountPercent: number | null;
  availability: DealAvailability;
  startsAt: string;
  endsAt: string;
  /** „Zuletzt geprüft am …“: letzte Bestätigung durch Händler, Import oder Feed */
  lastVerifiedAt: string | null;
  /** Hostname des Angebotslinks, z. B. „shop.example.at“ */
  urlHost: string | null;
  isAffiliateLink: boolean;
  /** Anzahl der Filialen (lokale Angebote) */
  storeCount: number;
  /** Nächstgelegene Filiale (Suche mit Ort) bzw. erste Filiale */
  nearestStore: { name: string; postalCode: string; place: string; distanceKm: number | null } | null;
}

/** Erfasster Preis (eigene Aufzeichnung von MarktAT, keine Schätzung) */
export interface DealPricePoint {
  priceCents: number;
  recordedAt: string;
}

export interface DealDetail extends DealSummary {
  description: string;
  /** Großes Bild oder null */
  largeImageUrl: string | null;
  url: string | null;
  brand: string | null;
  gtin: string | null;
  shippingNote: string | null;
  referencePriceSource: string | null;
  referencePriceEvidenceUrl: string | null;
  imageRights: DealImageRights | null;
  imageCredit: string | null;
  stores: DealStoreView[];
  /** Preisänderungen, die MarktAT selbst erfasst hat (neueste zuerst, max. 20) */
  priceHistory: DealPricePoint[];
  /** Niedrigster bei MarktAT erfasster Preis der 30 Tage vor dem aktuellen Preis */
  lowestRecordedPrice30d: number | null;
  source: DealSource;
  publishedAt: string | null;
  /** Für Händler und Team */
  status: DealDisplayStatus;
  isOwner: boolean;
  isFavorite: boolean;
  linkStatus: DealLinkStatus;
  relatedCategoryPath: string | null;
  /** Händlerseite bei MarktAT; null bei Affiliate-Deals */
  merchantProfileUrl: string | null;
  /** Nur für Händler und Team */
  moderation?: DealModerationInfo | null;
  reviewReason?: string | null;
}

export interface DealFavoriteItem {
  deal: DealSummary;
  /** false = abgelaufen, beendet, gelöscht oder Händler gesperrt */
  available: boolean;
  savedAt: string;
}

export interface DealSearchResult extends Paginated<DealSummary> {
  totalPages: number;
  location: LocationSummary | null;
  engine: 'meilisearch' | 'postgres';
}

/** Eigene Deals im Händlerbereich */
export interface MerchantDeal extends DealSummary {
  status: DealDisplayStatus;
  /** Bestätigung fällig (bzw. bald fällig) */
  verifyBy: string | null;
  linkStatus: DealLinkStatus;
  source: DealSource;
  externalId: string | null;
  viewCount: number;
  clickCount: number;
  reviewReason: string | null;
  updatedAt: string;
}

/** Voraussetzungen, um Deals zu veröffentlichen */
export interface DealerEligibility {
  /** Gewerbliches, aktives Konto */
  business: boolean;
  /** Fehlende Profilangaben (Firmenname, Geschäftsadresse, Telefonnummer) */
  missingFields: string[];
  /** Bestätigung nach Art. 30 DSA abgegeben */
  certified: boolean;
  /** Vom Team für Deals gesperrt */
  blocked: boolean;
  eligible: boolean;
}

export interface MerchantDealOverview {
  eligibility: DealerEligibility;
  deals: MerchantDeal[];
  counts: Record<'active' | 'scheduled' | 'unverified' | 'paused' | 'expired' | 'drafts' | 'review', number>;
}

/** Letzte Moderationsentscheidung zu einem ausgeblendeten Deal (gleicher Aufbau wie bei Inseraten) */
export type DealModerationInfo = ListingModerationInfo;
