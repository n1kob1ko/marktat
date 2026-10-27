/** Werte entsprechen den Prisma-Enums des Deal-Bereichs (siehe docs/deals.md). */

/** Wo das Angebot gilt */
export const DEAL_CHANNELS = ['ONLINE', 'LOCAL', 'BOTH'] as const;
export type DealChannel = (typeof DEAL_CHANNELS)[number];

export const DEAL_CHANNEL_LABELS: Record<DealChannel, string> = {
  ONLINE: 'Online',
  LOCAL: 'Im Geschäft',
  BOTH: 'Online und im Geschäft',
};

export const DEAL_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'PENDING_REVIEW', 'REJECTED', 'DELETED'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/**
 * Status, wie ihn Händler und Team sehen: zusätzlich „geplant“ (Beginn in der Zukunft) und „unbestätigt“
 * (seit DEAL_VERIFY_DAYS nicht mehr bestätigt – wird nicht mehr als aktuell angezeigt).
 */
export type DealDisplayStatus = DealStatus | 'SCHEDULED' | 'UNVERIFIED' | 'SOLD_OUT';

export const DEAL_STATUS_LABELS: Record<DealDisplayStatus, string> = {
  DRAFT: 'Entwurf',
  ACTIVE: 'Aktiv',
  PAUSED: 'Pausiert',
  EXPIRED: 'Abgelaufen',
  PENDING_REVIEW: 'In Prüfung',
  REJECTED: 'Abgelehnt',
  DELETED: 'Gelöscht',
  SCHEDULED: 'Geplant',
  UNVERIFIED: 'Bestätigung nötig',
  SOLD_OUT: 'Ausverkauft',
};

/** Verfügbarkeit – nur angeben, wenn sie zuverlässig bekannt ist */
export const DEAL_AVAILABILITIES = ['UNKNOWN', 'IN_STOCK', 'LIMITED', 'SOLD_OUT'] as const;
export type DealAvailability = (typeof DEAL_AVAILABILITIES)[number];

export const DEAL_AVAILABILITY_LABELS: Record<DealAvailability, string> = {
  UNKNOWN: 'Keine Angabe',
  IN_STOCK: 'Verfügbar',
  LIMITED: 'Nur geringe Stückzahl',
  SOLD_OUT: 'Ausverkauft',
};

/**
 * Grundlage eines Vergleichspreises. Händler dürfen nur LOWEST_30_DAYS und RRP angeben;
 * MARKET_CHECK ist für einen späteren, vom Team geprüften Marktvergleich vorbereitet.
 */
export const REFERENCE_PRICE_TYPES = ['LOWEST_30_DAYS', 'RRP', 'MARKET_CHECK'] as const;
export type ReferencePriceType = (typeof REFERENCE_PRICE_TYPES)[number];
export const MERCHANT_REFERENCE_PRICE_TYPES = ['LOWEST_30_DAYS', 'RRP'] as const satisfies readonly ReferencePriceType[];

export const REFERENCE_PRICE_LABELS: Record<ReferencePriceType, string> = {
  LOWEST_30_DAYS: 'Niedrigster Preis der letzten 30 Tage vor der Ermäßigung',
  RRP: 'Unverbindliche Preisempfehlung (UVP)',
  MARKET_CHECK: 'Vom MarktAT-Team geprüfter Marktvergleich',
};

/** Kurzform neben dem durchgestrichenen Preis */
export const REFERENCE_PRICE_SHORT: Record<ReferencePriceType, string> = {
  LOWEST_30_DAYS: 'Niedrigster Preis 30 Tage',
  RRP: 'UVP',
  MARKET_CHECK: 'Marktvergleich',
};

/** Rechte am Produktbild – Pflicht beim Hochladen */
export const DEAL_IMAGE_RIGHTS = ['OWN', 'MANUFACTURER', 'LICENSED'] as const;
export type DealImageRights = (typeof DEAL_IMAGE_RIGHTS)[number];

export const DEAL_IMAGE_RIGHTS_LABELS: Record<DealImageRights, string> = {
  OWN: 'Eigenes Foto',
  MANUFACTURER: 'Bild des Herstellers mit Nutzungserlaubnis',
  LICENSED: 'Lizenziertes Bild (z. B. Bilddatenbank)',
};

/** Woher ein Deal stammt */
export const DEAL_SOURCES = ['MANUAL', 'CSV', 'FEED'] as const;
export type DealSource = (typeof DEAL_SOURCES)[number];

export const DEAL_SOURCE_LABELS: Record<DealSource, string> = {
  MANUAL: 'Vom Händler eingetragen',
  CSV: 'Vom Händler per CSV-Datei importiert',
  FEED: 'Aus dem Produktfeed des Händlers',
};

export const DEAL_LINK_STATUSES = ['UNCHECKED', 'OK', 'BROKEN'] as const;
export type DealLinkStatus = (typeof DEAL_LINK_STATUSES)[number];
