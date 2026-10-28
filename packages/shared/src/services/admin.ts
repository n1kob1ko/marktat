import { CONTROL_CHARS } from '../schemas/interactions.js';
import { z } from '../schemas/zod.js';
import type { UserStatus } from '../schemas/moderation.js';
import type { AdminDecision, AdminReportSummary, PersonRef } from '../types.js';
import type { ServiceProfileStatus } from './enums.js';
import type { QualificationView, ServiceProfileDetail } from './types.js';

/** Filter der Moderation von Anbieterprofilen */
export const ADMIN_SERVICE_FILTERS = ['review', 'reported', 'qualifications', 'ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'REJECTED', 'DRAFT', 'all'] as const;
export type AdminServiceFilter = (typeof ADMIN_SERVICE_FILTERS)[number];

export const ADMIN_SERVICE_FILTER_LABELS: Record<AdminServiceFilter, string> = {
  review: 'In Prüfung, gemeldet oder Qualifikation offen',
  reported: 'Gemeldet',
  qualifications: 'Qualifikationen zu prüfen',
  ACTIVE: 'Sichtbar',
  PAUSED: 'Pausiert',
  PENDING_REVIEW: 'In Prüfung',
  REJECTED: 'Abgelehnt',
  DRAFT: 'Entwürfe',
  all: 'Alle',
};

export const adminServiceQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((v) => v?.replace(CONTROL_CHARS, '').trim().slice(0, 100) || undefined),
  filter: z
    .string()
    .optional()
    .transform((v) => ((ADMIN_SERVICE_FILTERS as readonly string[]).includes(v ?? '') ? (v as AdminServiceFilter) : 'review')),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type AdminServiceQuery = z.infer<typeof adminServiceQuerySchema>;

export interface AdminServiceProfileSummary {
  id: string;
  headline: string;
  status: ServiceProfileStatus;
  provider: PersonRef & { business: boolean; status: UserStatus };
  categories: string[];
  openReports: number;
  pendingQualifications: number;
  hiddenPortfolioItems: number;
  updatedAt: string;
}

export interface AdminServiceProfileDetail {
  profile: ServiceProfileDetail;
  /** E-Mail nur für Administratoren */
  provider: PersonRef & { email: string | null; business: boolean; status: UserStatus; createdAt: string };
  /** Alle Qualifikationen mit Nachweis-Angabe (auch nicht geprüfte) */
  qualifications: (QualificationView & { reference: string | null; reviewNote: string | null; reviewedBy: PersonRef | null })[];
  decisions: AdminDecision[];
  reports: AdminReportSummary[];
  viewCount: number;
  /** Für Entscheidungen mitzuschicken (Schutz vor gleichzeitiger Bearbeitung) */
  version: string;
}
