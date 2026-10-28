import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MAX_FAVORITES, type DealFavoriteItem, type FavoriteItem, type Paginated, type ServiceFavoriteItem } from '@marktat/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { dealInclude, isDealPublic, publicDealWhere, toDealSummary } from '../deals/deals.mapper.js';
import { ImageUrls } from '../images/image-urls.js';
import { MediaUrls } from '../images/media.js';
import { serviceProfileInclude, toServiceProfileSummary } from '../services/services.mapper.js';
import { isServiceProfilePublic, publicServiceProfileWhere } from '../services/visibility.js';
import { listingInclude, toListingSummary } from '../listings/listings.mapper.js';
import { ENTITY_ID, publiclyVisibleWhere } from '../listings/visibility.js';
import { isPubliclyVisible } from '../search/search-document.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PAGE_SIZE = 24;

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: ImageUrls,
    private readonly media: MediaUrls,
  ) {}

  /** Merkliste, neueste zuerst. Nicht mehr verfügbare Inserate bleiben sichtbar (ohne Bild), bis sie entfernt werden. */
  async list(user: AuthUser, page = 1): Promise<Paginated<FavoriteItem>> {
    const where = { userId: user.id };
    const [total, rows] = await Promise.all([
      this.prisma.favorite.count({ where }),
      this.prisma.favorite.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { listingId: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { listing: { include: { ...listingInclude, seller: { select: { ...listingInclude.seller.select, status: true, deletedAt: true } } } } },
      }),
    ]);
    const now = new Date();
    const items = rows.map(({ listing, createdAt }): FavoriteItem => {
      const available = isPubliclyVisible(listing, now);
      const summary = toListingSummary(listing, this.urls);
      // Nicht öffentliche Inserate: keine (signierten) Bild-URLs an Dritte
      if (!available) summary.imageUrl = null;
      return { listing: summary, available, savedAt: createdAt.toISOString() };
    });
    return { items, page, pageSize: PAGE_SIZE, total };
  }

  /** Merken ist idempotent; nur öffentlich sichtbare, fremde Inserate. */
  async add(user: AuthUser, listingId: string): Promise<void> {
    const listing = ENTITY_ID.test(listingId)
      ? await this.prisma.listing.findFirst({ where: { id: listingId, ...publiclyVisibleWhere() }, select: { id: true, sellerId: true } })
      : null;
    if (!listing) throw new NotFoundException('Dieses Inserat ist nicht mehr verfügbar.');
    if (listing.sellerId === user.id) throw new BadRequestException('Eigene Anzeigen kannst du nicht merken.');
    const exists = await this.prisma.favorite.findUnique({ where: { userId_listingId: { userId: user.id, listingId } } });
    if (exists) return;
    if ((await this.prisma.favorite.count({ where: { userId: user.id } })) >= MAX_FAVORITES) {
      throw new BadRequestException(`Deine Merkliste ist voll (höchstens ${MAX_FAVORITES} Anzeigen). Entferne zuerst alte Einträge.`);
    }
    // Doppelte Einträge verhindert der Primärschlüssel; gleichzeitige Klicks sind damit harmlos
    await this.prisma.favorite.createMany({ data: [{ userId: user.id, listingId }], skipDuplicates: true });
  }

  async remove(user: AuthUser, listingId: string): Promise<void> {
    if (!ENTITY_ID.test(listingId)) return;
    await this.prisma.favorite.deleteMany({ where: { userId: user.id, listingId } });
  }

  /** Welche der angegebenen Inserate gemerkt sind und welche der Person selbst gehören (dort kein Herz). */
  async lookup(user: AuthUser, listingIds: string[]): Promise<{ listingIds: string[]; ownListingIds: string[] }> {
    const ids = [...new Set(listingIds)].filter((id) => ENTITY_ID.test(id)).slice(0, 100);
    if (!ids.length) return { listingIds: [], ownListingIds: [] };
    const [favorites, own] = await Promise.all([
      this.prisma.favorite.findMany({ where: { userId: user.id, listingId: { in: ids } }, select: { listingId: true } }),
      this.prisma.listing.findMany({ where: { sellerId: user.id, id: { in: ids } }, select: { id: true } }),
    ]);
    return { listingIds: favorites.map((row) => row.listingId), ownListingIds: own.map((row) => row.id) };
  }

  async isFavorite(userId: string, listingId: string): Promise<boolean> {
    return (await this.prisma.favorite.count({ where: { userId, listingId } })) > 0;
  }
  // --- Deals und Anbieterprofile (Phase 10) --------------------------------------------

  /** Gemerkte Deals; abgelaufene bleiben (ohne Bild) sichtbar, bis sie entfernt werden */
  async listDeals(user: AuthUser, page = 1): Promise<Paginated<DealFavoriteItem>> {
    const where = { userId: user.id, deal: { status: { not: 'DELETED' as const } } };
    const [total, rows] = await Promise.all([
      this.prisma.dealFavorite.count({ where }),
      this.prisma.dealFavorite.findMany({ where, orderBy: [{ createdAt: 'desc' }, { dealId: 'asc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { deal: { include: dealInclude } } }),
    ]);
    const now = new Date();
    const items = rows.map(({ deal, createdAt }): DealFavoriteItem => {
      const available = isDealPublic(deal, now);
      const summary = toDealSummary(deal, this.media, null, now);
      if (!available) summary.imageUrl = null;
      return { deal: summary, available, savedAt: createdAt.toISOString() };
    });
    return { items, page, pageSize: PAGE_SIZE, total };
  }

  async addDeal(user: AuthUser, dealId: string): Promise<void> {
    const deal = ENTITY_ID.test(dealId) ? await this.prisma.deal.findFirst({ where: { id: dealId, ...publicDealWhere() }, select: { id: true, merchantId: true } }) : null;
    if (!deal) throw new NotFoundException('Dieses Angebot ist nicht mehr verfügbar.');
    if (deal.merchantId === user.id) throw new BadRequestException('Eigene Angebote kannst du nicht merken.');
    if (await this.prisma.dealFavorite.findUnique({ where: { userId_dealId: { userId: user.id, dealId } } })) return;
    if ((await this.prisma.dealFavorite.count({ where: { userId: user.id } })) >= MAX_FAVORITES) {
      throw new BadRequestException(`Du hast schon ${MAX_FAVORITES} Deals gemerkt. Entferne zuerst alte Einträge.`);
    }
    await this.prisma.dealFavorite.createMany({ data: [{ userId: user.id, dealId }], skipDuplicates: true });
  }

  async removeDeal(user: AuthUser, dealId: string): Promise<void> {
    if (!ENTITY_ID.test(dealId)) return;
    await this.prisma.dealFavorite.deleteMany({ where: { userId: user.id, dealId } });
  }

  /** Gemerkte Anbieterprofile; pausierte bzw. gesperrte bleiben (ohne Bild) sichtbar, bis sie entfernt werden */
  async listServices(user: AuthUser, page = 1): Promise<Paginated<ServiceFavoriteItem>> {
    const where = { userId: user.id, profile: { status: { not: 'DELETED' as const } } };
    const [total, rows] = await Promise.all([
      this.prisma.serviceFavorite.count({ where }),
      this.prisma.serviceFavorite.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { profileId: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { profile: { include: serviceProfileInclude } },
      }),
    ]);
    const items = rows.map(({ profile, createdAt }): ServiceFavoriteItem => {
      const available = isServiceProfilePublic(profile);
      const summary = toServiceProfileSummary(profile, this.media);
      if (!available) summary.imageUrl = null;
      return { profile: summary, available, savedAt: createdAt.toISOString() };
    });
    return { items, page, pageSize: PAGE_SIZE, total };
  }

  async addService(user: AuthUser, profileId: string): Promise<void> {
    const profile = ENTITY_ID.test(profileId)
      ? await this.prisma.serviceProfile.findFirst({ where: { id: profileId, ...publicServiceProfileWhere() }, select: { id: true, userId: true } })
      : null;
    if (!profile) throw new NotFoundException('Dieses Anbieterprofil ist nicht mehr verfügbar.');
    if (profile.userId === user.id) throw new BadRequestException('Dein eigenes Profil kannst du nicht merken.');
    if (await this.prisma.serviceFavorite.findUnique({ where: { userId_profileId: { userId: user.id, profileId } } })) return;
    if ((await this.prisma.serviceFavorite.count({ where: { userId: user.id } })) >= MAX_FAVORITES) {
      throw new BadRequestException(`Du hast schon ${MAX_FAVORITES} Anbieter gemerkt. Entferne zuerst alte Einträge.`);
    }
    await this.prisma.serviceFavorite.createMany({ data: [{ userId: user.id, profileId }], skipDuplicates: true });
  }

  async removeService(user: AuthUser, profileId: string): Promise<void> {
    if (!ENTITY_ID.test(profileId)) return;
    await this.prisma.serviceFavorite.deleteMany({ where: { userId: user.id, profileId } });
  }
}
