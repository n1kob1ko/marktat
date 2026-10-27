import { CONTROL_CHARS, REPORT_REASONS } from '../schemas/interactions.js';
import { DECISION_GROUNDS } from '../schemas/moderation.js';
import { z } from '../schemas/zod.js';
import type { UserStatus } from '../schemas/moderation.js';
import type { AdminDecision, AdminReportSummary, PersonRef } from '../types.js';
import type { DealDetail, DealerEligibility, MerchantDeal } from './types.js';

/** Filter der Deal-Moderation */
export const ADMIN_DEAL_FILTERS = ['review', 'reported', 'discount', 'broken', 'unverified', 'duplicates', 'ACTIVE', 'PAUSED', 'EXPIRED', 'REJECTED', 'DRAFT', 'all'] as const;
export type AdminDealFilter = (typeof ADMIN_DEAL_FILTERS)[number];

export const ADMIN_DEAL_FILTER_LABELS: Record<AdminDealFilter, string> = {
  review: 'In Prüfung oder gemeldet',
  reported: 'Gemeldet',
  discount: 'Auffälliger Rabatt (ab 50 %)',
  broken: 'Link defekt',
  unverified: 'Nicht mehr bestätigt',
  duplicates: 'Mögliche Doppelte',
  ACTIVE: 'Aktiv',
  PAUSED: 'Pausiert',
  EXPIRED: 'Abgelaufen',
  REJECTED: 'Abgelehnt',
  DRAFT: 'Entwürfe',
  all: 'Alle',
};

/** Ab diesem Rabatt erscheinen Deals im Filter „Auffälliger Rabatt“ (geprüft wird automatisch erst ab 70 %) */
export const ADMIN_DEAL_DISCOUNT_ATTENTION = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const adminDealQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((v) => v?.replace(CONTROL_CHARS, '').trim().slice(0, 100) || undefined),
  filter: z
    .string()
    .optional()
    .transform((v) => ((ADMIN_DEAL_FILTERS as readonly string[]).includes(v ?? '') ? (v as AdminDealFilter) : 'review')),
  merchant: z
    .string()
    .optional()
    .transform((v) => (v && UUID.test(v) ? v.toLowerCase() : undefined)),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type AdminDealQuery = z.infer<typeof adminDealQuerySchema>;

/** Deal einem anderen (berechtigten) Händlerkonto zuordnen – nur Administratoren */
export const assignDealMerchantSchema = z
  .object({
    merchantId: z.string().regex(UUID, 'Bitte gib die Konto-ID des Händlers an.'),
    note: z
      .string()
      .transform((v) => v.replace(CONTROL_CHARS, '').trim())
      .pipe(z.string().min(10, 'Bitte begründe die Änderung (mindestens 10 Zeichen).').max(500)),
  })
  .strict();
export type AssignDealMerchantInput = z.infer<typeof assignDealMerchantSchema>;

/**
 * Händlerkonto für Deals sperren bzw. freigeben – wie eine Kontosperre mit Grund, Rechtsgrundlage und Begründung
 * (Art. 17 DSA), Einspruch möglich. Freigeben nur Administratoren.
 */
export const dealsBlockSchema = z
  .object({
    decision: z.enum(['BLOCK', 'UNBLOCK'], { error: 'Bitte wähle eine Maßnahme.' }),
    reason: z.enum(REPORT_REASONS).optional(),
    ground: z.enum(DECISION_GROUNDS).optional(),
    statement: z
      .string({ error: 'Bitte begründe die Entscheidung.' })
      .transform((v) => v.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim())
      .pipe(z.string().min(20, 'Bitte begründe die Entscheidung für die betroffene Person (mindestens 20 Zeichen).').max(2000)),
    internalNote: z
      .string()
      .transform((v) => v.replace(CONTROL_CHARS, '').trim())
      .pipe(z.string().max(1000))
      .optional()
      .transform((v) => v || undefined),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision !== 'BLOCK') return;
    if (!v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Bitte wähle die Art des Verstoßes.' });
    if (!v.ground) ctx.addIssue({ code: 'custom', path: ['ground'], message: 'Bitte wähle die Rechtsgrundlage.' });
  });
export type DealsBlockInput = z.infer<typeof dealsBlockSchema>;

export interface AdminDealSummary extends MerchantDeal {
  merchantStatus: UserStatus;
  openReports: number;
  createdAt: string;
}

export interface AdminDealDetail {
  deal: DealDetail;
  merchant: PersonRef & {
    companyName: string | null;
    status: UserStatus;
    dealsBlockedAt: string | null;
    eligibility: DealerEligibility;
  };
  decisions: AdminDecision[];
  reports: AdminReportSummary[];
  /** Andere Deals desselben Händlers mit gleichem Titel (mögliche Doppelte) */
  duplicates: { id: string; title: string; status: string }[];
  linkFailures: number;
  linkCheckedAt: string | null;
  viewCount: number;
  clickCount: number;
  /** Für Entscheidungen mitzuschicken (Schutz vor gleichzeitiger Bearbeitung) */
  version: string;
}
