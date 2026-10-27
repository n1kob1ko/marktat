/** Werte entsprechen den Prisma-Enums des Dienstleistungsbereichs (siehe docs/dienstleistungen.md). */

export const SERVICE_PROFILE_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'REJECTED', 'DELETED'] as const;
export type ServiceProfileStatus = (typeof SERVICE_PROFILE_STATUSES)[number];
export const SERVICE_PROFILE_STATUS_LABELS: Record<ServiceProfileStatus, string> = {
  DRAFT: 'Entwurf',
  ACTIVE: 'Sichtbar',
  PAUSED: 'Pausiert',
  PENDING_REVIEW: 'In Prüfung',
  REJECTED: 'Abgelehnt',
  DELETED: 'Gelöscht',
};

export const SERVICE_PRICE_TYPES = ['HOURLY', 'FIXED', 'ON_REQUEST'] as const;
export type ServicePriceType = (typeof SERVICE_PRICE_TYPES)[number];
export const SERVICE_PRICE_TYPE_LABELS: Record<ServicePriceType, string> = {
  HOURLY: 'Stundensatz',
  FIXED: 'Pauschal ab',
  ON_REQUEST: 'Auf Anfrage',
};

export const SERVICE_AVAILABILITIES = ['AVAILABLE', 'LIMITED', 'UNAVAILABLE'] as const;
export type ServiceAvailability = (typeof SERVICE_AVAILABILITIES)[number];
export const SERVICE_AVAILABILITY_LABELS: Record<ServiceAvailability, string> = {
  AVAILABLE: 'Verfügbar',
  LIMITED: 'Eingeschränkt verfügbar',
  UNAVAILABLE: 'Derzeit ausgebucht',
};

/** Woher ein Bild im Portfolio stammt (fremde Bilder ohne Nutzungsrecht sind nicht erlaubt) */
export const PORTFOLIO_IMAGE_RIGHTS = ['OWN', 'CLIENT_PERMISSION', 'LICENSED'] as const;
export type PortfolioImageRights = (typeof PORTFOLIO_IMAGE_RIGHTS)[number];
export const PORTFOLIO_IMAGE_RIGHTS_LABELS: Record<PortfolioImageRights, string> = {
  OWN: 'Eigenes Foto bzw. eigene Arbeit',
  CLIENT_PERMISSION: 'Arbeit für Kund:innen, Veröffentlichung erlaubt',
  LICENSED: 'Lizenziertes Bild (mit Quelle)',
};

/** Qualifikationen: Angabe der Anbieter:in; „geprüft“ nur nach Prüfung durch das Team */
export const QUALIFICATION_STATUSES = ['CLAIMED', 'VERIFIED', 'REJECTED'] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];
export const QUALIFICATION_STATUS_LABELS: Record<QualificationStatus, string> = {
  CLAIMED: 'Angabe der Anbieter:in, nicht geprüft',
  VERIFIED: 'Von MarktAT geprüft',
  REJECTED: 'Nicht bestätigt',
};

/** Höchstwerte je Profil */
export const SERVICE_MAX_CATEGORIES = 5;
export const SERVICE_MAX_SKILLS = 20;
export const SERVICE_MAX_PORTFOLIO = 12;
export const SERVICE_MAX_QUALIFICATIONS = 5;
export const SERVICE_MAX_PRICE_CENTS = 100_000_00;
