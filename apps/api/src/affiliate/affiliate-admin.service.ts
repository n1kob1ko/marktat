import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AFFILIATE_FEED_LIST_INTERVAL_MINUTES,
  type AffiliateFeedReviewInput,
  type AffiliateFeedView,
  type AffiliateManualSyncInput,
  type AffiliateOverview,
  type AffiliateProgramReviewInput,
  type AffiliateProgramView,
  type AffiliateSyncRunView,
  type AffiliateSyncStats,
  type AffiliateWarning,
} from '@marktat/shared';
import type { AffiliateFeed, AffiliateProgram, AffiliateSyncRun } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { publicDealWhere } from '../deals/deals.mapper.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AwinClient } from './awin.client.js';
import { AFFILIATE_MANUAL_JOB, AffiliateSyncService } from './affiliate-sync.service.js';

const DAY_MS = 86_400_000;

type ProgramWithFeeds = AffiliateProgram & { feeds: AffiliateFeed[]; defaultCategory: { slug: string } | null; reviewer?: { displayName: string } | null };

/** Admin-Übersicht der Affiliate-Deals: Freigaben, Abrufe, Datenqualität und Warnungen */
@Injectable()
export class AffiliateAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly awin: AwinClient,
    private readonly sync: AffiliateSyncService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  async overview(): Promise<AffiliateOverview> {
    const now = new Date();
    const affiliate = { source: 'AFFILIATE' as const };
    const [programs, runs, activeDeals, expiredDeals, withoutImage, inReview, activePromotions, lastSuccess, lastFeedSuccess, invalidRuns] = await Promise.all([
      this.prisma.affiliateProgram.findMany({ include: { feeds: { orderBy: { name: 'asc' } }, defaultCategory: { select: { slug: true } } }, orderBy: [{ status: 'asc' }, { name: 'asc' }] }),
      this.prisma.affiliateSyncRun.findMany({ include: { program: { select: { name: true } }, feed: { select: { name: true } } }, orderBy: { startedAt: 'desc' }, take: 30 }),
      this.prisma.deal.count({ where: { ...publicDealWhere(now), ...affiliate } }),
      this.prisma.deal.count({ where: { ...affiliate, updatedAt: { gt: new Date(now.getTime() - 30 * DAY_MS) }, OR: [{ status: 'EXPIRED' }, { availability: 'SOLD_OUT', status: 'ACTIVE' }] } }),
      this.prisma.deal.count({
        where: { ...affiliate, status: { in: ['ACTIVE', 'PENDING_REVIEW'] }, endsAt: { gt: now }, OR: [{ externalImageUrl: null }, { affiliateProgram: { is: { allowImages: false } } }] },
      }),
      this.prisma.deal.count({ where: { ...affiliate, status: 'PENDING_REVIEW' } }),
      this.prisma.affiliatePromotion.count({ where: this.visiblePromotionWhere(now) }),
      this.prisma.affiliateSyncRun.findFirst({ where: { status: { in: ['SUCCESS', 'PARTIAL'] } }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } }),
      this.prisma.affiliateSyncRun.findFirst({ where: { kind: 'FEED', status: { in: ['SUCCESS', 'PARTIAL'] } }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } }),
      this.prisma.affiliateSyncRun.findMany({ where: { kind: 'FEED', startedAt: { gt: new Date(now.getTime() - 7 * DAY_MS) } }, select: { stats: true } }),
    ]);
    const activeByProgram = await this.prisma.deal.groupBy({ by: ['affiliateProgramId'], where: { ...publicDealWhere(now), ...affiliate }, _count: { _all: true } });
    const activeCount = new Map(activeByProgram.map((row) => [row.affiliateProgramId, row._count._all]));
    const reviewers = await this.prisma.user.findMany({ where: { id: { in: programs.map((p) => p.reviewedById).filter((v): v is string => Boolean(v)) } }, select: { id: true, displayName: true } });
    const reviewerName = new Map(reviewers.map((r) => [r.id, r.displayName]));
    const invalidPrices = invalidRuns.reduce((sum, run) => sum + ((run.stats as AffiliateSyncStats).skipped?.invalidPrice ?? 0), 0);
    const missing = this.awin.missingConfig();
    const config = { network: 'AWIN' as const, enabled: this.awin.enabled, missing, scheduled: this.sync.scheduled() };
    const failingFeeds = programs.flatMap((p) => p.feeds).filter((f) => f.status === 'FAILING' || (f.status === 'ACTIVE' && f.consecutiveFailures > 0));

    const warnings: AffiliateWarning[] = [];
    if (!config.enabled) warnings.push({ level: 'warning', message: 'Der Liveimport ist aus (AWIN_ENABLED=false). Es werden keine Daten von Awin abgerufen.' });
    else if (missing.length) warnings.push({ level: 'error', message: `Awin ist eingeschaltet, aber es fehlen Einstellungen: ${missing.join(', ')}.` });
    for (const feed of failingFeeds) {
      const program = programs.find((p) => p.id === feed.programId)!;
      warnings.push({
        level: feed.status === 'FAILING' ? 'error' : 'warning',
        message: `${program.name} – Feed „${feed.name}“: ${feed.status === 'FAILING' ? 'angehalten nach wiederholten Fehlern' : `${feed.consecutiveFailures} Fehlschlag/Fehlschläge in Folge`}${feed.lastError ? ` (${feed.lastError})` : ''}.`,
      });
    }
    for (const program of programs) {
      if (program.status === 'APPROVED' && program.membership !== 'JOINED') {
        warnings.push({ level: 'error', message: `${program.name}: freigegeben, aber laut Awin keine aktive Partnerschaft – Angebote sind ausgeblendet.` });
      }
      if (program.status === 'APPROVED' && program.membership === 'JOINED' && !program.feeds.some((f) => f.status === 'ACTIVE')) {
        warnings.push({ level: 'warning', message: `${program.name}: freigegeben, aber kein Feed aktiv.` });
      }
    }
    const lastSync = lastSuccess?.finishedAt ?? null;
    if (config.scheduled && (!lastSync || lastSync.getTime() < now.getTime() - 3 * AFFILIATE_FEED_LIST_INTERVAL_MINUTES * 60_000)) {
      warnings.push({ level: 'error', message: 'Seit über drei Stunden kein erfolgreicher Abruf. Bitte Systemseite (Hintergrundaufgaben) und Protokoll prüfen.' });
    }
    if (invalidPrices > 0) warnings.push({ level: 'warning', message: `${invalidPrices} Produkte wurden in den letzten 7 Tagen wegen ungültiger Preise übersprungen.` });

    return {
      config,
      counts: {
        activeDeals,
        connectedPrograms: programs.filter((p) => p.status === 'APPROVED' && p.membership === 'JOINED').length,
        pendingPrograms: programs.filter((p) => p.status === 'PENDING').length,
        failingFeeds: failingFeeds.filter((f) => f.status === 'FAILING').length,
        expiredDeals,
        withoutImage,
        invalidPrices,
        inReview,
        activePromotions,
      },
      lastSuccessfulSync: lastSync?.toISOString() ?? null,
      lastSuccessfulFeedSync: lastFeedSuccess?.finishedAt?.toISOString() ?? null,
      warnings,
      programs: programs.map((p) => this.toProgramView({ ...p, reviewer: p.reviewedById ? { displayName: reviewerName.get(p.reviewedById) ?? '' } : null }, activeCount.get(p.id) ?? 0)),
      runs: runs.map((run) => this.toRunView(run)),
    };
  }

  /** Programm freigeben (mit Dokumentation und Rechten für Bilder, Vergleichspreise, Gutscheine), anhalten oder ablehnen */
  async reviewProgram(admin: AuthUser, id: string, input: AffiliateProgramReviewInput, ip?: string): Promise<AffiliateProgramView> {
    const current = await this.requireProgram(id);
    let data;
    if (input.decision === 'APPROVE') {
      if (current.membership !== 'JOINED') throw new ConflictException('Freigabe erst, wenn die Partnerschaft bei Awin aktiv ist (Programm beigetreten und angenommen).');
      let defaultCategoryId: string | null = null;
      if (input.defaultCategorySlug) {
        const category = await this.prisma.dealCategory.findFirst({ where: { slug: input.defaultCategorySlug, isActive: true }, select: { id: true } });
        if (!category) throw new NotFoundException('Diese Kategorie gibt es nicht.');
        defaultCategoryId = category.id;
      }
      data = {
        status: 'APPROVED' as const,
        approvalNote: input.note,
        reviewedById: admin.id,
        approvedAt: new Date(),
        allowImages: input.allowImages,
        allowReferencePrices: input.allowReferencePrices,
        allowVouchers: input.allowVouchers,
        defaultCategoryId,
      };
    } else {
      data = { status: input.decision === 'PAUSE' ? ('PAUSED' as const) : ('REJECTED' as const), approvalNote: input.note, reviewedById: admin.id, approvedAt: null };
    }
    await this.prisma.affiliateProgram.update({ where: { id }, data });
    // Gutscheincodes nachträglich entfernen, wenn sie nicht (mehr) erlaubt sind
    if (input.decision !== 'APPROVE' || !input.allowVouchers) await this.prisma.affiliatePromotion.updateMany({ where: { programId: id }, data: { voucherCode: null } });
    this.audit.log({
      action: `admin.affiliate_program_${input.decision.toLowerCase() as 'approve' | 'pause' | 'reject'}`,
      actorId: admin.id,
      entityType: 'affiliate_program',
      entityId: id,
      ip,
      metadata: { note: input.note, ...(input.decision === 'APPROVE' && { allowImages: input.allowImages, allowReferencePrices: input.allowReferencePrices, allowVouchers: input.allowVouchers }) },
    });
    await this.sync.resyncProgram(id);
    return this.programView(id);
  }

  /** Feed eines freigegebenen Programms aktivieren oder anhalten */
  async reviewFeed(admin: AuthUser, id: string, input: AffiliateFeedReviewInput, ip?: string): Promise<AffiliateProgramView> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diesen Feed gibt es nicht.');
    const feed = await this.prisma.affiliateFeed.findUnique({ where: { id }, include: { program: true } });
    if (!feed) throw new NotFoundException('Diesen Feed gibt es nicht.');
    if (input.decision === 'ACTIVATE') {
      if (feed.program.status !== 'APPROVED') throw new ConflictException('Zuerst das Programm freigeben.');
      if (feed.status === 'REMOVED') throw new ConflictException('Dieser Feed ist bei Awin nicht mehr verfügbar.');
      await this.prisma.affiliateFeed.update({
        where: { id },
        data: { status: 'ACTIVE', approvedAt: new Date(), reviewedById: admin.id, approvalNote: input.note ?? null, consecutiveFailures: 0, lastError: null, nextFetchAt: null },
      });
    } else {
      await this.prisma.affiliateFeed.update({ where: { id }, data: { status: 'PAUSED', approvalNote: input.note ?? feed.approvalNote, nextFetchAt: null } });
    }
    this.audit.log({ action: input.decision === 'ACTIVATE' ? 'admin.affiliate_feed_activate' : 'admin.affiliate_feed_pause', actorId: admin.id, entityType: 'affiliate_feed', entityId: id, ip, metadata: { note: input.note ?? null } });
    await this.sync.resyncFeed(id);
    return this.programView(feed.programId);
  }

  /** Manueller Abruf über die Warteschlange (ein Auftrag zur Zeit) */
  async manualSync(admin: AuthUser, input: AffiliateManualSyncInput, ip?: string): Promise<{ queued: true }> {
    if (!this.awin.enabled) throw new ConflictException('Der Liveimport ist aus (AWIN_ENABLED=false).');
    const missing = this.awin.missingConfig();
    if (missing.length) throw new ConflictException(`Es fehlen Einstellungen: ${missing.join(', ')}.`);
    if (input.feedId) {
      const feed = ENTITY_ID.test(input.feedId) ? await this.prisma.affiliateFeed.findUnique({ where: { id: input.feedId }, select: { status: true } }) : null;
      if (!feed) throw new NotFoundException('Diesen Feed gibt es nicht.');
      if (feed.status !== 'ACTIVE') throw new ConflictException('Nur aktive Feeds lassen sich abrufen.');
    }
    await this.jobs.add(AFFILIATE_MANUAL_JOB, { kind: input.kind, feedId: input.feedId ?? null, actorId: admin.id }, { jobId: `${AFFILIATE_MANUAL_JOB}-${input.kind}-${input.feedId ?? 'all'}` });
    this.audit.log({ action: 'admin.affiliate_sync', actorId: admin.id, entityType: 'affiliate', entityId: input.feedId ?? input.kind, ip });
    return { queued: true };
  }

  // --- Öffentlich ---------------------------------------------------------------------

  visiblePromotionWhere(now = new Date()) {
    return {
      hiddenAt: null,
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      program: { status: 'APPROVED' as const, membership: 'JOINED' as const },
    };
  }

  // --- Hilfen -------------------------------------------------------------------------

  private async requireProgram(id: string) {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Dieses Programm gibt es nicht.');
    const program = await this.prisma.affiliateProgram.findUnique({ where: { id } });
    if (!program) throw new NotFoundException('Dieses Programm gibt es nicht.');
    return program;
  }

  private async programView(id: string): Promise<AffiliateProgramView> {
    const program = await this.prisma.affiliateProgram.findUniqueOrThrow({ where: { id }, include: { feeds: { orderBy: { name: 'asc' } }, defaultCategory: { select: { slug: true } } } });
    const reviewer = program.reviewedById ? await this.prisma.user.findUnique({ where: { id: program.reviewedById }, select: { displayName: true } }) : null;
    const activeDeals = await this.prisma.deal.count({ where: { ...publicDealWhere(), source: 'AFFILIATE', affiliateProgramId: id } });
    return this.toProgramView({ ...program, reviewer }, activeDeals);
  }

  private toProgramView(program: ProgramWithFeeds, activeDeals: number): AffiliateProgramView {
    return {
      id: program.id,
      network: program.network,
      externalId: program.externalId,
      name: program.name,
      region: program.region,
      membership: program.membership,
      membershipCheckedAt: program.membershipCheckedAt?.toISOString() ?? null,
      status: program.status,
      approvalNote: program.approvalNote,
      reviewedBy: program.reviewer?.displayName ?? null,
      approvedAt: program.approvedAt?.toISOString() ?? null,
      allowImages: program.allowImages,
      allowReferencePrices: program.allowReferencePrices,
      allowVouchers: program.allowVouchers,
      defaultCategorySlug: program.defaultCategory?.slug ?? null,
      lastSyncAt: program.lastSyncAt?.toISOString() ?? null,
      lastError: program.lastError,
      activeDeals,
      feeds: program.feeds.map((feed) => this.toFeedView(feed)),
    };
  }

  private toFeedView(feed: AffiliateFeed): AffiliateFeedView {
    return {
      id: feed.id,
      externalId: feed.externalId,
      name: feed.name,
      language: feed.language,
      vertical: feed.vertical,
      status: feed.status,
      approvalNote: feed.approvalNote,
      approvedAt: feed.approvedAt?.toISOString() ?? null,
      networkUpdatedAt: feed.networkUpdatedAt?.toISOString() ?? null,
      processedUpdatedAt: feed.processedUpdatedAt?.toISOString() ?? null,
      lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
      nextFetchAt: feed.nextFetchAt?.toISOString() ?? null,
      lastError: feed.lastError,
      consecutiveFailures: feed.consecutiveFailures,
      productCount: feed.productCount,
    };
  }

  private toRunView(run: AffiliateSyncRun & { program: { name: string } | null; feed: { name: string } | null }): AffiliateSyncRunView {
    return {
      id: run.id,
      network: run.network,
      kind: run.kind,
      status: run.status,
      programName: run.program?.name ?? null,
      feedName: run.feed?.name ?? null,
      stats: run.stats as AffiliateSyncStats,
      error: run.error,
      manual: run.triggeredById !== null,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  }
}
