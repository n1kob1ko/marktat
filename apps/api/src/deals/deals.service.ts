import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEAL_MAX_DURATION_DAYS,
  dealCategoryBySlug,
  dealEndsAt,
  dealImageRightsSchema,
  dealStartsAt,
  toViennaDay,
  type CreateDealInput,
  type DealCategoryView,
  type DealDetail,
  type DealerEligibility,
  type DealerStoreInput,
  type DealStoreView,
  type ExtendDealInput,
  type MerchantDealOverview,
  type UpdateDealInput,
} from '@marktat/shared';
import { Prisma, type Deal } from '../generated/prisma/client.js';
import type { DealStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { loadEnv } from '../config/env.js';
import { locationInclude, toLocationSummary } from '../geo/geo.service.js';
import { deleteMediaImage, isImageVariant, mediaVariantKey, MediaUrls, storeMediaImage } from '../images/media.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types.js';
import {
  currentDealFields,
  DealFieldError,
  DISCOUNT_REVIEW_REASON,
  needsDiscountReview,
  parseCompleteDeal,
  prepareDeal,
  replaceDealStores,
  RESUBMIT_REVIEW_REASON,
} from './deal-fields.js';
import { DealSearchService } from './deal-search.service.js';
import { dealInclude, isDealPublic, toDealDetail, toMerchantDeal } from './deals.mapper.js';

const DAY_MS = 86_400_000;
/** Höchstzahl gleichzeitig nicht gelöschter Deals je Händler (Schutz vor Massen-Spam; Importe zählen mit) */
export const MAX_DEALS_PER_MERCHANT = 2_000;
export const MAX_STORES_PER_MERCHANT = 200;
const IMAGE_DOWNLOAD_TTL_SECONDS = 3600;

type DealWithStores = Deal & { category: { slug: string }; stores: { storeId: string }[] };

/**
 * Deals gewerblicher Händler: anlegen, bearbeiten, veröffentlichen, pausieren, verlängern, bestätigen, löschen.
 * Nur eigene Deals (fremde ergeben 404), nur für berechtigte Händler (gewerblich, vollständiges Profil,
 * Bestätigung nach Art. 30 DSA, nicht gesperrt).
 */
@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly urls: MediaUrls,
    private readonly search: DealSearchService,
    private readonly moderation: ModerationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // --- Berechtigung ------------------------------------------------------------------

  async eligibility(userId: string): Promise<DealerEligibility> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const missingFields: string[] = [];
    if (!user.companyName) missingFields.push('Firmenname');
    if (!user.companyAddress) missingFields.push('Geschäftsadresse');
    if (!user.phone) missingFields.push('Telefonnummer');
    const business = user.accountType === 'BUSINESS' && user.status === 'ACTIVE' && !user.deletedAt;
    const certified = Boolean(user.dealerCertifiedAt);
    const blocked = Boolean(user.dealsBlockedAt);
    return { business, missingFields, certified, blocked, eligible: business && !missingFields.length && certified && !blocked };
  }

  /** Veröffentlichen nur für berechtigte Händler; Entwürfe dürfen gewerbliche Konten immer speichern. */
  private async requireDealer(user: AuthUser, forPublishing: boolean) {
    if (user.accountType !== 'BUSINESS') throw new ForbiddenException('Deals können nur gewerbliche Konten anlegen.');
    if (!forPublishing) return;
    const eligibility = await this.eligibility(user.id);
    if (eligibility.blocked) throw new ForbiddenException('Dein Konto ist für Deals gesperrt. Bei Fragen wende dich an unser Team.');
    if (eligibility.missingFields.length) {
      throw new ForbiddenException(`Bitte ergänze zuerst dein Händlerprofil: ${eligibility.missingFields.join(', ')}.`);
    }
    if (!eligibility.certified) throw new ForbiddenException('Bitte bestätige zuerst deine Angaben als gewerbliche:r Anbieter:in.');
  }

  /** Bestätigung nach Art. 30 DSA: nur eigene Angebote, zutreffende Preise und Angaben, geltendes Recht */
  async certify(user: AuthUser, ip?: string) {
    if (user.accountType !== 'BUSINESS') throw new ForbiddenException('Nur gewerbliche Konten können Deals veröffentlichen.');
    await this.prisma.user.update({ where: { id: user.id }, data: { dealerCertifiedAt: new Date() } });
    this.audit.log({ action: 'dealer.certified', actorId: user.id, entityType: 'user', entityId: user.id, ip });
    return this.eligibility(user.id);
  }

  // --- Eigene Deals ------------------------------------------------------------------

  async overview(user: AuthUser): Promise<MerchantDealOverview> {
    const [eligibility, rows] = await Promise.all([
      this.eligibility(user.id),
      this.prisma.deal.findMany({ where: { merchantId: user.id, status: { not: 'DELETED' } }, include: dealInclude, orderBy: { updatedAt: 'desc' }, take: 500 }),
    ]);
    const now = new Date();
    const counts = { active: 0, scheduled: 0, unverified: 0, paused: 0, expired: 0, drafts: 0, review: 0 };
    const deals = rows.map((row) => {
      const deal = toMerchantDeal(row, this.urls, now);
      const key = ({ ACTIVE: 'active', SCHEDULED: 'scheduled', UNVERIFIED: 'unverified', PAUSED: 'paused', EXPIRED: 'expired', DRAFT: 'drafts', PENDING_REVIEW: 'review' } as const)[
        deal.status as 'ACTIVE'
      ];
      if (key) counts[key]++;
      return deal;
    });
    return { eligibility, deals, counts };
  }

  async create(user: AuthUser, input: CreateDealInput, ip?: string): Promise<DealDetail> {
    const { publish, clientRequestId, referenceConfirmed: _confirmed, ...fields } = input;
    await this.requireDealer(user, publish);
    if (clientRequestId) {
      const previous = await this.prisma.deal.findFirst({ where: { merchantId: user.id, clientRequestId, deletedAt: null } });
      if (previous) return this.detail(previous.id, user);
    }
    const active = await this.prisma.deal.count({ where: { merchantId: user.id, status: { not: 'DELETED' } } });
    if (active >= MAX_DEALS_PER_MERCHANT) throw new ConflictException(`Du hast bereits ${MAX_DEALS_PER_MERCHANT} Deals. Bitte lösche alte Angebote.`);
    if (fields.externalId) await this.assertExternalIdFree(user.id, fields.externalId);
    const prepared = await prepareDeal(this.prisma, user.id, parseCompleteDeal(fields));
    const now = new Date();
    if (publish) this.assertNotOver(prepared.data.endsAt as Date, now);
    const review = publish && needsDiscountReview(prepared.discountPercent);
    let deal: Deal;
    try {
      deal = await this.prisma.$transaction(async (tx) => {
        const created = await tx.deal.create({
          data: {
            ...prepared.data,
            merchantId: user.id,
            clientRequestId,
            source: 'MANUAL',
            status: publish ? (review ? 'PENDING_REVIEW' : 'ACTIVE') : 'DRAFT',
            reviewReason: review ? DISCOUNT_REVIEW_REASON : null,
            publishedAt: publish ? now : null,
            lastVerifiedAt: publish ? now : null,
            referenceConfirmedAt: prepared.data.referencePriceCents ? now : null,
          },
        });
        await replaceDealStores(tx, created.id, prepared.storeIds);
        if (publish) await this.recordPrice(tx, created, 'MANUAL');
        return created;
      });
    } catch (error) {
      if (clientRequestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.deal.findFirst({ where: { merchantId: user.id, clientRequestId } });
        if (raced) return this.detail(raced.id, user);
      }
      throw error;
    }
    this.audit.log({ action: publish ? 'deal.published' : 'deal.created', actorId: user.id, entityType: 'deal', entityId: deal.id, ip });
    this.search.index.sync(deal.id);
    return this.detail(deal.id, user);
  }

  async update(user: AuthUser, id: string, input: UpdateDealInput, ip?: string): Promise<DealDetail> {
    const current = await this.requireOwned(user, id);
    const { referenceConfirmed: _confirmed, ...changes } = input;
    if (changes.externalId && changes.externalId !== current.externalId) await this.assertExternalIdFree(user.id, changes.externalId, id);
    const merged = parseCompleteDeal({ ...currentDealFields(current), ...changes });
    const prepared = await prepareDeal(this.prisma, user.id, merged);
    const now = new Date();
    const live = current.status === 'ACTIVE' || current.status === 'PAUSED' || current.status === 'PENDING_REVIEW';
    if (live) this.assertNotOver(prepared.data.endsAt as Date, now);
    const referenceChanged = prepared.data.referencePriceCents !== current.referencePriceCents || prepared.data.referencePriceType !== current.referencePriceType;
    const priceChanged = referenceChanged || prepared.data.priceCents !== current.priceCents;
    let status: DealStatus = current.status;
    let reviewReason = current.reviewReason;
    // Erneute Prüfung nur, wenn sich Preis oder Vergleichspreis ändern (ein vom Team freigegebener Rabatt bleibt freigegeben)
    if (current.status === 'ACTIVE' && priceChanged && needsDiscountReview(prepared.discountPercent)) {
      status = 'PENDING_REVIEW';
      reviewReason = DISCOUNT_REVIEW_REASON;
    } else if (current.status === 'PENDING_REVIEW' && current.reviewReason === DISCOUNT_REVIEW_REASON && !needsDiscountReview(prepared.discountPercent)) {
      // Automatische Prüfung entfällt, sobald der Rabatt wieder im üblichen Rahmen liegt
      status = 'ACTIVE';
      reviewReason = null;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.deal.updateMany({
        where: { id, status: current.status, updatedAt: current.updatedAt },
        data: {
          ...prepared.data,
          status,
          reviewReason,
          // Jede Bearbeitung durch den Händler gilt als Bestätigung des Angebots
          ...(current.publishedAt && { lastVerifiedAt: now }),
          ...(referenceChanged && { referenceConfirmedAt: prepared.data.referencePriceCents ? now : null }),
        },
      });
      if (!changed.count) throw new ConflictException('Das Angebot wurde inzwischen geändert. Bitte lade die Seite neu.');
      await replaceDealStores(tx, id, prepared.storeIds);
      const after = await tx.deal.findUniqueOrThrow({ where: { id } });
      if (after.publishedAt && (after.priceCents !== current.priceCents || after.referencePriceCents !== current.referencePriceCents)) {
        await this.recordPrice(tx, after, 'MANUAL');
      }
      return after;
    });
    this.audit.log({ action: 'deal.updated', actorId: user.id, entityType: 'deal', entityId: id, ip, metadata: { status: updated.status } });
    this.search.index.sync(id);
    return this.detail(id, user);
  }

  /** Entwurf veröffentlichen */
  async publish(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (current.status !== 'DRAFT') throw new ConflictException('Nur Entwürfe können veröffentlicht werden.');
    await this.requireDealer(user, true);
    const fields = parseCompleteDeal(currentDealFields(current));
    const prepared = await prepareDeal(this.prisma, user.id, fields);
    const now = new Date();
    this.assertNotOver(current.endsAt, now);
    const review = needsDiscountReview(prepared.discountPercent);
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.deal.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: review ? 'PENDING_REVIEW' : 'ACTIVE', reviewReason: review ? DISCOUNT_REVIEW_REASON : null, publishedAt: now, lastVerifiedAt: now },
      });
      if (!changed.count) throw new ConflictException('Der Status hat sich inzwischen geändert. Bitte lade die Seite neu.');
      await this.recordPrice(tx, current, 'MANUAL');
    });
    this.audit.log({ action: 'deal.published', actorId: user.id, entityType: 'deal', entityId: id, ip });
    this.search.index.sync(id);
    return this.detail(id, user);
  }

  async pause(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (current.status !== 'ACTIVE' || current.endsAt <= new Date()) throw new ConflictException('Nur laufende Angebote können pausiert werden.');
    return this.transition(user, current, 'PAUSED', 'deal.paused', ip);
  }

  async resume(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (current.status !== 'PAUSED') throw new ConflictException('Nur pausierte Angebote können fortgesetzt werden.');
    if (current.endsAt <= new Date()) throw new ConflictException('Das Angebot ist abgelaufen. Bitte verlängere es.');
    await this.requireDealer(user, true);
    return this.transition(user, current, 'ACTIVE', 'deal.resumed', ip, { lastVerifiedAt: new Date() });
  }

  /** „Angebot ist weiterhin gültig“ – setzt „Zuletzt geprüft“ */
  async verify(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (!['ACTIVE', 'PAUSED', 'PENDING_REVIEW'].includes(current.status) || current.endsAt <= new Date()) {
      throw new ConflictException('Bestätigen kannst du nur laufende Angebote. Abgelaufene bitte verlängern.');
    }
    await this.requireDealer(user, true);
    // Bestätigen löst einen als defekt erkannten Link nicht: Das erledigt die nächste erfolgreiche Prüfung bzw. ein neuer Link.
    await this.prisma.deal.update({ where: { id }, data: { lastVerifiedAt: new Date() } });
    this.audit.log({ action: 'deal.verified', actorId: user.id, entityType: 'deal', entityId: id, ip });
    this.search.index.sync(id);
    return this.detail(id, user);
  }

  /** Verlängern: neues Enddatum; bei abgelaufenen Angeboten beginnt die neue Laufzeit heute */
  async extend(user: AuthUser, id: string, input: ExtendDealInput, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (!['ACTIVE', 'PAUSED', 'EXPIRED'].includes(current.status)) throw new ConflictException('Dieses Angebot kann nicht verlängert werden.');
    await this.requireDealer(user, true);
    const now = new Date();
    const today = toViennaDay(now);
    if (input.endsOn < today) throw new DealFieldError('Bitte prüfe das Enddatum.', [{ path: 'endsOn', message: 'Das neue Ende darf nicht in der Vergangenheit liegen.' }]);
    const expired = current.endsAt <= now;
    let startsOn = toViennaDay(current.startsAt);
    if (expired || (Date.parse(input.endsOn) - Date.parse(startsOn)) / DAY_MS + 1 > DEAL_MAX_DURATION_DAYS) startsOn = startsOn > today ? startsOn : today;
    if ((Date.parse(input.endsOn) - Date.parse(startsOn)) / DAY_MS + 1 > DEAL_MAX_DURATION_DAYS) {
      throw new DealFieldError('Bitte prüfe das Enddatum.', [{ path: 'endsOn', message: `Ein Angebot läuft höchstens ${DEAL_MAX_DURATION_DAYS} Tage.` }]);
    }
    // Preis und Rabatt bleiben gleich: ein laufendes oder abgelaufenes Angebot läuft weiter, ein pausiertes bleibt pausiert
    const status: DealStatus = current.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
    await this.transition(user, current, status, 'deal.extended', ip, { startsAt: dealStartsAt(startsOn), endsAt: dealEndsAt(input.endsOn), lastVerifiedAt: now });
    return this.detail(id, user);
  }

  /** Abgelehnten Deal nach Überarbeitung erneut prüfen lassen */
  async resubmit(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (current.status !== 'REJECTED') throw new ConflictException('Nur abgelehnte Angebote können erneut eingereicht werden.');
    await this.requireDealer(user, true);
    const decision = await this.prisma.moderationDecision.findFirst({ where: { dealId: id, action: 'DEAL_REJECTED' }, orderBy: { createdAt: 'desc' } });
    if (decision && current.updatedAt <= decision.createdAt) throw new ConflictException('Bitte überarbeite das Angebot, bevor du es erneut einreichst.');
    return this.transition(user, current, 'PENDING_REVIEW', 'deal.resubmitted', ip, { reviewReason: RESUBMIT_REVIEW_REASON });
  }

  async remove(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    await this.prisma.deal.update({ where: { id }, data: { status: 'DELETED', deletedAt: new Date(), imageKey: null } });
    if (current.imageKey) await deleteMediaImage(this.storage, current.imageKey).catch(() => undefined);
    this.audit.log({ action: 'deal.deleted', actorId: user.id, entityType: 'deal', entityId: id, ip });
    this.search.index.sync(id);
  }

  // --- Bild ------------------------------------------------------------------------

  async uploadImage(user: AuthUser, id: string, body: unknown, query: Record<string, unknown>, ip?: string) {
    const current = await this.requireOwned(user, id);
    const rights = dealImageRightsSchema.safeParse({ rights: query.rechte ?? query.rights, credit: query.quelle ?? query.credit ?? '' });
    if (!rights.success) {
      throw new DealFieldError('Bitte gib an, woher das Bild stammt.', rights.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    if (rights.data.rights !== 'OWN' && !rights.data.credit) {
      throw new DealFieldError('Bitte gib die Quelle des Bildes an.', [{ path: 'credit', message: 'Bei Hersteller- und Lizenzbildern bitte Urheber bzw. Quelle angeben.' }]);
    }
    const prefix = `deals/${id}/${randomUUID()}`;
    const size = await storeMediaImage(this.storage, prefix, body);
    await this.prisma.deal.update({
      where: { id },
      data: { imageKey: prefix, imageWidth: size.width, imageHeight: size.height, imageRights: rights.data.rights, imageCredit: rights.data.credit ?? null },
    });
    if (current.imageKey) await deleteMediaImage(this.storage, current.imageKey).catch(() => undefined);
    this.audit.log({ action: 'deal.image_updated', actorId: user.id, entityType: 'deal', entityId: id, ip, metadata: { rights: rights.data.rights } });
    this.search.index.sync(id);
    return this.detail(id, user);
  }

  async deleteImage(user: AuthUser, id: string, ip?: string) {
    const current = await this.requireOwned(user, id);
    if (!current.imageKey) return this.detail(id, user);
    await this.prisma.deal.update({ where: { id }, data: { imageKey: null, imageWidth: null, imageHeight: null, imageRights: null, imageCredit: null } });
    await deleteMediaImage(this.storage, current.imageKey).catch(() => undefined);
    this.audit.log({ action: 'deal.image_updated', actorId: user.id, entityType: 'deal', entityId: id, ip, metadata: { removed: true } });
    this.search.index.sync(id);
    return this.detail(id, user);
  }

  /** Weiterleitung auf eine Bildvariante: öffentlich nur für sichtbare Deals, sonst mit gültiger Signatur */
  async imageDownload(id: string, variant: string, exp?: string, sig?: string) {
    if (!ENTITY_ID.test(id) || !isImageVariant(variant)) return null;
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: { merchant: { select: { status: true, deletedAt: true, accountType: true, dealsBlockedAt: true } } } });
    if (!deal?.imageKey) return null;
    const isPublic = isDealPublic(deal);
    if (!isPublic && !this.urls.verify('deal', id, variant, exp, sig)) return null;
    return { url: await this.storage.presignDownload(mediaVariantKey(deal.imageKey, variant), IMAGE_DOWNLOAD_TTL_SECONDS), isPublic };
  }

  // --- Öffentlich ---------------------------------------------------------------------

  async categories(): Promise<DealCategoryView[]> {
    const rows = await this.prisma.dealCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    return rows.map((row) => ({ slug: row.slug, name: row.name, icon: row.icon ?? dealCategoryBySlug(row.slug)?.icon ?? 'tag', relatedCategoryPath: row.relatedCategoryPath }));
  }

  /** Öffentlich nur sichtbare Deals; Händler und Team sehen auch Entwürfe, Abgelaufenes usw. */
  async findOne(id: string, viewer?: AuthUser): Promise<DealDetail> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Dieses Angebot gibt es nicht.');
    const deal = await this.prisma.deal.findUnique({ where: { id }, select: { status: true, merchantId: true } });
    if (!deal || deal.status === 'DELETED') throw new NotFoundException('Dieses Angebot gibt es nicht.');
    return this.detail(id, viewer);
  }

  /** Klick auf „Zum Angebot“: zählt und liefert das Ziel (nur bei sichtbaren Deals mit Link) */
  async click(id: string): Promise<{ url: string }> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Dieses Angebot gibt es nicht.');
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: { merchant: { select: { status: true, deletedAt: true, accountType: true, dealsBlockedAt: true } } } });
    if (!deal || !deal.url || !isDealPublic(deal)) throw new NotFoundException('Dieses Angebot ist nicht mehr verfügbar.');
    // Rohes SQL: Klicks ändern das Angebot nicht (updatedAt bleibt, Suchindex unberührt)
    await this.prisma.$executeRaw`UPDATE deals SET click_count = click_count + 1 WHERE id = ${id}`;
    return { url: deal.url };
  }

  private async detail(id: string, viewer?: AuthUser): Promise<DealDetail> {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: dealInclude });
    if (!deal || deal.status === 'DELETED') throw new NotFoundException('Dieses Angebot gibt es nicht.');
    const isOwner = viewer?.id === deal.merchantId;
    const isStaff = viewer?.role === 'ADMIN' || viewer?.role === 'MODERATOR';
    if (!isDealPublic(deal) && !isOwner && !isStaff) throw new NotFoundException('Dieses Angebot ist nicht mehr verfügbar.');
    const priceRecords = await this.prisma.dealPriceRecord.findMany({
      where: { dealId: id },
      orderBy: { recordedAt: 'desc' },
      take: 200,
      select: { priceCents: true, recordedAt: true },
    });
    const detail = toDealDetail(deal, this.urls, { priceRecords, viewerId: viewer?.id, webUrl: loadEnv().WEB_URL });
    if (isOwner || isStaff) {
      detail.moderation = await this.moderation.dealModerationInfo(deal);
      detail.reviewReason = deal.reviewReason;
    }
    return detail;
  }

  // --- Filialen ----------------------------------------------------------------------

  async stores(user: AuthUser): Promise<DealStoreView[]> {
    const rows = await this.prisma.dealerStore.findMany({ where: { merchantId: user.id, deletedAt: null }, include: { location: { include: locationInclude } }, orderBy: { name: 'asc' } });
    return rows.map((row) => ({ id: row.id, name: row.name, street: row.street, location: toLocationSummary(row.location), openingHours: row.openingHours }));
  }

  async createStore(user: AuthUser, input: DealerStoreInput, ip?: string) {
    if (user.accountType !== 'BUSINESS') throw new ForbiddenException('Filialen gibt es nur für gewerbliche Konten.');
    const count = await this.prisma.dealerStore.count({ where: { merchantId: user.id, deletedAt: null } });
    if (count >= MAX_STORES_PER_MERCHANT) throw new ConflictException(`Höchstens ${MAX_STORES_PER_MERCHANT} Filialen je Händler.`);
    await this.requireLocation(input.locationId);
    const store = await this.prisma.dealerStore.create({ data: { merchantId: user.id, name: input.name, street: input.street, locationId: input.locationId, openingHours: input.openingHours ?? null } });
    this.audit.log({ action: 'dealer.store_created', actorId: user.id, entityType: 'dealer_store', entityId: store.id, ip });
    return (await this.stores(user)).find((s) => s.id === store.id)!;
  }

  async updateStore(user: AuthUser, storeId: string, input: DealerStoreInput, ip?: string) {
    await this.requireOwnedStore(user, storeId);
    await this.requireLocation(input.locationId);
    await this.prisma.dealerStore.update({ where: { id: storeId }, data: { name: input.name, street: input.street, locationId: input.locationId, openingHours: input.openingHours ?? null } });
    this.audit.log({ action: 'dealer.store_updated', actorId: user.id, entityType: 'dealer_store', entityId: storeId, ip });
    await this.syncDealsOfStore(storeId);
    return (await this.stores(user)).find((s) => s.id === storeId)!;
  }

  /** Filiale löschen; lokale Deals, die nur hier galten, werden pausiert (sie hätten sonst keinen Ort mehr). */
  async deleteStore(user: AuthUser, storeId: string, ip?: string) {
    await this.requireOwnedStore(user, storeId);
    const affected = await this.prisma.dealStore.findMany({ where: { storeId }, select: { dealId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.dealerStore.update({ where: { id: storeId }, data: { deletedAt: new Date() } });
      await tx.dealStore.deleteMany({ where: { storeId } });
      await tx.deal.updateMany({
        where: { id: { in: affected.map((a) => a.dealId) }, channel: 'LOCAL', status: 'ACTIVE', stores: { none: {} } },
        data: { status: 'PAUSED' },
      });
    });
    this.audit.log({ action: 'dealer.store_deleted', actorId: user.id, entityType: 'dealer_store', entityId: storeId, ip, metadata: { deals: affected.length } });
    this.search.index.syncMany(affected.map((a) => a.dealId));
  }

  // --- Hilfsfunktionen -------------------------------------------------------------------

  private async syncDealsOfStore(storeId: string) {
    const rows = await this.prisma.dealStore.findMany({ where: { storeId }, select: { dealId: true } });
    this.search.index.syncMany(rows.map((r) => r.dealId));
  }

  /** Preisänderung festhalten (Grundlage für „niedrigster erfasster Preis“ – keine Schätzungen) */
  async recordPrice(tx: Prisma.TransactionClient, deal: Pick<Deal, 'id' | 'priceCents' | 'referencePriceCents'>, source: 'MANUAL' | 'CSV' | 'FEED') {
    await tx.dealPriceRecord.create({ data: { dealId: deal.id, priceCents: deal.priceCents, referencePriceCents: deal.referencePriceCents, source } });
  }

  private async transition(user: AuthUser, current: Deal, status: DealStatus, action: 'deal.paused' | 'deal.resumed' | 'deal.extended' | 'deal.resubmitted', ip?: string, data: Prisma.DealUpdateManyMutationInput = {}) {
    const changed = await this.prisma.deal.updateMany({ where: { id: current.id, status: current.status, updatedAt: current.updatedAt }, data: { status, ...data } });
    if (!changed.count) throw new ConflictException('Der Status des Angebots hat sich inzwischen geändert. Bitte lade die Seite neu.');
    this.audit.log({ action, actorId: user.id, entityType: 'deal', entityId: current.id, ip });
    this.search.index.sync(current.id);
    return this.detail(current.id, user);
  }

  private assertNotOver(endsAt: Date, now: Date) {
    if (endsAt <= now) throw new DealFieldError('Bitte prüfe das Enddatum.', [{ path: 'endsOn', message: 'Das Angebot ist bereits abgelaufen. Bitte wähle ein späteres Ende.' }]);
  }

  private async assertExternalIdFree(merchantId: string, externalId: string, exceptId?: string) {
    const existing = await this.prisma.deal.findFirst({ where: { merchantId, externalId, ...(exceptId && { id: { not: exceptId } }) }, select: { id: true } });
    if (existing) throw new DealFieldError('Diese Artikelnummer verwendest du bereits.', [{ path: 'externalId', message: 'Diese Artikelnummer gehört schon zu einem anderen deiner Angebote.' }]);
  }

  /** Eigentümerprüfung serverseitig; fremde Deals ergeben 404 */
  private async requireOwned(user: AuthUser, id: string): Promise<DealWithStores> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException('Dieses Angebot gibt es nicht.');
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: { category: { select: { slug: true } }, stores: { select: { storeId: true } } } });
    if (!deal || deal.status === 'DELETED' || deal.merchantId !== user.id) throw new NotFoundException('Dieses Angebot gibt es nicht.');
    return deal;
  }

  private async requireOwnedStore(user: AuthUser, storeId: string) {
    if (!ENTITY_ID.test(storeId)) throw new NotFoundException('Diese Filiale gibt es nicht.');
    const store = await this.prisma.dealerStore.findUnique({ where: { id: storeId } });
    if (!store || store.deletedAt || store.merchantId !== user.id) throw new NotFoundException('Diese Filiale gibt es nicht.');
    return store;
  }

  private async requireLocation(locationId: number) {
    if (!(await this.prisma.location.count({ where: { id: locationId } }))) {
      throw new DealFieldError('Bitte prüfe den Ort.', [{ path: 'locationId', message: 'Der gewählte Ort ist unbekannt.' }]);
    }
  }

}
