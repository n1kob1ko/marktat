import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  carryOverAttributes,
  categoryAttributeSchema,
  formatAmountCents,
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
import { Prisma, type Category, type Listing } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { ImageUrls } from '../images/image-urls.js';
import { SearchIndexService } from '../search/search-index.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { BookingsService } from '../billing/bookings.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  effectiveStatus,
  listingInclude,
  toListingDetail,
  toListingSummary,
} from './listings.mapper.js';

const DAY_MS = 86_400_000;

/** Ablaufdatum aus der Laufzeit des Produkts „listing“ (Admin-Bereich, Standard 60 Tage) */
function expiryFrom(date: Date, durationDays: number) {
  return new Date(date.getTime() + durationDays * DAY_MS);
}

/** Status, aus denen ein Inserat veröffentlicht bzw. verlängert werden kann */
const PUBLISHABLE: ListingStatus[] = ['DRAFT', 'EXPIRED', 'ACTIVE'];

@Injectable()
export class ListingsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
    private readonly urls: ImageUrls,
    private readonly searchIndex: SearchIndexService,
    private readonly moderation: ModerationService,
    private readonly bookings: BookingsService,
  ) {}

  /** Bezahltes Veröffentlichen (nur im kostenpflichtigen Betrieb) läuft über die Buchungen. */
  onModuleInit() {
    this.bookings.registerListingHandler({
      assertPublishable: async (userId, listingId) => {
        const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
        if (!listing || listing.sellerId !== userId || listing.status === 'DELETED') throw new NotFoundException('Dieses Inserat gibt es nicht.');
        if (!PUBLISHABLE.includes(effectiveStatus(listing))) throw new ConflictException('Dieses Inserat kann nicht veröffentlicht werden.');
        await this.assertPublishable(listing);
      },
      activate: async (tx, listingId, durationDays, now) => {
        const expiresAt = expiryFrom(now, durationDays);
        const current = await tx.listing.findUniqueOrThrow({ where: { id: listingId } });
        await tx.listing.updateMany({
          where: { id: listingId, status: { in: ['DRAFT', 'EXPIRED', 'ACTIVE'] } },
          data: { status: 'ACTIVE', publishedAt: current.publishedAt ?? now, expiresAt },
        });
        return expiresAt;
      },
    });
  }

  /**
   * Bedingungen fürs Veröffentlichen. Im kostenlosen Betrieb (Standard) immer 0,00 €; ist das Inserat
   * kostenpflichtig, geht Veröffentlichen nur über eine Buchung mit Zahlung (402).
   */
  private async listingTerms(user: AuthUser) {
    const terms = await this.bookings.listingTerms(user);
    if (terms.price.requiresPayment) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message: `Das Veröffentlichen kostet derzeit ${formatAmountCents(terms.price.priceCents)}. Speichere das Inserat als Entwurf und buche es unter „Meine Anzeigen“.`,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return terms;
  }

  private recordFreeListing(tx: Prisma.TransactionClient, user: AuthUser, listingId: string, terms: Awaited<ReturnType<ListingsService['listingTerms']>>, now: Date, endsAt: Date) {
    return this.bookings.recordFreeListing(tx, { userId: user.id, listingId, product: terms.product, mode: terms.mode, startsAt: now, endsAt });
  }

  async create(user: AuthUser, input: CreateListingInput, ip?: string) {
    const { publish, clientRequestId, ...fields } = input;
    // Formular erneut abgeschickt (Doppelklick, Verbindungsabbruch): das schon angelegte Inserat zurückgeben
    const previous = await this.previousCreate(user, clientRequestId);
    if (previous) return previous;
    const category = fields.categoryId ? await this.requireCategory(fields.categoryId, publish) : null;
    if (fields.locationId) await this.requireLocation(fields.locationId);
    const schema = categoryAttributeSchema(category?.path);
    const attributes = this.parseAttributes(schema, fields.attributes ?? {});
    const condition = this.conditionFor(schema, fields.condition);
    const price = this.pricingFor(schema, fields.priceType, fields.priceCents);
    if (publish) this.assertComplete({ ...fields, ...price, attributes: undefined }, schema, attributes);
    const terms = publish ? await this.listingTerms(user) : null;

    const now = new Date();
    const expiresAt = terms ? expiryFrom(now, terms.durationDays) : null;
    let listing: Prisma.ListingGetPayload<{ include: typeof listingInclude }>;
    try {
      listing = await this.prisma.$transaction(async (tx) => {
        const created = await tx.listing.create({
          data: {
            sellerId: user.id,
            clientRequestId,
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
            expiresAt,
          },
          include: listingInclude,
        });
        if (terms && expiresAt) await this.recordFreeListing(tx, user, created.id, terms, now, expiresAt);
        return created;
      });
    } catch (error) {
      // Gleichzeitig doppelt abgeschickt: Die andere Anfrage hat das Inserat schon angelegt
      const raced = clientRequestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
        ? await this.previousCreate(user, clientRequestId)
        : null;
      if (raced) return raced;
      throw error;
    }
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

  private async previousCreate(user: AuthUser, clientRequestId?: string) {
    if (!clientRequestId) return null;
    const listing = await this.prisma.listing.findFirst({
      where: { sellerId: user.id, clientRequestId, deletedAt: null },
      include: listingInclude,
    });
    return listing ? toListingDetail(listing, this.urls, user.id) : null;
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
    if (!PUBLISHABLE.includes(status)) {
      throw new ConflictException('Dieses Inserat kann nicht veröffentlicht werden.');
    }
    const attributes = await this.assertPublishable(current);
    const terms = await this.listingTerms(user);
    const now = new Date();
    const expiresAt = expiryFrom(now, terms.durationDays);
    // Nur aus dem geprüften Status heraus: eine gleichzeitige Moderationsentscheidung darf nicht überschrieben werden
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.listing.updateMany({
        where: { id, status: current.status },
        data: {
          attributes,
          status: 'ACTIVE',
          publishedAt: status === 'DRAFT' || !current.publishedAt ? now : current.publishedAt,
          expiresAt,
        },
      });
      if (changed.count === 0) throw new ConflictException('Der Status des Inserats hat sich inzwischen geändert. Bitte lade die Seite neu.');
      await this.recordFreeListing(tx, user, id, terms, now, expiresAt);
    });
    const updated = await this.prisma.listing.findUniqueOrThrow({ where: { id }, include: listingInclude });
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
    return this.setStatus(user, id, 'ACTIVE', 'PAUSED', 'listing.paused', ip);
  }

  async resume(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (current.status !== 'PAUSED') {
      throw new ConflictException('Nur pausierte Inserate können fortgesetzt werden.');
    }
    if (current.expiresAt && current.expiresAt <= new Date()) {
      throw new ConflictException('Das Inserat ist abgelaufen. Bitte verlängere es.');
    }
    return this.setStatus(user, id, 'PAUSED', 'ACTIVE', 'listing.resumed', ip);
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
    return rows.map((row) => {
      const summary = toListingSummary(row, this.urls);
      summary.promotionsUntil = {
        highlighted: summary.highlighted ? row.highlightedUntil!.toISOString() : null,
        top: summary.top ? row.topUntil!.toISOString() : null,
      };
      return summary;
    });
  }

  /** Öffentlich nur aktive Inserate; Entwürfe usw. sieht ausschließlich der Eigentümer bzw. Moderation. */
  async findOne(id: string, viewer?: AuthUser) {
    const listing = await this.prisma.listing.findUnique({ where: { id }, include: listingInclude });
    if (!listing || listing.status === 'DELETED') throw new NotFoundException('Dieses Inserat gibt es nicht.');
    const isOwner = viewer?.id === listing.sellerId;
    const isStaff = viewer?.role === 'ADMIN' || viewer?.role === 'MODERATOR';
    // Inserate gesperrter oder gelöschter Konten sind wie in der Suche nicht öffentlich
    const sellerActive = listing.seller.status === 'ACTIVE' && !listing.seller.deletedAt;
    if ((effectiveStatus(listing) !== 'ACTIVE' || !sellerActive) && !isOwner && !isStaff) {
      throw new NotFoundException('Dieses Inserat ist nicht mehr verfügbar.');
    }
    const state = await this.viewerState(listing.id, viewer);
    const moderation = isOwner || isStaff ? await this.moderation.listingModerationInfo(listing) : null;
    return toListingDetail(listing, this.urls, viewer?.id, state && { ...state, moderation });
  }

  // --- Hilfsfunktionen -------------------------------------------------------

  /** Vollständigkeit vor dem Veröffentlichen; gibt die bereinigten Zusatzangaben zurück. */
  private async assertPublishable(listing: Listing) {
    const fields = this.editableFields(listing);
    const category = fields.categoryId ? await this.requireCategory(fields.categoryId, true) : null;
    const schema = categoryAttributeSchema(category?.path);
    // Altbestand: nicht (mehr) passende Angaben fallen weg, fehlende Pflichtangaben werden gemeldet.
    const attributes = carryOverAttributes(schema, listing.attributes);
    this.assertComplete(fields, schema, attributes);
    return attributes;
  }

  /** Merkliste und bestehende Unterhaltung der angemeldeten Person zu diesem Inserat */
  private async viewerState(listingId: string, viewer?: AuthUser) {
    if (!viewer) return undefined;
    const [favorite, conversation] = await Promise.all([
      this.prisma.favorite.findUnique({ where: { userId_listingId: { userId: viewer.id, listingId } }, select: { listingId: true } }),
      this.prisma.conversation.findUnique({ where: { listingId_buyerId: { listingId, buyerId: viewer.id } }, select: { id: true } }),
    ]);
    return { isFavorite: Boolean(favorite), conversationId: conversation?.id ?? null };
  }

  /** Statuswechsel nur aus `from` heraus (atomar), damit eine gleichzeitige Moderationsentscheidung gewinnt */
  private async setStatus(
    user: AuthUser,
    id: string,
    from: ListingStatus,
    status: ListingStatus,
    action: 'listing.paused' | 'listing.resumed',
    ip?: string,
  ) {
    const changed = await this.prisma.listing.updateMany({ where: { id, status: from }, data: { status } });
    if (changed.count === 0) throw new ConflictException('Der Status des Inserats hat sich inzwischen geändert. Bitte lade die Seite neu.');
    const updated = await this.prisma.listing.findUniqueOrThrow({ where: { id }, include: listingInclude });
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
