import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_LISTING_DURATION_DAYS,
  listingPublishSchema,
  slugify,
  type CreateListingInput,
  type ListingQuery,
  type ListingStatus,
  type Paginated,
  type ListingSummary,
  type UpdateListingInput,
} from '@marktat/shared';
import type { Listing, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  effectiveStatus,
  listingInclude,
  toListingDetail,
  toListingSummary,
} from './listings.mapper.js';

const DAY_MS = 86_400_000;

function expiryFrom(date: Date) {
  return new Date(date.getTime() + DEFAULT_LISTING_DURATION_DAYS * DAY_MS);
}

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, input: CreateListingInput, ip?: string) {
    const { publish, ...fields } = input;
    const category = fields.categoryId ? await this.requireCategory(fields.categoryId, publish) : null;
    if (fields.locationId) await this.requireLocation(fields.locationId);

    const now = new Date();
    const listing = await this.prisma.listing.create({
      data: {
        sellerId: user.id,
        title: fields.title,
        slug: slugify(fields.title),
        description: fields.description ?? '',
        categoryId: category?.id ?? null,
        vertical: category?.vertical ?? 'MARKETPLACE',
        priceType: fields.priceType ?? null,
        priceCents: this.priceFor(fields.priceType, fields.priceCents),
        condition: fields.condition ?? null,
        locationId: fields.locationId ?? null,
        attributes: fields.attributes ?? {},
        status: publish ? 'ACTIVE' : 'DRAFT',
        publishedAt: publish ? now : null,
        expiresAt: publish ? expiryFrom(now) : null,
      },
      include: listingInclude,
    });
    this.audit.log({
      action: publish ? 'listing.published' : 'listing.created',
      actorId: user.id,
      entityType: 'listing',
      entityId: listing.id,
      ip,
    });
    return toListingDetail(listing, user.id);
  }

  async update(user: AuthUser, id: string, input: UpdateListingInput) {
    const current = await this.requireOwned(user, id);
    if (input.categoryId) await this.requireCategory(input.categoryId, current.status === 'ACTIVE');
    if (input.locationId) await this.requireLocation(input.locationId);

    const merged = { ...this.editableFields(current), ...input };
    // Aktive Inserate müssen nach jeder Änderung vollständig bleiben.
    if (current.status === 'ACTIVE' || current.status === 'PAUSED') {
      this.assertPublishable(merged);
    }
    const priceType = merged.priceType ?? null;
    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title, slug: slugify(input.title) } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.categoryId !== undefined
          ? {
              categoryId: input.categoryId,
              vertical: (await this.categories.findActive(input.categoryId))!.vertical,
            }
          : {}),
        ...(input.priceType !== undefined || input.priceCents !== undefined
          ? { priceType, priceCents: this.priceFor(priceType, merged.priceCents) }
          : {}),
        ...(input.condition !== undefined ? { condition: input.condition } : {}),
        ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
        ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
      },
      include: listingInclude,
    });
    return toListingDetail(updated, user.id);
  }

  /** Entwurf oder abgelaufenes Inserat veröffentlichen bzw. verlängern. */
  async publish(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    const status = effectiveStatus(current);
    if (!['DRAFT', 'EXPIRED', 'ACTIVE'].includes(status)) {
      throw new ConflictException('Dieses Inserat kann nicht veröffentlicht werden.');
    }
    const fields = this.editableFields(current);
    this.assertPublishable(fields);
    await this.requireCategory(fields.categoryId!, true);
    const now = new Date();
    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        publishedAt: status === 'DRAFT' || !current.publishedAt ? now : current.publishedAt,
        expiresAt: expiryFrom(now),
      },
      include: listingInclude,
    });
    this.audit.log({
      action: status === 'DRAFT' ? 'listing.published' : 'listing.renewed',
      actorId: user.id,
      entityType: 'listing',
      entityId: id,
      ip,
    });
    return toListingDetail(updated, user.id);
  }

  async pause(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (effectiveStatus(current) !== 'ACTIVE') {
      throw new ConflictException('Nur aktive Inserate können pausiert werden.');
    }
    return this.setStatus(user, id, 'PAUSED', 'listing.paused', ip);
  }

  async resume(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (current.status !== 'PAUSED') {
      throw new ConflictException('Nur pausierte Inserate können fortgesetzt werden.');
    }
    if (current.expiresAt && current.expiresAt <= new Date()) {
      throw new ConflictException('Das Inserat ist abgelaufen. Bitte verlängere es.');
    }
    return this.setStatus(user, id, 'ACTIVE', 'listing.resumed', ip);
  }

  async remove(user: AuthUser, id: string, ip?: string) {
    await this.requireOwned(user, id);
    await this.prisma.listing.update({
      where: { id },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
    this.audit.log({ action: 'listing.deleted', actorId: user.id, entityType: 'listing', entityId: id, ip });
  }

  async findPublic(query: ListingQuery): Promise<Paginated<ListingSummary>> {
    const where: Prisma.ListingWhereInput = {
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
      deletedAt: null,
      seller: { status: 'ACTIVE' },
    };
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) {
      where.categoryId = { in: await this.categories.subtreeIds(query.categoryId) };
    }
    if (query.vertical) {
      where.vertical = query.vertical;
    }
    if (query.state) {
      where.location = { district: { state: { slug: query.state } } };
    }
    const [total, rows] = await Promise.all([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toListingSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async findMine(user: AuthUser): Promise<ListingSummary[]> {
    const rows = await this.prisma.listing.findMany({
      where: { sellerId: user.id, status: { not: 'DELETED' } },
      include: listingInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toListingSummary);
  }

  /** Öffentlich nur aktive Inserate; Entwürfe usw. sieht ausschließlich der Eigentümer bzw. Moderation. */
  async findOne(id: string, viewer?: AuthUser) {
    const listing = await this.prisma.listing.findUnique({ where: { id }, include: listingInclude });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException('Dieses Inserat gibt es nicht.');
    const isOwner = viewer?.id === listing.sellerId;
    const isStaff = viewer?.role === 'ADMIN' || viewer?.role === 'MODERATOR';
    if (effectiveStatus(listing) !== 'ACTIVE' && !isOwner && !isStaff) {
      throw new NotFoundException('Dieses Inserat ist nicht mehr verfügbar.');
    }
    return toListingDetail(listing, viewer?.id);
  }

  // --- Hilfsfunktionen -------------------------------------------------------

  private async setStatus(user: AuthUser, id: string, status: ListingStatus, action: 'listing.paused' | 'listing.resumed', ip?: string) {
    const updated = await this.prisma.listing.update({ where: { id }, data: { status }, include: listingInclude });
    this.audit.log({ action, actorId: user.id, entityType: 'listing', entityId: id, ip });
    return toListingDetail(updated, user.id);
  }

  /** Eigentümerprüfung serverseitig. Fremde Inserate liefern 404, um ihre Existenz nicht preiszugeben. */
  private async requireOwned(user: AuthUser, id: string): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing || listing.status === 'DELETED' || listing.sellerId !== user.id) {
      throw new NotFoundException('Dieses Inserat gibt es nicht.');
    }
    return listing;
  }

  private async requireCategory(categoryId: string, mustBeLeaf: boolean) {
    const category = await this.categories.findActive(categoryId);
    if (!category) throw new BadRequestException('Die gewählte Kategorie gibt es nicht.');
    if (mustBeLeaf && !(await this.categories.isLeaf(categoryId))) {
      throw new BadRequestException('Bitte wähle eine Unterkategorie.');
    }
    return category;
  }

  private async requireLocation(locationId: number) {
    const exists = await this.prisma.location.count({ where: { id: locationId } });
    if (!exists) throw new BadRequestException('Der gewählte Ort ist unbekannt.');
  }

  private priceFor(priceType: string | null | undefined, priceCents: number | null | undefined) {
    if (priceType === 'FIXED' || priceType === 'NEGOTIABLE') {
      return priceCents === null || priceCents === undefined ? null : BigInt(priceCents);
    }
    return null;
  }

  private editableFields(listing: Listing) {
    return {
      title: listing.title,
      description: listing.description,
      categoryId: listing.categoryId ?? undefined,
      priceType: listing.priceType ?? undefined,
      priceCents: listing.priceCents === null ? null : Number(listing.priceCents),
      condition: listing.condition,
      locationId: listing.locationId ?? undefined,
      attributes: (listing.attributes ?? {}) as Record<string, string | number | boolean>,
    };
  }

  private assertPublishable(fields: Record<string, unknown>) {
    const result = listingPublishSchema.safeParse(fields);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Das Inserat ist noch nicht vollständig.',
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
  }
}
