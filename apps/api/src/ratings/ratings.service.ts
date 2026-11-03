import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isUnlimitedAccount,
  RATING_STAR_LABELS,
  type ConversationRating,
  type MyRatings,
  type PublicRatings,
  type RateInput,
  type RatingItem,
  type RatingReplyInput,
  type RatingSummary,
} from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { NotificationsService } from '../moderation/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PAGE_SIZE = 20;
/** Eigene Listen im Konto: die neuesten je Richtung */
const MY_LIST_LIMIT = 100;
/** Neue Bewertungen je Konto und Tag (gegen Massenbewertungen mit Zweitkonten) */
export const RATINGS_PER_DAY = 20;
const DAY_MS = 86_400_000;

const personSelect = {
  id: true,
  displayName: true,
  accountType: true,
  companyName: true,
  status: true,
  deletedAt: true,
} as const;
type Person = {
  id: string;
  displayName: string;
  accountType: string;
  companyName: string | null;
  status: string;
  deletedAt: Date | null;
};

const ratingInclude = {
  rater: { select: personSelect },
  ratee: { select: personSelect },
  conversation: {
    select: {
      buyerId: true,
      listing: { select: { title: true, status: true, deletedAt: true } },
      serviceProfile: { select: { headline: true, status: true } },
      project: { select: { title: true, status: true } },
    },
  },
} satisfies Prisma.RatingInclude;
type RatingRow = Prisma.RatingGetPayload<{ include: typeof ratingInclude }>;

const conversationSelect = {
  id: true,
  buyerId: true,
  sellerId: true,
  listingId: true,
  serviceProfileId: true,
  projectId: true,
  buyer: { select: personSelect },
  seller: { select: personSelect },
  listing: { select: { title: true } },
  serviceProfile: { select: { headline: true } },
  project: { select: { title: true } },
} satisfies Prisma.ConversationSelect;

function personName(
  user: Pick<Person, 'displayName' | 'accountType' | 'companyName' | 'deletedAt'>,
) {
  if (user.deletedAt) return 'Gelöschtes Konto';
  return user.accountType === 'BUSINESS' && user.companyName ? user.companyName : user.displayName;
}

function isInactive(user: Pick<Person, 'status' | 'deletedAt'>) {
  return user.status !== 'ACTIVE' || user.deletedAt !== null;
}

function emptySummary(): RatingSummary {
  return { average: null, count: 0, distribution: [0, 0, 0, 0, 0] };
}

/**
 * Bewertungen nach einem Kontakt zu einer Anzeige. Bewerten darf, wer in der Unterhaltung mit der anderen Person geschrieben hat,
 * sobald beide Seiten mindestens eine Nachricht geschickt haben – je Unterhaltung und Person einmal (änderbar).
 * Ob tatsächlich gekauft wurde, prüfen wir nicht; das steht so auch auf den öffentlichen Seiten.
 */
@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Öffentlich -------------------------------------------------------------------

  async summary(userId: string): Promise<RatingSummary> {
    const groups = await this.prisma.rating.groupBy({
      by: ['stars'],
      where: { rateeId: userId, hiddenAt: null },
      _count: { _all: true },
    });
    const result = emptySummary();
    let sum = 0;
    for (const group of groups) {
      if (group.stars < 1 || group.stars > 5) continue;
      result.distribution[group.stars - 1] = group._count._all;
      result.count += group._count._all;
      sum += group.stars * group._count._all;
    }
    result.average = result.count ? Math.round((sum / result.count) * 10) / 10 : null;
    return result;
  }

  async publicSummary(userId: string): Promise<RatingSummary> {
    await this.requireActiveUser(userId);
    return this.summary(userId);
  }

  async publicList(userId: string, page = 1): Promise<PublicRatings> {
    const user = await this.requireActiveUser(userId);
    const where = { rateeId: userId, hiddenAt: null } satisfies Prisma.RatingWhereInput;
    const [summary, rows, total] = await Promise.all([
      this.summary(userId),
      this.prisma.rating.findMany({
        where,
        include: ratingInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.rating.count({ where }),
    ]);
    return {
      user: {
        id: user.id,
        displayName: personName(user),
        accountType: user.accountType as PublicRatings['user']['accountType'],
        memberSince: user.createdAt.toISOString(),
      },
      summary,
      items: rows.map((row) => toItem(row)),
      page,
      pageSize: PAGE_SIZE,
      total,
    };
  }

  /** Einzelne sichtbare Bewertung (z. B. für das Meldeformular) */
  async publicOne(ratingId: string): Promise<RatingItem> {
    const row = ENTITY_ID.test(ratingId)
      ? await this.prisma.rating.findFirst({
          where: { id: ratingId, hiddenAt: null, ratee: { status: 'ACTIVE', deletedAt: null } },
          include: ratingInclude,
        })
      : null;
    if (!row) throw new NotFoundException('Diese Bewertung gibt es nicht (mehr).');
    return toItem(row);
  }

  // --- Eigene Bewertungen -------------------------------------------------------------

  async mine(user: AuthUser): Promise<MyRatings> {
    const [summary, received, given] = await Promise.all([
      this.summary(user.id),
      this.prisma.rating.findMany({
        where: { rateeId: user.id },
        include: ratingInclude,
        orderBy: { createdAt: 'desc' },
        take: MY_LIST_LIMIT,
      }),
      this.prisma.rating.findMany({
        where: { raterId: user.id },
        include: ratingInclude,
        orderBy: { createdAt: 'desc' },
        take: MY_LIST_LIMIT,
      }),
    ]);
    // Ausgeblendete Bewertungen über mich sehe ich nicht (sie sind nicht mehr Teil meines Profils), eigene schon – mit Hinweis
    return {
      summary,
      received: received
        .filter((r) => !r.hiddenAt)
        .map((r) => ({ ...toItem(r), conversationId: r.conversationId })),
      given: given.map((r) => toItem(r, { withHidden: true })),
    };
  }

  /** Für den Chat: kann ich die andere Person bewerten, und mit wie vielen Sternen habe ich es schon getan? */
  async quickState(
    userId: string,
    conversation: { id: string; buyerId: string; sellerId: string; listingId: string | null },
    partnerInactive: boolean,
  ): Promise<{ canRate: boolean; myStars: number | null }> {
    if (!conversation.listingId) return { canRate: false, myStars: null };
    const [mine, writers] = await Promise.all([
      this.prisma.rating.findUnique({
        where: { conversationId_raterId: { conversationId: conversation.id, raterId: userId } },
        select: { stars: true },
      }),
      this.writers(conversation.id),
    ]);
    return {
      canRate:
        !partnerInactive && writers.has(conversation.buyerId) && writers.has(conversation.sellerId),
      myStars: mine?.stars ?? null,
    };
  }

  async forConversation(user: AuthUser, conversationId: string): Promise<ConversationRating> {
    const conversation = await this.requireParticipant(user.id, conversationId);
    const partner = conversation.buyerId === user.id ? conversation.seller : conversation.buyer;
    const [writers, ratings] = await Promise.all([
      this.writers(conversation.id),
      this.prisma.rating.findMany({
        where: { conversationId: conversation.id },
        include: ratingInclude,
      }),
    ]);
    const mine = ratings.find((r) => r.raterId === user.id);
    const theirs = ratings.find((r) => r.raterId === partner.id && !r.hiddenAt);
    return {
      conversationId: conversation.id,
      partner: { id: partner.id, displayName: personName(partner) },
      subject: subjectOf(conversation),
      blockedReason: blockedReason(partner, writers, conversation),
      mine: mine ? toItem(mine, { withHidden: true }) : null,
      theirs: theirs ? toItem(theirs) : null,
    };
  }

  async rate(
    user: AuthUser,
    conversationId: string,
    input: RateInput,
    ip?: string,
  ): Promise<ConversationRating> {
    const conversation = await this.requireParticipant(user.id, conversationId);
    const partner = conversation.buyerId === user.id ? conversation.seller : conversation.buyer;
    const reason = blockedReason(partner, await this.writers(conversation.id), conversation);
    if (reason) throw new ForbiddenException(reason);
    const created = await this.prisma.$transaction(async (tx) => {
      // Je Konto serialisieren: Tageslimit und „schon bewertet?“ ohne Wettlauf
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rating:${user.id}`}))`;
      const existing = await tx.rating.findUnique({
        where: { conversationId_raterId: { conversationId: conversation.id, raterId: user.id } },
      });
      if (existing?.hiddenAt) {
        throw new ForbiddenException(
          'Diese Bewertung hat unser Team ausgeblendet. Du kannst sie löschen oder in deinem Konto Einspruch gegen die Entscheidung erheben.',
        );
      }
      if (existing) {
        await tx.rating.update({
          where: { id: existing.id },
          data: { stars: input.stars, comment: input.comment ?? null },
        });
        return null;
      }
      const since = new Date(Date.now() - DAY_MS);
      if (
        !isUnlimitedAccount(user) &&
        (await tx.rating.count({ where: { raterId: user.id, createdAt: { gt: since } } })) >=
          RATINGS_PER_DAY
      ) {
        throw new HttpException(
          'Du hast heute schon viele Bewertungen abgegeben. Bitte versuche es morgen wieder.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return tx.rating.create({
        data: {
          conversationId: conversation.id,
          raterId: user.id,
          rateeId: partner.id,
          stars: input.stars,
          comment: input.comment ?? null,
        },
      });
    });
    if (created) {
      this.audit.log({
        action: 'rating.created',
        actorId: user.id,
        entityType: 'rating',
        entityId: created.id,
        ip,
        metadata: { stars: input.stars },
      });
      await this.notifyRatee(created.id);
    } else {
      this.audit.log({
        action: 'rating.updated',
        actorId: user.id,
        entityType: 'conversation',
        entityId: conversation.id,
        ip,
        metadata: { stars: input.stars },
      });
    }
    return this.forConversation(user, conversation.id);
  }

  async remove(user: AuthUser, conversationId: string, ip?: string): Promise<void> {
    const conversation = await this.requireParticipant(user.id, conversationId);
    const { count } = await this.prisma.rating.deleteMany({
      where: { conversationId: conversation.id, raterId: user.id },
    });
    if (!count) throw new NotFoundException('Du hast diese Person hier noch nicht bewertet.');
    this.audit.log({
      action: 'rating.deleted',
      actorId: user.id,
      entityType: 'conversation',
      entityId: conversation.id,
      ip,
    });
  }

  /** Öffentliche Antwort der bewerteten Person (eine je Bewertung, änderbar) */
  async reply(
    user: AuthUser,
    ratingId: string,
    input: RatingReplyInput,
    ip?: string,
  ): Promise<RatingItem> {
    const rating = await this.requireReceived(user.id, ratingId);
    const row = await this.prisma.rating.update({
      where: { id: rating.id },
      data: { reply: input.body, repliedAt: new Date() },
      include: ratingInclude,
    });
    this.audit.log({
      action: 'rating.replied',
      actorId: user.id,
      entityType: 'rating',
      entityId: rating.id,
      ip,
    });
    return toItem(row);
  }

  async removeReply(user: AuthUser, ratingId: string, ip?: string): Promise<RatingItem> {
    const rating = await this.requireReceived(user.id, ratingId);
    const row = await this.prisma.rating.update({
      where: { id: rating.id },
      data: { reply: null, repliedAt: null },
      include: ratingInclude,
    });
    this.audit.log({
      action: 'rating.replied',
      actorId: user.id,
      entityType: 'rating',
      entityId: rating.id,
      ip,
      metadata: { removed: true },
    });
    return toItem(row);
  }

  // --- Hilfsfunktionen ----------------------------------------------------------------

  private async requireActiveUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE', deletedAt: null },
      select: { ...personSelect, createdAt: true },
    });
    if (!user) throw new NotFoundException('Dieses Profil gibt es nicht.');
    return user;
  }

  private async requireParticipant(userId: string, conversationId: string) {
    const conversation = ENTITY_ID.test(conversationId)
      ? await this.prisma.conversation.findFirst({
          where: { id: conversationId, OR: [{ buyerId: userId }, { sellerId: userId }] },
          select: conversationSelect,
        })
      : null;
    if (!conversation) throw new NotFoundException('Diese Unterhaltung gibt es nicht.');
    return conversation;
  }

  private async requireReceived(userId: string, ratingId: string) {
    const rating = ENTITY_ID.test(ratingId)
      ? await this.prisma.rating.findFirst({
          where: { id: ratingId, rateeId: userId, hiddenAt: null },
          select: { id: true },
        })
      : null;
    if (!rating) throw new NotFoundException('Diese Bewertung gibt es nicht.');
    return rating;
  }

  /** Wer hat in der Unterhaltung schon geschrieben? */
  private async writers(conversationId: string): Promise<Set<string>> {
    const rows = await this.prisma.message.groupBy({ by: ['senderId'], where: { conversationId } });
    return new Set(rows.map((r) => r.senderId));
  }

  /** Mitteilung an die bewertete Person; per E-Mail nur, wenn sie E-Mails zu Nachrichten bekommen möchte */
  private async notifyRatee(ratingId: string) {
    const rating = await this.prisma.rating.findUnique({
      where: { id: ratingId },
      include: {
        ...ratingInclude,
        ratee: { select: { ...personSelect, notifyMessagesByEmail: true } },
      },
    });
    if (!rating) return;
    const subject = subjectTitle(rating);
    await this.notifications.notify(
      {
        userId: rating.rateeId,
        type: 'RATING_RECEIVED',
        title: 'Du hast eine neue Bewertung',
        body: [
          `${personName(rating.rater)} hat dich mit ${rating.stars} von 5 Sternen bewertet (${RATING_STAR_LABELS[rating.stars]})${subject ? ` – zu „${subject}“` : ''}.`,
          'Du kannst einmal öffentlich darauf antworten. Verstößt die Bewertung gegen unsere Regeln, kannst du sie melden.',
        ].join('\n\n'),
        link: '/konto/bewertungen',
      },
      { email: rating.ratee.notifyMessagesByEmail },
    );
  }
}

function subjectOf(conversation: {
  listingId: string | null;
  serviceProfileId: string | null;
  projectId: string | null;
  listing: { title: string } | null;
  serviceProfile: { headline: string } | null;
  project: { title: string } | null;
}): ConversationRating['subject'] {
  if (conversation.listingId)
    return {
      kind: 'listing',
      title: conversation.listing?.title ?? 'Anzeige',
      href: `/anzeige/${conversation.listingId}`,
    };
  if (conversation.projectId)
    return {
      kind: 'project',
      title: conversation.project?.title ?? 'Projektauftrag',
      href: `/dienstleistungen/projekte/${conversation.projectId}`,
    };
  return {
    kind: 'service',
    title: conversation.serviceProfile?.headline ?? 'Anbieterprofil',
    href: `/dienstleistungen/${conversation.serviceProfileId}`,
  };
}

function blockedReason(
  partner: Person,
  writers: Set<string>,
  conversation: { buyerId: string; sellerId: string; listingId: string | null },
): string | null {
  // Dienstleistungen und Projektaufträge bewusst ohne Bewertungen (siehe docs/dienstleistungen.md)
  if (!conversation.listingId)
    return 'Bewertungen gibt es nur nach einem Kontakt zu einer Anzeige.';
  if (isInactive(partner)) return 'Diese Person ist nicht mehr auf Markterl aktiv.';
  if (!writers.has(conversation.buyerId) || !writers.has(conversation.sellerId)) {
    return 'Bewerten kannst du, sobald ihr beide in dieser Unterhaltung geschrieben habt.';
  }
  return null;
}

function subjectTitle(row: RatingRow): string | null {
  const { listing, serviceProfile, project } = row.conversation;
  if (listing) return listing.deletedAt || listing.status === 'DELETED' ? null : listing.title;
  if (serviceProfile) return serviceProfile.status === 'DELETED' ? null : serviceProfile.headline;
  if (project) return project.status === 'DELETED' ? null : project.title;
  return null;
}

function toItem(row: RatingRow, options: { withHidden?: boolean } = {}): RatingItem {
  const { listing, serviceProfile } = row.conversation;
  const title = subjectTitle(row);
  return {
    id: row.id,
    stars: row.stars,
    comment: row.comment,
    reply: row.reply,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    raterRole: row.conversation.buyerId === row.raterId ? 'buyer' : 'seller',
    rater: { id: row.rater.id, displayName: personName(row.rater) },
    ratee: { id: row.ratee.id, displayName: personName(row.ratee) },
    subject: title
      ? { kind: listing ? 'listing' : serviceProfile ? 'service' : 'project', title }
      : null,
    ...(options.withHidden
      ? { hidden: row.hiddenAt !== null, conversationId: row.conversationId }
      : {}),
  };
}
