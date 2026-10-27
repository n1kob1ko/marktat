import { Injectable } from '@nestjs/common';
import type { SitemapEntries } from '@marktat/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { publiclyVisibleWhere } from '../listings/visibility.js';

/** Google verarbeitet höchstens 50 000 Adressen je Sitemap-Datei */
const MAX_LISTINGS = 45_000;

/** Öffentliche Seiten für die Sitemap – nur, was auch ohne Anmeldung sichtbar ist. */
@Injectable()
export class SeoService {
  constructor(private readonly prisma: PrismaService) {}

  async sitemap(): Promise<SitemapEntries> {
    const visible = publiclyVisibleWhere();
    const [listings, dealers, categories] = await Promise.all([
      this.prisma.listing.findMany({
        where: visible,
        select: { id: true, updatedAt: true },
        orderBy: { publishedAt: 'desc' },
        take: MAX_LISTINGS,
      }),
      // Händlerprofile ohne aktive Inserate sind für Suchmaschinen wertlos
      this.prisma.user.findMany({
        where: { accountType: 'BUSINESS', status: 'ACTIVE', deletedAt: null, listings: { some: visible } },
        select: { id: true, updatedAt: true },
        take: 5_000,
      }),
      this.prisma.category.findMany({ select: { path: true } }),
    ]);
    return {
      listings: listings.map((l) => ({ id: l.id, updatedAt: l.updatedAt.toISOString() })),
      dealers: dealers.map((d) => ({ id: d.id, updatedAt: d.updatedAt.toISOString() })),
      categories: categories.map((c) => c.path),
    };
  }
}
