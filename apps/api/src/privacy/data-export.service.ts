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
    const [profile, listings, favorites, savedSearches, conversations, blocks, reports, decisions, notifications, activity, bookings] = await Promise.all([
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
          serviceProfile: { select: { id: true, headline: true } },
          project: { select: { id: true, title: true } },
          buyer: { select: { displayName: true, status: true } },
          seller: { select: { displayName: true, status: true } },
          messages: { where: { senderId: id }, orderBy: { createdAt: 'asc' }, select: { body: true, createdAt: true, readAt: true } },
          _count: { select: { messages: { where: { recipientId: id } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.userBlock.findMany({ where: { blockerId: id }, include: { blocked: { select: { displayName: true, status: true } } } }),
      this.prisma.report.findMany({ where: { reporterId: id }, select: { targetType: true, reason: true, details: true, status: true, createdAt: true, listing: { select: { title: true } }, deal: { select: { title: true } }, serviceProfile: { select: { headline: true } }, project: { select: { title: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.moderationDecision.findMany({ where: { userId: id }, include: { appeal: true, listing: { select: { title: true } }, deal: { select: { title: true } }, serviceProfile: { select: { headline: true } }, project: { select: { title: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.notification.findMany({ where: { userId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.auditLog.findMany({ where: { actorId: id }, select: { action: true, createdAt: true, ipPrefix: true }, orderBy: { createdAt: 'desc' }, take: ACTIVITY_LIMIT }),
      this.prisma.booking.findMany({
        where: { userId: id },
        include: { product: { select: { code: true, name: true } }, listing: { select: { title: true } }, payment: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    // Händlerbereich und Dienstleistungen (Phase 10): Deals, Filialen, Produktfeeds, Anbieterprofil, Projektaufträge
    const [deals, stores, feeds, serviceProfile, projects, dealFavorites, serviceFavorites] = await Promise.all([
      this.prisma.deal.findMany({
        where: { merchantId: id, status: { not: 'DELETED' } },
        include: { category: { select: { name: true } }, priceRecords: { select: { priceCents: true, recordedAt: true }, orderBy: { recordedAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.dealerStore.findMany({ where: { merchantId: id, deletedAt: null }, include: { location: { select: { postalCode: true, place: true } } } }),
      this.prisma.dealFeed.findMany({ where: { merchantId: id, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.prisma.serviceProfile.findFirst({
        where: { userId: id, status: { not: 'DELETED' } },
        include: {
          categories: { include: { category: { select: { name: true } } } },
          location: { select: { postalCode: true, place: true } },
          portfolio: { include: { category: { select: { name: true } } }, orderBy: { sortOrder: 'asc' } },
          qualifications: { orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.serviceProject.findMany({
        where: { userId: id, status: { not: 'DELETED' } },
        include: { category: { select: { name: true } }, location: { select: { postalCode: true, place: true } }, _count: { select: { conversations: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.dealFavorite.findMany({ where: { userId: id }, include: { deal: { select: { title: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.serviceFavorite.findMany({ where: { userId: id }, include: { profile: { select: { headline: true } } }, orderBy: { createdAt: 'asc' } }),
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
        website: profile.website,
        showPhone: profile.showPhone,
        hasLogo: Boolean(profile.logoKey),
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
      dealFavorites: dealFavorites.map((f) => ({ dealId: f.dealId, title: f.deal.title, savedAt: f.createdAt })),
      serviceFavorites: serviceFavorites.map((f) => ({ profileId: f.profileId, headline: f.profile.headline, savedAt: f.createdAt })),
      savedSearches: savedSearches.map((s) => ({ kind: s.kind, name: s.name, params: s.params, labels: s.labels, notify: s.notify, createdAt: s.createdAt })),
      conversations: conversations.map((c) => ({
        id: c.id,
        listing: c.listing,
        serviceProfile: c.serviceProfile ? { id: c.serviceProfile.id, headline: c.serviceProfile.headline } : null,
        project: c.project ? { id: c.project.id, title: c.project.title } : null,
        myRole: c.buyerId === id ? 'Interessent' : 'Anbieter',
        partner: name(c.buyerId === id ? c.seller : c.buyer),
        startedAt: c.createdAt,
        myMessages: c.messages.map((m) => ({ sentAt: m.createdAt, body: m.body, readByPartnerAt: m.readAt })),
        receivedMessages: c._count.messages,
      })),
      blockedPersons: blocks.map((b) => ({ displayName: name(b.blocked), blockedAt: b.createdAt })),
      reportsMade: reports.map((r) => ({
        target:
          r.targetType === 'LISTING'
            ? `Inserat „${r.listing?.title ?? 'gelöscht'}“`
            : r.targetType === 'DEAL'
              ? `Angebot „${r.deal?.title ?? 'gelöscht'}“`
              : r.targetType === 'SERVICE_PROFILE'
                ? `Anbieterprofil „${r.serviceProfile?.headline ?? 'gelöscht'}“`
                : r.targetType === 'PROJECT'
                  ? `Projektauftrag „${r.project?.title ?? 'gelöscht'}“`
                  : 'Unterhaltung',
        reason: REPORT_REASON_LABELS[r.reason],
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
      })),
      moderationDecisions: decisions.map((d) => ({
        action: MODERATION_ACTION_LABELS[d.action],
        listing: d.listing?.title ?? null,
        deal: d.deal?.title ?? null,
        serviceProfile: d.serviceProfile?.headline ?? null,
        project: d.project?.title ?? null,
        reason: d.reason ? REPORT_REASON_LABELS[d.reason] : null,
        ground: d.ground,
        statement: d.statement,
        createdAt: d.createdAt,
        appeal: d.appeal ? { body: d.appeal.body, status: d.appeal.status, response: d.appeal.response, createdAt: d.appeal.createdAt, decidedAt: d.appeal.decidedAt } : null,
      })),
      notifications: notifications.map((n) => ({ title: n.title, body: n.body, createdAt: n.createdAt, readAt: n.readAt })),
      activity: activity.map((a) => ({ action: a.action, at: a.createdAt, ipPrefix: a.ipPrefix })),
      deals: deals.map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description,
        category: d.category.name,
        status: d.status,
        channel: d.channel,
        url: d.url,
        priceCents: d.priceCents,
        referencePriceCents: d.referencePriceCents,
        referencePriceType: d.referencePriceType,
        referencePriceSource: d.referencePriceSource,
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        source: d.source,
        externalId: d.externalId,
        createdAt: d.createdAt,
        recordedPrices: d.priceRecords,
      })),
      stores: stores.map((s) => ({ name: s.name, street: s.street, postalCode: s.location.postalCode, place: s.location.place, openingHours: s.openingHours })),
      dealFeeds: feeds.map((f) => ({ name: f.name, url: f.url, format: f.format, status: f.status, licenseNote: f.licenseNote, createdAt: f.createdAt })),
      serviceProfile: serviceProfile
        ? {
            id: serviceProfile.id,
            status: serviceProfile.status,
            headline: serviceProfile.headline,
            summary: serviceProfile.summary,
            description: serviceProfile.description,
            categories: serviceProfile.categories.map((c) => c.category.name),
            skills: serviceProfile.skills,
            location: serviceProfile.location,
            serviceRadiusKm: serviceProfile.serviceRadiusKm,
            austriaWide: serviceProfile.austriaWide,
            remote: serviceProfile.remote,
            priceType: serviceProfile.priceType,
            priceCents: serviceProfile.priceCents,
            experienceYears: serviceProfile.experienceYears,
            website: serviceProfile.website,
            availability: serviceProfile.availability,
            availabilityNote: serviceProfile.availabilityNote,
            hasImage: Boolean(serviceProfile.imageKey),
            imageRights: serviceProfile.imageRights,
            imageCredit: serviceProfile.imageCredit,
            confirmedAt: serviceProfile.confirmedAt,
            publishedAt: serviceProfile.publishedAt,
            createdAt: serviceProfile.createdAt,
            portfolio: serviceProfile.portfolio.map((p) => ({
              title: p.title,
              description: p.description,
              category: p.category?.name ?? null,
              url: p.url,
              hasImage: Boolean(p.imageKey),
              imageRights: p.imageRights,
              imageCredit: p.imageCredit,
              hiddenByModeration: Boolean(p.hiddenAt),
              createdAt: p.createdAt,
            })),
            qualifications: serviceProfile.qualifications.map((q) => ({ title: q.title, issuer: q.issuer, reference: q.reference, status: q.status, reviewedAt: q.reviewedAt })),
          }
        : null,
      projects: projects.map((p) => ({
        id: p.id,
        status: p.status,
        title: p.title,
        description: p.description,
        category: p.category.name,
        location: p.location,
        remote: p.remote,
        budgetType: p.budgetType,
        budgetCents: p.budgetCents,
        timeframe: p.timeframe,
        publishedAt: p.publishedAt,
        expiresAt: p.expiresAt,
        closedAt: p.closedAt,
        receivedContacts: p._count.conversations,
        createdAt: p.createdAt,
      })),
      bookings: bookings.map((b) => ({
        product: b.product.name,
        listing: b.listing?.title ?? null,
        status: b.status,
        priceCents: b.priceCents,
        currency: b.currency,
        billingMode: b.billingMode,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        createdAt: b.createdAt,
        payment: b.payment
          ? { status: b.payment.status, amountCents: b.payment.amountCents, refundedCents: b.payment.refundedCents, paidAt: b.payment.paidAt, invoiceNumber: b.payment.invoiceNumber }
          : null,
      })),
    };
  }
}
