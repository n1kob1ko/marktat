import { Injectable } from '@nestjs/common';
import { MODERATION_ACTION_LABELS, REPORT_REASON_LABELS } from '@marktat/shared';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Höchstzahl der Aktivitätseinträge im Export (das Audit-Log wird ohnehin nach 12 Monaten gelöscht) */
const ACTIVITY_LIMIT = 2000;

/**
 * Datenexport nach Art. 15 und 20 DSGVO als JSON. Enthält alle Daten, die die Person selbst angegeben hat oder
 * die über sie gespeichert sind – aber keine personenbezogenen Daten anderer: Von Gesprächspartnern stehen nur
 * die öffentlichen Anzeigenamen drin, nicht deren Nachrichten; bei eigenen Meldungen fehlt die gemeldete Person.
 */
@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async export(user: AuthUser, ip?: string) {
    const id = user.id;
    const [profile, listings, favorites, savedSearches, conversations, blocks, reports, decisions, notifications, activity] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id } }),
      this.prisma.listing.findMany({
        where: { sellerId: id },
        include: {
          category: { select: { path: true, name: true } },
          location: { select: { postalCode: true, place: true } },
          images: { select: { id: true, width: true, height: true, status: true, createdAt: true }, orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.favorite.findMany({ where: { userId: id }, include: { listing: { select: { id: true, title: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.savedSearch.findMany({ where: { userId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.conversation.findMany({
        where: { OR: [{ buyerId: id }, { sellerId: id }] },
        include: {
          listing: { select: { id: true, title: true } },
          buyer: { select: { displayName: true, status: true } },
          seller: { select: { displayName: true, status: true } },
          messages: { where: { senderId: id }, orderBy: { createdAt: 'asc' }, select: { body: true, createdAt: true, readAt: true } },
          _count: { select: { messages: { where: { recipientId: id } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.userBlock.findMany({ where: { blockerId: id }, include: { blocked: { select: { displayName: true, status: true } } } }),
      this.prisma.report.findMany({ where: { reporterId: id }, select: { targetType: true, reason: true, details: true, status: true, createdAt: true, listing: { select: { title: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.moderationDecision.findMany({ where: { userId: id }, include: { appeal: true, listing: { select: { title: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.notification.findMany({ where: { userId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.auditLog.findMany({ where: { actorId: id }, select: { action: true, createdAt: true, ipPrefix: true }, orderBy: { createdAt: 'desc' }, take: ACTIVITY_LIMIT }),
    ]);
    const name = (u: { displayName: string; status: string }) => (u.status === 'DELETED' ? 'Gelöschtes Konto' : u.displayName);

    this.audit.log({ action: 'privacy.export', actorId: id, entityType: 'user', entityId: id, ip });
    return {
      format: 'MarktAT-Datenexport',
      version: 1,
      exportedAt: new Date().toISOString(),
      hinweis:
        'Dieser Export enthält deine Daten bei MarktAT (Art. 15 und 20 DSGVO). Nachrichten anderer Personen sind aus Datenschutzgründen nicht enthalten, nur deine eigenen.',
      profile: {
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        accountType: profile.accountType,
        role: profile.role,
        status: profile.status,
        bio: profile.bio,
        phone: profile.phone,
        avatarUrl: profile.avatarUrl,
        companyName: profile.companyName,
        companyRegisterNumber: profile.companyRegisterNumber,
        vatId: profile.vatId,
        companyAddress: profile.companyAddress,
        termsVersion: profile.termsVersion,
        termsAcceptedAt: profile.termsAcceptedAt,
        createdAt: profile.createdAt,
        lastSeenAt: profile.lastSeenAt,
      },
      settings: { notifyMessagesByEmail: profile.notifyMessagesByEmail, notifySearchesByEmail: profile.notifySearchesByEmail },
      listings: listings.map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        status: l.status,
        category: l.category ? { path: l.category.path, name: l.category.name } : null,
        priceType: l.priceType,
        priceCents: l.priceCents?.toString() ?? null,
        condition: l.condition,
        attributes: l.attributes,
        location: l.location,
        viewCount: l.viewCount,
        createdAt: l.createdAt,
        publishedAt: l.publishedAt,
        expiresAt: l.expiresAt,
        deletedAt: l.deletedAt,
        images: l.images,
      })),
      favorites: favorites.map((f) => ({ listingId: f.listingId, title: f.listing.title, savedAt: f.createdAt })),
      savedSearches: savedSearches.map((s) => ({ name: s.name, params: s.params, labels: s.labels, notify: s.notify, createdAt: s.createdAt })),
      conversations: conversations.map((c) => ({
        id: c.id,
        listing: c.listing,
        myRole: c.buyerId === id ? 'Interessent' : 'Anbieter',
        partner: name(c.buyerId === id ? c.seller : c.buyer),
        startedAt: c.createdAt,
        myMessages: c.messages.map((m) => ({ sentAt: m.createdAt, body: m.body, readByPartnerAt: m.readAt })),
        receivedMessages: c._count.messages,
      })),
      blockedPersons: blocks.map((b) => ({ displayName: name(b.blocked), blockedAt: b.createdAt })),
      reportsMade: reports.map((r) => ({
        target: r.targetType === 'LISTING' ? `Inserat „${r.listing?.title ?? 'gelöscht'}“` : 'Unterhaltung',
        reason: REPORT_REASON_LABELS[r.reason],
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
      })),
      moderationDecisions: decisions.map((d) => ({
        action: MODERATION_ACTION_LABELS[d.action],
        listing: d.listing?.title ?? null,
        reason: d.reason ? REPORT_REASON_LABELS[d.reason] : null,
        ground: d.ground,
        statement: d.statement,
        createdAt: d.createdAt,
        appeal: d.appeal ? { body: d.appeal.body, status: d.appeal.status, response: d.appeal.response, createdAt: d.appeal.createdAt, decidedAt: d.appeal.decidedAt } : null,
      })),
      notifications: notifications.map((n) => ({ title: n.title, body: n.body, createdAt: n.createdAt, readAt: n.readAt })),
      activity: activity.map((a) => ({ action: a.action, at: a.createdAt, ipPrefix: a.ipPrefix })),
    };
  }
}
