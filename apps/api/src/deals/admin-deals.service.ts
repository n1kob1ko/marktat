import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ADMIN_DEAL_DISCOUNT_ATTENTION,
  type AdminDealDetail,
  type AdminDealQuery,
  type AdminDealSummary,
  type AssignDealMerchantInput,
  type Paginated,
  AFFILIATE_NETWORK_LABELS,
} from '@marktat/shared';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { MediaUrls } from '../images/media.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { decisionInclude, reportSummaryInclude, toAdminDecision, toPerson } from '../moderation/moderation.mapper.js';
import { ReportsService, OPEN_STATUSES } from '../moderation/reports.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DealSearchService } from './deal-search.service.js';
import { dealDisplayStatus, dealInclude, toMerchantDeal, verifiedSince } from './deals.mapper.js';
import { DealsService } from './deals.service.js';

const PAGE_SIZE = 25;

/** Deal-Moderation im Admin-Bereich: Prüfliste, Details, Zuordnung zu einem anderen Händlerkonto */
@Injectable()
export class AdminDealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly urls: MediaUrls,
    private readonly deals: DealsService,
    private readonly reports: ReportsService,
    private readonly search: DealSearchService,
  ) {}

  async list(query: AdminDealQuery): Promise<Paginated<AdminDealSummary>> {
    const now = new Date();
    const openReports = { some: { status: { in: OPEN_STATUSES } } };
    let filter: Prisma.DealWhereInput;
    switch (query.filter) {
      case 'review':
        filter = { OR: [{ status: 'PENDING_REVIEW' }, { reports: openReports }] };
        break;
      case 'reported':
        filter = { reports: openReports };
        break;
      case 'discount':
        filter = { discountPercent: { gte: ADMIN_DEAL_DISCOUNT_ATTENTION }, status: { notIn: ['DRAFT', 'REJECTED'] } };
        break;
      case 'broken':
        filter = { linkStatus: 'BROKEN' };
        break;
      case 'unverified':
        filter = { status: 'ACTIVE', endsAt: { gt: now }, OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lte: verifiedSince(now) } }] };
        break;
      case 'duplicates':
        filter = { id: { in: await this.duplicateIds() } };
        break;
      case 'EXPIRED':
        filter = { OR: [{ status: 'EXPIRED' }, { status: { in: ['ACTIVE', 'PAUSED'] }, endsAt: { lte: now } }] };
        break;
      case 'ACTIVE':
      case 'PAUSED':
        filter = { status: query.filter, endsAt: { gt: now } };
        break;
      case 'REJECTED':
      case 'DRAFT':
        filter = { status: query.filter };
        break;
      default:
        filter = {};
    }
    const q = query.q;
    const where: Prisma.DealWhereInput = {
      AND: [
        { status: { not: 'DELETED' } },
        filter,
        query.merchant ? { merchantId: query.merchant } : {},
        q
          ? ENTITY_ID.test(q)
            ? { id: q }
            : { OR: [{ title: { contains: q, mode: 'insensitive' } }, { merchant: { companyName: { contains: q, mode: 'insensitive' } } }, { externalId: q }] }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        include: { ...dealInclude, _count: { select: { reports: { where: { status: { in: OPEN_STATUSES } } } } } },
        orderBy: query.filter === 'discount' ? [{ discountPercent: 'desc' }, { updatedAt: 'desc' }] : { updatedAt: 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.deal.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        ...toMerchantDeal(row, this.urls, now),
        merchantStatus: row.merchant?.status ?? null,
        openReports: row._count.reports,
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: PAGE_SIZE,
      total,
    };
  }

  async detail(viewer: AuthUser, id: string): Promise<AdminDealDetail> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Dieses Angebot gibt es nicht.');
    const row = await this.prisma.deal.findUnique({
      where: { id },
      include: {
        merchant: { select: { id: true, displayName: true, companyName: true, status: true, dealsBlockedAt: true } },
        affiliateProgram: { select: { id: true, name: true, network: true, status: true } },
        affiliateFeed: { select: { name: true } },
      },
    });
    if (!row || row.status === 'DELETED') throw new NotFoundException('Dieses Angebot gibt es nicht.');
    const [deal, decisions, reportRows, duplicates, eligibility] = await Promise.all([
      this.deals.findOne(id, viewer),
      this.prisma.moderationDecision.findMany({ where: { dealId: id }, include: decisionInclude, orderBy: { createdAt: 'desc' } }),
      this.prisma.report.findMany({ where: { dealId: id }, include: reportSummaryInclude, orderBy: { createdAt: 'desc' }, take: 50 }),
      // Nur Händlerdeals: Feeds der Partnerprogramme haben oft Varianten mit gleichem Namen (Größe, Farbe)
      this.prisma.deal.findMany({
        where: { merchantId: row.merchantId ?? '00000000-0000-0000-0000-000000000000', id: { not: id }, status: { not: 'DELETED' }, title: { equals: row.title, mode: 'insensitive' } },
        select: { id: true, title: true, status: true, startsAt: true, endsAt: true, lastVerifiedAt: true, availability: true },
        take: 20,
      }),
      row.merchantId ? this.deals.eligibility(row.merchantId) : null,
    ]);
    return {
      deal,
      merchant:
        row.merchant && eligibility
          ? {
              ...toPerson(row.merchant)!,
              companyName: row.merchant.companyName,
              status: row.merchant.status,
              dealsBlockedAt: row.merchant.dealsBlockedAt?.toISOString() ?? null,
              eligibility,
            }
          : null,
      affiliate: row.affiliateProgram
        ? {
            programId: row.affiliateProgram.id,
            programName: row.affiliateProgram.name,
            programStatus: row.affiliateProgram.status,
            networkName: AFFILIATE_NETWORK_LABELS[row.affiliateProgram.network],
            feedName: row.affiliateFeed?.name ?? null,
            externalId: row.externalId,
          }
        : null,
      decisions: decisions.map((d) => toAdminDecision(d)),
      reports: await this.reports.summaries(reportRows),
      duplicates: duplicates.map((d) => ({ id: d.id, title: d.title, status: dealDisplayStatus(d) })),
      linkFailures: row.linkFailures,
      linkCheckedAt: row.linkCheckedAt?.toISOString() ?? null,
      viewCount: row.viewCount,
      clickCount: row.clickCount,
      version: row.updatedAt.toISOString(),
    };
  }

  /**
   * Deal einem anderen Händlerkonto zuordnen (z. B. Konto gewechselt). Filialen gehören dem bisherigen Händler und
   * werden entfernt – Deals mit Filialen werden deshalb pausiert, bis der neue Händler eigene Filialen zuordnet.
   */
  async assignMerchant(admin: AuthUser, id: string, input: AssignDealMerchantInput, ip?: string): Promise<AdminDealDetail> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Dieses Angebot gibt es nicht.');
    const deal = await this.prisma.deal.findUnique({ where: { id } });
    if (!deal || deal.status === 'DELETED') throw new NotFoundException('Dieses Angebot gibt es nicht.');
    // Affiliate-Angebote gehören einem Partnerprogramm und nie einem MarktAT-Händlerkonto
    if (deal.source === 'AFFILIATE') throw new ConflictException('Angebote aus Partnerprogrammen lassen sich keinem Händlerkonto zuordnen.');
    if (deal.merchantId === input.merchantId) throw new ConflictException('Das Angebot gehört bereits zu diesem Konto.');
    const target = await this.prisma.user.findUnique({ where: { id: input.merchantId }, select: { id: true, accountType: true, status: true } });
    if (!target || target.status === 'DELETED') throw new NotFoundException('Dieses Konto gibt es nicht.');
    if (target.accountType !== 'BUSINESS') throw new ConflictException('Deals können nur gewerblichen Konten gehören.');
    const eligibility = await this.deals.eligibility(target.id);
    if (eligibility.blocked) throw new ConflictException('Dieses Konto ist für Deals gesperrt.');
    const externalIdTaken = deal.externalId
      ? Boolean(await this.prisma.deal.count({ where: { merchantId: target.id, externalId: deal.externalId } }))
      : false;
    await this.prisma.$transaction(async (tx) => {
      await tx.dealStore.deleteMany({ where: { dealId: id } });
      await tx.deal.update({
        where: { id },
        data: {
          merchantId: target.id,
          clientRequestId: null,
          ...(externalIdTaken && { externalId: null }),
          ...(deal.channel !== 'ONLINE' && deal.status === 'ACTIVE' && { status: 'PAUSED' }),
        },
      });
    });
    this.audit.log({
      action: 'admin.deal_merchant_changed',
      actorId: admin.id,
      entityType: 'deal',
      entityId: id,
      ip,
      metadata: { from: deal.merchantId, to: target.id, note: input.note, externalIdCleared: externalIdTaken },
    });
    this.search.index.sync(id);
    return this.detail(admin, id);
  }

  /** Mögliche Doppelte: derselbe Händler, gleicher Titel (ohne Groß-/Kleinschreibung), beide nicht gelöscht */
  private async duplicateIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT d.id FROM deals d
      WHERE d.status <> 'DELETED' AND EXISTS (
        SELECT 1 FROM deals o
        WHERE o.merchant_id = d.merchant_id AND o.id <> d.id AND o.status <> 'DELETED' AND lower(o.title) = lower(d.title)
      )
      LIMIT 1000`;
    return rows.map((r) => r.id);
  }
}
