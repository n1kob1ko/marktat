import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MODERATION_ACTION_LABELS,
  REPORT_REASON_LABELS,
  type AppealDecisionInput,
  type AppealInput,
  type ListingDecisionInput,
  type ListingModerationInfo,
  type ModerationDecisionView,
  type UserDecisionInput,
} from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { ListingStatus, ModerationAction, NotificationType } from '../generated/prisma/enums.js';
import { AuditService, type AuditAction } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
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

const AUDIT_ACTIONS: Record<ModerationAction, AuditAction> = {
  LISTING_REJECTED: 'moderation.listing_rejected',
  LISTING_HIDDEN: 'moderation.listing_hidden',
  LISTING_RESTORED: 'moderation.listing_restored',
  ACCOUNT_SUSPENDED: 'moderation.account_suspended',
  ACCOUNT_RESTORED: 'moderation.account_restored',
};

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
    const latest = await this.latestDecision(listingId);
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
    const latest = await this.latestDecision(listing.id);
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
    const decision = await this.prisma.moderationDecision.findUniqueOrThrow({ where: { id: decisionId }, select: { userId: true, action: true, listing: { select: { title: true } } } });
    if (reversal) {
      if (reversal.listingId) this.searchIndex.sync(reversal.listingId);
      else this.searchIndex.syncSeller(decision.userId);
      this.audit.log({ action: AUDIT_ACTIONS[reversal.action], actorId: reviewer.id, entityType: reversal.listingId ? 'listing' : 'user', entityId: reversal.listingId ?? decision.userId, ip, metadata: { decisionId: reversal.id, appealId } });
    }
    const what = decision.listing ? `zur Anzeige „${decision.listing.title}“` : 'zu deinem Konto';
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
    original: { id: string; action: ModerationAction; userId: string; listingId: string | null; snapshot: Prisma.JsonValue },
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

  private latestDecision(listingId: string) {
    return this.prisma.moderationDecision.findFirst({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      include: { appeal: { select: { status: true } } },
    });
  }

  /** Letzte einschränkende Entscheidung, die noch nicht aufgehoben wurde */
  private latestRestrictive(tx: Tx, where: { listingId?: string; userId?: string; action?: ModerationAction }) {
    return tx.moderationDecision.findFirst({
      where: {
        ...(where.listingId ? { listingId: where.listingId } : {}),
        ...(where.userId ? { userId: where.userId, listingId: null } : {}),
        action: where.action ?? { in: ['LISTING_REJECTED', 'LISTING_HIDDEN'] },
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
    const decision = await this.prisma.moderationDecision.findUniqueOrThrow({ where: { id: decisionId }, include: { listing: { select: { title: true } } } });
    const title = decision.listing?.title;
    const texts: Record<ModerationAction, { type: NotificationType; title: string; intro: string }> = {
      LISTING_REJECTED: { type: 'LISTING_REJECTED', title: 'Deine Anzeige wurde deaktiviert', intro: `Wir haben deine Anzeige „${title}“ wegen eines Verstoßes deaktiviert. Sie ist nicht mehr öffentlich sichtbar.` },
      LISTING_HIDDEN: { type: 'LISTING_HIDDEN', title: 'Deine Anzeige wird geprüft', intro: `Deine Anzeige „${title}“ ist bis zum Abschluss einer Prüfung vorübergehend nicht öffentlich sichtbar.` },
      LISTING_RESTORED: { type: 'LISTING_RESTORED', title: 'Deine Anzeige ist wieder freigegeben', intro: `Wir haben deine Anzeige „${title}“ geprüft und wieder freigegeben.` },
      ACCOUNT_SUSPENDED: { type: 'ACCOUNT_SUSPENDED', title: 'Dein Konto wurde gesperrt', intro: 'Wir haben dein MarktAT-Konto gesperrt. Deine Anzeigen sind nicht mehr sichtbar und du kannst keine Nachrichten senden.' },
      ACCOUNT_RESTORED: { type: 'ACCOUNT_RESTORED', title: 'Die Sperre deines Kontos ist aufgehoben', intro: 'Dein MarktAT-Konto ist wieder freigeschaltet. Du kannst alle Funktionen wieder nutzen.' },
    };
    const text = texts[decision.action];
    const restrictive = decision.action === 'LISTING_REJECTED' || decision.action === 'LISTING_HIDDEN' || decision.action === 'ACCOUNT_SUSPENDED';
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
