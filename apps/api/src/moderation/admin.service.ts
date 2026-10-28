import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminAppealItem,
  AdminAppealQuery,
  AdminAuditQuery,
  AdminDashboard,
  AdminListingDetail,
  AdminListingQuery,
  AdminListingSummary,
  AdminUserDetail,
  AdminUserQuery,
  AdminUserSummary,
  AuditEntry,
  ChangeRoleInput,
  Paginated,
  ReportingRestrictionInput,
} from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService, IMPORTANT_AUDIT_PREFIXES } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ImageUrls } from '../images/image-urls.js';
import { JobsService } from '../jobs/jobs.service.js';
import { effectiveStatus, listingInclude, toListingDetail, toListingSummary, type ListingWithRelations } from '../listings/listings.mapper.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decisionInclude, personSelect, reportSummaryInclude, toAdminDecision, toPerson } from './moderation.mapper.js';
import { ModerationService } from './moderation.service.js';
import { OPEN_STATUSES, ReportsService } from './reports.service.js';

const PAGE_SIZE = 25;
const AUDIT_PAGE_SIZE = 50;
const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const adminListingInclude = {
  ...listingInclude,
  seller: { select: { ...listingInclude.seller.select, status: true } },
  _count: { select: { reports: { where: { status: { in: OPEN_STATUSES } } } } },
} satisfies Prisma.ListingInclude;

type AdminListingRow = Prisma.ListingGetPayload<{ include: typeof adminListingInclude }>;

/** Lesende Abfragen und Verwaltung im Admin-Bereich. Berechtigungen prüfen Controller (@Roles) und diese Klasse. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly urls: ImageUrls,
    private readonly jobs: JobsService,
    private readonly reports: ReportsService,
    private readonly moderation: ModerationService,
  ) {}

  // --- Dashboard -------------------------------------------------------------------

  async dashboard(viewer: AuthUser): Promise<AdminDashboard> {
    const now = new Date();
    const [byStatus, expired, reportCounts, urgent, reportedListings, openAppeals] = await Promise.all([
      this.prisma.listing.groupBy({ by: ['status'], _count: true }),
      this.prisma.listing.count({ where: { status: 'ACTIVE', expiresAt: { lte: now } } }),
      this.prisma.report.groupBy({ by: ['status'], where: { status: { in: OPEN_STATUSES } }, _count: true }),
      this.prisma.report.count({ where: { status: { in: OPEN_STATUSES }, priority: { in: ['HIGH', 'URGENT'] } } }),
      this.prisma.listing.count({ where: { status: { not: 'DELETED' }, reports: { some: { status: { in: OPEN_STATUSES } } } } }),
      this.prisma.appeal.count({ where: { status: 'OPEN' } }),
    ]);
    const [dealsActive, dealsPending, feedsPending, servicesActive, servicesPending, qualificationsOpen, projectsActive, projectsPending] = await Promise.all([
      this.prisma.deal.count({ where: { status: 'ACTIVE', endsAt: { gt: now } } }),
      this.prisma.deal.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.dealFeed.count({ where: { status: 'PENDING' } }),
      this.prisma.serviceProfile.count({ where: { status: 'ACTIVE' } }),
      this.prisma.serviceProfile.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.serviceQualification.count({ where: { status: 'CLAIMED', profile: { status: { not: 'DELETED' } } } }),
      this.prisma.serviceProject.count({ where: { status: 'ACTIVE', expiresAt: { gt: now } } }),
      this.prisma.serviceProject.count({ where: { status: 'PENDING_REVIEW' } }),
    ]);
    const count = (status: string) => byStatus.find((g) => g.status === status)?._count ?? 0;
    const moderation: AdminDashboard['moderation'] = {
      listings: {
        active: count('ACTIVE') - expired,
        paused: count('PAUSED'),
        expired: count('EXPIRED') + expired,
        pendingReview: count('PENDING_REVIEW'),
        rejected: count('REJECTED'),
        draft: count('DRAFT'),
      },
      reports: {
        open: reportCounts.find((g) => g.status === 'OPEN')?._count ?? 0,
        inReview: reportCounts.find((g) => g.status === 'IN_REVIEW')?._count ?? 0,
        urgent,
        reportedListings,
      },
      appeals: { open: openAppeals },
      deals: { active: dealsActive, pendingReview: dealsPending, feedsPending },
      services: { active: servicesActive, pendingReview: servicesPending, qualificationsOpen },
      projects: { active: projectsActive, pendingReview: projectsPending },
    };
    if (viewer.role !== 'ADMIN') return { moderation, system: null };

    const since14 = new Date(now.getTime() - 13 * DAY_MS);
    since14.setUTCHours(0, 0, 0, 0);
    const [usersByStatus, staff, new7d, new30d, registrations, deletions, jobs, events] = await Promise.all([
      this.prisma.user.groupBy({ by: ['status'], _count: true }),
      this.prisma.user.count({ where: { role: { in: ['ADMIN', 'MODERATOR'] }, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { createdAt: { gt: new Date(now.getTime() - 7 * DAY_MS) } } }),
      this.prisma.user.count({ where: { createdAt: { gt: new Date(now.getTime() - 30 * DAY_MS) } } }),
      this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', created_at) AS day, count(*) AS count FROM users
        WHERE created_at >= ${since14} GROUP BY 1 ORDER BY 1`,
      this.prisma.accountDeletion.groupBy({ by: ['status'], where: { status: { in: ['PENDING', 'FAILED'] } }, _count: true }),
      this.jobs.stats().catch(() => ({ backend: 'redis' as const, waiting: 0, delayed: 0, failed: -1, recentFailures: [] })),
      this.prisma.auditLog.findMany({
        where: { OR: IMPORTANT_AUDIT_PREFIXES.map((prefix) => ({ action: { startsWith: prefix } })) },
        include: { actor: { select: personSelect } },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ]);
    const userCount = (status: string) => usersByStatus.find((g) => g.status === status)?._count ?? 0;
    const perDay = new Map(registrations.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
    return {
      moderation,
      system: {
        users: {
          total: usersByStatus.reduce((sum, g) => sum + g._count, 0) - userCount('DELETED'),
          active: userCount('ACTIVE'),
          suspended: userCount('SUSPENDED'),
          deleted: userCount('DELETED'),
          staff,
          new7d,
          new30d,
        },
        registrations: Array.from({ length: 14 }, (_, i) => {
          const date = new Date(since14.getTime() + i * DAY_MS).toISOString().slice(0, 10);
          return { date, count: perDay.get(date) ?? 0 };
        }),
        deletions: {
          pending: deletions.find((g) => g.status === 'PENDING')?._count ?? 0,
          failed: deletions.find((g) => g.status === 'FAILED')?._count ?? 0,
        },
        jobs,
        events: events.map(toAuditEntry),
      },
    };
  }

  // --- Inserate ------------------------------------------------------------------------

  async listings(query: AdminListingQuery): Promise<Paginated<AdminListingSummary>> {
    const openReports = { some: { status: { in: OPEN_STATUSES } } };
    const now = new Date();
    const statusWhere: Prisma.ListingWhereInput =
      query.status === 'review'
        ? { OR: [{ status: 'PENDING_REVIEW' }, { reports: openReports }] }
        : query.status === 'reported'
          ? { reports: openReports }
          : query.status === 'all'
            ? {}
            : query.status === 'EXPIRED'
              ? { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { lte: now } }] }
              : query.status === 'ACTIVE'
                ? { status: 'ACTIVE', expiresAt: { gt: now } }
                : { status: query.status };
    const where: Prisma.ListingWhereInput = {
      AND: [
        { status: { not: 'DELETED' } },
        statusWhere,
        query.q ? (ENTITY_ID.test(query.q) ? { id: query.q } : { title: { contains: query.q, mode: 'insensitive' } }) : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.listing.findMany({ where, include: adminListingInclude, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      this.prisma.listing.count({ where }),
    ]);
    return { items: rows.map((row) => this.toAdminListing(row)), page: query.page, pageSize: PAGE_SIZE, total };
  }

  async listing(viewer: AuthUser, id: string): Promise<AdminListingDetail> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Dieses Inserat gibt es nicht.');
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: { ...listingInclude, seller: { select: { ...listingInclude.seller.select, status: true, email: true } } },
    });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException('Dieses Inserat gibt es nicht.');
    const [decisions, reportRows, moderation] = await Promise.all([
      this.prisma.moderationDecision.findMany({ where: { listingId: id }, include: decisionInclude, orderBy: { createdAt: 'desc' } }),
      this.prisma.report.findMany({ where: { listingId: id }, include: reportSummaryInclude, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.moderation.listingModerationInfo(listing),
    ]);
    return {
      listing: { ...toListingDetail(listing, this.urls, viewer.id), moderation },
      seller: {
        ...toPerson(listing.seller)!,
        status: listing.seller.status,
        createdAt: listing.seller.createdAt.toISOString(),
        // E-Mail-Adressen sehen nur Administratoren (Datenminimierung für die Moderation)
        email: viewer.role === 'ADMIN' ? listing.seller.email : null,
      },
      decisions: decisions.map((d) => toAdminDecision(d)),
      reports: await this.reports.summaries(reportRows),
      version: listing.updatedAt.toISOString(),
    };
  }

  private toAdminListing(row: AdminListingRow): AdminListingSummary {
    const summary = toListingSummary(row as unknown as ListingWithRelations, this.urls);
    return {
      id: row.id,
      title: row.title,
      status: effectiveStatus(row),
      thumbUrl: summary.imageUrl,
      seller: { ...toPerson(row.seller)!, status: row.seller.status },
      createdAt: row.createdAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      openReports: row._count.reports,
    };
  }

  // --- Konten ----------------------------------------------------------------------------

  async users(query: AdminUserQuery): Promise<Paginated<AdminUserSummary>> {
    const q = query.q;
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(q
        ? UUID.test(q)
          ? { id: q }
          : { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }, { companyName: { contains: q, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, include: this.userCounts(), orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map((row) => this.toAdminUser(row, true)), page: query.page, pageSize: PAGE_SIZE, total };
  }

  async user(viewer: AuthUser, id: string): Promise<AdminUserDetail> {
    if (!UUID.test(id)) throw new NotFoundException('Dieses Konto gibt es nicht.');
    const user = await this.prisma.user.findUnique({ where: { id }, include: { ...this.userCounts(), deletion: true } });
    if (!user) throw new NotFoundException('Dieses Konto gibt es nicht.');
    const [listings, reportRows, made, decisions] = await Promise.all([
      this.prisma.listing.findMany({ where: { sellerId: id, status: { not: 'DELETED' } }, include: adminListingInclude, orderBy: { updatedAt: 'desc' }, take: 20 }),
      this.prisma.report.findMany({ where: { reportedId: id }, include: reportSummaryInclude, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.report.groupBy({ by: ['abusive'], where: { reporterId: id }, _count: true }),
      this.prisma.moderationDecision.findMany({ where: { userId: id }, include: decisionInclude, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return {
      ...this.toAdminUser(user, viewer.role === 'ADMIN'),
      companyName: user.companyName,
      listings: listings.map((row) => this.toAdminListing(row)),
      reportsReceived: await this.reports.summaries(reportRows),
      reportsMade: { total: made.reduce((sum, g) => sum + g._count, 0), abusive: made.find((g) => g.abusive)?._count ?? 0 },
      reportingBlockedUntil: user.reportingBlockedUntil?.toISOString() ?? null,
      dealsBlockedAt: user.dealsBlockedAt?.toISOString() ?? null,
      decisions: decisions.map((d) => toAdminDecision(d)),
      deletion: user.deletion ? { status: user.deletion.status, requestedAt: user.deletion.requestedAt.toISOString() } : null,
    };
  }

  /**
   * Rollen USER ↔ MODERATOR. ADMIN wird nie über die API vergeben oder entzogen (nur per Kommandozeile mit
   * Serverzugang, siehe scripts/admin-role.ts) – so kann sich niemand über manipulierte Requests hochstufen.
   */
  async changeRole(admin: AuthUser, id: string, input: ChangeRoleInput, ip?: string): Promise<AdminUserDetail> {
    if (id === admin.id) throw new ForbiddenException('Die eigene Rolle kannst du nicht ändern.');
    if (!UUID.test(id)) throw new NotFoundException('Dieses Konto gibt es nicht.');
    const target = await this.prisma.user.findUnique({ where: { id }, select: { role: true, status: true } });
    if (!target || target.status === 'DELETED') throw new NotFoundException('Dieses Konto gibt es nicht.');
    if (target.role === 'ADMIN') throw new ForbiddenException('Administratorrechte werden nur über die Kommandozeile geändert.');
    if (target.status !== 'ACTIVE' && input.role !== 'USER') throw new ConflictException('Gesperrte Konten können keine Moderationsrechte erhalten.');
    if (target.role !== input.role) {
      const updated = await this.prisma.user.updateMany({ where: { id, role: target.role }, data: { role: input.role } });
      if (updated.count === 0) throw new ConflictException('Die Rolle wurde inzwischen geändert. Bitte lade die Seite neu.');
      this.audit.log({ action: 'admin.role_changed', actorId: admin.id, entityType: 'user', entityId: id, ip, metadata: { from: target.role, to: input.role } });
    }
    return this.user(admin, id);
  }

  /** Meldefunktion einschränken (Art. 23 DSA – nach vorheriger Warnung und Einzelfallprüfung) */
  async restrictReporting(admin: AuthUser, id: string, input: ReportingRestrictionInput, ip?: string): Promise<AdminUserDetail> {
    if (!UUID.test(id)) throw new NotFoundException('Dieses Konto gibt es nicht.');
    const until = input.days ? new Date(Date.now() + input.days * DAY_MS) : null;
    const updated = await this.prisma.user.updateMany({ where: { id, status: { not: 'DELETED' } }, data: { reportingBlockedUntil: until } });
    if (updated.count === 0) throw new NotFoundException('Dieses Konto gibt es nicht.');
    this.audit.log({ action: 'admin.reporting_restricted', actorId: admin.id, entityType: 'user', entityId: id, ip, metadata: { days: input.days, hasNote: Boolean(input.note) } });
    return this.user(admin, id);
  }

  private userCounts() {
    return {
      _count: {
        select: {
          listings: { where: { status: 'ACTIVE' as const, expiresAt: { gt: new Date() } } },
          reportsReceived: { where: { status: { in: OPEN_STATUSES } } },
        },
      },
    };
  }

  private toAdminUser(
    user: Prisma.UserGetPayload<{ include: { _count: { select: { listings: true; reportsReceived: true } } } }>,
    showEmail: boolean,
  ): AdminUserSummary {
    return {
      id: user.id,
      displayName: user.status === 'DELETED' ? 'Gelöschtes Konto' : user.displayName,
      email: showEmail && user.status !== 'DELETED' ? user.email : null,
      role: user.role,
      status: user.status,
      accountType: user.accountType,
      createdAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      activeListings: user._count.listings,
      openReports: user._count.reportsReceived,
    };
  }

  // --- Einsprüche und Protokoll ----------------------------------------------------------

  async appeals(query: AdminAppealQuery): Promise<Paginated<AdminAppealItem>> {
    const where: Prisma.AppealWhereInput = { status: query.status };
    const [rows, total] = await Promise.all([
      this.prisma.appeal.findMany({
        where,
        include: { user: { select: personSelect }, reviewer: { select: personSelect }, decision: { include: decisionInclude } },
        orderBy: { createdAt: query.status === 'OPEN' ? 'asc' : 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.appeal.count({ where }),
    ]);
    return { items: rows.map(toAppealItem), page: query.page, pageSize: PAGE_SIZE, total };
  }

  async appeal(id: string): Promise<AdminAppealItem> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diesen Einspruch gibt es nicht.');
    const row = await this.prisma.appeal.findUnique({
      where: { id },
      include: { user: { select: personSelect }, reviewer: { select: personSelect }, decision: { include: decisionInclude } },
    });
    if (!row) throw new NotFoundException('Diesen Einspruch gibt es nicht.');
    return toAppealItem(row);
  }

  async auditLog(query: AdminAuditQuery): Promise<Paginated<AuditEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, include: { actor: { select: personSelect } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: rows.map(toAuditEntry), page: query.page, pageSize: AUDIT_PAGE_SIZE, total };
  }
}

function toAuditEntry(row: Prisma.AuditLogGetPayload<{ include: { actor: { select: typeof personSelect } } }>): AuditEntry {
  return {
    id: row.id.toString(),
    action: row.action,
    actor: toPerson(row.actor),
    entityType: row.entityType,
    entityId: row.entityId,
    ipPrefix: row.ipPrefix,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAppealItem(
  row: Prisma.AppealGetPayload<{ include: { user: { select: typeof personSelect }; reviewer: { select: typeof personSelect }; decision: { include: typeof decisionInclude } } }>,
): AdminAppealItem {
  return {
    id: row.id,
    status: row.status,
    body: row.body,
    response: row.response,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    user: { ...toPerson(row.user)!, status: row.user.status },
    reviewer: toPerson(row.reviewer),
    decision: toAdminDecision(row.decision),
  };
}
