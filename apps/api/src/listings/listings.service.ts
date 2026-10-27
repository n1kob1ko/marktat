import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  carryOverAttributes,
  categoryAttributeSchema,
  DEFAULT_LISTING_DURATION_DAYS,
  listingPublishSchema,
  missingRequiredAttributes,
  parseListingAttributes,
  slugify,
  type AttributeIssue,
  type CategoryAttributeSchema,
  type CreateListingInput,
  type ItemCondition,
  type ListingAttributes,
  type ListingStatus,
  type PriceType,
  type ListingSummary,
  type UpdateListingInput,
} from '@marktat/shared';
import type { Category, Listing } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { ImageUrls } from '../images/image-urls.js';
import { SearchIndexService } from '../search/search-index.service.js';
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
    private readonly urls: ImageUrls,
    private readonly searchIndex: SearchIndexService,
  ) {}

  async create(user: AuthUser, input: CreateListingInput, ip?: string) {
    const { publish, ...fields } = input;
    const category = fields.categoryId ? await this.requireCategory(fields.categoryId, publish) : null;
    if (fields.locationId) await this.requireLocation(fields.locationId);
    const schema = categoryAttributeSchema(category?.path);
    const attributes = this.parseAttributes(schema, fields.attributes ?? {});
    const condition = this.conditionFor(schema, fields.condition);
    const price = this.pricingFor(schema, fields.priceType, fields.priceCents);
    if (publish) this.assertComplete({ ...fields, ...price, attributes: undefined }, schema, attributes);

    const now = new Date();
    const listing = await this.prisma.listing.create({
      data: {
        sellerId: user.id,
        title: fields.title,
        slug: slugify(fields.title),
        description: fields.description ?? '',
        categoryId: category?.id ?? null,
        vertical: category?.vertical ?? 'MARKETPLACE',
        priceType: price.priceType,
        priceCents: this.toBigInt(price.priceCents),
        condition,
        locationId: fields.locationId ?? null,
        attributes,
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
    this.searchIndex.sync(listing.id);
    return toListingDetail(listing, this.urls, user.id);
  }

  async update(user: AuthUser, id: string, input: UpdateListingInput) {
    const current = await this.requireOwned(user, id);
    const isLive = current.status === 'ACTIVE' || current.status === 'PAUSED';
    const categoryChanged = input.categoryId !== undefined && input.categoryId !== current.categoryId;
    const category = categoryChanged ? await this.requireCategory(input.categoryId!, isLive) : await this.currentCategory(current);
    if (input.locationId) await this.requireLocation(input.locationId);
    const schema = categoryAttributeSchema(category?.path);

    // Zusatzangaben: übermittelte Werte ersetzen die gespeicherten vollständig. Beim Kategoriewechsel
    // ohne neue Werte bleiben nur Angaben, die auch in der neuen Kategorie existieren.
    let attributes: ListingAttributes | undefined;
    if (input.attributes !== undefined) attributes = this.parseAttributes(schema, input.attributes);
    else if (categoryChanged) attributes = carryOverAttributes(schema, current.attributes);

    let condition: ItemCondition | null | undefined;
    if (input.condition !== undefined) condition = this.conditionFor(schema, input.condition);
    else if (categoryChanged && !schema.itemCondition) condition = null;

    const stored = this.editableFields(current);
    const priceChanged = input.priceType !== undefined || input.priceCents !== undefined || categoryChanged;
    const price = this.pricingFor(schema, input.priceType ?? stored.priceType, input.priceCents !== undefined ? input.priceCents : stored.priceCents);
    const { attributes: _attributes, ...changes } = input;
    const merged = { ...stored, ...changes, ...price };
    // Aktive Inserate müssen nach jeder Änderung vollständig bleiben.
    if (isLive) this.assertComplete(merged, schema, attributes ?? carryOverAttributes(schema, current.attributes));

    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title, slug: slugify(input.title) } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(categoryChanged ? { categoryId: category!.id, vertical: category!.vertical } : {}),
        ...(priceChanged ? { priceType: price.priceType, priceCents: this.toBigInt(price.priceCents) } : {}),
        ...(condition !== undefined ? { condition } : {}),
        ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
        ...(attributes !== undefined ? { attributes } : {}),
      },
      include: listingInclude,
    });
    this.searchIndex.sync(id);
    return toListingDetail(updated, this.urls, user.id);
  }

  /** Entwurf oder abgelaufenes Inserat veröffentlichen bzw. verlängern. */
  async publish(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    const status = effectiveStatus(current);
    if (!['DRAFT', 'EXPIRED', 'ACTIVE'].includes(status)) {
      throw new ConflictException('Dieses Inserat kann nicht veröffentlicht werden.');
    }
    const fields = this.editableFields(current);
    const category = fields.categoryId ? await this.requireCategory(fields.categoryId, true) : null;
    const schema = categoryAttributeSchema(category?.path);
    // Altbestand: nicht (mehr) passende Angaben fallen weg, fehlende Pflichtangaben werden gemeldet.
    const attributes = carryOverAttributes(schema, current.attributes);
    this.assertComplete(fields, schema, attributes);
    const now = new Date();
    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        attributes,
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
    this.searchIndex.sync(id);
    return toListingDetail(updated, this.urls, user.id);
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
    this.searchIndex.sync(id);
  }

  async findMine(user: AuthUser): Promise<ListingSummary[]> {
    const rows = await this.prisma.listing.findMany({
      where: { sellerId: user.id, status: { not: 'DELETED' } },
      include: listingInclude,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => toListingSummary(row, this.urls));
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
    return toListingDetail(listing, this.urls, viewer?.id, await this.viewerState(listing.id, viewer));
  }

  // --- Hilfsfunktionen -------------------------------------------------------

  /** Merkliste und bestehende Unterhaltung der angemeldeten Person zu diesem Inserat */
  private async viewerState(listingId: string, viewer?: AuthUser) {
    if (!viewer) return undefined;
    const [favorite, conversation] = await Promise.all([
      this.prisma.favorite.findUnique({ where: { userId_listingId: { userId: viewer.id, listingId } }, select: { listingId: true } }),
      this.prisma.conversation.findUnique({ where: { listingId_buyerId: { listingId, buyerId: viewer.id } }, select: { id: true } }),
    ]);
    return { isFavorite: Boolean(favorite), conversationId: conversation?.id ?? null };
  }

  private async setStatus(user: AuthUser, id: string, status: ListingStatus, action: 'listing.paused' | 'listing.resumed', ip?: string) {
    const updated = await this.prisma.listing.update({ where: { id }, data: { status }, include: listingInclude });
    this.audit.log({ action, actorId: user.id, entityType: 'listing', entityId: id, ip });
    this.searchIndex.sync(id);
    return toListingDetail(updated, this.urls, user.id);
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

  /** Kategorie eines bestehenden Inserats – auch wenn sie inzwischen deaktiviert wurde. */
  private async currentCategory(listing: Listing): Promise<Category | null> {
    if (!listing.categoryId) return null;
    return (await this.categories.findActive(listing.categoryId)) ?? this.prisma.category.findUnique({ where: { id: listing.categoryId } });
  }

  private parseAttributes(schema: CategoryAttributeSchema, input: Record<string, unknown>) {
    const { attributes, issues } = parseListingAttributes(schema, input);
    if (issues.length) this.fail('Bitte prüfe die Zusatzangaben.', issues);
    return attributes;
  }

  /** Der Artikelzustand (Neu, Gut …) gehört nur zu Waren, nicht zu Autos, Wohnungen oder Jobs. */
  private conditionFor(schema: CategoryAttributeSchema, condition: ItemCondition | null | undefined): ItemCondition | null {
    if (!condition) return null;
    if (!schema.itemCondition) {
      this.fail('Bitte prüfe die Zusatzangaben.', [{ path: 'condition', message: 'Für diese Kategorie gibt es keine Zustandsangabe.' }]);
    }
    return condition;
  }

  /** Jobs haben keinen Preis (das Gehalt steht in den Zusatzangaben), sonst gilt der Preis nur bei Fix/VB. */
  private pricingFor(schema: CategoryAttributeSchema, priceType: PriceType | null | undefined, priceCents: number | null | undefined) {
    if (schema.price === 'none') return { priceType: 'ON_REQUEST' as const, priceCents: null };
    const needsPrice = priceType === 'FIXED' || priceType === 'NEGOTIABLE';
    return { priceType: priceType ?? null, priceCents: needsPrice ? (priceCents ?? null) : null };
  }

  private toBigInt(cents: number | null) {
    return cents === null ? null : BigInt(cents);
  }

  private fail(message: string, errors: AttributeIssue[]): never {
    throw new BadRequestException({ statusCode: 400, message, errors });
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
    };
  }

  /** Vollständigkeit fürs Veröffentlichen: allgemeine Felder und Pflichtangaben der Kategorie, alle Fehler auf einmal. */
  private assertComplete(fields: Record<string, unknown>, schema: CategoryAttributeSchema, attributes: ListingAttributes) {
    const result = listingPublishSchema.safeParse(fields);
    const errors: AttributeIssue[] = result.success
      ? []
      : result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    errors.push(...missingRequiredAttributes(schema, attributes));
    if (errors.length) this.fail('Das Inserat ist noch nicht vollständig.', errors);
  }
}
