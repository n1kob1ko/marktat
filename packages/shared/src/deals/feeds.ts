import { z } from '../schemas/zod.js';
import { DEAL_IMAGE_RIGHTS } from './enums.js';
import type { DealImportMapping, DealImportSummary } from './import.js';
import { externalUrlSchema } from './schemas.js';

/**
 * Produktfeeds: Ein Händler hinterlegt die Adresse seines eigenen (oder lizenzierten) Feeds, das Team gibt ihn frei,
 * danach holt MarktAT ihn regelmäßig ab und aktualisiert die Deals über denselben Weg wie der CSV-Import.
 * Ohne Freigabe wird nichts abgerufen. Fremde Plattformen werden nicht ausgelesen.
 */

export const DEAL_FEED_FORMATS = ['CSV', 'JSON'] as const;
export type DealFeedFormat = (typeof DEAL_FEED_FORMATS)[number];
export const DEAL_FEED_FORMAT_LABELS: Record<DealFeedFormat, string> = { CSV: 'CSV (Spalten wie in der Vorlage)', JSON: 'JSON (Liste von Angeboten)' };

export const DEAL_FEED_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'FAILING'] as const;
export type DealFeedStatus = (typeof DEAL_FEED_STATUSES)[number];
export const DEAL_FEED_STATUS_LABELS: Record<DealFeedStatus, string> = {
  PENDING: 'Wartet auf Freigabe',
  APPROVED: 'Freigegeben',
  REJECTED: 'Abgelehnt',
  PAUSED: 'Pausiert',
  FAILING: 'Wiederholt fehlgeschlagen',
};

/** Wie oft ein Feed höchstens abgerufen wird (Rücksicht auf den Server des Händlers) */
export const DEAL_FEED_MIN_INTERVAL_HOURS = 6;
export const DEAL_FEED_MAX_INTERVAL_HOURS = 168;
/** Nach so vielen Fehlschlägen in Folge wird ein Feed angehalten */
export const DEAL_FEED_MAX_FAILURES = 5;
export const DEAL_FEED_MAX_BYTES = 5 * 1024 * 1024;
export const DEAL_FEED_MAX_PER_MERCHANT = 5;

export const dealFeedSchema = z.object({
  name: z.string({ error: 'Bitte gib einen Namen ein.' }).trim().min(3, 'Mindestens 3 Zeichen.').max(80),
  url: externalUrlSchema,
  format: z.enum(DEAL_FEED_FORMATS, { error: 'Bitte wähle das Format.' }),
  intervalHours: z
    .number()
    .int()
    .min(DEAL_FEED_MIN_INTERVAL_HOURS, `Mindestens alle ${DEAL_FEED_MIN_INTERVAL_HOURS} Stunden.`)
    .max(DEAL_FEED_MAX_INTERVAL_HOURS, 'Höchstens einmal pro Woche.'),
  /** Woher die Daten stammen und unter welchen Bedingungen sie genutzt werden dürfen */
  licenseNote: z.string({ error: 'Bitte beschreibe die Herkunft der Daten.' }).trim().min(10, 'Bitte beschreibe die Herkunft der Daten (mindestens 10 Zeichen).').max(500),
  /** Bestätigung: eigener Feed oder Nutzung ausdrücklich erlaubt; Vergleichspreise belegbar */
  licenseConfirmed: z.literal(true, { error: 'Bitte bestätige, dass du die Daten so verwenden darfst.' }),
  referencePricesConfirmed: z.boolean(),
  imageRights: z.enum(DEAL_IMAGE_RIGHTS).nullable().optional(),
});
export type DealFeedInput = z.infer<typeof dealFeedSchema>;

export const dealFeedReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'PAUSE']),
  note: z.string().trim().max(500).optional(),
});
export type DealFeedReviewInput = z.infer<typeof dealFeedReviewSchema>;

export interface DealFeedView {
  id: string;
  merchant: { id: string; name: string };
  name: string;
  url: string;
  format: DealFeedFormat;
  intervalHours: number;
  licenseNote: string;
  referencePricesConfirmed: boolean;
  status: DealFeedStatus;
  mapping: DealImportMapping;
  reviewNote: string | null;
  approvedAt: string | null;
  lastFetchedAt: string | null;
  nextFetchAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  dealCount: number;
  createdAt: string;
  lastImport: DealImportSummary | null;
}
