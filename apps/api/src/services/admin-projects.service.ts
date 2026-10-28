import { Injectable, NotFoundException } from '@nestjs/common';
import type { AdminProjectDetail, AdminProjectQuery, AdminProjectSummary, Paginated } from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { decisionInclude, reportSummaryInclude, toAdminDecision } from '../moderation/moderation.mapper.js';
import { OPEN_STATUSES, ReportsService } from '../moderation/reports.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectsService } from './projects.service.js';
import { providerName } from './services.mapper.js';

const PAGE_SIZE = 25;

/** Moderation der Projektaufträge: Prüfliste und Details (Entscheidungen über ModerationService.decideProject) */
@Injectable()
export class AdminProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly reports: ReportsService,
  ) {}

  async list(query: AdminProjectQuery): Promise<Paginated<AdminProjectSummary>> {
    const openReports = { some: { status: { in: OPEN_STATUSES } } };
    let filter: Prisma.ServiceProjectWhereInput;
    switch (query.filter) {
      case 'review':
        filter = { OR: [{ status: 'PENDING_REVIEW' }, { reports: openReports }] };
        break;
      case 'reported':
        filter = { reports: openReports };
        break;
      case 'all':
        filter = {};
        break;
      default:
        filter = { status: query.filter };
    }
    const q = query.q;
    const where: Prisma.ServiceProjectWhereInput = {
      AND: [
        { status: { not: 'DELETED' } },
        filter,
        q
          ? ENTITY_ID.test(q)
            ? { id: q }
            : {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { user: { companyName: { contains: q, mode: 'insensitive' } } },
                  { user: { displayName: { contains: q, mode: 'insensitive' } } },
                ],
              }
          : {},
      ],
    };
    const now = new Date();
    const [rows, total] = await Promise.all([
      this.prisma.serviceProject.findMany({
        where,
        include: {
          user: { select: { id: true, displayName: true, companyName: true, accountType: true, status: true, deletedAt: true } },
          category: { select: { name: true } },
          _count: { select: { reports: { where: { status: { in: OPEN_STATUSES } } }, conversations: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.serviceProject.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        expired: (row.status === 'ACTIVE' || row.status === 'PAUSED') && row.expiresAt !== null && row.expiresAt <= now,
        client: { id: row.user.id, displayName: providerName(row.user), business: row.user.accountType === 'BUSINESS', status: row.user.status },
        category: row.category.name,
        openReports: row._count.reports,
        contactCount: row._count.conversations,
        updatedAt: row.updatedAt.toISOString(),
      })),
      page: query.page,
      pageSize: PAGE_SIZE,
      total,
    };
  }

  async detail(viewer: AuthUser, id: string): Promise<AdminProjectDetail> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diesen Projektauftrag gibt es nicht.');
    const row = await this.prisma.serviceProject.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, displayName: true, companyName: true, accountType: true, status: true, deletedAt: true, email: true, createdAt: true } },
        _count: { select: { conversations: true } },
      },
    });
    if (!row || row.status === 'DELETED') throw new NotFoundException('Diesen Projektauftrag gibt es nicht.');
    const [project, decisions, reportRows] = await Promise.all([
      this.projects.findOne(id, viewer),
      this.prisma.moderationDecision.findMany({ where: { projectId: id }, include: decisionInclude, orderBy: { createdAt: 'desc' } }),
      this.prisma.report.findMany({ where: { projectId: id }, include: reportSummaryInclude, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return {
      project,
      client: {
        id: row.user.id,
        displayName: providerName(row.user),
        email: viewer.role === 'ADMIN' && row.user.status !== 'DELETED' ? row.user.email : null,
        business: row.user.accountType === 'BUSINESS',
        status: row.user.status,
        createdAt: row.user.createdAt.toISOString(),
      },
      decisions: decisions.map((d) => toAdminDecision(d)),
      reports: await this.reports.summaries(reportRows),
      contactCount: row._count.conversations,
      viewCount: row.viewCount,
      version: row.updatedAt.toISOString(),
    };
  }
}
