import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MAX_FAVORITES, type FavoriteItem, type Paginated } from '@marktat/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { ImageUrls } from '../images/image-urls.js';
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
}
