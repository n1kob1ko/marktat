import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminServiceProfileDetail, AdminServiceProfileSummary, AdminServiceQuery, Paginated, QualificationReviewInput } from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { decisionInclude, personSelect, reportSummaryInclude, toAdminDecision, toPerson } from '../moderation/moderation.mapper.js';
import { OPEN_STATUSES, ReportsService } from '../moderation/reports.service.js';
import { NotificationsService } from '../moderation/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { providerName, toQualificationView } from './services.mapper.js';
import { ServiceProfilesService } from './service-profiles.service.js';

const PAGE_SIZE = 25;

/** Moderation der Anbieterprofile: Prüfliste, Details, Prüfung von Qualifikationen */
@Injectable()
export class AdminServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly profiles: ServiceProfilesService,
    private readonly reports: ReportsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: AdminServiceQuery): Promise<Paginated<AdminServiceProfileSummary>> {
    const openReports = { some: { status: { in: OPEN_STATUSES } } };
    const pendingQualifications = { some: { status: 'CLAIMED' as const } };
    let filter: Prisma.ServiceProfileWhereInput;
    switch (query.filter) {
      case 'review':
        filter = { OR: [{ status: 'PENDING_REVIEW' }, { reports: openReports }, { status: { in: ['ACTIVE', 'PAUSED'] }, qualifications: pendingQualifications }] };
        break;
      case 'reported':
        filter = { reports: openReports };
        break;
      case 'qualifications':
        filter = { qualifications: pendingQualifications };
        break;
      case 'all':
        filter = {};
        break;
      default:
        filter = { status: query.filter };
    }
    const q = query.q;
    const where: Prisma.ServiceProfileWhereInput = {
      AND: [
        { status: { not: 'DELETED' } },
        filter,
        q
          ? ENTITY_ID.test(q)
            ? { id: q }
            : {
                OR: [
                  { headline: { contains: q, mode: 'insensitive' } },
                  { user: { companyName: { contains: q, mode: 'insensitive' } } },
                  { user: { displayName: { contains: q, mode: 'insensitive' } } },
                ],
              }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.serviceProfile.findMany({
        where,
        include: {
          user: { select: { id: true, displayName: true, companyName: true, accountType: true, status: true, deletedAt: true } },
          categories: { include: { category: { select: { name: true } } } },
          _count: {
            select: {
              reports: { where: { status: { in: OPEN_STATUSES } } },
              qualifications: { where: { status: 'CLAIMED' } },
              portfolio: { where: { hiddenAt: { not: null } } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.serviceProfile.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        headline: row.headline,
        status: row.status,
        provider: { id: row.user.id, displayName: providerName(row.user), business: row.user.accountType === 'BUSINESS', status: row.user.status },
        categories: row.categories.map((c) => c.category.name),
        openReports: row._count.reports,
        pendingQualifications: row._count.qualifications,
        hiddenPortfolioItems: row._count.portfolio,
        updatedAt: row.updatedAt.toISOString(),
      })),
      page: query.page,
      pageSize: PAGE_SIZE,
      total,
    };
  }

  async detail(viewer: AuthUser, id: string): Promise<AdminServiceProfileDetail> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Dieses Anbieterprofil gibt es nicht.');
    const row = await this.prisma.serviceProfile.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, displayName: true, companyName: true, accountType: true, status: true, deletedAt: true, email: true, createdAt: true } },
        qualifications: { include: { reviewedBy: { select: personSelect } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row || row.status === 'DELETED') throw new NotFoundException('Dieses Anbieterprofil gibt es nicht.');
    const [profile, decisions, reportRows] = await Promise.all([
      this.profiles.findOne(id, viewer),
      this.prisma.moderationDecision.findMany({ where: { serviceProfileId: id }, include: decisionInclude, orderBy: { createdAt: 'desc' } }),
      this.prisma.report.findMany({ where: { serviceProfileId: id }, include: reportSummaryInclude, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return {
      profile,
      provider: {
        id: row.user.id,
        displayName: providerName(row.user),
        email: viewer.role === 'ADMIN' && row.user.status !== 'DELETED' ? row.user.email : null,
        business: row.user.accountType === 'BUSINESS',
        status: row.user.status,
        createdAt: row.user.createdAt.toISOString(),
      },
      qualifications: row.qualifications.map((q) => ({ ...toQualificationView(q, true), reviewNote: q.reviewNote, reviewedBy: toPerson(q.reviewedBy) })),
      decisions: decisions.map((d) => toAdminDecision(d)),
      reports: await this.reports.summaries(reportRows),
      viewCount: row.viewCount,
      version: row.updatedAt.toISOString(),
    };
  }

  /**
   * Qualifikation prüfen (z. B. GISA-Eintrag, Zeugnis oder Registernummer abgeglichen). Erst danach erscheint sie
   * öffentlich als „von MarktAT geprüft“. Die Prüfung ersetzt keine behördliche Bestätigung.
   */
  async reviewQualification(reviewer: AuthUser, qualificationId: string, input: QualificationReviewInput, ip?: string): Promise<AdminServiceProfileDetail> {
    if (!ENTITY_ID.test(qualificationId)) throw new NotFoundException('Diese Qualifikation gibt es nicht.');
    const qualification = await this.prisma.serviceQualification.findUnique({ where: { id: qualificationId }, include: { profile: { select: { id: true, userId: true, status: true, headline: true } } } });
    if (!qualification || qualification.profile.status === 'DELETED') throw new NotFoundException('Diese Qualifikation gibt es nicht.');
    if (qualification.profile.userId === reviewer.id) throw new ForbiddenException('Eigene Angaben kannst du nicht prüfen.');
    const status = input.decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED';
    if (qualification.status === status) throw new ConflictException('Diese Qualifikation hat bereits diesen Stand.');
    const updated = await this.prisma.serviceQualification.updateMany({
      where: { id: qualificationId, updatedAt: qualification.updatedAt },
      data: { status, reviewedById: reviewer.id, reviewedAt: new Date(), reviewNote: input.note || null },
    });
    if (!updated.count) throw new ConflictException('Die Angabe wurde inzwischen geändert. Bitte lade die Seite neu.');
    this.audit.log({
      action: status === 'VERIFIED' ? 'admin.qualification_verified' : 'admin.qualification_rejected',
      actorId: reviewer.id,
      entityType: 'service_profile',
      entityId: qualification.profile.id,
      ip,
      metadata: { qualificationId },
    });
    await this.notifications.notify({
      userId: qualification.profile.userId,
      type: 'QUALIFICATION_REVIEWED',
      title: status === 'VERIFIED' ? 'Deine Qualifikation wurde geprüft' : 'Deine Qualifikation konnte nicht bestätigt werden',
      body: [
        status === 'VERIFIED'
          ? `Wir haben deine Angabe „${qualification.title}“ geprüft. Sie erscheint in deinem Anbieterprofil jetzt als „von MarktAT geprüft“.`
          : `Wir konnten deine Angabe „${qualification.title}“ nicht bestätigen. Sie wird in deinem Anbieterprofil nicht mehr angezeigt.`,
        input.note ? `Hinweis: ${input.note}` : '',
        status === 'REJECTED' ? 'Du kannst die Angabe löschen und mit einem überprüfbaren Nachweis (z. B. GISA-Zahl) neu eintragen.' : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      link: '/konto/dienstleistungen',
    });
    return this.detail(reviewer, qualification.profile.id);
  }
}
