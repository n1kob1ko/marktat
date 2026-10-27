import { APPEAL_WINDOW_DAYS, RESTRICTIVE_ACTIONS, type AdminDecision, type AdminReportSummary, type AppealView, type ModerationDecisionView, type PersonRef } from '@marktat/shared';
import type { Appeal, ModerationDecision, Prisma } from '../generated/prisma/client.js';
import { dealDisplayStatus } from '../deals/deals.mapper.js';
import { effectiveStatus } from '../listings/listings.mapper.js';

const DAY_MS = 86_400_000;

export const personSelect = { id: true, displayName: true, status: true } as const;

export function toPerson(user: { id: string; displayName: string; status?: string } | null): PersonRef | null {
  if (!user) return null;
  return { id: user.id, displayName: user.status === 'DELETED' ? 'Gelöschtes Konto' : user.displayName };
}

export const decisionInclude = {
  listing: { select: { id: true, title: true } },
  deal: { select: { id: true, title: true } },
  appeal: true,
  reversedBy: { select: { id: true }, take: 1 },
  moderator: { select: personSelect },
  user: { select: personSelect },
} satisfies Prisma.ModerationDecisionInclude;

export type DecisionWithRelations = Prisma.ModerationDecisionGetPayload<{ include: typeof decisionInclude }>;

export function appealDeadline(decision: Pick<ModerationDecision, 'createdAt'>) {
  return new Date(decision.createdAt.getTime() + APPEAL_WINDOW_DAYS * DAY_MS);
}

/** Einspruch möglich: einschränkende Maßnahme, nicht aufgehoben, Frist offen, noch kein Einspruch */
export function canAppeal(decision: DecisionWithRelations, now = new Date()) {
  return (
    RESTRICTIVE_ACTIONS.includes(decision.action) &&
    !decision.appeal &&
    decision.reversedBy.length === 0 &&
    appealDeadline(decision) > now
  );
}

export function toAppealView(appeal: Appeal): AppealView {
  return {
    id: appeal.id,
    status: appeal.status,
    body: appeal.body,
    response: appeal.response,
    createdAt: appeal.createdAt.toISOString(),
    decidedAt: appeal.decidedAt?.toISOString() ?? null,
  };
}

/** Sicht der betroffenen Person: ohne interne Notiz und ohne Namen der Moderation */
export function toDecisionView(decision: DecisionWithRelations, now = new Date()): ModerationDecisionView {
  const restrictive = RESTRICTIVE_ACTIONS.includes(decision.action);
  return {
    id: decision.id,
    action: decision.action,
    reason: decision.reason,
    ground: decision.ground,
    statement: decision.statement,
    createdAt: decision.createdAt.toISOString(),
    listing: decision.listing,
    deal: decision.deal,
    appeal: decision.appeal ? toAppealView(decision.appeal) : null,
    canAppeal: canAppeal(decision, now),
    appealDeadline: restrictive ? appealDeadline(decision).toISOString() : null,
    reversed: decision.reversedBy.length > 0,
  };
}

export function toAdminDecision(decision: DecisionWithRelations, now = new Date()): AdminDecision {
  return {
    ...toDecisionView(decision, now),
    internalNote: decision.internalNote,
    moderator: toPerson(decision.moderator),
    user: toPerson(decision.user)!,
    snapshot: (decision.snapshot as Record<string, unknown> | null) ?? null,
  };
}

export const reportSummaryInclude = {
  listing: { select: { id: true, title: true, status: true, expiresAt: true } },
  deal: { select: { id: true, title: true, status: true, startsAt: true, endsAt: true, lastVerifiedAt: true, availability: true } },
  reported: { select: personSelect },
  reporter: { select: personSelect },
  assignee: { select: personSelect },
} satisfies Prisma.ReportInclude;

export type ReportWithRelations = Prisma.ReportGetPayload<{ include: typeof reportSummaryInclude }>;

export function toReportSummary(report: ReportWithRelations, relatedOpen: number): AdminReportSummary {
  return {
    id: report.id,
    targetType: report.targetType,
    reason: report.reason,
    status: report.status,
    priority: report.priority,
    details: report.details,
    createdAt: report.createdAt.toISOString(),
    listing: report.listing ? { id: report.listing.id, title: report.listing.title, status: effectiveStatus(report.listing) } : null,
    deal: report.deal ? { id: report.deal.id, title: report.deal.title, status: dealDisplayStatus(report.deal) } : null,
    conversationId: report.conversationId,
    reported: report.reported ? { ...toPerson(report.reported)!, status: report.reported.status } : null,
    reporter: toPerson(report.reporter),
    assignee: toPerson(report.assignee),
    relatedOpen,
  };
}
