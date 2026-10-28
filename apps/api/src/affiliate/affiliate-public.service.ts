import { Injectable, Logger } from '@nestjs/common';
import { AFFILIATE_NETWORK_LABELS, AFFILIATE_URL_MAX_LENGTH, type AffiliatePromotionView } from '@marktat/shared';
import { safeFetch } from '../common/safe-fetch.js';
import { loadEnv } from '../config/env.js';
import { dealVisibilityInclude, isDealPublic } from '../deals/deals.mapper.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AffiliateAdminService } from './affiliate-admin.service.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 3600_000;

/**
 * Öffentliche Teile der Affiliate-Deals. Produktbilder werden nicht kopiert oder verändert, sondern unverändert vom
 * Bildserver des Händlers weitergereicht (Nutzungsrecht laut Programmbedingungen, nur wenn freigegeben) – so sieht
 * der Händler keine IP-Adressen der Besucher, und die Seite lädt keine fremden Inhalte direkt.
 */
@Injectable()
export class AffiliatePublicService {
  private readonly logger = new Logger(AffiliatePublicService.name);
  private readonly cache = new Map<string, { body: Buffer; contentType: string; expires: number }>();
  private cacheBytes = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AffiliateAdminService,
  ) {}

  async promotions(): Promise<AffiliatePromotionView[]> {
    const rows = await this.prisma.affiliatePromotion.findMany({
      where: this.admin.visiblePromotionWhere(),
      include: { program: { select: { name: true, network: true } } },
      orderBy: [{ endsAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 12,
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      terms: row.terms,
      voucherCode: row.voucherCode,
      url: row.url,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      advertiserName: row.program.name,
      networkName: AFFILIATE_NETWORK_LABELS[row.program.network],
    }));
  }

  /** Bild eines sichtbaren Affiliate-Deals, dessen Programm Bilder erlaubt */
  async image(id: string): Promise<{ body: Buffer; contentType: string } | null> {
    if (!ENTITY_ID.test(id)) return null;
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: { ...dealVisibilityInclude, affiliateProgram: { select: { status: true, membership: true, allowImages: true } } },
    });
    if (!deal || deal.source !== 'AFFILIATE' || !deal.externalImageUrl || !deal.affiliateProgram?.allowImages || !isDealPublic(deal)) return null;
    const url = deal.externalImageUrl;
    const key = `${id}:${url}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached;
    try {
      const response = await safeFetch(url, { maxBytes: IMAGE_MAX_BYTES + 1, timeoutMs: 10_000, maxRedirects: 3, headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8' }, allowPrivate: loadEnv().OUTBOUND_ALLOW_PRIVATE, maxUrlLength: AFFILIATE_URL_MAX_LENGTH });
      const contentType = String(response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (response.status !== 200 || response.truncated || !IMAGE_TYPES.has(contentType) || !response.body.length) return null;
      const entry = { body: response.body, contentType, expires: Date.now() + CACHE_TTL_MS };
      this.remember(key, entry);
      return entry;
    } catch (error) {
      this.logger.debug(`Partnerbild ${id} nicht ladbar: ${(error as Error).message}`);
      return null;
    }
  }

  private remember(key: string, entry: { body: Buffer; contentType: string; expires: number }) {
    this.cache.set(key, entry);
    this.cacheBytes += entry.body.length;
    // Älteste zuerst entfernen (Map behält die Einfügereihenfolge)
    for (const [oldKey, old] of this.cache) {
      if (this.cacheBytes <= CACHE_MAX_BYTES) break;
      this.cache.delete(oldKey);
      this.cacheBytes -= old.body.length;
    }
  }
}
