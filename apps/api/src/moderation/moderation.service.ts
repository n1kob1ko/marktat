import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MODERATION_ACTION_LABELS,
  RESTRICTIVE_ACTIONS,
  REPORT_REASON_LABELS,
  type AppealDecisionInput,
  type AppealInput,
  type DealModerationInfo,
  type DealsBlockInput,
  type ListingDecisionInput,
  type ListingModerationInfo,
  type ModerationDecisionView,
  type PortfolioItemDecisionInput,
  type UserDecisionInput,
} from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { DealStatus, ListingStatus, ModerationAction, NotificationType, ServiceProfileStatus, ServiceProjectStatus } from '../generated/prisma/enums.js';
import { AuditService, type AuditAction } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { DealSearchService } from '../deals/deal-search.service.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { effectiveStatus } from '../listings/listings.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SearchIndexService } from '../search/search-index.service.js';
import { canAppeal, decisionInclude, toAdminDecision, toDecisionView } from './moderation.mapper.js';
import { NotificationsService } from './notifications.service.js';
import { ReportsService } from './reports.service.js';

const LISTING_ACTIONS = {
  REJECT: 'LISTING_REJECTED',
  HIDE: 'LISTING_HIDDEN',
  RESTORE: 'LISTING_RESTORED',
} as const satisfies Record<ListingDecisionInput['decision'], ModerationAction>;

/** Von welchen Status aus eine Maßnahme möglich ist */
const ALLOWED_FROM: Record<ListingDecisionInput['decision'], ListingStatus[]> = {
  REJECT: ['ACTIVE', 'PAUSED', 'EXPIRED', 'PENDING_REVIEW'],
  HIDE: ['ACTIVE', 'PAUSED', 'EXPIRED'],
  RESTORE: ['REJECTED', 'PENDING_REVIEW'],
};

const DEAL_ACTIONS = {
  REJECT: 'DEAL_REJECTED',
  HIDE: 'DEAL_HIDDEN',
  RESTORE: 'DEAL_RESTORED',
} as const satisfies Record<ListingDecisionInput['decision'], ModerationAction>;

/** Wie bei Inseraten; „abgelaufen“ ergibt sich aus dem Enddatum */
const DEAL_ALLOWED_FROM: Record<ListingDecisionInput['decision'], DealStatus[]> = {
  REJECT: ['ACTIVE', 'PAUSED', 'EXPIRED', 'PENDING_REVIEW'],
  HIDE: ['ACTIVE', 'PAUSED', 'EXPIRED'],
  RESTORE: ['REJECTED', 'PENDING_REVIEW'],
};

const SERVICE_PROFILE_ACTIONS = {
  REJECT: 'SERVICE_PROFILE_REJECTED',
  HIDE: 'SERVICE_PROFILE_HIDDEN',
  RESTORE: 'SERVICE_PROFILE_RESTORED',
} as const satisfies Record<ListingDecisionInput['decision'], ModerationAction>;

const SERVICE_PROFILE_ALLOWED_FROM: Record<ListingDecisionInput['decision'], ServiceProfileStatus[]> = {
  REJECT: ['ACTIVE', 'PAUSED', 'PENDING_REVIEW'],
  HIDE: ['ACTIVE', 'PAUSED'],
  RESTORE: ['REJECTED', 'PENDING_REVIEW'],
};

const PROJECT_ACTIONS = {
  REJECT: 'PROJECT_REJECTED',
  HIDE: 'PROJECT_HIDDEN',
  RESTORE: 'PROJECT_RESTORED',
} as const satisfies Record<ListingDecisionInput['decision'], ModerationAction>;

const PROJECT_ALLOWED_FROM: Record<ListingDecisionInput['decision'], ServiceProjectStatus[]> = {
  REJECT: ['ACTIVE', 'PAUSED', 'CLOSED', 'PENDING_REVIEW'],
  HIDE: ['ACTIVE', 'PAUSED'],
  RESTORE: ['REJECTED', 'PENDING_REVIEW'],
};

/** Grund der Prüfung, solange die Moderation einen Deal ausgeblendet hat (wird nicht automatisch aufgehoben) */
export const MODERATION_REVIEW_REASON = 'Vom Team bis zum Abschluss einer Prüfung ausgeblendet.';

/** Einschränkende Entscheidungen zu einem Inhalt als Ganzem (Portfolio-Einträge werden einzeln betrachtet) */
const RESTRICTIVE_CONTENT_ACTIONS: ModerationAction[] = ['LISTING_REJECTED', 'LISTING_HIDDEN', 'DEAL_REJECTED', 'DEAL_HIDDEN', 'SERVICE_PROFILE_REJECTED', 'SERVICE_PROFILE_HIDDEN', 'PROJECT_REJECTED', 'PROJECT_HIDDEN'];

const AUDIT_ACTIONS: Record<ModerationAction, AuditAction> = {
  LISTING_REJECTED: 'moderation.listing_rejected',
  LISTING_HIDDEN: 'moderation.listing_hidden',
  LISTING_RESTORED: 'moderation.listing_restored',
  ACCOUNT_SUSPENDED: 'moderation.account_suspended',
  ACCOUNT_RESTORED: 'moderation.account_restored',
  DEAL_REJECTED: 'moderation.deal_rejected',
  DEAL_HIDDEN: 'moderation.deal_hidden',
  DEAL_RESTORED: 'moderation.deal_restored',
  DEALS_BLOCKED: 'admin.deals_blocked',
  DEALS_UNBLOCKED: 'admin.deals_unblocked',
  SERVICE_PROFILE_REJECTED: 'moderation.service_profile_rejected',
  SERVICE_PROFILE_HIDDEN: 'moderation.service_profile_hidden',
  SERVICE_PROFILE_RESTORED: 'moderation.service_profile_restored',
  PORTFOLIO_ITEM_HIDDEN: 'moderation.portfolio_item_hidden',
  PORTFOLIO_ITEM_RESTORED: 'moderation.portfolio_item_restored',
  PROJECT_REJECTED: 'moderation.project_rejected',
  PROJECT_HIDDEN: 'moderation.project_hidden',
  PROJECT_RESTORED: 'moderation.project_restored',
};

function dealBaseStatus(deal: { status: DealStatus; endsAt: Date }, now = new Date()): DealStatus {
  return (deal.status === 'ACTIVE' || deal.status === 'PAUSED') && deal.endsAt <= now ? 'EXPIRED' : deal.status;
}

type Tx = Prisma.TransactionClient;

/**
 * Moderationsentscheidungen (Art. 17 DSA): Jede Maßnahme trifft ein Mensch, mit Grund, Rechtsgrundlage und
 * Begründung an die betroffene Person. Meldungen allein ändern nie etwas am Inhalt oder Konto.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly searchIndex: SearchIndexService,
    private readonly dealSearch: DealSearchService,
    private readonly notifications: NotificationsService,
    private readonly reports: ReportsService,
  ) {}

  // --- Inserate ----------------------------------------------------------------

  async decideListing(moderator: AuthUser, listingId: string, input: ListingDecisionInput, ip?: string) {
    if (!ENTITY_ID.test(listingId)) throw new NotFoundException('Dieses Inserat gibt es nicht.');
    const action = LISTING_ACTIONS[input.decision];
    const { decision, closedReports } = await this.prisma.$transaction(async (tx) => {
      // Zeilensperre: gleichzeitige Entscheidungen zum selben Inserat laufen nacheinander; die zweite sieht die neue Version.
      await tx.$queryRaw`SELECT id FROM listings WHERE id = ${listingId} FOR UPDATE`;
      const listing = await tx.listing.findUnique({ where: { id: listingId } });
      if (!listing || listing.status === 'DELETED') throw new NotFoundException('Dieses Inserat gibt es nicht.');
      if (listing.sellerId === moderator.id) throw new ForbiddenException('Eigene Inserate kannst du nicht moderieren.');
      if (listing.updatedAt.toISOString() !== new Date(input.version).toISOString()) {
        throw new ConflictException('Das Inserat wurde inzwischen geändert oder bereits moderiert. Bitte lade die Seite neu und prüfe den aktuellen Stand.');
      }
      const current = effectiveStatus(listing);
      if (!ALLOWED_FROM[input.decision].includes(current)) {
        throw new ConflictException(`Diese Maßnahme ist für ein Inserat mit Status „${current}“ nicht möglich.`);
      }
      const previous = await this.latestRestrictive(tx, { listingId });
      const nextStatus = input.decision === 'REJECT' ? 'REJECTED' : input.decision === 'HIDE' ? 'PENDING_REVIEW' : this.restoredStatus(listing, previous?.snapshot);
      await tx.listing.update({ where: { id: listingId }, data: { status: nextStatus } });
      const decision = await tx.moderationDecision.create({
        data: {
          action,
          userId: listing.sellerId,
          listingId,
          moderatorId: moderator.id,
          reason: input.decision === 'RESTORE' ? null : input.reason,
          ground: input.decision === 'RESTORE' ? null : input.ground,
          statement: input.statement,
          internalNote: input.internalNote,
          reversesId: input.decision === 'RESTORE' ? previous?.id : undefined,
          snapshot: {
            title: listing.title,
            description: listing.description,
            priceType: listing.priceType,
            priceCents: listing.priceCents?.toString() ?? null,
            categoryId: listing.categoryId,
            statusBefore: listing.status,
            version: listing.updatedAt.toISOString(),
          },
        },
      });
      const reportStatus = input.decision === 'REJECT' ? 'RESOLVED' : input.decision === 'HIDE' ? 'IN_REVIEW' : 'DISMISSED';
      const closedReports = await this.reports.closeWithDecision(tx, { listingId }, decision.id, moderator.id, reportStatus);
      return { decision, closedReports };
    });

    this.searchIndex.sync(listingId);
    this.audit.log({ action: AUDIT_ACTIONS[action], actorId: moderator.id, entityType: 'listing', entityId: listingId, ip, metadata: { decisionId: decision.id, reason: decision.reason } });
    await this.notifyDecision(decision.id);
    if (closedReports.length) await this.reports.notifyReporters(closedReports, input.decision === 'REJECT' ? 'RESOLVED' : 'DISMISSED');
    return this.adminDecision(decision.id);
  }

  /** Eigentümer: überarbeitetes, abgelehntes Inserat erneut zur Prüfung einreichen. */
  async resubmit(user: AuthUser, listingId: string, ip?: string) {
    if (!ENTITY_ID.test(listingId)) throw new NotFoundException('Dieses Inserat gibt es nicht.');
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status === 'DELETED' || listing.sellerId !== user.id) throw new NotFoundException('Dieses Inserat gibt es nicht.');
    const latest = await this.latestDecision({ listingId });
    if (listing.status !== 'REJECTED' || !latest || latest.action !== 'LISTING_REJECTED') {
      throw new ConflictException('Nur abgelehnte Anzeigen können erneut eingereicht werden.');
    }
    if (listing.updatedAt <= latest.createdAt) {
      throw new ConflictException('Bitte überarbeite die Anzeige zuerst. Danach kannst du sie erneut zur Prüfung einreichen.');
    }
    const updated = await this.prisma.listing.updateMany({ where: { id: listingId, status: 'REJECTED' }, data: { status: 'PENDING_REVIEW' } });
    if (updated.count === 0) throw new ConflictException('Der Status der Anzeige hat sich inzwischen geändert.');
    this.audit.log({ action: 'listing.resubmitted', actorId: user.id, entityType: 'listing', entityId: listingId, ip, metadata: { decisionId: latest.id } });
    return { status: 'PENDING_REVIEW' as const };
  }

  /** Für die Detailseite (Eigentümer und Moderation): letzte Entscheidung bei ausgeblendeten Inseraten */
  async listingModerationInfo(listing: { id: string; status: ListingStatus; updatedAt: Date }): Promise<ListingModerationInfo | null> {
    if (listing.status !== 'REJECTED' && listing.status !== 'PENDING_REVIEW') return null;
    const latest = await this.latestDecision({ listingId: listing.id });
    if (!latest || latest.action === 'LISTING_RESTORED') return null;
    return {
      decisionId: latest.id,
      action: latest.action,
      reason: latest.reason,
      statement: latest.statement,
      createdAt: latest.createdAt.toISOString(),
      appealStatus: latest.appeal?.status ?? null,
      canResubmit: listing.status === 'REJECTED' && latest.action === 'LISTING_REJECTED' && listing.updatedAt > latest.createdAt,
    };
  }

  // --- Deals --------------------------------------------------------------------

  /**
   * Deals: gleiche Regeln wie bei Inseraten. „Freigeben“ beendet auch die automatische Prüfung bei sehr hohem Rabatt
   * (das Team hat den Vergleichspreis geprüft).
   */
  async decideDeal(moderator: AuthUser, dealId: string, input: ListingDecisionInput, ip?: string) {
    if (!ENTITY_ID.test(dealId)) throw new NotFoundException('Dieses Angebot gibt es nicht.');
    const action = DEAL_ACTIONS[input.decision];
    const { decision, closedReports } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM deals WHERE id = ${dealId} FOR UPDATE`;
      const deal = await tx.deal.findUnique({ where: { id: dealId } });
      if (!deal || deal.status === 'DELETED') throw new NotFoundException('Dieses Angebot gibt es nicht.');
      if (deal.merchantId === moderator.id) throw new ForbiddenException('Eigene Angebote kannst du nicht moderieren.');
      if (deal.updatedAt.toISOString() !== new Date(input.version).toISOString()) {
        throw new ConflictException('Das Angebot wurde inzwischen geändert oder bereits moderiert. Bitte lade die Seite neu und prüfe den aktuellen Stand.');
      }
      const current = dealBaseStatus(deal);
      if (!DEAL_ALLOWED_FROM[input.decision].includes(current)) {
        throw new ConflictException(`Diese Maßnahme ist für ein Angebot mit Status „${current}“ nicht möglich.`);
      }
      const previous = await this.latestRestrictive(tx, { dealId });
      const nextStatus: DealStatus =
        input.decision === 'REJECT' ? 'REJECTED' : input.decision === 'HIDE' ? 'PENDING_REVIEW' : this.restoredDealStatus(deal, previous?.snapshot);
      await tx.deal.update({
        where: { id: dealId },
        data: {
          status: nextStatus,
          reviewReason: input.decision === 'HIDE' ? MODERATION_REVIEW_REASON : null,
          ...(input.decision === 'RESTORE' && !deal.publishedAt && { publishedAt: new Date() }),
        },
      });
      const decision = await tx.moderationDecision.create({
        data: {
          action,
          userId: deal.merchantId,
          dealId,
          moderatorId: moderator.id,
          reason: input.decision === 'RESTORE' ? null : input.reason,
          ground: input.decision === 'RESTORE' ? null : input.ground,
          statement: input.statement,
          internalNote: input.internalNote,
          reversesId: input.decision === 'RESTORE' ? previous?.id : undefined,
          snapshot: {
            title: deal.title,
            description: deal.description,
            priceCents: deal.priceCents,
            referencePriceCents: deal.referencePriceCents,
            referencePriceType: deal.referencePriceType,
            referencePriceSource: deal.referencePriceSource,
            discountPercent: deal.discountPercent,
            url: deal.url,
            reviewReason: deal.reviewReason,
            statusBefore: deal.status,
            version: deal.updatedAt.toISOString(),
          },
        },
      });
      const reportStatus = input.decision === 'REJECT' ? 'RESOLVED' : input.decision === 'HIDE' ? 'IN_REVIEW' : 'DISMISSED';
      const closedReports = await this.reports.closeWithDecision(tx, { dealId }, decision.id, moderator.id, reportStatus);
      return { decision, closedReports };
    });

    this.dealSearch.index.sync(dealId);
    this.audit.log({ action: AUDIT_ACTIONS[action], actorId: moderator.id, entityType: 'deal', entityId: dealId, ip, metadata: { decisionId: decision.id, reason: decision.reason } });
    await this.notifyDecision(decision.id);
    if (closedReports.length) await this.reports.notifyReporters(closedReports, input.decision === 'REJECT' ? 'RESOLVED' : 'DISMISSED');
    return this.adminDecision(decision.id);
  }

  /** Für Händler und Team: letzte Entscheidung bei ausgeblendeten Deals */
  async dealModerationInfo(deal: { id: string; status: DealStatus; updatedAt: Date }): Promise<DealModerationInfo | null> {
    if (deal.status !== 'REJECTED' && deal.status !== 'PENDING_REVIEW') return null;
    const latest = await this.latestDecision({ dealId: deal.id });
    if (!latest || latest.action === 'DEAL_RESTORED') return null;
    return {
      decisionId: latest.id,
      action: latest.action,
      reason: latest.reason,
      statement: latest.statement,
      createdAt: latest.createdAt.toISOString(),
      appealStatus: latest.appeal?.status ?? null,
      canResubmit: deal.status === 'REJECTED' && latest.action === 'DEAL_REJECTED' && deal.updatedAt > latest.createdAt,
    };
  }

  // --- Anbieterprofile (Dienstleistungen) -------------------------------------------

  /** Anbieterprofil deaktivieren, bis zur Prüfung ausblenden oder freigeben – gleiche Regeln wie bei Inseraten */
  async decideServiceProfile(moderator: AuthUser, profileId: string, input: ListingDecisionInput, ip?: string) {
    if (!ENTITY_ID.test(profileId)) throw new NotFoundException('Dieses Anbieterprofil gibt es nicht.');
    const action = SERVICE_PROFILE_ACTIONS[input.decision];
    const { decision, closedReports } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM service_profiles WHERE id = ${profileId} FOR UPDATE`;
      const profile = await tx.serviceProfile.findUnique({ where: { id: profileId } });
      if (!profile || profile.status === 'DELETED') throw new NotFoundException('Dieses Anbieterprofil gibt es nicht.');
      if (profile.userId === moderator.id) throw new ForbiddenException('Dein eigenes Profil kannst du nicht moderieren.');
      if (profile.updatedAt.toISOString() !== new Date(input.version).toISOString()) {
        throw new ConflictException('Das Profil wurde inzwischen geändert oder bereits moderiert. Bitte lade die Seite neu und prüfe den aktuellen Stand.');
      }
      if (!SERVICE_PROFILE_ALLOWED_FROM[input.decision].includes(profile.status)) {
        throw new ConflictException(`Diese Maßnahme ist für ein Profil mit Status „${profile.status}“ nicht möglich.`);
      }
      const previous = await this.latestRestrictive(tx, { serviceProfileId: profileId });
      const nextStatus: ServiceProfileStatus =
        input.decision === 'REJECT' ? 'REJECTED' : input.decision === 'HIDE' ? 'PENDING_REVIEW' : this.restoredProfileStatus(previous?.snapshot);
      await tx.serviceProfile.update({
        where: { id: profileId },
        data: {
          status: nextStatus,
          reviewReason: input.decision === 'HIDE' ? MODERATION_REVIEW_REASON : null,
          ...(nextStatus === 'ACTIVE' && !profile.publishedAt && { publishedAt: new Date() }),
        },
      });
      const decision = await tx.moderationDecision.create({
        data: {
          action,
          userId: profile.userId,
          serviceProfileId: profileId,
          moderatorId: moderator.id,
          reason: input.decision === 'RESTORE' ? null : input.reason,
          ground: input.decision === 'RESTORE' ? null : input.ground,
          statement: input.statement,
          internalNote: input.internalNote,
          reversesId: input.decision === 'RESTORE' ? previous?.id : undefined,
          snapshot: {
            headline: profile.headline,
            summary: profile.summary,
            description: profile.description,
            skills: profile.skills,
            website: profile.website,
            priceType: profile.priceType,
            priceCents: profile.priceCents,
            reviewReason: profile.reviewReason,
            statusBefore: profile.status,
            version: profile.updatedAt.toISOString(),
          },
        },
      });
      const reportStatus = input.decision === 'REJECT' ? 'RESOLVED' : input.decision === 'HIDE' ? 'IN_REVIEW' : 'DISMISSED';
      const closedReports = await this.reports.closeWithDecision(tx, { serviceProfileId: profileId }, decision.id, moderator.id, reportStatus);
      return { decision, closedReports };
    });

    this.audit.log({ action: AUDIT_ACTIONS[action], actorId: moderator.id, entityType: 'service_profile', entityId: profileId, ip, metadata: { decisionId: decision.id, reason: decision.reason } });
    await this.notifyDecision(decision.id);
    if (closedReports.length) await this.reports.notifyReporters(closedReports, input.decision === 'REJECT' ? 'RESOLVED' : 'DISMISSED');
    return this.adminDecision(decision.id);
  }

  /**
   * Einzelnen Portfolio-Eintrag ausblenden (z. B. Bild ohne Nutzungsrecht) oder wieder zeigen; das Profil bleibt online.
   * Ausblenden erledigt offene Meldungen zum Profil als „Maßnahme ergriffen“.
   */
  async decidePortfolioItem(moderator: AuthUser, itemId: string, input: PortfolioItemDecisionInput, ip?: string) {
    if (!ENTITY_ID.test(itemId)) throw new NotFoundException('Diesen Portfolio-Eintrag gibt es nicht.');
    const action: ModerationAction = input.decision === 'HIDE' ? 'PORTFOLIO_ITEM_HIDDEN' : 'PORTFOLIO_ITEM_RESTORED';
    const { decision, closedReports, profileId } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM service_portfolio_items WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.servicePortfolioItem.findUnique({ where: { id: itemId }, include: { profile: { select: { id: true, userId: true, status: true } } } });
      if (!item || item.profile.status === 'DELETED') throw new NotFoundException('Diesen Portfolio-Eintrag gibt es nicht.');
      if (item.profile.userId === moderator.id) throw new ForbiddenException('Dein eigenes Profil kannst du nicht moderieren.');
      if (input.decision === 'HIDE' && item.hiddenAt) throw new ConflictException('Dieser Eintrag ist bereits ausgeblendet.');
      if (input.decision === 'RESTORE' && !item.hiddenAt) throw new ConflictException('Dieser Eintrag ist nicht ausgeblendet.');
      const previous = input.decision === 'RESTORE' ? await this.latestPortfolioHide(tx, item.profile.id, itemId) : null;
      await tx.servicePortfolioItem.update({ where: { id: itemId }, data: { hiddenAt: input.decision === 'HIDE' ? new Date() : null } });
      const decision = await tx.moderationDecision.create({
        data: {
          action,
          userId: item.profile.userId,
          serviceProfileId: item.profile.id,
          moderatorId: moderator.id,
          reason: input.decision === 'RESTORE' ? null : input.reason,
          ground: input.decision === 'RESTORE' ? null : input.ground,
          statement: input.statement,
          internalNote: input.internalNote,
          reversesId: previous?.id,
          snapshot: { portfolioItemId: itemId, title: item.title, description: item.description, url: item.url, imageRights: item.imageRights, imageCredit: item.imageCredit },
        },
      });
      const closedReports = input.decision === 'HIDE' ? await this.reports.closeWithDecision(tx, { serviceProfileId: item.profile.id }, decision.id, moderator.id, 'RESOLVED') : [];
      return { decision, closedReports, profileId: item.profile.id };
    });
    this.audit.log({ action: AUDIT_ACTIONS[action], actorId: moderator.id, entityType: 'service_profile', entityId: profileId, ip, metadata: { decisionId: decision.id, portfolioItemId: itemId } });
    await this.notifyDecision(decision.id);
    if (closedReports.length) await this.reports.notifyReporters(closedReports, 'RESOLVED');
    return this.adminDecision(decision.id);
  }

  /** Für Inhaber:in und Team: letzte Entscheidung bei ausgeblendeten Profilen */
  async serviceProfileModerationInfo(profile: { id: string; status: ServiceProfileStatus; updatedAt: Date }): Promise<ListingModerationInfo | null> {
    if (profile.status !== 'REJECTED' && profile.status !== 'PENDING_REVIEW') return null;
    const latest = await this.prisma.moderationDecision.findFirst({
      where: { serviceProfileId: profile.id, action: { in: ['SERVICE_PROFILE_REJECTED', 'SERVICE_PROFILE_HIDDEN', 'SERVICE_PROFILE_RESTORED'] } },
      orderBy: { createdAt: 'desc' },
      include: { appeal: { select: { status: true } } },
    });
    if (!latest || latest.action === 'SERVICE_PROFILE_RESTORED') return null;
    return {
      decisionId: latest.id,
      action: latest.action,
      reason: latest.reason,
      statement: latest.statement,
      createdAt: latest.createdAt.toISOString(),
      appealStatus: latest.appeal?.status ?? null,
      canResubmit: profile.status === 'REJECTED' && latest.action === 'SERVICE_PROFILE_REJECTED' && profile.updatedAt > latest.createdAt,
    };
  }

  /** Projektauftrag ablehnen, bis zur Prüfung ausblenden oder freigeben (wie bei Anbieterprofilen) */
  async decideProject(moderator: AuthUser, projectId: string, input: ListingDecisionInput, ip?: string) {
    if (!ENTITY_ID.test(projectId)) throw new NotFoundException('Diesen Projektauftrag gibt es nicht.');
    const action = PROJECT_ACTIONS[input.decision];
    const { decision, closedReports } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM service_projects WHERE id = ${projectId} FOR UPDATE`;
      const project = await tx.serviceProject.findUnique({ where: { id: projectId } });
      if (!project || project.status === 'DELETED') throw new NotFoundException('Diesen Projektauftrag gibt es nicht.');
      if (project.userId === moderator.id) throw new ForbiddenException('Über eigene Projektaufträge entscheidet jemand anderer aus dem Team.');
      if (project.updatedAt.toISOString() !== new Date(input.version).toISOString()) {
        throw new ConflictException('Der Auftrag wurde inzwischen geändert oder bereits moderiert. Bitte lade die Seite neu und prüfe den aktuellen Stand.');
      }
      if (!PROJECT_ALLOWED_FROM[input.decision].includes(project.status)) {
        throw new ConflictException(`Diese Maßnahme ist für einen Auftrag mit Status „${project.status}“ nicht möglich.`);
      }
      const previous = await this.latestRestrictive(tx, { projectId });
      const nextStatus: ServiceProjectStatus =
        input.decision === 'REJECT' ? 'REJECTED' : input.decision === 'HIDE' ? 'PENDING_REVIEW' : this.restoredProjectStatus(previous?.snapshot);
      await tx.serviceProject.update({
        where: { id: projectId },
        data: { status: nextStatus, reviewReason: input.decision === 'HIDE' ? MODERATION_REVIEW_REASON : null },
      });
      const decision = await tx.moderationDecision.create({
        data: {
          action,
          userId: project.userId,
          projectId,
          moderatorId: moderator.id,
          reason: input.decision === 'RESTORE' ? null : input.reason,
          ground: input.decision === 'RESTORE' ? null : input.ground,
          statement: input.statement,
          internalNote: input.internalNote,
          reversesId: input.decision === 'RESTORE' ? previous?.id : undefined,
          snapshot: {
            title: project.title,
            description: project.description,
            budgetType: project.budgetType,
            budgetCents: project.budgetCents,
            timeframe: project.timeframe,
            reviewReason: project.reviewReason,
            statusBefore: project.status,
            version: project.updatedAt.toISOString(),
          },
        },
      });
      const reportStatus = input.decision === 'REJECT' ? 'RESOLVED' : input.decision === 'HIDE' ? 'IN_REVIEW' : 'DISMISSED';
      const closedReports = await this.reports.closeWithDecision(tx, { projectId }, decision.id, moderator.id, reportStatus);
      return { decision, closedReports };
    });

    this.audit.log({ action: AUDIT_ACTIONS[action], actorId: moderator.id, entityType: 'service_project', entityId: projectId, ip, metadata: { decisionId: decision.id, reason: decision.reason } });
    await this.notifyDecision(decision.id);
    if (closedReports.length) await this.reports.notifyReporters(closedReports, input.decision === 'REJECT' ? 'RESOLVED' : 'DISMISSED');
    return this.adminDecision(decision.id);
  }

  /** Für Auftraggeber:in und Team: letzte Entscheidung bei ausgeblendeten Aufträgen */
  async projectModerationInfo(project: { id: string; status: ServiceProjectStatus; updatedAt: Date }): Promise<ListingModerationInfo | null> {
    if (project.status !== 'REJECTED' && project.status !== 'PENDING_REVIEW') return null;
    const latest = await this.prisma.moderationDecision.findFirst({
      where: { projectId: project.id, action: { in: ['PROJECT_REJECTED', 'PROJECT_HIDDEN', 'PROJECT_RESTORED'] } },
      orderBy: { createdAt: 'desc' },
      include: { appeal: { select: { status: true } } },
    });
    if (!latest || latest.action === 'PROJECT_RESTORED') return null;
    return {
      decisionId: latest.id,
      action: latest.action,
      reason: latest.reason,
      statement: latest.statement,
      createdAt: latest.createdAt.toISOString(),
      appealStatus: latest.appeal?.status ?? null,
      canResubmit: project.status === 'REJECTED' && latest.action === 'PROJECT_REJECTED' && project.updatedAt > latest.createdAt,
    };
  }

  /**
   * Händlerkonto für Deals sperren: alle Deals verschwinden sofort aus der Öffentlichkeit, das Konto bleibt sonst
   * nutzbar. Wie eine Kontosperre begründet und anfechtbar; aufheben nur Administratoren (oder per Einspruch).
   */
  async decideDealsBlock(actor: AuthUser, userId: string, input: DealsBlockInput, ip?: string) {
    if (userId === actor.id) throw new ForbiddenException('Du kannst dein eigenes Konto nicht sperren oder entsperren.');
    if (input.decision === 'UNBLOCK' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Sperren aufheben dürfen nur Administratoren (oder über einen Einspruch).');
    }
    const action: ModerationAction = input.decision === 'BLOCK' ? 'DEALS_BLOCKED' : 'DEALS_UNBLOCKED';
    const decision = await this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, actor, userId);
      const target = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dealsBlockedAt: true, accountType: true } });
      if (input.decision === 'BLOCK' && target.dealsBlockedAt) throw new ConflictException('Das Konto ist für Deals bereits gesperrt.');
      if (input.decision === 'BLOCK' && target.accountType !== 'BUSINESS') throw new ConflictException('Nur gewerbliche Konten können Deals veröffentlichen.');
      if (input.decision === 'UNBLOCK' && !target.dealsBlockedAt) throw new ConflictException('Das Konto ist für Deals nicht gesperrt.');
      const previous = input.decision === 'UNBLOCK' ? await this.latestRestrictive(tx, { userId, action: 'DEALS_BLOCKED' }) : null;
      return this.applyDealsBlock(tx, actor.id, userId, action, {
        reason: input.reason ?? null,
        ground: input.ground ?? null,
        statement: input.statement,
        internalNote: input.internalNote ?? null,
        reversesId: previous?.id ?? null,
      });
    });
    this.dealSearch.syncMerchant(userId);
    this.audit.log({ action: AUDIT_ACTIONS[action], actorId: actor.id, entityType: 'user', entityId: userId, ip, metadata: { decisionId: decision.id, reason: decision.reason } });
    await this.notifyDecision(decision.id);
    return this.adminDecision(decision.id);
  }

  private async applyDealsBlock(
    tx: Tx,
    moderatorId: string,
    userId: string,
    action: 'DEALS_BLOCKED' | 'DEALS_UNBLOCKED',
    fields: Pick<Prisma.ModerationDecisionUncheckedCreateInput, 'reason' | 'ground' | 'statement' | 'internalNote' | 'reversesId'>,
  ) {
    await tx.user.update({ where: { id: userId }, data: { dealsBlockedAt: action === 'DEALS_BLOCKED' ? new Date() : null } });
    return tx.moderationDecision.create({ data: { action, userId, moderatorId, ...fields } });
  }

  // --- Konten ------------------------------------------------------------------

  async decideUser(actor: AuthUser, userId: string, input: UserDecisionInput, ip?: string) {
    if (userId === actor.id) throw new ForbiddenException('Du kannst dein eigenes Konto nicht sperren oder entsperren.');
    if (input.decision === 'RESTORE' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Sperren aufheben dürfen nur Administratoren (oder über einen Einspruch).');
    }
    const action: ModerationAction = input.decision === 'SUSPEND' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_RESTORED';
    const { decision, closedReports } = await this.prisma.$transaction(async (tx) => {
      const target = await this.lockAccount(tx, actor, userId);
      if (input.decision === 'SUSPEND' && target.status !== 'ACTIVE') throw new ConflictException('Das Konto ist bereits gesperrt.');
      if (input.decision === 'RESTORE' && target.status !== 'SUSPENDED') throw new ConflictException('Das Konto ist nicht gesperrt.');
      if (input.reportId) {
        const report = await tx.report.findFirst({ where: { id: input.reportId, reportedId: userId }, select: { id: true } });
        if (!report) throw new NotFoundException('Die Meldung gehört nicht zu diesem Konto.');
      }
      const previous = input.decision === 'RESTORE' ? await this.latestRestrictive(tx, { userId, action: 'ACCOUNT_SUSPENDED' }) : null;
      const decision = await this.applyAccountDecision(tx, actor.id, userId, action, {
        reason: input.reason ?? null,
        ground: input.ground ?? null,
        statement: input.statement,
        internalNote: input.internalNote ?? null,
        reversesId: previous?.id ?? null,
      });
      const closedReports = input.reportId
        ? await this.reports.closeWithDecision(tx, { id: input.reportId }, decision.id, actor.id, input.decision === 'SUSPEND' ? 'RESOLVED' : 'DISMISSED')
        : [];
      return { decision, closedReports };
    });
    this.searchIndex.syncSeller(userId);
    this.audit.log({ action: AUDIT_ACTIONS[action], actorId: actor.id, entityType: 'user', entityId: userId, ip, metadata: { decisionId: decision.id, reason: decision.reason } });
    await this.notifyDecision(decision.id);
    if (closedReports.length) await this.reports.notifyReporters(closedReports, input.decision === 'SUSPEND' ? 'RESOLVED' : 'DISMISSED');
    return this.adminDecision(decision.id);
  }

  /**
   * Sperrt die Zeile des Zielkontos und prüft den Handlungsspielraum:
   * Moderation nur für normale Konten; Admins nur durch andere aktive Admins, und nie den letzten aktiven Admin.
   * Die globale Sperre verhindert, dass sich zwei Admins gleichzeitig gegenseitig sperren.
   */
  private async lockAccount(tx: Tx, actor: AuthUser, userId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff-accounts'))`;
    const [target] = await tx.$queryRaw<{ id: string; role: string; status: string }[]>`
      SELECT id, role::text, status::text FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!target || target.status === 'DELETED') throw new NotFoundException('Dieses Konto gibt es nicht.');
    const self = await tx.user.findUnique({ where: { id: actor.id }, select: { status: true, role: true } });
    if (!self || self.status !== 'ACTIVE' || self.role !== actor.role) throw new ForbiddenException('Keine Berechtigung.');
    if (target.role !== 'USER' && actor.role !== 'ADMIN') throw new ForbiddenException('Konten der Moderation und Administration verwalten nur Administratoren.');
    if (target.role === 'ADMIN') {
      const otherAdmins = await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: userId } } });
      if (otherAdmins === 0) throw new ConflictException('Das ist das letzte aktive Administratorkonto. Es kann nicht gesperrt werden.');
    }
    return target;
  }

  private async applyAccountDecision(
    tx: Tx,
    moderatorId: string,
    userId: string,
    action: 'ACCOUNT_SUSPENDED' | 'ACCOUNT_RESTORED',
    fields: Pick<Prisma.ModerationDecisionUncheckedCreateInput, 'reason' | 'ground' | 'statement' | 'internalNote' | 'reversesId'>,
  ) {
    const suspend = action === 'ACCOUNT_SUSPENDED';
    await tx.user.update({ where: { id: userId }, data: { status: suspend ? 'SUSPENDED' : 'ACTIVE', suspendedAt: suspend ? new Date() : null } });
    return tx.moderationDecision.create({ data: { action, userId, moderatorId, ...fields } });
  }

  // --- Entscheidungen für Betroffene und Einsprüche -----------------------------------

  async myDecisions(user: AuthUser): Promise<ModerationDecisionView[]> {
    const rows = await this.prisma.moderationDecision.findMany({
      where: { userId: user.id },
      include: decisionInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => toDecisionView(row));
  }

  async myDecision(user: AuthUser, id: string): Promise<ModerationDecisionView> {
    return toDecisionView(await this.requireOwnDecision(user, id));
  }

  async appeal(user: AuthUser, decisionId: string, input: AppealInput, ip?: string): Promise<ModerationDecisionView> {
    const decision = await this.requireOwnDecision(user, decisionId);
    if (!canAppeal(decision)) {
      throw new ConflictException(
        decision.appeal ? 'Du hast gegen diese Entscheidung bereits Einspruch erhoben.' : 'Gegen diese Entscheidung ist kein Einspruch (mehr) möglich.',
      );
    }
    try {
      await this.prisma.appeal.create({ data: { decisionId, userId: user.id, body: input.body } });
    } catch (error) {
      // Zwei gleichzeitige Einsprüche: der eindeutige Schlüssel lässt nur einen zu
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Du hast gegen diese Entscheidung bereits Einspruch erhoben.');
      throw error;
    }
    this.audit.log({ action: 'appeal.created', actorId: user.id, entityType: 'decision', entityId: decisionId, ip });
    return this.myDecision(user, decisionId);
  }

  async decideAppeal(reviewer: AuthUser, appealId: string, input: AppealDecisionInput, ip?: string) {
    if (!ENTITY_ID.test(appealId)) throw new NotFoundException('Diesen Einspruch gibt es nicht.');
    let sameReviewer = false;
    const { decisionId, reversal } = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM appeals WHERE id = ${appealId} FOR UPDATE`;
      if (!locked) throw new NotFoundException('Diesen Einspruch gibt es nicht.');
      const appeal = await tx.appeal.findUniqueOrThrow({
        where: { id: appealId },
        include: { decision: { include: { user: { select: { role: true, status: true } } } } },
      });
      if (appeal.status !== 'OPEN') throw new ConflictException('Über diesen Einspruch wurde bereits entschieden.');
      if (appeal.userId === reviewer.id) throw new ForbiddenException('Über eigene Einsprüche kannst du nicht entscheiden.');
      if (appeal.decision.user.role !== 'USER' && reviewer.role !== 'ADMIN') {
        throw new ForbiddenException('Einsprüche von Moderation und Administration prüfen nur Administratoren.');
      }
      // Art. 20 DSA: Prüfung möglichst durch eine andere Person als die ursprüngliche Entscheidung
      sameReviewer = appeal.decision.moderatorId === reviewer.id;
      if (sameReviewer && reviewer.role !== 'ADMIN') {
        throw new ForbiddenException('Den Einspruch muss eine andere Person prüfen als die, die entschieden hat.');
      }
      await tx.appeal.update({ where: { id: appealId }, data: { status: input.outcome, response: input.response, reviewerId: reviewer.id, decidedAt: new Date() } });
      const reversal = input.outcome === 'REVERSED' ? await this.reverse(tx, reviewer, appeal.decision, input.response) : null;
      return { decisionId: appeal.decisionId, reversal };
    });

    this.audit.log({ action: 'appeal.decided', actorId: reviewer.id, entityType: 'appeal', entityId: appealId, ip, metadata: { outcome: input.outcome, decisionId, sameReviewer } });
    const decision = await this.prisma.moderationDecision.findUniqueOrThrow({ where: { id: decisionId }, select: { userId: true, action: true, listing: { select: { title: true } }, deal: { select: { title: true } }, serviceProfile: { select: { headline: true } }, project: { select: { title: true } } } });
    if (reversal) {
      if (reversal.listingId) this.searchIndex.sync(reversal.listingId);
      else if (reversal.dealId) this.dealSearch.index.sync(reversal.dealId);
      else if (reversal.serviceProfileId || reversal.projectId) {
        // Postgres-Suche: nichts nachzuziehen
      } else if (reversal.action === 'DEALS_UNBLOCKED') this.dealSearch.syncMerchant(decision.userId);
      else this.searchIndex.syncSeller(decision.userId);
      const entityType = reversal.listingId ? 'listing' : reversal.dealId ? 'deal' : reversal.serviceProfileId ? 'service_profile' : reversal.projectId ? 'service_project' : 'user';
      this.audit.log({
        action: AUDIT_ACTIONS[reversal.action],
        actorId: reviewer.id,
        entityType,
        entityId: reversal.listingId ?? reversal.dealId ?? reversal.serviceProfileId ?? reversal.projectId ?? decision.userId,
        ip,
        metadata: { decisionId: reversal.id, appealId },
      });
    }
    const what = decision.listing
      ? `zur Anzeige „${decision.listing.title}“`
      : decision.deal
        ? `zum Angebot „${decision.deal.title}“`
        : decision.serviceProfile
          ? `zu deinem Anbieterprofil „${decision.serviceProfile.headline}“`
          : decision.project
            ? `zu deinem Projektauftrag „${decision.project.title}“`
            : 'zu deinem Konto';
    await this.notifications.notify({
      userId: decision.userId,
      type: 'APPEAL_DECIDED',
      title: input.outcome === 'REVERSED' ? 'Deinem Einspruch wurde stattgegeben' : 'Dein Einspruch wurde geprüft',
      body: [
        `Wir haben deinen Einspruch gegen die Entscheidung ${what} („${MODERATION_ACTION_LABELS[decision.action]}“) geprüft.`,
        input.outcome === 'REVERSED'
          ? 'Ergebnis: Die Entscheidung wurde aufgehoben.'
          : 'Ergebnis: Die Entscheidung bleibt bestehen.',
        `Begründung: ${input.response}`,
        input.outcome === 'UPHELD'
          ? 'Du kannst dich an eine zertifizierte außergerichtliche Streitbeilegungsstelle wenden (Art. 21 DSA) oder den Rechtsweg beschreiten.'
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      link: `/konto/entscheidungen/${decisionId}`,
      decisionId,
    });
    const appeal = await this.prisma.appeal.findUniqueOrThrow({ where: { id: appealId }, select: { decisionId: true } });
    return this.adminDecision(appeal.decisionId);
  }

  /** Einspruch stattgegeben: Maßnahme rückgängig machen, wenn der Zustand noch dazu passt. */
  private async reverse(
    tx: Tx,
    reviewer: AuthUser,
    original: { id: string; action: ModerationAction; userId: string; listingId: string | null; dealId: string | null; serviceProfileId: string | null; projectId: string | null; snapshot: Prisma.JsonValue },
    response: string,
  ) {
    const statement = `Nach Prüfung deines Einspruchs aufgehoben: ${response}`.slice(0, 2000);
    if (original.listingId && (original.action === 'LISTING_REJECTED' || original.action === 'LISTING_HIDDEN')) {
      await tx.$queryRaw`SELECT id FROM listings WHERE id = ${original.listingId} FOR UPDATE`;
      const listing = await tx.listing.findUnique({ where: { id: original.listingId } });
      const latest = await this.latestRestrictive(tx, { listingId: original.listingId });
      if (!listing || !['REJECTED', 'PENDING_REVIEW'].includes(listing.status) || latest?.id !== original.id) return null;
      await tx.listing.update({ where: { id: listing.id }, data: { status: this.restoredStatus(listing, original.snapshot) } });
      const decision = await tx.moderationDecision.create({
        data: { action: 'LISTING_RESTORED', userId: original.userId, listingId: listing.id, moderatorId: reviewer.id, statement, reversesId: original.id },
      });
      await this.reports.closeWithDecision(tx, { listingId: listing.id }, decision.id, reviewer.id, 'DISMISSED');
      return decision;
    }
    if (original.dealId && (original.action === 'DEAL_REJECTED' || original.action === 'DEAL_HIDDEN')) {
      await tx.$queryRaw`SELECT id FROM deals WHERE id = ${original.dealId} FOR UPDATE`;
      const deal = await tx.deal.findUnique({ where: { id: original.dealId } });
      const latest = await this.latestRestrictive(tx, { dealId: original.dealId });
      if (!deal || !['REJECTED', 'PENDING_REVIEW'].includes(deal.status) || latest?.id !== original.id) return null;
      await tx.deal.update({ where: { id: deal.id }, data: { status: this.restoredDealStatus(deal, original.snapshot), reviewReason: null } });
      const decision = await tx.moderationDecision.create({
        data: { action: 'DEAL_RESTORED', userId: original.userId, dealId: deal.id, moderatorId: reviewer.id, statement, reversesId: original.id },
      });
      await this.reports.closeWithDecision(tx, { dealId: deal.id }, decision.id, reviewer.id, 'DISMISSED');
      return decision;
    }
    if (original.serviceProfileId && (original.action === 'SERVICE_PROFILE_REJECTED' || original.action === 'SERVICE_PROFILE_HIDDEN')) {
      await tx.$queryRaw`SELECT id FROM service_profiles WHERE id = ${original.serviceProfileId} FOR UPDATE`;
      const profile = await tx.serviceProfile.findUnique({ where: { id: original.serviceProfileId } });
      const latest = await this.latestRestrictive(tx, { serviceProfileId: original.serviceProfileId });
      if (!profile || !['REJECTED', 'PENDING_REVIEW'].includes(profile.status) || latest?.id !== original.id) return null;
      const status = this.restoredProfileStatus(original.snapshot);
      await tx.serviceProfile.update({
        where: { id: profile.id },
        data: { status, reviewReason: null, ...(status === 'ACTIVE' && !profile.publishedAt && { publishedAt: new Date() }) },
      });
      const decision = await tx.moderationDecision.create({
        data: { action: 'SERVICE_PROFILE_RESTORED', userId: original.userId, serviceProfileId: profile.id, moderatorId: reviewer.id, statement, reversesId: original.id },
      });
      await this.reports.closeWithDecision(tx, { serviceProfileId: profile.id }, decision.id, reviewer.id, 'DISMISSED');
      return decision;
    }
    if (original.serviceProfileId && original.action === 'PORTFOLIO_ITEM_HIDDEN') {
      const itemId = (original.snapshot as { portfolioItemId?: string } | null)?.portfolioItemId;
      const item = itemId ? await tx.servicePortfolioItem.findUnique({ where: { id: itemId } }) : null;
      const latest = itemId ? await this.latestPortfolioHide(tx, original.serviceProfileId, itemId) : null;
      if (!item?.hiddenAt || latest?.id !== original.id) return null;
      await tx.servicePortfolioItem.update({ where: { id: item.id }, data: { hiddenAt: null } });
      return tx.moderationDecision.create({
        data: {
          action: 'PORTFOLIO_ITEM_RESTORED',
          userId: original.userId,
          serviceProfileId: original.serviceProfileId,
          moderatorId: reviewer.id,
          statement,
          reversesId: original.id,
          snapshot: { portfolioItemId: item.id, title: item.title },
        },
      });
    }
    if (original.projectId && (original.action === 'PROJECT_REJECTED' || original.action === 'PROJECT_HIDDEN')) {
      await tx.$queryRaw`SELECT id FROM service_projects WHERE id = ${original.projectId} FOR UPDATE`;
      const project = await tx.serviceProject.findUnique({ where: { id: original.projectId } });
      const latest = await this.latestRestrictive(tx, { projectId: original.projectId });
      if (!project || !['REJECTED', 'PENDING_REVIEW'].includes(project.status) || latest?.id !== original.id) return null;
      await tx.serviceProject.update({ where: { id: project.id }, data: { status: this.restoredProjectStatus(original.snapshot), reviewReason: null } });
      const decision = await tx.moderationDecision.create({
        data: { action: 'PROJECT_RESTORED', userId: original.userId, projectId: project.id, moderatorId: reviewer.id, statement, reversesId: original.id },
      });
      await this.reports.closeWithDecision(tx, { projectId: project.id }, decision.id, reviewer.id, 'DISMISSED');
      return decision;
    }
    if (original.action === 'DEALS_BLOCKED') {
      const user = await tx.user.findUnique({ where: { id: original.userId }, select: { dealsBlockedAt: true } });
      const latest = await this.latestRestrictive(tx, { userId: original.userId, action: 'DEALS_BLOCKED' });
      if (!user?.dealsBlockedAt || latest?.id !== original.id) return null;
      return this.applyDealsBlock(tx, reviewer.id, original.userId, 'DEALS_UNBLOCKED', { statement, reversesId: original.id, reason: null, ground: null, internalNote: null });
    }
    if (original.action === 'ACCOUNT_SUSPENDED') {
      const user = await tx.user.findUnique({ where: { id: original.userId }, select: { status: true } });
      const latest = await this.latestRestrictive(tx, { userId: original.userId, action: 'ACCOUNT_SUSPENDED' });
      if (user?.status !== 'SUSPENDED' || latest?.id !== original.id) return null;
      return this.applyAccountDecision(tx, reviewer.id, original.userId, 'ACCOUNT_RESTORED', {
        statement,
        reversesId: original.id,
        reason: null,
        ground: null,
        internalNote: null,
      });
    }
    return null;
  }

  // --- Hilfsfunktionen -------------------------------------------------------------

  async adminDecision(id: string) {
    return toAdminDecision(await this.prisma.moderationDecision.findUniqueOrThrow({ where: { id }, include: decisionInclude }));
  }

  /** Nach einer Freigabe: zurück zu „pausiert“, wenn das Inserat vorher pausiert war; abgelaufene bleiben abgelaufen. */
  private restoredStatus(listing: { expiresAt: Date | null }, snapshot: Prisma.JsonValue | undefined): ListingStatus {
    const before = (snapshot as { statusBefore?: ListingStatus } | null)?.statusBefore;
    if (before === 'PAUSED') return 'PAUSED';
    return listing.expiresAt && listing.expiresAt > new Date() ? 'ACTIVE' : 'EXPIRED';
  }

  /** Freigabe eines Deals: vorheriger Zustand (pausiert bleibt pausiert, Entwurf bleibt Entwurf), sonst nach Enddatum */
  private restoredDealStatus(deal: { endsAt: Date }, snapshot: Prisma.JsonValue | undefined): DealStatus {
    const before = (snapshot as { statusBefore?: DealStatus } | null)?.statusBefore;
    if (before === 'PAUSED' || before === 'DRAFT') return before;
    return deal.endsAt > new Date() ? 'ACTIVE' : 'EXPIRED';
  }

  /** Freigabe eines Profils: pausiert bleibt pausiert, Entwurf bleibt Entwurf */
  private restoredProfileStatus(snapshot: Prisma.JsonValue | undefined): ServiceProfileStatus {
    const before = (snapshot as { statusBefore?: ServiceProfileStatus } | null)?.statusBefore;
    return before === 'PAUSED' || before === 'DRAFT' ? before : 'ACTIVE';
  }

  /** Freigabe eines Auftrags: pausiert bzw. beendet bleibt so, sonst wieder sichtbar */
  private restoredProjectStatus(snapshot: Prisma.JsonValue | undefined): ServiceProjectStatus {
    const before = (snapshot as { statusBefore?: ServiceProjectStatus } | null)?.statusBefore;
    return before === 'PAUSED' || before === 'CLOSED' || before === 'DRAFT' ? before : 'ACTIVE';
  }

  /** Letzte noch nicht aufgehobene Ausblendung eines Portfolio-Eintrags */
  private latestPortfolioHide(tx: Tx, serviceProfileId: string, itemId: string) {
    return tx.moderationDecision.findFirst({
      where: { serviceProfileId, action: 'PORTFOLIO_ITEM_HIDDEN', snapshot: { path: ['portfolioItemId'], equals: itemId }, reversedBy: { none: {} } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  }

  private latestDecision(where: { listingId: string } | { dealId: string }) {
    return this.prisma.moderationDecision.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
      include: { appeal: { select: { status: true } } },
    });
  }

  /** Letzte einschränkende Entscheidung, die noch nicht aufgehoben wurde */
  private latestRestrictive(tx: Tx, where: { listingId?: string; dealId?: string; serviceProfileId?: string; projectId?: string; userId?: string; action?: ModerationAction }) {
    return tx.moderationDecision.findFirst({
      where: {
        ...(where.listingId ? { listingId: where.listingId } : {}),
        ...(where.dealId ? { dealId: where.dealId } : {}),
        ...(where.serviceProfileId ? { serviceProfileId: where.serviceProfileId } : {}),
        ...(where.projectId ? { projectId: where.projectId } : {}),
        ...(where.userId ? { userId: where.userId, listingId: null, dealId: null, serviceProfileId: null, projectId: null } : {}),
        action: where.action ?? { in: RESTRICTIVE_CONTENT_ACTIONS },
        reversedBy: { none: {} },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, snapshot: true },
    });
  }

  private async requireOwnDecision(user: AuthUser, id: string) {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Diese Entscheidung gibt es nicht.');
    const decision = await this.prisma.moderationDecision.findFirst({ where: { id, userId: user.id }, include: decisionInclude });
    if (!decision) throw new NotFoundException('Diese Entscheidung gibt es nicht.');
    return decision;
  }

  /** Begründung an die betroffene Person (Mitteilung im Konto und E-Mail) */
  private async notifyDecision(decisionId: string) {
    const decision = await this.prisma.moderationDecision.findUniqueOrThrow({ where: { id: decisionId }, include: { listing: { select: { title: true } }, deal: { select: { title: true } }, serviceProfile: { select: { headline: true } }, project: { select: { title: true } } } });
    const title = decision.listing?.title ?? decision.deal?.title ?? decision.serviceProfile?.headline ?? decision.project?.title;
    const itemTitle = (decision.snapshot as { title?: string } | null)?.title ?? 'Eintrag';
    const texts: Record<ModerationAction, { type: NotificationType; title: string; intro: string }> = {
      LISTING_REJECTED: { type: 'LISTING_REJECTED', title: 'Deine Anzeige wurde deaktiviert', intro: `Wir haben deine Anzeige „${title}“ wegen eines Verstoßes deaktiviert. Sie ist nicht mehr öffentlich sichtbar.` },
      LISTING_HIDDEN: { type: 'LISTING_HIDDEN', title: 'Deine Anzeige wird geprüft', intro: `Deine Anzeige „${title}“ ist bis zum Abschluss einer Prüfung vorübergehend nicht öffentlich sichtbar.` },
      LISTING_RESTORED: { type: 'LISTING_RESTORED', title: 'Deine Anzeige ist wieder freigegeben', intro: `Wir haben deine Anzeige „${title}“ geprüft und wieder freigegeben.` },
      ACCOUNT_SUSPENDED: { type: 'ACCOUNT_SUSPENDED', title: 'Dein Konto wurde gesperrt', intro: 'Wir haben dein MarktAT-Konto gesperrt. Deine Anzeigen sind nicht mehr sichtbar und du kannst keine Nachrichten senden.' },
      ACCOUNT_RESTORED: { type: 'ACCOUNT_RESTORED', title: 'Die Sperre deines Kontos ist aufgehoben', intro: 'Dein MarktAT-Konto ist wieder freigeschaltet. Du kannst alle Funktionen wieder nutzen.' },
      DEAL_REJECTED: { type: 'DEAL_REJECTED', title: 'Dein Angebot wurde deaktiviert', intro: `Wir haben dein Angebot „${title}“ wegen eines Verstoßes deaktiviert. Es ist nicht mehr öffentlich sichtbar.` },
      DEAL_HIDDEN: { type: 'DEAL_HIDDEN', title: 'Dein Angebot wird geprüft', intro: `Dein Angebot „${title}“ ist bis zum Abschluss einer Prüfung vorübergehend nicht öffentlich sichtbar.` },
      DEAL_RESTORED: { type: 'DEAL_RESTORED', title: 'Dein Angebot ist freigegeben', intro: `Wir haben dein Angebot „${title}“ geprüft und freigegeben.` },
      DEALS_BLOCKED: {
        type: 'DEALS_BLOCKED',
        title: 'Dein Konto wurde für Deals gesperrt',
        intro: 'Du kannst vorerst keine Deals veröffentlichen; deine bestehenden Deals sind nicht mehr öffentlich sichtbar. Inserate, Nachrichten und dein Konto kannst du weiter nutzen.',
      },
      DEALS_UNBLOCKED: { type: 'DEALS_UNBLOCKED', title: 'Du kannst wieder Deals veröffentlichen', intro: 'Die Sperre für Deals ist aufgehoben. Bitte bestätige deine laufenden Angebote, damit sie wieder erscheinen.' },
      SERVICE_PROFILE_REJECTED: {
        type: 'SERVICE_PROFILE_REJECTED',
        title: 'Dein Anbieterprofil wurde deaktiviert',
        intro: `Wir haben dein Anbieterprofil „${title}“ wegen eines Verstoßes deaktiviert. Es ist nicht mehr öffentlich sichtbar.`,
      },
      SERVICE_PROFILE_HIDDEN: {
        type: 'SERVICE_PROFILE_HIDDEN',
        title: 'Dein Anbieterprofil wird geprüft',
        intro: `Dein Anbieterprofil „${title}“ ist bis zum Abschluss einer Prüfung vorübergehend nicht öffentlich sichtbar.`,
      },
      SERVICE_PROFILE_RESTORED: { type: 'SERVICE_PROFILE_RESTORED', title: 'Dein Anbieterprofil ist freigegeben', intro: `Wir haben dein Anbieterprofil „${title}“ geprüft und freigegeben.` },
      PORTFOLIO_ITEM_HIDDEN: {
        type: 'PORTFOLIO_ITEM_HIDDEN',
        title: 'Ein Portfolio-Eintrag wurde ausgeblendet',
        intro: `Wir haben den Eintrag „${itemTitle}“ in deinem Anbieterprofil „${title}“ ausgeblendet. Dein Profil bleibt sonst sichtbar.`,
      },
      PORTFOLIO_ITEM_RESTORED: {
        type: 'PORTFOLIO_ITEM_RESTORED',
        title: 'Ein Portfolio-Eintrag ist wieder sichtbar',
        intro: `Der Eintrag „${itemTitle}“ in deinem Anbieterprofil „${title}“ ist wieder sichtbar.`,
      },
      PROJECT_REJECTED: {
        type: 'PROJECT_REJECTED',
        title: 'Dein Projektauftrag wurde deaktiviert',
        intro: `Wir haben deinen Projektauftrag „${title}“ wegen eines Verstoßes deaktiviert. Er ist nicht mehr öffentlich sichtbar.`,
      },
      PROJECT_HIDDEN: {
        type: 'PROJECT_HIDDEN',
        title: 'Dein Projektauftrag wird geprüft',
        intro: `Dein Projektauftrag „${title}“ ist bis zum Abschluss einer Prüfung vorübergehend nicht öffentlich sichtbar.`,
      },
      PROJECT_RESTORED: { type: 'PROJECT_RESTORED', title: 'Dein Projektauftrag ist freigegeben', intro: `Wir haben deinen Projektauftrag „${title}“ geprüft und freigegeben.` },
    };
    const text = texts[decision.action];
    const restrictive = RESTRICTIVE_ACTIONS.includes(decision.action);
    const body = [
      text.intro,
      decision.reason ? `Grund: ${REPORT_REASON_LABELS[decision.reason]}` : '',
      `Begründung: ${decision.statement}`,
      restrictive
        ? 'Diese Entscheidung wurde von einer Person aus unserem Team getroffen, nicht automatisiert. Wenn du sie für falsch hältst, kannst du innerhalb von sechs Monaten in deinem Konto Einspruch erheben.'
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    await this.notifications.notify({ userId: decision.userId, type: text.type, title: text.title, body, link: `/konto/entscheidungen/${decision.id}`, decisionId: decision.id });
  }
}
