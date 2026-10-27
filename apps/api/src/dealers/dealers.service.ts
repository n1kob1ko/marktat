import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import type { DealerProfile } from '@marktat/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types.js';
import { ImageUrls } from '../images/image-urls.js';
import { listingInclude, toListingSummary } from '../listings/listings.mapper.js';
import { SORTED_AT } from '../search/search-query.js';
import { logoUrl, toMe } from '../users/users.mapper.js';

export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const LOGO_SIZE = 400;
const PAGE_SIZE = 24;

/** Öffentliches Händlerprofil und Logo. Nur aktive, nicht gelöschte gewerbliche Konten haben ein Profil. */
@Injectable()
export class DealersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly urls: ImageUrls,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async profile(id: string, page = 1): Promise<DealerProfile> {
    const dealer = await this.prisma.user.findFirst({ where: { id, accountType: 'BUSINESS', status: 'ACTIVE', deletedAt: null } });
    if (!dealer) throw new NotFoundException('Dieses Händlerprofil gibt es nicht.');
    const now = new Date();
    const where = { sellerId: id, status: 'ACTIVE' as const, deletedAt: null, expiresAt: { gt: now } };
    const [total, ids] = await Promise.all([
      this.prisma.listing.count({ where }),
      // Gleiche Reihenfolge wie „Neueste“ in der Suche (Hochschieben eingeschlossen)
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT l.id FROM listings l
        WHERE l.seller_id = ${id}::uuid AND l.status = 'ACTIVE' AND l.deleted_at IS NULL AND l.expires_at > (now() AT TIME ZONE 'UTC')
        ORDER BY ${SORTED_AT} DESC, l.id COLLATE "C" DESC
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    ]);
    const rows = await this.prisma.listing.findMany({ where: { id: { in: ids.map((r) => r.id) } }, include: listingInclude });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      id: dealer.id,
      companyName: dealer.companyName ?? dealer.displayName,
      displayName: dealer.displayName,
      logoUrl: logoUrl(dealer),
      description: dealer.bio,
      address: dealer.companyAddress,
      website: dealer.website,
      phone: dealer.showPhone ? dealer.phone : null,
      companyRegisterNumber: dealer.companyRegisterNumber,
      vatId: dealer.vatId,
      memberSince: dealer.createdAt.toISOString(),
      activeListings: total,
      listings: {
        items: ids.flatMap(({ id: listingId }) => {
          const row = byId.get(listingId);
          return row ? [toListingSummary(row, this.urls)] : [];
        }),
        page,
        pageSize: PAGE_SIZE,
        total,
      },
    };
  }

  /** Weiterleitung auf das Logo (nur öffentliche Händlerprofile) */
  async logoDownload(id: string) {
    const dealer = await this.prisma.user.findFirst({ where: { id, accountType: 'BUSINESS', status: 'ACTIVE', deletedAt: null }, select: { logoKey: true } });
    if (!dealer?.logoKey) return null;
    return this.storage.presignDownload(dealer.logoKey, 3600);
  }

  /** Logo hochladen: Inhalt wird geprüft, zugeschnitten (max. 400 × 400) und ohne Metadaten als WebP gespeichert. */
  async uploadLogo(user: AuthUser, body: unknown, ip?: string) {
    if (user.accountType !== 'BUSINESS') throw new ForbiddenException('Ein Logo gibt es nur für gewerbliche Konten.');
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('Bitte wähle ein Bild aus.');
    if (body.length > MAX_LOGO_BYTES) throw new BadRequestException('Das Logo darf höchstens 5 MB groß sein.');
    let webp: Buffer;
    try {
      const meta = await sharp(body, { limitInputPixels: 40_000_000 }).metadata();
      if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('format');
      if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 64) throw new Error('size');
      webp = await sharp(body, { limitInputPixels: 40_000_000, failOn: 'error' })
        .rotate()
        .resize({ width: LOGO_SIZE, height: LOGO_SIZE, fit: 'inside', withoutEnlargement: true })
        .toColorspace('srgb')
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Bitte lade ein JPEG-, PNG- oder WebP-Bild mit mindestens 64 × 64 Pixeln hoch.');
    }
    const key = `logos/${user.id}/${randomUUID()}.webp`;
    await this.storage.put(key, webp, 'image/webp', 'public, max-age=31536000, immutable');
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { logoKey: true } });
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { logoKey: key } });
    if (previous.logoKey) await this.storage.deleteMany([previous.logoKey]).catch(() => undefined);
    this.audit.log({ action: 'user.logo_updated', actorId: user.id, entityType: 'user', entityId: user.id, ip });
    return toMe(updated);
  }

  async deleteLogo(user: AuthUser, ip?: string) {
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { logoKey: true } });
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { logoKey: null } });
    if (previous.logoKey) {
      await this.storage.deleteMany([previous.logoKey]).catch(() => undefined);
      this.audit.log({ action: 'user.logo_updated', actorId: user.id, entityType: 'user', entityId: user.id, ip, metadata: { removed: true } });
    }
    return toMe(updated);
  }
}
