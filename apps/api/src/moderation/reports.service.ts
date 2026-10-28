import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  REPORT_REASON_LABELS,
  type AdminReportDetail,
  type AdminReportQuery,
  type DismissReportInput,
  type Paginated,
  type AdminReportSummary,
  type ReportListingInput,
  type ReportUserInput,
  type ReportedConversation,
  type UpdateReportInput,
} from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { ReportPriority, ReportReason, ReportStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { publicDealWhere } from '../deals/deals.mapper.js';
import { ENTITY_ID, publiclyVisibleWhere } from '../listings/visibility.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { publicProjectWhere, publicServiceProfileWhere } from '../services/visibility.js';
import { decisionInclude, personSelect, reportSummaryInclude, toAdminDecision, toPerson, toReportSummary, type ReportWithRelations } from './moderation.mapper.js';
import { NotificationsService } from './notifications.service.js';

/** Meldungen je Konto und Tag (Inserate und Unterhaltungen zusammen) */
export const REPORTS_PER_DAY = 10;
export const OPEN_STATUSES: ReportStatus[] = ['OPEN', 'IN_REVIEW'];
const PAGE_SIZE = 25;
/** Höchstens so viele Nachrichten einer gemeldeten Unterhaltung werden der Moderation gezeigt */
const REPORTED_MESSAGES_LIMIT = 100;
const DAY_MS = 86_400_000;

/** Startpriorität: Betrug und verbotene Artikel zuerst. Die Anzahl der Meldungen ändert nichts automatisch. */
export function initialPriority(reason: ReportReason): ReportPriority {
  return reason === 'FRAUD' || reason === 'PROHIBITED_ITEM' ? 'HIGH' : 'NORMAL';
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Meldungen einreichen ---------------------------------------------------

  async reportListing(user: AuthUser, listingId: string, input: ReportListingInput, ip?: string): Promise<{ id: string }> {
    if (!ENTITY_ID.test(listingId)) throw new NotFoundException('Dieses Inserat gibt es nicht.');
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, ...publiclyVisibleWhere() },
      select: { id: true, sellerId: true },
    });
    if (!listing) throw new NotFoundException('Dieses Inserat gibt es nicht (mehr).');
    if (listing.sellerId === user.id) throw new ForbiddenException('Deine eigene Anzeige kannst du nicht melden.');
    const report = await this.create(user, {
      targetType: 'LISTING',
      listingId: listing.id,
      reportedId: listing.sellerId,
      reason: input.reason,
      details: input.details,
    });
    this.audit.log({ action: 'listing.reported', actorId: user.id, entityType: 'listing', entityId: listing.id, ip, metadata: { reportId: report.id, reason: input.reason } });
    return { id: report.id };
  }

  /** Meldung eines Deals (z. B. irreführender Rabatt, falsche Händlerangaben, verbotener Artikel) */
  async reportDeal(user: AuthUser, dealId: string, input: ReportListingInput, ip?: string): Promise<{ id: string }> {
    if (!ENTITY_ID.test(dealId)) throw new NotFoundException('Dieses Angebot gibt es nicht.');
    const deal = await this.prisma.deal.findFirst({ where: { id: dealId, ...publicDealWhere() }, select: { id: true, merchantId: true } });
    if (!deal) throw new NotFoundException('Dieses Angebot gibt es nicht (mehr).');
    if (deal.merchantId === user.id) throw new ForbiddenException('Dein eigenes Angebot kannst du nicht melden.');
    const report = await this.create(user, { targetType: 'DEAL', dealId: deal.id, reportedId: deal.merchantId ?? undefined, reason: input.reason, details: input.details });
    this.audit.log({ action: 'deal.reported', actorId: user.id, entityType: 'deal', entityId: deal.id, ip, metadata: { reportId: report.id, reason: input.reason } });
    return { id: report.id };
  }

  /** Meldung eines Anbieterprofils (z. B. falsche Qualifikationen, fremde Bilder im Portfolio, Betrug) */
  async reportServiceProfile(user: AuthUser, profileId: string, input: ReportListingInput, ip?: string): Promise<{ id: string }> {
    if (!ENTITY_ID.test(profileId)) throw new NotFoundException('Dieses Anbieterprofil gibt es nicht.');
    const profile = await this.prisma.serviceProfile.findFirst({ where: { id: profileId, ...publicServiceProfileWhere() }, select: { id: true, userId: true } });
    if (!profile) throw new NotFoundException('Dieses Anbieterprofil gibt es nicht (mehr).');
    if (profile.userId === user.id) throw new ForbiddenException('Dein eigenes Profil kannst du nicht melden.');
    const report = await this.create(user, { targetType: 'SERVICE_PROFILE', serviceProfileId: profile.id, reportedId: profile.userId, reason: input.reason, details: input.details });
    this.audit.log({ action: 'service_profile.reported', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { reportId: report.id, reason: input.reason } });
    return { id: report.id };
  }

  /** Meldung eines Projektauftrags (z. B. verstecktes Jobangebot, Betrug, unzulässige Tätigkeit) */
  async reportProject(user: AuthUser, projectId: string, input: ReportListingInput, ip?: string): Promise<{ id: string }> {
    if (!ENTITY_ID.test(projectId)) throw new NotFoundException('Diesen Projektauftrag gibt es nicht.');
    const project = await this.prisma.serviceProject.findFirst({ where: { id: projectId, ...publicProjectWhere() }, select: { id: true, userId: true } });
    if (!project) throw new NotFoundException('Diesen Projektauftrag gibt es nicht (mehr).');
    if (project.userId === user.id) throw new ForbiddenException('Deinen eigenen Auftrag kannst du nicht melden.');
    const report = await this.create(user, { targetType: 'PROJECT', projectId: project.id, reportedId: project.userId, reason: input.reason, details: input.details });
    this.audit.log({ action: 'project.reported', actorId: user.id, entityType: 'service_project', entityId: project.id, ip, metadata: { reportId: report.id, reason: input.reason } });
    return { id: report.id };
  }

  async reportConversation(user: AuthUser, conversation: { id: string; reportedId: string }, input: ReportUserInput, ip?: string) {
    const report = await this.create(user, {
      targetType: 'CONVERSATION',
      conversationId: conversation.id,
      reportedId: conversation.reportedId,
      reason: input.reason,
      details: input.details,
    });
    this.audit.log({ action: 'user.reported', actorId: user.id, entityType: 'user', entityId: conversation.reportedId, ip, metadata: { reportId: report.id, reason: input.reason } });
    return { id: report.id };
  }

  /**
   * Gemeinsame Regeln: Einschränkung der Meldefunktion (Art. 23 DSA), Tageslimit und keine doppelte offene
   * Meldung derselben Person zum selben Inhalt. Die Sperre je Konto serialisiert gleichzeitige Anfragen.
   */
  private async create(
    user: AuthUser,
    data: {
      targetType: 'LISTING' | 'CONVERSATION' | 'DEAL' | 'SERVICE_PROFILE' | 'PROJECT';
      listingId?: string;
      projectId?: string;
      dealId?: string;
      serviceProfileId?: string;
      conversationId?: string;
      /** Leer bei Affiliate-Deals (kein Konto bei MarktAT) */
      reportedId?: string;
      reason: ReportReason;
      details?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report:${user.id}`}))`;
      const reporter = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { reportingBlockedUntil: true } });
      if (reporter.reportingBlockedUntil && reporter.reportingBlockedUntil > new Date()) {
        throw new ForbiddenException(
          'Deine Meldungen werden vorübergehend nicht bearbeitet, weil mehrere offensichtlich unbegründet waren. Bei Fragen wende dich an den Support.',
        );
      }
      const since = new Date(Date.now() - DAY_MS);
      if ((await tx.report.count({ where: { reporterId: user.id, createdAt: { gt: since } } })) >= REPORTS_PER_DAY) {
        throw new HttpException('Du hast heute schon viele Meldungen geschickt. Bitte versuche es morgen wieder.', HttpStatus.TOO_MANY_REQUESTS);
      }
      const duplicate = await tx.report.findFirst({
        where: {
          reporterId: user.id,
          status: { in: OPEN_STATUSES },
          ...(data.listingId
            ? { listingId: data.listingId }
            : data.dealId
              ? { dealId: data.dealId }
              : data.serviceProfileId
                ? { serviceProfileId: data.serviceProfileId }
                : data.projectId
                  ? { projectId: data.projectId }
                  : { conversationId: data.conversationId }),
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException(
          data.listingId
            ? 'Du hast diese Anzeige bereits gemeldet. Wir sehen sie uns an und melden uns.'
            : data.dealId
              ? 'Du hast dieses Angebot bereits gemeldet. Wir sehen es uns an.'
              : data.serviceProfileId
                ? 'Du hast dieses Anbieterprofil bereits gemeldet. Wir sehen es uns an.'
                : data.projectId
                  ? 'Du hast diesen Projektauftrag bereits gemeldet. Wir sehen ihn uns an.'
                  : 'Du hast diese Unterhaltung bereits gemeldet. Wir sehen sie uns an.',
        );
      }
      const report = await tx.report.create({
        data: { ...data, reporterId: user.id, priority: initialPriority(data.reason) },
        select: { id: true },
      });
      await tx.reportEvent.create({ data: { reportId: report.id, actorId: user.id, type: 'CREATED', toStatus: 'OPEN' } });
      return report;
    });
  }

  // --- Bearbeitung durch die Moderation ----------------------------------------

  async list(query: AdminReportQuery, viewer: AuthUser): Promise<Paginated<AdminReportSummary>> {
    const where: Prisma.ReportWhereInput = {
      status: query.status === 'active' ? { in: OPEN_STATUSES } : query.status,
      ...(query.target ? { targetType: query.target } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assignee === 'me' ? { assigneeId: viewer.id } : query.assignee === 'none' ? { assigneeId: null } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: reportSummaryInclude,
        // Dringendes zuerst, innerhalb gleicher Priorität die ältesten Meldungen
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.report.count({ where }),
    ]);
    return { items: await this.summaries(rows), page: query.page, pageSize: PAGE_SIZE, total };
  }

  /** Meldungen mit der Anzahl weiterer offener Meldungen zum selben Inhalt */
  async summaries(rows: ReportWithRelations[]): Promise<AdminReportSummary[]> {
    const listingIds = [...new Set(rows.flatMap((r) => (r.listingId ? [r.listingId] : [])))];
    const conversationIds = [...new Set(rows.flatMap((r) => (r.targetType === 'CONVERSATION' && r.conversationId ? [r.conversationId] : [])))];
    const dealIds = [...new Set(rows.flatMap((r) => (r.dealId ? [r.dealId] : [])))];
    const profileIds = [...new Set(rows.flatMap((r) => (r.serviceProfileId ? [r.serviceProfileId] : [])))];
    const projectIds = [...new Set(rows.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
    const [byListing, byConversation, byDeal, byProfile, byProject] = await Promise.all([
      listingIds.length
        ? this.prisma.report.groupBy({ by: ['listingId'], where: { listingId: { in: listingIds }, status: { in: OPEN_STATUSES } }, _count: true })
        : [],
      conversationIds.length
        ? this.prisma.report.groupBy({ by: ['conversationId'], where: { conversationId: { in: conversationIds }, status: { in: OPEN_STATUSES } }, _count: true })
        : [],
      dealIds.length ? this.prisma.report.groupBy({ by: ['dealId'], where: { dealId: { in: dealIds }, status: { in: OPEN_STATUSES } }, _count: true }) : [],
      profileIds.length
        ? this.prisma.report.groupBy({ by: ['serviceProfileId'], where: { serviceProfileId: { in: profileIds }, status: { in: OPEN_STATUSES } }, _count: true })
        : [],
      projectIds.length
        ? this.prisma.report.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: { in: OPEN_STATUSES } }, _count: true })
        : [],
    ]);
    const listingCounts = new Map(byListing.map((g) => [g.listingId, g._count]));
    const conversationCounts = new Map(byConversation.map((g) => [g.conversationId, g._count]));
    const dealCounts = new Map(byDeal.map((g) => [g.dealId, g._count]));
    const profileCounts = new Map(byProfile.map((g) => [g.serviceProfileId, g._count]));
    const projectCounts = new Map(byProject.map((g) => [g.projectId, g._count]));
    return rows.map((row) => {
      const open = row.listingId
        ? (listingCounts.get(row.listingId) ?? 0)
        : row.dealId
          ? (dealCounts.get(row.dealId) ?? 0)
          : row.serviceProfileId
            ? (profileCounts.get(row.serviceProfileId) ?? 0)
            : row.projectId
            ? (projectCounts.get(row.projectId) ?? 0)
            : row.conversationId
            ? (conversationCounts.get(row.conversationId) ?? 0)
            : 0;
      const self = OPEN_STATUSES.includes(row.status) ? 1 : 0;
      return toReportSummary(row, Math.max(0, open - self));
    });
  }

  async detail(id: string): Promise<AdminReportDetail> {
    const report = await this.requireReport(id);
    const relatedWhere: Prisma.ReportWhereInput | null = report.listingId
      ? { listingId: report.listingId }
      : report.dealId
        ? { dealId: report.dealId }
        : report.serviceProfileId
        ? { serviceProfileId: report.serviceProfileId }
        : report.projectId
        ? { projectId: report.projectId }
        : report.conversationId
        ? { conversationId: report.conversationId }
        : null;
    const [events, decision, relatedRows, reporterStats, reporterUser] = await Promise.all([
      this.prisma.reportEvent.findMany({ where: { reportId: id }, include: { actor: { select: personSelect } }, orderBy: { createdAt: 'asc' } }),
      report.decisionId ? this.prisma.moderationDecision.findUnique({ where: { id: report.decisionId }, include: decisionInclude }) : null,
      relatedWhere
        ? this.prisma.report.findMany({ where: { ...relatedWhere, id: { not: id } }, include: reportSummaryInclude, orderBy: { createdAt: 'desc' }, take: 20 })
        : [],
      report.reporterId
        ? this.prisma.report.groupBy({ by: ['abusive'], where: { reporterId: report.reporterId }, _count: true })
        : null,
      report.reporterId ? this.prisma.user.findUnique({ where: { id: report.reporterId }, select: { reportingBlockedUntil: true } }) : null,
    ]);
    const [summary] = await this.summaries([report]);
    return {
      ...summary!,
      abusive: report.abusive,
      resolutionNote: report.resolutionNote,
      handledAt: report.handledAt?.toISOString() ?? null,
      handledBy: toPerson(report.handledBy),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        actor: toPerson(e.actor),
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      decision: decision ? toAdminDecision(decision) : null,
      related: await this.summaries(relatedRows),
      reporterStats: reporterStats
        ? {
            total: reporterStats.reduce((sum, g) => sum + g._count, 0),
            abusive: reporterStats.find((g) => g.abusive)?._count ?? 0,
            blockedUntil: reporterUser?.reportingBlockedUntil?.toISOString() ?? null,
          }
        : null,
      canViewMessages: await this.canViewMessages(report),
    };
  }

  /**
   * Nachrichten einer gemeldeten Unterhaltung – nur solange die Meldung bearbeitet wird (oder ein Einspruch
   * zur Entscheidung offen ist), nur bis zum Zeitpunkt der Meldung und jede Einsicht wird protokolliert.
   */
  async reportedMessages(viewer: AuthUser, id: string, ip?: string): Promise<ReportedConversation> {
    const report = await this.requireReport(id);
    if (!(await this.canViewMessages(report))) {
      throw new ForbiddenException('Die Nachrichten dieser Unterhaltung können nicht (mehr) eingesehen werden.');
    }
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: report.conversationId! },
      select: { listing: { select: { id: true, title: true } }, serviceProfile: { select: { id: true, headline: true } }, project: { select: { id: true, title: true } } },
    });
    const rows = await this.prisma.message.findMany({
      where: { conversationId: report.conversationId!, createdAt: { lte: report.createdAt } },
      orderBy: { createdAt: 'desc' },
      take: REPORTED_MESSAGES_LIMIT + 1,
      select: { id: true, senderId: true, body: true, createdAt: true },
    });
    await this.prisma.reportEvent.create({ data: { reportId: id, actorId: viewer.id, type: 'NOTE', note: 'Nachrichten der Unterhaltung eingesehen' } });
    this.audit.log({ action: 'report.messages_viewed', actorId: viewer.id, entityType: 'conversation', entityId: report.conversationId!, ip, metadata: { reportId: id } });
    return {
      listing: conversation?.listing ?? null,
      subject: conversation?.listing
        ? { kind: 'listing', id: conversation.listing.id, title: conversation.listing.title }
        : conversation?.serviceProfile
          ? { kind: 'service', id: conversation.serviceProfile.id, title: conversation.serviceProfile.headline }
          : conversation?.project
            ? { kind: 'project', id: conversation.project.id, title: conversation.project.title }
            : null,
      messages: rows
        .slice(0, REPORTED_MESSAGES_LIMIT)
        .reverse()
        .map((m) => ({ id: m.id, author: m.senderId === report.reporterId ? 'reporter' : 'reported', body: m.body, createdAt: m.createdAt.toISOString() })),
      truncated: rows.length > REPORTED_MESSAGES_LIMIT,
    };
  }

  async update(viewer: AuthUser, id: string, input: UpdateReportInput, ip?: string): Promise<AdminReportDetail> {
    await this.prisma.$transaction(async (tx) => {
      const [report] = await tx.$queryRaw<{ id: string; status: ReportStatus; priority: ReportPriority; assignee_id: string | null }[]>`
        SELECT id, status, priority, assignee_id FROM reports WHERE id = ${id} FOR UPDATE`;
      if (!report) throw new NotFoundException('Diese Meldung gibt es nicht.');
      const closed = !OPEN_STATUSES.includes(report.status);
      if (closed && (input.priority || input.assign)) throw new ConflictException('Diese Meldung ist bereits erledigt.');
      const data: Prisma.ReportUpdateInput = {};
      const events: Prisma.ReportEventCreateManyInput[] = [];
      if (input.priority && input.priority !== report.priority) {
        data.priority = input.priority;
        events.push({ reportId: id, actorId: viewer.id, type: 'PRIORITY_CHANGED', metadata: { from: report.priority, to: input.priority } });
      }
      if (input.assign === 'me' && report.assignee_id !== viewer.id) {
        data.assignee = { connect: { id: viewer.id } };
        events.push({ reportId: id, actorId: viewer.id, type: 'ASSIGNED' });
        if (report.status === 'OPEN') {
          data.status = 'IN_REVIEW';
          events.push({ reportId: id, actorId: viewer.id, type: 'STATUS_CHANGED', fromStatus: 'OPEN', toStatus: 'IN_REVIEW' });
        }
      } else if (input.assign === 'none' && report.assignee_id) {
        data.assignee = { disconnect: true };
        events.push({ reportId: id, actorId: viewer.id, type: 'UNASSIGNED' });
      }
      if (input.note) events.push({ reportId: id, actorId: viewer.id, type: 'NOTE', note: input.note });
      if (Object.keys(data).length) await tx.report.update({ where: { id }, data });
      if (events.length) await tx.reportEvent.createMany({ data: events });
    });
    this.audit.log({ action: 'report.updated', actorId: viewer.id, entityType: 'report', entityId: id, ip, metadata: { fields: Object.keys(input) } });
    return this.detail(id);
  }

  /** Kein Verstoß. Gleichzeitige Bearbeitung: nur die erste Entscheidung zählt. */
  async dismiss(viewer: AuthUser, id: string, input: DismissReportInput, ip?: string): Promise<AdminReportDetail> {
    const report = await this.requireReport(id);
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.updateMany({
        where: { id, status: { in: OPEN_STATUSES } },
        data: { status: 'DISMISSED', abusive: input.abusive, resolutionNote: input.note, handledById: viewer.id, handledAt: new Date() },
      });
      if (updated.count === 0) return false;
      await tx.reportEvent.create({
        data: { reportId: id, actorId: viewer.id, type: 'STATUS_CHANGED', fromStatus: report.status, toStatus: 'DISMISSED', note: input.note, metadata: { abusive: input.abusive } },
      });
      return true;
    });
    if (!result) throw new ConflictException('Diese Meldung wurde inzwischen bereits bearbeitet.');
    this.audit.log({ action: 'report.dismissed', actorId: viewer.id, entityType: 'report', entityId: id, ip, metadata: { abusive: input.abusive } });
    await this.notifyReporters([report], 'DISMISSED');
    return this.detail(id);
  }

  /**
   * Schließt alle offenen Meldungen zu einem Inhalt mit einer Entscheidung ab (innerhalb der Transaktion der Entscheidung).
   * `status` = RESOLVED (Maßnahme), DISMISSED (kein Verstoß) oder IN_REVIEW (vorläufig ausgeblendet, Prüfung läuft).
   */
  async closeWithDecision(
    tx: Prisma.TransactionClient,
    where: Prisma.ReportWhereInput,
    /** null: Entscheidung ohne betroffenes Konto (Affiliate-Deals) */
    decisionId: string | null,
    actorId: string,
    status: 'RESOLVED' | 'DISMISSED' | 'IN_REVIEW',
  ) {
    const open = await tx.report.findMany({ where: { ...where, status: { in: OPEN_STATUSES } }, select: { id: true, status: true, reporterId: true, listingId: true, dealId: true, serviceProfileId: true, projectId: true, conversationId: true, reason: true } });
    if (!open.length) return [];
    const final = status !== 'IN_REVIEW';
    await tx.report.updateMany({
      where: { id: { in: open.map((r) => r.id) } },
      data: { status, decisionId, ...(final ? { handledById: actorId, handledAt: new Date() } : {}) },
    });
    await tx.reportEvent.createMany({
      data: open.filter((r) => r.status !== status).map((r) => ({ reportId: r.id, actorId, type: 'STATUS_CHANGED' as const, fromStatus: r.status, toStatus: status, metadata: { decisionId } })),
    });
    return final ? open : [];
  }

  /** Meldende Personen erfahren das Ergebnis (Art. 16 Abs. 5 DSA) – ohne Details zur betroffenen Person. */
  async notifyReporters(
    reports: { reporterId: string | null; listingId: string | null; dealId?: string | null; serviceProfileId?: string | null; projectId?: string | null; conversationId: string | null; reason: ReportReason }[],
    outcome: 'RESOLVED' | 'DISMISSED',
  ) {
    const titles = new Map<string, string>();
    const listingIds = [...new Set(reports.flatMap((r) => (r.listingId ? [r.listingId] : [])))];
    if (listingIds.length) {
      for (const l of await this.prisma.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true } })) titles.set(l.id, l.title);
    }
    const dealIds = [...new Set(reports.flatMap((r) => (r.dealId ? [r.dealId] : [])))];
    if (dealIds.length) {
      for (const d of await this.prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, title: true } })) titles.set(d.id, d.title);
    }
    const profileIds = [...new Set(reports.flatMap((r) => (r.serviceProfileId ? [r.serviceProfileId] : [])))];
    if (profileIds.length) {
      for (const p of await this.prisma.serviceProfile.findMany({ where: { id: { in: profileIds } }, select: { id: true, headline: true } })) titles.set(p.id, p.headline);
    }
    const projectIds = [...new Set(reports.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
    if (projectIds.length) {
      for (const p of await this.prisma.serviceProject.findMany({ where: { id: { in: projectIds } }, select: { id: true, title: true } })) titles.set(p.id, p.title);
    }
    const seen = new Set<string>();
    for (const report of reports) {
      if (!report.reporterId) continue;
      const key = `${report.reporterId}:${report.listingId ?? report.dealId ?? report.serviceProfileId ?? report.projectId ?? report.conversationId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const subject = report.listingId
        ? `die Anzeige „${titles.get(report.listingId) ?? 'Anzeige'}“`
        : report.dealId
          ? `das Angebot „${titles.get(report.dealId) ?? 'Angebot'}“`
          : report.serviceProfileId
            ? `das Anbieterprofil „${titles.get(report.serviceProfileId) ?? 'Anbieterprofil'}“`
            : report.projectId
              ? `den Projektauftrag „${titles.get(report.projectId) ?? 'Projektauftrag'}“`
              : 'eine Unterhaltung';
      const result =
        outcome === 'RESOLVED'
          ? 'Wir haben einen Verstoß festgestellt und Maßnahmen ergriffen.'
          : 'Wir haben den Inhalt geprüft und keinen Verstoß gegen unsere Regeln oder geltendes Recht festgestellt. Der Inhalt bleibt deshalb online.';
      await this.notifications.notify({
        userId: report.reporterId,
        type: 'REPORT_HANDLED',
        title: 'Deine Meldung wurde bearbeitet',
        body: `Danke für deine Meldung zu ${subject} (Grund: ${REPORT_REASON_LABELS[report.reason]}).\n\n${result}`,
        link: '/konto/mitteilungen',
      });
    }
  }

  private async requireReport(id: string) {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diese Meldung gibt es nicht.');
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: { ...reportSummaryInclude, handledBy: { select: personSelect } },
    });
    if (!report) throw new NotFoundException('Diese Meldung gibt es nicht.');
    return report;
  }

  private async canViewMessages(report: { targetType: string; conversationId: string | null; status: ReportStatus; decisionId: string | null }) {
    if (report.targetType !== 'CONVERSATION' || !report.conversationId) return false;
    if (OPEN_STATUSES.includes(report.status)) return true;
    if (!report.decisionId) return false;
    const appeal = await this.prisma.appeal.findUnique({ where: { decisionId: report.decisionId }, select: { status: true } });
    return appeal?.status === 'OPEN';
  }
}
