import { ForbiddenException, Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import type { DealerDashboard, ListingStats } from '@marktat/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { loadEnv, signingSecret } from '../config/env.js';
import { hmac } from '../common/signing.js';
import type { AuthUser } from '../auth/auth.types.js';
import { effectiveStatus } from '../listings/listings.mapper.js';
import { BookingsService } from '../billing/bookings.service.js';
import { MemoryViewDedupe, RedisViewDedupe, type ViewDedupe } from './view-dedupe.js';

/**
 * Derselbe Besucher zählt je Inserat höchstens einmal pro (Wiener) Kalendertag: der Schlüssel enthält den Tag,
 * die Gültigkeit deckt den längsten Tag (25 h bei der Zeitumstellung) sicher ab.
 */
export const VIEW_DEDUPE_SECONDS = 26 * 3600;
const STATS_DAYS = 30;
const DAY_MS = 86_400_000;

const viennaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Kalendertag in Wien als YYYY-MM-DD */
export const dayOf = (date: Date) => viennaDay.format(date);

/**
 * Inseratsstatistiken. Gezählt werden Aufrufe der Detailseite, die der Browser meldet – ohne eigene Aufrufe,
 * ohne Team, ohne erkennbare Bots (prüft das Web) und je Besucher höchstens einmal in 6 Stunden. Es werden nur
 * Tagessummen gespeichert, keine IPs oder Besucherkennungen.
 */
@Injectable()
export class ListingStatsService implements OnModuleDestroy {
  private readonly dedupe: ViewDedupe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
  ) {
    const env = loadEnv();
    this.dedupe = env.REDIS_URL && env.NODE_ENV !== 'test' ? new RedisViewDedupe(env.REDIS_URL, env.QUEUE_PREFIX) : new MemoryViewDedupe();
  }

  async onModuleDestroy() {
    await this.dedupe.close();
  }

  async recordView(listingId: string, visitor: string, viewer?: AuthUser, now = new Date()): Promise<{ counted: boolean }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true, status: true, expiresAt: true, deletedAt: true, seller: { select: { status: true, deletedAt: true } } },
    });
    if (!listing || listing.deletedAt || effectiveStatus(listing, now) !== 'ACTIVE' || listing.seller.status !== 'ACTIVE' || listing.seller.deletedAt) {
      return { counted: false };
    }
    if (viewer && (viewer.id === listing.sellerId || viewer.role !== 'USER')) return { counted: false };
    // Pseudonym und tageweise wechselnd: aus dem Schlüssel lässt sich weder IP noch Person ableiten
    const who = viewer ? `u:${viewer.id}` : `v:${visitor}`;
    const key = hmac(signingSecret(loadEnv()), `${listingId}:${who}:${dayOf(now)}`).slice(0, 40);
    if (!(await this.dedupe.firstSeen(key, VIEW_DEDUPE_SECONDS))) return { counted: false };
    const day = dayOf(now);
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        INSERT INTO listing_view_days (listing_id, day, views) VALUES (${listingId}, ${day}::date, 1)
        ON CONFLICT (listing_id, day) DO UPDATE SET views = listing_view_days.views + 1`,
      // Rohes SQL: updatedAt bleibt (ein Aufruf ist keine Änderung des Inserats)
      this.prisma.$executeRaw`UPDATE listings SET view_count = view_count + 1 WHERE id = ${listingId}`,
    ]);
    return { counted: true };
  }

  async listingStats(user: AuthUser, listingId: string, now = new Date()): Promise<ListingStats> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    const isStaff = user.role === 'ADMIN' || user.role === 'MODERATOR';
    if (!listing || listing.status === 'DELETED' || (listing.sellerId !== user.id && !isStaff)) throw new NotFoundException('Dieses Inserat gibt es nicht.');

    const since = new Date(now.getTime() - (STATS_DAYS - 1) * DAY_MS);
    const [days, first, favorites, inquiries, interested] = await Promise.all([
      this.prisma.listingViewDay.findMany({ where: { listingId, day: { gte: new Date(`${dayOf(since)}T00:00:00Z`) } }, orderBy: { day: 'asc' } }),
      this.prisma.listingViewDay.findFirst({ where: { listingId }, orderBy: { day: 'asc' }, select: { day: true } }),
      this.prisma.favorite.count({ where: { listingId } }),
      this.prisma.conversation.count({ where: { listingId } }),
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM (
          SELECT user_id AS id FROM favorites WHERE listing_id = ${listingId}
          UNION SELECT buyer_id AS id FROM conversations WHERE listing_id = ${listingId}
        ) people`,
    ]);
    const byDay = new Map(days.map((d) => [d.day.toISOString().slice(0, 10), d.views]));
    const viewsByDay = Array.from({ length: STATS_DAYS }, (_, i) => {
      const day = dayOf(new Date(since.getTime() + i * DAY_MS));
      return { day, views: byDay.get(day) ?? 0 };
    });
    const activePromotions: ListingStats['activePromotions'] = [];
    if (listing.highlightedUntil && listing.highlightedUntil > now) {
      activePromotions.push({ code: 'highlight', name: 'Hervorhebung', endsAt: listing.highlightedUntil.toISOString() });
    }
    if (listing.topUntil && listing.topUntil > now) activePromotions.push({ code: 'top', name: 'Top-Anzeige', endsAt: listing.topUntil.toISOString() });
    return {
      listingId,
      title: listing.title,
      status: effectiveStatus(listing, now),
      createdAt: listing.createdAt.toISOString(),
      publishedAt: listing.publishedAt?.toISOString() ?? null,
      expiresAt: listing.expiresAt?.toISOString() ?? null,
      bumpedAt: listing.bumpedAt?.toISOString() ?? null,
      totalViews: listing.viewCount,
      viewsByDay,
      favorites,
      interestedPeople: Number(interested[0]?.n ?? 0),
      inquiries,
      activePromotions,
      countingSince: first ? first.day.toISOString().slice(0, 10) : null,
    };
  }

  async dealerDashboard(user: AuthUser, now = new Date()): Promise<DealerDashboard> {
    if (user.accountType !== 'BUSINESS') throw new ForbiddenException('Das Händler-Dashboard gibt es für gewerbliche Konten.');
    const sellerId = user.id;
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const [profile, listings, views30d, favorites, inquiries, inquiries30d, bumps30d, usage] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: sellerId } }),
      this.prisma.listing.findMany({
        where: { sellerId, status: { not: 'DELETED' } },
        select: { id: true, title: true, status: true, expiresAt: true, viewCount: true, highlightedUntil: true, topUntil: true, _count: { select: { favorites: true, conversations: true } } },
      }),
      this.prisma.$queryRaw<{ n: bigint | null }[]>`
        SELECT sum(v.views) AS n FROM listing_view_days v JOIN listings l ON l.id = v.listing_id
        WHERE l.seller_id = ${sellerId}::uuid AND v.day >= ${dayOf(monthAgo)}::date`,
      this.prisma.favorite.count({ where: { listing: { sellerId } } }),
      this.prisma.conversation.count({ where: { sellerId } }),
      this.prisma.conversation.count({ where: { sellerId, createdAt: { gt: monthAgo } } }),
      this.prisma.booking.count({ where: { userId: sellerId, kind: 'BUMP', createdAt: { gt: monthAgo }, status: 'COMPLETED' } }),
      this.bookings.usage(sellerId, now),
    ]);
    const counts = { active: 0, paused: 0, expired: 0, drafts: 0, other: 0 };
    for (const listing of listings) {
      const status = effectiveStatus(listing, now);
      if (status === 'ACTIVE') counts.active++;
      else if (status === 'PAUSED') counts.paused++;
      else if (status === 'EXPIRED') counts.expired++;
      else if (status === 'DRAFT') counts.drafts++;
      else counts.other++;
    }
    const missing: string[] = [];
    if (!profile.companyName) missing.push('Firmenname');
    if (!profile.companyAddress) missing.push('Geschäftssitz');
    if (!profile.companyRegisterNumber && !profile.vatId) missing.push('Firmenbuchnummer oder UID');
    if (!profile.bio) missing.push('Beschreibung');
    if (!profile.logoKey) missing.push('Logo');
    return {
      listings: counts,
      views30d: Number(views30d[0]?.n ?? 0),
      totalViews: listings.reduce((sum, l) => sum + l.viewCount, 0),
      favorites,
      inquiries,
      inquiries30d,
      activeTop: listings.filter((l) => l.topUntil && l.topUntil > now).length,
      activeHighlights: listings.filter((l) => l.highlightedUntil && l.highlightedUntil > now).length,
      bumps30d,
      usage,
      topListings: [...listings]
        .sort((a, b) => b.viewCount - a.viewCount || b._count.favorites - a._count.favorites)
        .slice(0, 5)
        .map((l) => ({ id: l.id, title: l.title, views: l.viewCount, favorites: l._count.favorites, inquiries: l._count.conversations })),
      profileComplete: missing.length === 0,
      missingProfileFields: missing,
    };
  }
}
