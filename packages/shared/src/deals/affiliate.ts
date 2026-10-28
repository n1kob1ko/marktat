import { CONTROL_CHARS } from '../schemas/interactions.js';
import { z } from '../schemas/zod.js';

/**
 * Zentrale Affiliate-Deals (Publisher-Programme in Affiliate-Netzwerken, derzeit Awin). Getrennt von den
 * Angeboten der Händlerkonten: Ein Affiliate-Deal gehört einem freigegebenen Partnerprogramm, nie einem
 * MarktAT-Händler. Regeln und Ablauf: docs/affiliate.md
 */

export const AFFILIATE_NETWORKS = ['AWIN'] as const;
export type AffiliateNetwork = (typeof AFFILIATE_NETWORKS)[number];
export const AFFILIATE_NETWORK_LABELS: Record<AffiliateNetwork, string> = { AWIN: 'Awin' };

export const AFFILIATE_PROGRAM_STATUSES = ['PENDING', 'APPROVED', 'PAUSED', 'REJECTED'] as const;
export type AffiliateProgramStatus = (typeof AFFILIATE_PROGRAM_STATUSES)[number];
export const AFFILIATE_PROGRAM_STATUS_LABELS: Record<AffiliateProgramStatus, string> = {
  PENDING: 'Wartet auf Freigabe',
  APPROVED: 'Freigegeben',
  PAUSED: 'Angehalten',
  REJECTED: 'Abgelehnt',
};

export const AFFILIATE_MEMBERSHIPS = ['JOINED', 'NOT_JOINED', 'PENDING', 'SUSPENDED', 'UNKNOWN'] as const;
export type AffiliateMembership = (typeof AFFILIATE_MEMBERSHIPS)[number];
export const AFFILIATE_MEMBERSHIP_LABELS: Record<AffiliateMembership, string> = {
  JOINED: 'Partnerschaft aktiv',
  NOT_JOINED: 'Nicht beigetreten',
  PENDING: 'Bewerbung offen',
  SUSPENDED: 'Partnerschaft ausgesetzt',
  UNKNOWN: 'Unbekannt',
};

export const AFFILIATE_FEED_STATUSES = ['PENDING', 'ACTIVE', 'PAUSED', 'FAILING', 'REMOVED'] as const;
export type AffiliateFeedStatus = (typeof AFFILIATE_FEED_STATUSES)[number];
export const AFFILIATE_FEED_STATUS_LABELS: Record<AffiliateFeedStatus, string> = {
  PENDING: 'Wartet auf Freigabe',
  ACTIVE: 'Aktiv',
  PAUSED: 'Angehalten',
  FAILING: 'Fehlerhaft',
  REMOVED: 'Nicht mehr verfügbar',
};

export const AFFILIATE_SYNC_KINDS = ['FEED_LIST', 'FEED', 'PROMOTIONS'] as const;
export type AffiliateSyncKind = (typeof AFFILIATE_SYNC_KINDS)[number];
export const AFFILIATE_SYNC_KIND_LABELS: Record<AffiliateSyncKind, string> = {
  FEED_LIST: 'Programme und Feedliste',
  FEED: 'Produktfeed',
  PROMOTIONS: 'Aktionen und Gutscheine',
};

export const AFFILIATE_SYNC_STATUSES = ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'] as const;
export type AffiliateSyncStatus = (typeof AFFILIATE_SYNC_STATUSES)[number];
export const AFFILIATE_SYNC_STATUS_LABELS: Record<AffiliateSyncStatus, string> = {
  RUNNING: 'Läuft',
  SUCCESS: 'Erfolgreich',
  PARTIAL: 'Teilweise übernommen',
  FAILED: 'Fehlgeschlagen',
};

/** Gründe, aus denen ein Produkt aus dem Feed nicht übernommen wird (Datenqualität) */
export const AFFILIATE_SKIP_REASONS = ['invalidPrice', 'wrongCurrency', 'missingId', 'missingTitle', 'invalidLink', 'expired', 'outOfStock', 'limit'] as const;
export type AffiliateSkipReason = (typeof AFFILIATE_SKIP_REASONS)[number];
export const AFFILIATE_SKIP_REASON_LABELS: Record<AffiliateSkipReason, string> = {
  invalidPrice: 'Ungültiger oder fehlender Preis',
  wrongCurrency: 'Andere Währung als Euro',
  missingId: 'Keine stabile Artikelnummer',
  missingTitle: 'Kein Produktname',
  invalidLink: 'Kein gültiger Tracking-Link',
  expired: 'Gültigkeit bereits abgelaufen',
  outOfStock: 'Nicht lieferbar (neu, daher nicht angelegt)',
  limit: 'Höchstzahl je Feed erreicht',
};

/** Zähler eines Abrufs */
export interface AffiliateSyncStats {
  rows?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  ended?: number;
  /** Ohne erlaubtes Bild übernommen */
  withoutImage?: number;
  /** In Prüfung (Rabatt ab 70 %) */
  review?: number;
  /** Keine passende Kategorie gefunden: Standardkategorie des Programms bzw. „Sonstige Angebote“ */
  defaultCategory?: number;
  skipped?: Partial<Record<AffiliateSkipReason, number>>;
  /** Feedliste */
  programs?: number;
  feeds?: number;
  /** Aktionen */
  promotions?: number;
  hidden?: number;
  truncated?: boolean;
  /** Unveränderter Feed (gleicher Stand laut Netzwerk) – kein Download */
  notModified?: boolean;
}

/** Abstand der automatischen Abrufe (Awin empfiehlt Downloads nur bei geändertem Stand) */
export const AFFILIATE_FEED_LIST_INTERVAL_MINUTES = 60;
export const AFFILIATE_PROMOTIONS_INTERVAL_HOURS = 4;
/** Ein Feed wird höchstens so oft heruntergeladen, auch wenn das Netzwerk häufiger neu importiert */
export const AFFILIATE_FEED_MIN_INTERVAL_HOURS = 3;
export const AFFILIATE_FEED_MAX_FAILURES = 5;
/** Ohne Gültigkeitsende im Feed: so lange gilt ein Produkt ab dem Datenstand (wird bei jedem Abruf verlängert) */
export const AFFILIATE_DEFAULT_VALIDITY_DAYS = 7;

const note = (min: number, message: string) =>
  z
    .string()
    .transform((v) => v.replace(CONTROL_CHARS, '').trim())
    .pipe(z.string().min(min, message).max(1000));

/** Programm freigeben (mit Dokumentation), anhalten oder ablehnen – nur Administration */
export const affiliateProgramReviewSchema = z.discriminatedUnion('decision', [
  z
    .object({
      decision: z.literal('APPROVE'),
      note: note(20, 'Bitte dokumentiere die Freigabe (mindestens 20 Zeichen), z. B. geprüfte Programmbedingungen und Datum der Partnerschaft.'),
      allowImages: z.boolean(),
      allowReferencePrices: z.boolean(),
      allowVouchers: z.boolean(),
      defaultCategorySlug: z.string().max(60).nullable().optional(),
    })
    .strict(),
  z.object({ decision: z.literal('PAUSE'), note: note(5, 'Bitte begründe kurz (mindestens 5 Zeichen).') }).strict(),
  z.object({ decision: z.literal('REJECT'), note: note(5, 'Bitte begründe kurz (mindestens 5 Zeichen).') }).strict(),
]);
export type AffiliateProgramReviewInput = z.infer<typeof affiliateProgramReviewSchema>;

/** Feed eines freigegebenen Programms aktivieren oder anhalten */
export const affiliateFeedReviewSchema = z
  .object({
    decision: z.enum(['ACTIVATE', 'PAUSE']),
    note: z
      .string()
      .transform((v) => v.replace(CONTROL_CHARS, '').trim())
      .pipe(z.string().max(1000))
      .optional(),
  })
  .strict();
export type AffiliateFeedReviewInput = z.infer<typeof affiliateFeedReviewSchema>;

/** Manueller Abruf (nur Administration) */
export const affiliateManualSyncSchema = z.object({ kind: z.enum(['ALL', 'FEED_LIST', 'PROMOTIONS']), feedId: z.string().max(40).optional() }).strict();
export type AffiliateManualSyncInput = z.infer<typeof affiliateManualSyncSchema>;

// --- Antworten der API ------------------------------------------------------------------

export interface AffiliateConfigStatus {
  network: AffiliateNetwork;
  /** AWIN_ENABLED=true */
  enabled: boolean;
  /** Fehlende Einstellungen (nur Namen, nie Werte) */
  missing: string[];
  /** Live-Abruf läuft automatisch (aktiv, vollständig konfiguriert, Hintergrundaufgaben an) */
  scheduled: boolean;
}

export interface AffiliateProgramView {
  id: string;
  network: AffiliateNetwork;
  externalId: string;
  name: string;
  region: string | null;
  membership: AffiliateMembership;
  membershipCheckedAt: string | null;
  status: AffiliateProgramStatus;
  approvalNote: string | null;
  reviewedBy: string | null;
  approvedAt: string | null;
  allowImages: boolean;
  allowReferencePrices: boolean;
  allowVouchers: boolean;
  defaultCategorySlug: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Öffentlich sichtbare Produkte */
  activeDeals: number;
  feeds: AffiliateFeedView[];
}

export interface AffiliateFeedView {
  id: string;
  externalId: string;
  name: string;
  language: string | null;
  vertical: string | null;
  status: AffiliateFeedStatus;
  approvalNote: string | null;
  approvedAt: string | null;
  networkUpdatedAt: string | null;
  processedUpdatedAt: string | null;
  lastFetchedAt: string | null;
  nextFetchAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  productCount: number;
}

export interface AffiliateSyncRunView {
  id: string;
  network: AffiliateNetwork;
  kind: AffiliateSyncKind;
  status: AffiliateSyncStatus;
  programName: string | null;
  feedName: string | null;
  stats: AffiliateSyncStats;
  error: string | null;
  manual: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface AffiliateWarning {
  level: 'warning' | 'error';
  message: string;
}

export interface AffiliateOverview {
  config: AffiliateConfigStatus;
  counts: {
    /** Öffentlich sichtbare Affiliate-Deals */
    activeDeals: number;
    /** Freigegebene Programme mit aktiver Partnerschaft */
    connectedPrograms: number;
    pendingPrograms: number;
    failingFeeds: number;
    /** Abgelaufen, beendet oder nicht mehr lieferbar (letzte 30 Tage) */
    expiredDeals: number;
    /** Laufende Produkte ohne erlaubtes Bild */
    withoutImage: number;
    /** In den letzten 7 Tagen übersprungen wegen ungültigem Preis */
    invalidPrices: number;
    inReview: number;
    activePromotions: number;
  };
  lastSuccessfulSync: string | null;
  lastSuccessfulFeedSync: string | null;
  warnings: AffiliateWarning[];
  programs: AffiliateProgramView[];
  runs: AffiliateSyncRunView[];
}

/** Aktion oder Gutschein auf /deals (Kennzeichnung „Werbung“) */
export interface AffiliatePromotionView {
  id: string;
  type: 'PROMOTION' | 'VOUCHER';
  title: string;
  description: string;
  terms: string | null;
  voucherCode: string | null;
  url: string;
  startsAt: string | null;
  endsAt: string | null;
  advertiserName: string;
  networkName: string;
}
