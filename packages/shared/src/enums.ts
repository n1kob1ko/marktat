/** Die vier Hauptbereiche der Plattform. Werte entsprechen dem Prisma-Enum `Vertical`. */
export const VERTICALS = ['MARKETPLACE', 'VEHICLES', 'REAL_ESTATE', 'JOBS'] as const;
export type Vertical = (typeof VERTICALS)[number];

export const VERTICAL_LABELS: Record<Vertical, string> = {
  MARKETPLACE: 'Marktplatz',
  VEHICLES: 'Auto & Motor',
  REAL_ESTATE: 'Immobilien',
  JOBS: 'Jobs',
};

export const VERTICAL_SLUGS: Record<Vertical, string> = {
  MARKETPLACE: 'marktplatz',
  VEHICLES: 'auto-motor',
  REAL_ESTATE: 'immobilien',
  JOBS: 'jobs',
};

export const ACCOUNT_TYPES = ['PRIVATE', 'BUSINESS'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const USER_ROLES = ['USER', 'MODERATOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PRICE_TYPES = ['FIXED', 'NEGOTIABLE', 'FREE', 'ON_REQUEST'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  FIXED: 'Fixpreis',
  NEGOTIABLE: 'Verhandlungsbasis',
  FREE: 'Zu verschenken',
  ON_REQUEST: 'Preis auf Anfrage',
};

export const LISTING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'REJECTED',
  'DELETED',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  DRAFT: 'Entwurf',
  PENDING_REVIEW: 'In Prüfung',
  ACTIVE: 'Aktiv',
  PAUSED: 'Pausiert',
  EXPIRED: 'Abgelaufen',
  REJECTED: 'Abgelehnt',
  DELETED: 'Gelöscht',
};

export const ITEM_CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'ACCEPTABLE', 'DEFECTIVE'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export const ITEM_CONDITION_LABELS: Record<ItemCondition, string> = {
  NEW: 'Neu',
  LIKE_NEW: 'Wie neu',
  GOOD: 'Gut',
  ACCEPTABLE: 'Akzeptabel',
  DEFECTIVE: 'Defekt',
};

/** Standard-Laufzeit einer Anzeige in Tagen (später im Admin-Bereich konfigurierbar). */
export const DEFAULT_LISTING_DURATION_DAYS = 60;
