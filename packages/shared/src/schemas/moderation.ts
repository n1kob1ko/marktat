import { z } from './zod.js';
import { CONTROL_CHARS, REPORT_REASONS } from './interactions.js';

// ---------------------------------------------------------------------------
// Werte und Beschriftungen (entsprechen den Prisma-Enums)
// ---------------------------------------------------------------------------

export const REPORT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN: 'Offen',
  IN_REVIEW: 'In Bearbeitung',
  RESOLVED: 'Erledigt – Maßnahme',
  DISMISSED: 'Erledigt – kein Verstoß',
};

export const REPORT_TARGETS = ['LISTING', 'CONVERSATION'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export const REPORT_TARGET_LABELS: Record<ReportTarget, string> = {
  LISTING: 'Inserat',
  CONVERSATION: 'Unterhaltung',
};

export const REPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type ReportPriority = (typeof REPORT_PRIORITIES)[number];
export const REPORT_PRIORITY_LABELS: Record<ReportPriority, string> = {
  LOW: 'Niedrig',
  NORMAL: 'Normal',
  HIGH: 'Hoch',
  URGENT: 'Dringend',
};

export const REPORT_EVENT_TYPES = ['CREATED', 'ASSIGNED', 'UNASSIGNED', 'PRIORITY_CHANGED', 'STATUS_CHANGED', 'NOTE'] as const;
export type ReportEventType = (typeof REPORT_EVENT_TYPES)[number];

export const MODERATION_ACTIONS = [
  'LISTING_REJECTED',
  'LISTING_HIDDEN',
  'LISTING_RESTORED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_RESTORED',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];
export const MODERATION_ACTION_LABELS: Record<ModerationAction, string> = {
  LISTING_REJECTED: 'Inserat deaktiviert',
  LISTING_HIDDEN: 'Inserat bis zur Prüfung ausgeblendet',
  LISTING_RESTORED: 'Inserat freigegeben',
  ACCOUNT_SUSPENDED: 'Konto gesperrt',
  ACCOUNT_RESTORED: 'Sperre aufgehoben',
};
/** Einschränkende Maßnahmen: brauchen Grund, Rechtsgrundlage und Begründung (Art. 17 DSA) und erlauben Einspruch. */
export const RESTRICTIVE_ACTIONS: readonly ModerationAction[] = ['LISTING_REJECTED', 'LISTING_HIDDEN', 'ACCOUNT_SUSPENDED'];

export const DECISION_GROUNDS = ['TERMS', 'ILLEGAL'] as const;
export type DecisionGround = (typeof DECISION_GROUNDS)[number];
export const DECISION_GROUND_LABELS: Record<DecisionGround, string> = {
  TERMS: 'Verstoß gegen die Nutzungsbedingungen',
  ILLEGAL: 'Mutmaßlich rechtswidriger Inhalt',
};

export const APPEAL_STATUSES = ['OPEN', 'UPHELD', 'REVERSED'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];
export const APPEAL_STATUS_LABELS: Record<AppealStatus, string> = {
  OPEN: 'In Prüfung',
  UPHELD: 'Abgelehnt – Entscheidung bleibt',
  REVERSED: 'Stattgegeben – Entscheidung aufgehoben',
};
/** Frist für Einsprüche ab der Entscheidung (Art. 20 Abs. 1 DSA: mindestens sechs Monate) */
export const APPEAL_WINDOW_DAYS = 183;

export const NOTIFICATION_TYPES = [
  'LISTING_REJECTED',
  'LISTING_HIDDEN',
  'LISTING_RESTORED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_RESTORED',
  'APPEAL_DECIDED',
  'REPORT_HANDLED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Aktiv',
  SUSPENDED: 'Gesperrt',
  DELETED: 'Gelöscht',
};

export const USER_ROLE_LABELS = { USER: 'Nutzer', MODERATOR: 'Moderation', ADMIN: 'Administration' } as const;

/** Bestätigungswort für die Kontolöschung */
export const DELETE_CONFIRMATION_WORD = 'LÖSCHEN';

// ---------------------------------------------------------------------------
// Eingaben
// ---------------------------------------------------------------------------

const cleanText = (min: number, max: number, minMessage: string) =>
  z
    .string({ error: minMessage })
    .transform((v) => v.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim())
    .pipe(
      z
        .string()
        .min(min, minMessage)
        .max(max, `Höchstens ${max.toLocaleString('de-AT')} Zeichen.`),
    );

const optionalNote = z
  .string()
  .transform((v) => v.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim())
  .pipe(z.string().max(1000, 'Höchstens 1.000 Zeichen.'))
  .optional()
  .transform((v) => v || undefined);

/** Meldung eines Inserats (Art. 16 DSA: Begründung, Fundstelle, Erklärung nach Treu und Glauben) */
export const reportListingSchema = z
  .object({
    reason: z.enum(REPORT_REASONS, { error: 'Bitte wähle einen Grund.' }),
    details: cleanText(10, 1000, 'Bitte beschreibe kurz, was nicht stimmt (mindestens 10 Zeichen).'),
    goodFaith: z.literal(true, { error: 'Bitte bestätige, dass deine Angaben nach bestem Wissen richtig sind.' }),
  })
  .strict();
export type ReportListingInput = z.infer<typeof reportListingSchema>;

export const appealSchema = z
  .object({ body: cleanText(20, 2000, 'Bitte begründe deinen Einspruch (mindestens 20 Zeichen).') })
  .strict();
export type AppealInput = z.infer<typeof appealSchema>;

export const appealDecisionSchema = z
  .object({
    outcome: z.enum(['UPHELD', 'REVERSED'], { error: 'Bitte wähle ein Ergebnis.' }),
    response: cleanText(20, 2000, 'Bitte begründe das Ergebnis (mindestens 20 Zeichen).'),
  })
  .strict();
export type AppealDecisionInput = z.infer<typeof appealDecisionSchema>;

const decisionFields = {
  reason: z.enum(REPORT_REASONS).optional(),
  ground: z.enum(DECISION_GROUNDS).optional(),
  statement: cleanText(20, 2000, 'Bitte begründe die Entscheidung für die betroffene Person (mindestens 20 Zeichen).'),
  internalNote: optionalNote,
};

/** Für einschränkende Maßnahmen sind Grund und Rechtsgrundlage Pflicht. */
function requireGrounds(restrictive: boolean, value: { reason?: unknown; ground?: unknown }, ctx: z.RefinementCtx) {
  if (!restrictive) return;
  if (!value.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Bitte wähle die Art des Verstoßes.' });
  if (!value.ground) ctx.addIssue({ code: 'custom', path: ['ground'], message: 'Bitte wähle die Rechtsgrundlage.' });
}

export const LISTING_DECISIONS = ['REJECT', 'HIDE', 'RESTORE'] as const;
export type ListingDecisionKind = (typeof LISTING_DECISIONS)[number];

export const listingDecisionSchema = z
  .object({
    decision: z.enum(LISTING_DECISIONS, { error: 'Bitte wähle eine Maßnahme.' }),
    ...decisionFields,
    /** `updatedAt` des Inserats, wie es der Moderation angezeigt wurde – verhindert Entscheidungen auf veraltetem Stand */
    version: z.iso.datetime({ offset: true, error: 'Version fehlt.' }),
  })
  .strict()
  .superRefine((v, ctx) => requireGrounds(v.decision !== 'RESTORE', v, ctx));
export type ListingDecisionInput = z.infer<typeof listingDecisionSchema>;

export const userDecisionSchema = z
  .object({
    decision: z.enum(['SUSPEND', 'RESTORE'], { error: 'Bitte wähle eine Maßnahme.' }),
    ...decisionFields,
    /** Meldung, die damit erledigt wird (optional) */
    reportId: z.string().regex(/^[a-z0-9]{20,40}$/).optional(),
  })
  .strict()
  .superRefine((v, ctx) => requireGrounds(v.decision === 'SUSPEND', v, ctx));
export type UserDecisionInput = z.infer<typeof userDecisionSchema>;

export const updateReportSchema = z
  .object({
    priority: z.enum(REPORT_PRIORITIES).optional(),
    assign: z.enum(['me', 'none']).optional(),
    note: optionalNote,
  })
  .strict()
  .refine((v) => v.priority !== undefined || v.assign !== undefined || v.note !== undefined, 'Nichts zu ändern.');
export type UpdateReportInput = z.infer<typeof updateReportSchema>;

export const dismissReportSchema = z
  .object({
    note: optionalNote,
    /** Offensichtlich unbegründet (Art. 23 DSA) */
    abusive: z.boolean().default(false),
  })
  .strict();
export type DismissReportInput = z.infer<typeof dismissReportSchema>;

/** Rollen, die im Admin-Bereich vergeben werden können. ADMIN nur über die Kommandozeile (siehe docs/moderation.md). */
export const ASSIGNABLE_ROLES = ['USER', 'MODERATOR'] as const;
export const changeRoleSchema = z.object({ role: z.enum(ASSIGNABLE_ROLES, { error: 'Diese Rolle kann hier nicht vergeben werden.' }) }).strict();
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const reportingRestrictionSchema = z
  .object({ days: z.number().int().min(0).max(365), note: optionalNote })
  .strict();
export type ReportingRestrictionInput = z.infer<typeof reportingRestrictionSchema>;

export const accountDeletionSchema = z
  .object({
    password: z.string({ error: 'Bitte gib dein Passwort ein.' }).min(1, 'Bitte gib dein Passwort ein.').max(200),
    confirmation: z
      .string({ error: `Bitte tippe ${DELETE_CONFIRMATION_WORD} ein.` })
      .transform((v) => v.trim().toLocaleUpperCase('de-AT'))
      .pipe(z.literal(DELETE_CONFIRMATION_WORD, { error: `Bitte tippe ${DELETE_CONFIRMATION_WORD} ein.` })),
  })
  .strict();
export type AccountDeletionInput = z.infer<typeof accountDeletionSchema>;

// ---------------------------------------------------------------------------
// Filter im Admin-Bereich (Query-Parameter)
// ---------------------------------------------------------------------------

const page = z.coerce.number().int().min(1).max(1000).default(1);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => ((values as readonly string[]).includes(v ?? '') ? (v as T[number]) : undefined));

export const adminReportQuerySchema = z.object({
  /** `active` = offen oder in Bearbeitung (Standard) */
  status: optionalEnum(['active', ...REPORT_STATUSES] as const).transform((v) => v ?? 'active'),
  target: optionalEnum(REPORT_TARGETS),
  reason: optionalEnum(REPORT_REASONS),
  priority: optionalEnum(REPORT_PRIORITIES),
  assignee: optionalEnum(['me', 'none'] as const),
  page,
});
export type AdminReportQuery = z.infer<typeof adminReportQuerySchema>;

const searchText = z
  .string()
  .optional()
  .transform((v) => v?.replace(CONTROL_CHARS, '').trim().slice(0, 100) || undefined);

export const adminListingQuerySchema = z.object({
  q: searchText,
  /** `review` = in Prüfung oder gemeldet (Standard) */
  status: optionalEnum(['review', 'reported', 'PENDING_REVIEW', 'REJECTED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'DRAFT', 'all'] as const).transform(
    (v) => v ?? 'review',
  ),
  page,
});
export type AdminListingQuery = z.infer<typeof adminListingQuerySchema>;

export const adminUserQuerySchema = z.object({
  q: searchText,
  status: optionalEnum(USER_STATUSES),
  role: optionalEnum(['USER', 'MODERATOR', 'ADMIN'] as const),
  page,
});
export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;

export const adminAppealQuerySchema = z.object({
  status: optionalEnum(APPEAL_STATUSES).transform((v) => v ?? 'OPEN'),
  page,
});
export type AdminAppealQuery = z.infer<typeof adminAppealQuerySchema>;

export const adminAuditQuerySchema = z.object({
  /** Präfix der Aktion, z. B. `moderation.` oder `user.suspended` */
  action: z
    .string()
    .optional()
    .transform((v) => (v && /^[a-z_.]{1,60}$/.test(v) ? v : undefined)),
  actorId: z.uuid().optional().catch(undefined),
  entityId: z
    .string()
    .optional()
    .transform((v) => (v && /^[a-zA-Z0-9-]{1,60}$/.test(v) ? v : undefined)),
  page,
});
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;
