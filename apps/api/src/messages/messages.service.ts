import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type {
  ChatMessage,
  ConversationDetail,
  ConversationSummary,
  MessagePage,
  Paginated,
  ReportUserInput,
  UnreadSummary,
} from '@marktat/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { loadEnv } from '../config/env.js';
import { Prisma, type Message } from '../generated/prisma/client.js';
import { ImageUrls } from '../images/image-urls.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ENTITY_ID, publiclyVisibleWhere } from '../listings/visibility.js';
import { escapeHtml, MailService, mailLayout } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { isPubliclyVisible } from '../search/search-document.js';

/** Grenzwerte gegen Spam und massenhaftes Anschreiben (je Konto, gilt über alle API-Instanzen). */
export const MESSAGE_LIMITS = {
  perMinute: 10,
  perHour: 100,
  newConversationsPerHour: 10,
  newConversationsPerDay: 30,
  reportsPerDay: 10,
} as const;

const CONVERSATIONS_PAGE_SIZE = 20;
const MESSAGES_PAGE_SIZE = 30;
const MAX_MESSAGES_PAGE_SIZE = 100;
const PREVIEW_LENGTH = 140;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConversationFilter = 'alle' | 'ungelesen' | 'kaufen' | 'verkaufen';
export const CONVERSATION_FILTERS: readonly ConversationFilter[] = ['alle', 'ungelesen', 'kaufen', 'verkaufen'];

const userSelect = { id: true, displayName: true, accountType: true, companyName: true, status: true, deletedAt: true } as const;

const conversationInclude = {
  listing: {
    select: {
      id: true,
      title: true,
      priceType: true,
      priceCents: true,
      status: true,
      deletedAt: true,
      expiresAt: true,
      seller: { select: { status: true, deletedAt: true } },
      images: { where: { status: 'READY' }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1, select: { id: true } },
    },
  },
  buyer: { select: userSelect },
  seller: { select: userSelect },
  messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;
type UserRow = ConversationRow['buyer'];

const MESSAGE_EMAIL_JOB = 'message-email';

/**
 * Private Nachrichten zwischen Interessent und Anbieter, je Inserat eine Unterhaltung.
 * Jede Abfrage ist auf die beiden Beteiligten beschränkt; fremde IDs ergeben 404 (keine Bestätigung,
 * dass es die Unterhaltung gibt).
 */
@Injectable()
export class MessagesService implements OnModuleInit {
  private readonly logger = new Logger(MessagesService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: ImageUrls,
    private readonly realtime: RealtimeService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.jobs.register(MESSAGE_EMAIL_JOB, (data) => this.sendMessageEmail(String(data.conversationId), String(data.recipientId)));
  }

  // --- Unterhaltungen ----------------------------------------------------------

  /** Erste Nachricht zu einem Inserat. Besteht schon eine Unterhaltung, wird sie fortgesetzt. */
  async start(user: AuthUser, listingId: string, body: string, ip?: string): Promise<{ conversationId: string; message: ChatMessage }> {
    const listing = ENTITY_ID.test(listingId)
      ? await this.prisma.listing.findFirst({ where: { id: listingId, ...publiclyVisibleWhere() }, select: { id: true, sellerId: true } })
      : null;
    if (!listing) throw new NotFoundException('Diese Anzeige ist nicht mehr verfügbar.');
    if (listing.sellerId === user.id) throw new BadRequestException('Das ist deine eigene Anzeige – du kannst dir nicht selbst schreiben.');
    await this.assertNotBlocked(user.id, listing.sellerId);

    const existing = await this.prisma.conversation.findUnique({
      where: { listingId_buyerId: { listingId, buyerId: user.id } },
      select: { id: true },
    });
    if (!existing) await this.assertConversationLimit(user.id);
    await this.assertMessageLimit(user.id);

    const { conversationId, message } = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.upsert({
        where: { listingId_buyerId: { listingId, buyerId: user.id } },
        create: { listingId, buyerId: user.id, sellerId: listing.sellerId },
        update: {},
        select: { id: true },
      });
      const message = await tx.message.create({
        data: { conversationId: conversation.id, senderId: user.id, recipientId: listing.sellerId, body },
      });
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } });
      return { conversationId: conversation.id, message };
    });
    if (!existing) {
      this.audit.log({ action: 'conversation.started', actorId: user.id, entityType: 'conversation', entityId: conversationId, ip, metadata: { listingId } });
    }
    await this.afterSend(message);
    return { conversationId, message: toChatMessage(message, user.id) };
  }

  async list(user: AuthUser, options: { filter?: ConversationFilter; q?: string; page?: number } = {}): Promise<Paginated<ConversationSummary>> {
    const page = options.page ?? 1;
    const where = this.listWhere(user.id, options.filter ?? 'alle', options.q);
    const [total, rows] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: conversationInclude,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * CONVERSATIONS_PAGE_SIZE,
        take: CONVERSATIONS_PAGE_SIZE,
      }),
    ]);
    const unread = await this.unreadByConversation(user.id, rows.map((row) => row.id));
    return {
      items: rows.map((row) => this.toSummary(row, user.id, unread.get(row.id) ?? 0)),
      page,
      pageSize: CONVERSATIONS_PAGE_SIZE,
      total,
    };
  }

  async detail(user: AuthUser, conversationId: string): Promise<ConversationDetail> {
    const row = await this.requireParticipant(user.id, conversationId);
    const unread = await this.unreadByConversation(user.id, [row.id]);
    const partner = row.buyerId === user.id ? row.seller : row.buyer;
    const [blockedByMe, blockedMe] = await this.blockState(user.id, partner.id);
    return {
      ...this.toSummary(row, user.id, unread.get(row.id) ?? 0),
      blockedByMe,
      sendBlockedReason: sendBlockedReason(partner, blockedByMe, blockedMe),
    };
  }

  /** Nachrichten seitenweise: ohne Cursor die neuesten, `before` = ältere, `after` = neuere (nach einer Unterbrechung). */
  async messages(user: AuthUser, conversationId: string, options: { before?: string; after?: string; limit?: number } = {}): Promise<MessagePage> {
    const conversation = await this.requireParticipant(user.id, conversationId);
    const limit = Math.min(Math.max(options.limit ?? MESSAGES_PAGE_SIZE, 1), MAX_MESSAGES_PAGE_SIZE);
    const cursorId = options.after ?? options.before;
    const cursor = cursorId && ENTITY_ID.test(cursorId)
      ? await this.prisma.message.findFirst({ where: { id: cursorId, conversationId: conversation.id }, select: { id: true, createdAt: true } })
      : null;
    if (cursorId && !cursor) throw new BadRequestException('Ungültiger Verweis auf eine Nachricht.');

    if (options.after && cursor) {
      const rows = await this.prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
      return { items: rows.slice(0, limit).map((m) => toChatMessage(m, user.id)), hasMore: false };
    }
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit).reverse().map((m) => toChatMessage(m, user.id)),
      hasMore: rows.length > limit,
    };
  }

  async send(user: AuthUser, conversationId: string, body: string): Promise<ChatMessage> {
    const conversation = await this.requireParticipant(user.id, conversationId);
    const partner = conversation.buyerId === user.id ? conversation.seller : conversation.buyer;
    const [blockedByMe, blockedMe] = await this.blockState(user.id, partner.id);
    const reason = sendBlockedReason(partner, blockedByMe, blockedMe);
    if (reason) throw new ForbiddenException(reason);
    await this.assertMessageLimit(user.id);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId: conversation.id, senderId: user.id, recipientId: partner.id, body },
      });
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: created.createdAt } });
      return created;
    });
    await this.afterSend(message);
    return toChatMessage(message, user.id);
  }

  /** Alle Nachrichten der Unterhaltung an mich als gelesen markieren. */
  async markRead(user: AuthUser, conversationId: string): Promise<UnreadSummary> {
    const conversation = await this.requireParticipant(user.id, conversationId);
    const readAt = new Date();
    const { count } = await this.prisma.message.updateMany({
      where: { conversationId: conversation.id, recipientId: user.id, readAt: null },
      data: { readAt },
    });
    const unread = await this.unread(user.id);
    if (count > 0) {
      const partnerId = conversation.buyerId === user.id ? conversation.sellerId : conversation.buyerId;
      this.realtime.publish(user.id, { type: 'read', conversationId: conversation.id, readAt: readAt.toISOString(), unread });
      this.realtime.publish(partnerId, { type: 'read', conversationId: conversation.id, readAt: readAt.toISOString(), unread: await this.unread(partnerId) });
    }
    return unread;
  }

  async unread(userId: string): Promise<UnreadSummary> {
    const [row] = await this.prisma.$queryRaw<{ messages: number; conversations: number }[]>`
      SELECT count(*)::int AS messages, count(DISTINCT conversation_id)::int AS conversations
      FROM messages WHERE recipient_id = ${userId}::uuid AND read_at IS NULL`;
    return { messages: row?.messages ?? 0, conversations: row?.conversations ?? 0 };
  }

  /** Für die Detailseite eines Inserats: bestehende Unterhaltung der angemeldeten Person */
  async conversationIdFor(userId: string, listingId: string): Promise<string | null> {
    const row = await this.prisma.conversation.findUnique({ where: { listingId_buyerId: { listingId, buyerId: userId } }, select: { id: true } });
    return row?.id ?? null;
  }

  // --- Blockieren und Melden -----------------------------------------------------

  async block(user: AuthUser, targetId: string, ip?: string): Promise<void> {
    if (!UUID.test(targetId)) throw new NotFoundException('Diese Person gibt es nicht.');
    if (targetId === user.id) throw new BadRequestException('Du kannst dich nicht selbst blockieren.');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw new NotFoundException('Diese Person gibt es nicht.');
    await this.prisma.userBlock.createMany({ data: [{ blockerId: user.id, blockedId: targetId }], skipDuplicates: true });
    this.audit.log({ action: 'user.blocked', actorId: user.id, entityType: 'user', entityId: targetId, ip });
  }

  async unblock(user: AuthUser, targetId: string, ip?: string): Promise<void> {
    if (!UUID.test(targetId)) return;
    const { count } = await this.prisma.userBlock.deleteMany({ where: { blockerId: user.id, blockedId: targetId } });
    if (count) this.audit.log({ action: 'user.unblocked', actorId: user.id, entityType: 'user', entityId: targetId, ip });
  }

  async blocks(user: AuthUser) {
    const rows = await this.prisma.userBlock.findMany({
      where: { blockerId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { blocked: { select: { id: true, displayName: true } } },
    });
    return rows.map((row) => ({ id: row.blocked.id, displayName: row.blocked.displayName, blockedAt: row.createdAt.toISOString() }));
  }

  /** Meldung an die Moderation. Speichert keine Nachrichtenkopie – die Moderation sieht die Unterhaltung über die ID. */
  async report(user: AuthUser, conversationId: string, input: ReportUserInput, ip?: string): Promise<{ id: string }> {
    const conversation = await this.requireParticipant(user.id, conversationId);
    const reportedId = conversation.buyerId === user.id ? conversation.sellerId : conversation.buyerId;
    const since = new Date(Date.now() - 24 * 3600_000);
    if ((await this.prisma.userReport.count({ where: { reporterId: user.id, createdAt: { gt: since } } })) >= MESSAGE_LIMITS.reportsPerDay) {
      throw tooMany('Du hast heute schon sehr viele Meldungen geschickt. Bitte versuche es morgen wieder.');
    }
    const report = await this.prisma.userReport.create({
      data: { reporterId: user.id, reportedId, conversationId: conversation.id, reason: input.reason, details: input.details },
      select: { id: true },
    });
    this.audit.log({ action: 'user.reported', actorId: user.id, entityType: 'user', entityId: reportedId, ip, metadata: { reportId: report.id, reason: input.reason } });
    return report;
  }

  // --- E-Mail-Benachrichtigung -----------------------------------------------------

  /**
   * Höchstens eine E-Mail je Unterhaltung, bis die Person wieder gelesen hat. Wer innerhalb der Wartezeit
   * liest (MESSAGE_EMAIL_DELAY_SECONDS), bekommt gar keine. Der Nachrichtentext steht bewusst nicht in der E-Mail.
   */
  async sendMessageEmail(conversationId: string, recipientId: string): Promise<void> {
    const unread = await this.prisma.message.findMany({
      where: { conversationId, recipientId, readAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, notifiedAt: true },
    });
    if (!unread.length) return;
    const pendingIds = unread.filter((m) => !m.notifiedAt).map((m) => m.id);
    if (!pendingIds.length) return;
    const markNotified = () => this.prisma.message.updateMany({ where: { id: { in: pendingIds } }, data: { notifiedAt: new Date() } });

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { listing: { select: { title: true } }, buyer: { select: userSelect }, seller: { select: userSelect } },
    });
    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
    const alreadyNotified = unread.length > pendingIds.length;
    if (!conversation || !recipient || alreadyNotified || !recipient.notifyMessagesByEmail || recipient.status !== 'ACTIVE' || recipient.deletedAt) {
      await markNotified();
      return;
    }
    const sender = conversation.buyerId === recipientId ? conversation.seller : conversation.buyer;
    const senderName = displayName(sender);
    const title = conversation.listing.title;
    const url = `${this.env.WEB_URL}/nachrichten/${conversation.id}`;
    const count = pendingIds.length;
    const intro = conversation.sellerId === recipientId ? `zu deiner Anzeige „${title}“` : `zur Anzeige „${title}“`;
    const text = [
      `Hallo ${recipient.displayName},`,
      '',
      `${senderName} hat dir ${count > 1 ? `${count} neue Nachrichten` : 'eine neue Nachricht'} ${intro} geschrieben.`,
      '',
      `Nachricht lesen und antworten: ${url}`,
      '',
      `Benachrichtigungen ändern: ${this.env.WEB_URL}/konto/benachrichtigungen`,
    ].join('\n');
    const html = mailLayout({
      heading: count > 1 ? `${count} neue Nachrichten` : 'Neue Nachricht',
      paragraphs: [
        `Hallo ${escapeHtml(recipient.displayName)},`,
        `<strong>${escapeHtml(senderName)}</strong> hat dir ${count > 1 ? `${count} neue Nachrichten` : 'eine neue Nachricht'} ${escapeHtml(intro)} geschrieben.`,
        'Aus Datenschutzgründen steht der Text nur in deinem Postfach auf MarktAT.',
      ],
      action: { label: 'Nachricht lesen', url },
      settingsUrl: `${this.env.WEB_URL}/konto/benachrichtigungen`,
    });
    await this.mail.send({ to: recipient.email, subject: oneLine(`Neue Nachricht von ${senderName} zu „${title}“`), text, html });
    await markNotified();
  }

  // --- intern ----------------------------------------------------------------------

  private async afterSend(message: Message) {
    const [recipientUnread, senderUnread, recipient] = await Promise.all([
      this.unread(message.recipientId),
      this.unread(message.senderId),
      this.prisma.user.findUnique({ where: { id: message.recipientId }, select: { notifyMessagesByEmail: true } }),
    ]);
    this.realtime.publish(message.recipientId, { type: 'message', message: toChatMessage(message, message.recipientId), unread: recipientUnread });
    // Weitere offene Fenster der schreibenden Person aktualisieren
    this.realtime.publish(message.senderId, { type: 'message', message: toChatMessage(message, message.senderId), unread: senderUnread });
    if (recipient?.notifyMessagesByEmail) {
      await this.jobs
        .add(
          MESSAGE_EMAIL_JOB,
          { conversationId: message.conversationId, recipientId: message.recipientId },
          { delayMs: this.env.MESSAGE_EMAIL_DELAY_SECONDS * 1000, jobId: `message-email-${message.conversationId}-${message.recipientId}` },
        )
        .catch((error: Error) => this.logger.warn(`E-Mail-Auftrag nicht angelegt: ${error.message}`));
    }
  }

  private async requireParticipant(userId: string, conversationId: string): Promise<ConversationRow> {
    const row = ENTITY_ID.test(conversationId)
      ? await this.prisma.conversation.findFirst({
          where: { id: conversationId, OR: [{ buyerId: userId }, { sellerId: userId }] },
          include: conversationInclude,
        })
      : null;
    if (!row) throw new NotFoundException('Diese Unterhaltung gibt es nicht.');
    return row;
  }

  private listWhere(userId: string, filter: ConversationFilter, q?: string): Prisma.ConversationWhereInput {
    const and: Prisma.ConversationWhereInput[] = [];
    if (filter === 'kaufen') and.push({ buyerId: userId });
    else if (filter === 'verkaufen') and.push({ sellerId: userId });
    else and.push({ OR: [{ buyerId: userId }, { sellerId: userId }] });
    if (filter === 'ungelesen') and.push({ messages: { some: { recipientId: userId, readAt: null } } });
    const text = q?.trim().slice(0, 100);
    if (text) {
      const contains = { contains: text, mode: 'insensitive' as const };
      and.push({
        OR: [
          { listing: { title: contains } },
          { buyerId: userId, seller: { displayName: contains } },
          { sellerId: userId, buyer: { displayName: contains } },
        ],
      });
    }
    return { AND: and };
  }

  private async unreadByConversation(userId: string, conversationIds: string[]): Promise<Map<string, number>> {
    if (!conversationIds.length) return new Map();
    const rows = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: { recipientId: userId, readAt: null, conversationId: { in: conversationIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.conversationId, row._count._all]));
  }

  private toSummary(row: ConversationRow, userId: string, unreadCount: number): ConversationSummary {
    const role = row.buyerId === userId ? 'buyer' : 'seller';
    const partner = role === 'buyer' ? row.seller : row.buyer;
    const { listing } = row;
    const available = isPubliclyVisible(listing);
    const image = listing.images[0];
    const last = row.messages[0];
    return {
      id: row.id,
      role,
      partner: { id: partner.id, displayName: displayName(partner), inactive: isInactive(partner) },
      listing: {
        id: listing.id,
        title: listing.title,
        // Beteiligte kannten das Inserat schon; nicht mehr öffentliche Bilder nur signiert, gelöschte gar nicht
        imageUrl: image && !listing.deletedAt ? this.urls.url(image.id, 'thumb', !available) : null,
        priceType: listing.priceType,
        priceCents: listing.priceCents === null ? null : Number(listing.priceCents),
        available,
      },
      lastMessage: last
        ? { body: preview(last.body), mine: last.senderId === userId, createdAt: last.createdAt.toISOString() }
        : null,
      lastMessageAt: row.lastMessageAt.toISOString(),
      unreadCount,
    };
  }

  /** [ich habe blockiert, ich wurde blockiert] */
  private async blockState(userId: string, partnerId: string): Promise<[boolean, boolean]> {
    const rows = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: userId, blockedId: partnerId }, { blockerId: partnerId, blockedId: userId }] },
      select: { blockerId: true },
    });
    return [rows.some((r) => r.blockerId === userId), rows.some((r) => r.blockerId === partnerId)];
  }

  private async assertNotBlocked(userId: string, partnerId: string) {
    const [blockedByMe, blockedMe] = await this.blockState(userId, partnerId);
    if (blockedByMe) throw new ForbiddenException('Du hast diese Person blockiert. Hebe die Blockierung auf, um ihr zu schreiben.');
    if (blockedMe) throw new ForbiddenException('Du kannst dieser Person keine Nachrichten senden.');
  }

  private async assertMessageLimit(userId: string) {
    const now = Date.now();
    const [lastMinute, lastHour] = await Promise.all([
      this.prisma.message.count({ where: { senderId: userId, createdAt: { gt: new Date(now - 60_000) } } }),
      this.prisma.message.count({ where: { senderId: userId, createdAt: { gt: new Date(now - 3600_000) } } }),
    ]);
    if (lastMinute >= MESSAGE_LIMITS.perMinute) throw tooMany('Du schreibst gerade sehr schnell. Bitte warte einen Moment.');
    if (lastHour >= MESSAGE_LIMITS.perHour) throw tooMany('Du hast in der letzten Stunde sehr viele Nachrichten geschickt. Bitte versuche es später wieder.');
  }

  private async assertConversationLimit(userId: string) {
    const now = Date.now();
    const [lastHour, lastDay] = await Promise.all([
      this.prisma.conversation.count({ where: { buyerId: userId, createdAt: { gt: new Date(now - 3600_000) } } }),
      this.prisma.conversation.count({ where: { buyerId: userId, createdAt: { gt: new Date(now - 24 * 3600_000) } } }),
    ]);
    if (lastHour >= MESSAGE_LIMITS.newConversationsPerHour || lastDay >= MESSAGE_LIMITS.newConversationsPerDay) {
      throw tooMany('Du hast in kurzer Zeit sehr viele Anbieter angeschrieben. Bitte versuche es später wieder.');
    }
  }
}

export function toChatMessage(message: Message, viewerId: string): ChatMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    body: message.body,
    mine: message.senderId === viewerId,
    createdAt: message.createdAt.toISOString(),
    readAt: message.readAt?.toISOString() ?? null,
  };
}

function isInactive(user: Pick<UserRow, 'status' | 'deletedAt'>) {
  return user.status !== 'ACTIVE' || user.deletedAt !== null;
}

function displayName(user: Pick<UserRow, 'displayName' | 'accountType' | 'companyName' | 'status' | 'deletedAt'>) {
  if (user.deletedAt) return 'Gelöschtes Konto';
  return user.accountType === 'BUSINESS' && user.companyName ? user.companyName : user.displayName;
}

function sendBlockedReason(partner: UserRow, blockedByMe: boolean, blockedMe: boolean): string | null {
  if (isInactive(partner)) return 'Diese Person ist nicht mehr auf MarktAT aktiv.';
  if (blockedByMe) return 'Du hast diese Person blockiert.';
  if (blockedMe) return 'Du kannst dieser Person keine Nachrichten mehr senden.';
  return null;
}

function preview(body: string) {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

function oneLine(text: string) {
  return text.replace(/[\r\n]+/g, ' ').slice(0, 200);
}

function tooMany(message: string) {
  return new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message }, HttpStatus.TOO_MANY_REQUESTS);
}
