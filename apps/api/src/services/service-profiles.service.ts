import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  portfolioImageRightsSchema,
  SERVICE_MAX_PORTFOLIO,
  SERVICE_MAX_QUALIFICATIONS,
  type MyServiceProfile,
  type PortfolioItemInput,
  type QualificationInput,
  type ServiceCategoryView,
  type ServiceProfileDetail,
  type ServiceProfileFields,
} from '@marktat/shared';
import type { ServiceProfileStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { deleteMediaImage, isImageVariant, mediaVariantKey, MediaUrls, storeMediaImage } from '../images/media.js';
import { ENTITY_ID } from '../listings/visibility.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types.js';
import { serviceProfileDetailInclude, toServiceCategoryView, toServiceProfileDetail } from './services.mapper.js';
import { isServiceProfilePublic } from './visibility.js';

const IMAGE_DOWNLOAD_TTL_SECONDS = 3600;
const RESUBMIT_REVIEW_REASON = 'Nach einer Ablehnung überarbeitet und erneut eingereicht.';
const NOT_FOUND = 'Dieses Anbieterprofil gibt es nicht.';

type FieldIssue = { path: string; message: string };

function fieldError(message: string, issues: FieldIssue[]) {
  return new BadRequestException({ statusCode: 400, message, errors: issues });
}

/**
 * Anbieterprofile für Dienstleistungen und Freelancer: eine Erweiterung des bestehenden Kontos (höchstens eines je Konto).
 * Keine Bewertungen, keine Abzeichen; „geprüft“ erscheint nur bei Qualifikationen, die das Team geprüft hat.
 */
@Injectable()
export class ServiceProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly urls: MediaUrls,
    private readonly moderation: ModerationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async categories(): Promise<ServiceCategoryView[]> {
    const rows = await this.prisma.serviceCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    return rows.map(toServiceCategoryView);
  }

  // --- Eigenes Profil ---------------------------------------------------------------

  async me(user: AuthUser): Promise<MyServiceProfile> {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { accountType: true, companyName: true, companyAddress: true } });
    const missingAccountFields =
      account.accountType === 'BUSINESS'
        ? [!account.companyName && 'Firmenname', !account.companyAddress && 'Firmenanschrift'].filter((v): v is string => Boolean(v))
        : [];
    const row = await this.prisma.serviceProfile.findUnique({ where: { userId: user.id }, include: serviceProfileDetailInclude });
    if (!row || row.status === 'DELETED') return { profile: null, missingAccountFields };
    const detail = await this.withModeration(row, toServiceProfileDetail(row, this.urls, { privileged: true, isOwner: true, conversationId: null }));
    return {
      profile: { ...detail, imageRights: row.imageRights, imageCredit: row.imageCredit, reviewReason: row.reviewReason },
      missingAccountFields,
    };
  }

  /** Anlegen bzw. ändern. Ein gelöschtes Profil wird dabei neu begonnen (gleiche Zeile, alte Inhalte sind schon entfernt). */
  async save(user: AuthUser, input: ServiceProfileFields, ip?: string): Promise<MyServiceProfile> {
    if (input.locationId) {
      const location = await this.prisma.location.findUnique({ where: { id: input.locationId }, select: { id: true } });
      if (!location) throw fieldError('Diesen Ort kennen wir nicht.', [{ path: 'locationId', message: 'Bitte wähle einen Ort aus der Liste.' }]);
    }
    const categories = await this.prisma.serviceCategory.findMany({ where: { slug: { in: input.categorySlugs }, isActive: true }, select: { id: true } });
    if (categories.length !== input.categorySlugs.length) throw fieldError('Unbekannte Kategorie.', [{ path: 'categorySlugs', message: 'Bitte wähle Kategorien aus der Liste.' }]);
    const fields = {
      headline: input.headline,
      summary: input.summary,
      description: input.description,
      skills: input.skills,
      locationId: input.locationId ?? null,
      serviceRadiusKm: input.serviceRadiusKm,
      austriaWide: input.austriaWide,
      remote: input.remote,
      priceType: input.priceType,
      priceCents: input.priceCents,
      experienceYears: input.experienceYears ?? null,
      website: input.website ?? null,
      availability: input.availability,
      availabilityNote: input.availabilityNote ?? null,
    };
    const existing = await this.prisma.serviceProfile.findUnique({ where: { userId: user.id }, select: { id: true, status: true } });
    const restart = existing?.status === 'DELETED';
    const profileId = await this.prisma.$transaction(async (tx) => {
      const profile = existing
        ? await tx.serviceProfile.update({
            where: { id: existing.id },
            data: { ...fields, ...(restart && { status: 'DRAFT', confirmedAt: null, publishedAt: null, reviewReason: null, viewCount: 0 }) },
            select: { id: true },
          })
        : await tx.serviceProfile.create({ data: { ...fields, userId: user.id }, select: { id: true } });
      await tx.serviceProfileCategory.deleteMany({ where: { profileId: profile.id } });
      await tx.serviceProfileCategory.createMany({ data: categories.map((c) => ({ profileId: profile.id, categoryId: c.id })) });
      return profile.id;
    });
    this.audit.log({
      action: existing && !restart ? 'service_profile.updated' : 'service_profile.created',
      actorId: user.id,
      entityType: 'service_profile',
      entityId: profileId,
      ip,
    });
    return this.me(user);
  }

  /** Veröffentlichen mit Bestätigung der Angaben; gewerbliche Konten brauchen Firmenname und Anschrift (Impressum). */
  async publish(user: AuthUser, ip?: string): Promise<MyServiceProfile> {
    const profile = await this.requireOwn(user);
    if (profile.status !== 'DRAFT') throw new ConflictException('Nur Entwürfe können veröffentlicht werden.');
    const { missingAccountFields } = await this.me(user);
    if (missingAccountFields.length) {
      throw new ConflictException(`Bitte ergänze zuerst in deinem Konto: ${missingAccountFields.join(', ')}. Diese Angaben sind für gewerbliche Anbieter Pflicht.`);
    }
    await this.prisma.serviceProfile.updateMany({
      where: { id: profile.id, status: 'DRAFT' },
      data: { status: 'ACTIVE', confirmedAt: new Date(), publishedAt: profile.publishedAt ?? new Date() },
    });
    this.audit.log({ action: 'service_profile.published', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip });
    return this.me(user);
  }

  async pause(user: AuthUser, ip?: string) {
    return this.transition(user, ['ACTIVE'], 'PAUSED', 'service_profile.paused', 'Nur sichtbare Profile können pausiert werden.', ip);
  }

  async resume(user: AuthUser, ip?: string) {
    return this.transition(user, ['PAUSED'], 'ACTIVE', 'service_profile.resumed', 'Nur pausierte Profile können wieder sichtbar geschaltet werden.', ip);
  }

  /** Abgelehntes Profil nach einer Überarbeitung erneut zur Prüfung einreichen */
  async resubmit(user: AuthUser, ip?: string) {
    const profile = await this.requireOwn(user);
    if (profile.status !== 'REJECTED') throw new ConflictException('Nur abgelehnte Profile können erneut eingereicht werden.');
    const decision = await this.prisma.moderationDecision.findFirst({
      where: { serviceProfileId: profile.id, action: 'SERVICE_PROFILE_REJECTED' },
      orderBy: { createdAt: 'desc' },
    });
    if (decision && profile.updatedAt <= decision.createdAt) throw new ConflictException('Bitte überarbeite dein Profil, bevor du es erneut einreichst.');
    const updated = await this.prisma.serviceProfile.updateMany({ where: { id: profile.id, status: 'REJECTED' }, data: { status: 'PENDING_REVIEW', reviewReason: RESUBMIT_REVIEW_REASON } });
    if (!updated.count) throw new ConflictException('Der Status deines Profils hat sich inzwischen geändert.');
    this.audit.log({ action: 'service_profile.resubmitted', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { decisionId: decision?.id } });
    return this.me(user);
  }

  /**
   * Profil löschen: verschwindet sofort, Bilder, Portfolio und Qualifikationen werden entfernt. Die Zeile bleibt
   * (Status DELETED) für bestehende Unterhaltungen, Meldungen und Entscheidungen.
   */
  async remove(user: AuthUser, ip?: string) {
    const profile = await this.requireOwn(user);
    const items = await this.prisma.servicePortfolioItem.findMany({ where: { profileId: profile.id }, select: { imageKey: true } });
    await this.prisma.$transaction([
      this.prisma.servicePortfolioItem.deleteMany({ where: { profileId: profile.id } }),
      this.prisma.serviceQualification.deleteMany({ where: { profileId: profile.id } }),
      this.prisma.serviceProfile.update({ where: { id: profile.id }, data: { status: 'DELETED', imageKey: null, imageRights: null, imageCredit: null, reviewReason: null } }),
    ]);
    for (const key of [profile.imageKey, ...items.map((i) => i.imageKey)]) {
      if (key) await deleteMediaImage(this.storage, key).catch(() => undefined);
    }
    this.audit.log({ action: 'service_profile.deleted', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip });
  }

  // --- Profilbild --------------------------------------------------------------------

  async uploadImage(user: AuthUser, body: unknown, query: Record<string, unknown>, ip?: string) {
    const profile = await this.requireOwn(user);
    const rights = parseRights(query);
    const prefix = `services/${profile.id}/${randomUUID()}`;
    await storeMediaImage(this.storage, prefix, body);
    await this.prisma.serviceProfile.update({ where: { id: profile.id }, data: { imageKey: prefix, imageRights: rights.rights, imageCredit: rights.credit ?? null } });
    if (profile.imageKey) await deleteMediaImage(this.storage, profile.imageKey).catch(() => undefined);
    this.audit.log({ action: 'service_profile.image_updated', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { rights: rights.rights } });
    return this.me(user);
  }

  async deleteImage(user: AuthUser, ip?: string) {
    const profile = await this.requireOwn(user);
    if (profile.imageKey) {
      await this.prisma.serviceProfile.update({ where: { id: profile.id }, data: { imageKey: null, imageRights: null, imageCredit: null } });
      await deleteMediaImage(this.storage, profile.imageKey).catch(() => undefined);
      this.audit.log({ action: 'service_profile.image_updated', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { removed: true } });
    }
    return this.me(user);
  }

  // --- Portfolio ----------------------------------------------------------------------

  async addPortfolioItem(user: AuthUser, input: PortfolioItemInput & { description: string | null; url: string | null }, ip?: string) {
    const profile = await this.requireOwn(user);
    const count = await this.prisma.servicePortfolioItem.count({ where: { profileId: profile.id } });
    if (count >= SERVICE_MAX_PORTFOLIO) throw new ConflictException(`Höchstens ${SERVICE_MAX_PORTFOLIO} Einträge im Portfolio.`);
    const item = await this.prisma.servicePortfolioItem.create({
      data: {
        profileId: profile.id,
        title: input.title,
        description: input.description,
        url: input.url,
        categoryId: await this.categoryId(input.categorySlug),
        sortOrder: count,
      },
    });
    this.audit.log({ action: 'service_profile.portfolio_created', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { portfolioItemId: item.id } });
    return { id: item.id, profile: await this.me(user) };
  }

  async updatePortfolioItem(user: AuthUser, itemId: string, input: PortfolioItemInput & { description: string | null; url: string | null }, ip?: string) {
    const { profile, item } = await this.requireOwnItem(user, itemId);
    await this.prisma.servicePortfolioItem.update({
      where: { id: item.id },
      data: { title: input.title, description: input.description, url: input.url, categoryId: await this.categoryId(input.categorySlug) },
    });
    this.audit.log({ action: 'service_profile.portfolio_updated', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { portfolioItemId: item.id } });
    return this.me(user);
  }

  async removePortfolioItem(user: AuthUser, itemId: string, ip?: string) {
    const { profile, item } = await this.requireOwnItem(user, itemId);
    await this.prisma.servicePortfolioItem.delete({ where: { id: item.id } });
    if (item.imageKey) await deleteMediaImage(this.storage, item.imageKey).catch(() => undefined);
    this.audit.log({ action: 'service_profile.portfolio_deleted', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { portfolioItemId: item.id } });
    return this.me(user);
  }

  async uploadPortfolioImage(user: AuthUser, itemId: string, body: unknown, query: Record<string, unknown>, ip?: string) {
    const { profile, item } = await this.requireOwnItem(user, itemId);
    const rights = parseRights(query);
    const prefix = `services/${profile.id}/portfolio/${item.id}/${randomUUID()}`;
    await storeMediaImage(this.storage, prefix, body);
    await this.prisma.servicePortfolioItem.update({ where: { id: item.id }, data: { imageKey: prefix, imageRights: rights.rights, imageCredit: rights.credit ?? null } });
    if (item.imageKey) await deleteMediaImage(this.storage, item.imageKey).catch(() => undefined);
    this.audit.log({ action: 'service_profile.portfolio_updated', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { portfolioItemId: item.id, rights: rights.rights } });
    return this.me(user);
  }

  async deletePortfolioImage(user: AuthUser, itemId: string, ip?: string) {
    const { profile, item } = await this.requireOwnItem(user, itemId);
    if (item.imageKey) {
      await this.prisma.servicePortfolioItem.update({ where: { id: item.id }, data: { imageKey: null, imageRights: null, imageCredit: null } });
      await deleteMediaImage(this.storage, item.imageKey).catch(() => undefined);
      this.audit.log({ action: 'service_profile.portfolio_updated', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { portfolioItemId: item.id, imageRemoved: true } });
    }
    return this.me(user);
  }

  // --- Qualifikationen ----------------------------------------------------------------

  /** Neue Angabe: zunächst „nicht geprüft“. Ändern heißt löschen und neu anlegen (dann erneut zu prüfen). */
  async addQualification(user: AuthUser, input: QualificationInput & { issuer: string | null; reference: string | null }, ip?: string) {
    const profile = await this.requireOwn(user);
    const count = await this.prisma.serviceQualification.count({ where: { profileId: profile.id } });
    if (count >= SERVICE_MAX_QUALIFICATIONS) throw new ConflictException(`Höchstens ${SERVICE_MAX_QUALIFICATIONS} Qualifikationen je Profil.`);
    const row = await this.prisma.serviceQualification.create({ data: { profileId: profile.id, title: input.title, issuer: input.issuer, reference: input.reference } });
    this.audit.log({ action: 'service_profile.qualification_created', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { qualificationId: row.id } });
    return this.me(user);
  }

  async removeQualification(user: AuthUser, qualificationId: string, ip?: string) {
    const profile = await this.requireOwn(user);
    const { count } = ENTITY_ID.test(qualificationId)
      ? await this.prisma.serviceQualification.deleteMany({ where: { id: qualificationId, profileId: profile.id } })
      : { count: 0 };
    if (!count) throw new NotFoundException('Diese Qualifikation gibt es nicht.');
    this.audit.log({ action: 'service_profile.qualification_deleted', actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip, metadata: { qualificationId } });
    return this.me(user);
  }

  // --- Öffentlich ---------------------------------------------------------------------

  async findOne(id: string, viewer?: AuthUser): Promise<ServiceProfileDetail> {
    if (!ENTITY_ID.test(id)) throw new NotFoundException(NOT_FOUND);
    const row = await this.prisma.serviceProfile.findUnique({ where: { id }, include: serviceProfileDetailInclude });
    if (!row || row.status === 'DELETED') throw new NotFoundException(NOT_FOUND);
    const isOwner = viewer?.id === row.userId;
    const isStaff = viewer?.role === 'ADMIN' || viewer?.role === 'MODERATOR';
    if (!isServiceProfilePublic(row) && !isOwner && !isStaff) throw new NotFoundException('Dieses Anbieterprofil ist nicht mehr verfügbar.');
    const [conversation, favorite] = viewer && !isOwner
      ? await Promise.all([
          this.prisma.conversation.findUnique({ where: { serviceProfileId_buyerId: { serviceProfileId: id, buyerId: viewer.id } }, select: { id: true } }),
          this.prisma.serviceFavorite.count({ where: { userId: viewer.id, profileId: id } }),
        ])
      : [null, 0];
    if (!isOwner && isServiceProfilePublic(row)) {
      // Rohes SQL: Aufrufe ändern das Profil nicht (updatedAt bleibt)
      await this.prisma.$executeRaw`UPDATE service_profiles SET view_count = view_count + 1 WHERE id = ${id}`;
    }
    const detail = toServiceProfileDetail(row, this.urls, { privileged: isOwner || isStaff, isOwner, conversationId: conversation?.id ?? null, isFavorite: favorite > 0 });
    return isOwner || isStaff ? this.withModeration(row, detail) : detail;
  }

  /** Weiterleitung auf eine Bildvariante: öffentlich nur bei sichtbaren Profilen, sonst mit gültiger Signatur */
  async imageDownload(profileId: string, variant: string, exp?: string, sig?: string) {
    if (!ENTITY_ID.test(profileId) || !isImageVariant(variant)) return null;
    const profile = await this.prisma.serviceProfile.findUnique({ where: { id: profileId }, include: { user: { select: { status: true, deletedAt: true } } } });
    if (!profile?.imageKey) return null;
    const isPublic = isServiceProfilePublic(profile);
    if (!isPublic && !this.urls.verify('portfolio', profileId, variant, exp, sig)) return null;
    return { url: await this.storage.presignDownload(mediaVariantKey(profile.imageKey, variant), IMAGE_DOWNLOAD_TTL_SECONDS), isPublic };
  }

  async portfolioImageDownload(profileId: string, itemId: string, variant: string, exp?: string, sig?: string) {
    if (!ENTITY_ID.test(profileId) || !ENTITY_ID.test(itemId) || !isImageVariant(variant)) return null;
    const item = await this.prisma.servicePortfolioItem.findFirst({
      where: { id: itemId, profileId },
      include: { profile: { select: { status: true, user: { select: { status: true, deletedAt: true } } } } },
    });
    if (!item?.imageKey) return null;
    const isPublic = isServiceProfilePublic(item.profile) && !item.hiddenAt;
    if (!isPublic && !this.urls.verify('portfolio', itemId, variant, exp, sig)) return null;
    return { url: await this.storage.presignDownload(mediaVariantKey(item.imageKey, variant), IMAGE_DOWNLOAD_TTL_SECONDS), isPublic };
  }

  // --- intern -------------------------------------------------------------------------

  private async withModeration(row: { id: string; status: ServiceProfileStatus; updatedAt: Date }, detail: ServiceProfileDetail) {
    detail.moderation = await this.moderation.serviceProfileModerationInfo(row);
    return detail;
  }

  private async transition(user: AuthUser, from: ServiceProfileStatus[], to: ServiceProfileStatus, action: 'service_profile.paused' | 'service_profile.resumed', message: string, ip?: string) {
    const profile = await this.requireOwn(user);
    if (!from.includes(profile.status)) throw new ConflictException(message);
    const updated = await this.prisma.serviceProfile.updateMany({ where: { id: profile.id, status: { in: from } }, data: { status: to } });
    if (!updated.count) throw new ConflictException('Der Status deines Profils hat sich inzwischen geändert.');
    this.audit.log({ action, actorId: user.id, entityType: 'service_profile', entityId: profile.id, ip });
    return this.me(user);
  }

  private async requireOwn(user: AuthUser) {
    const profile = await this.prisma.serviceProfile.findUnique({ where: { userId: user.id } });
    if (!profile || profile.status === 'DELETED') throw new NotFoundException('Du hast noch kein Anbieterprofil.');
    return profile;
  }

  private async requireOwnItem(user: AuthUser, itemId: string) {
    const profile = await this.requireOwn(user);
    const item = ENTITY_ID.test(itemId) ? await this.prisma.servicePortfolioItem.findFirst({ where: { id: itemId, profileId: profile.id } }) : null;
    if (!item) throw new NotFoundException('Diesen Portfolio-Eintrag gibt es nicht.');
    return { profile, item };
  }

  private async categoryId(slug: string | null | undefined) {
    if (!slug) return null;
    const category = await this.prisma.serviceCategory.findUnique({ where: { slug }, select: { id: true, isActive: true } });
    if (!category?.isActive) throw fieldError('Unbekannte Kategorie.', [{ path: 'categorySlug', message: 'Bitte wähle eine Kategorie aus der Liste.' }]);
    return category.id;
  }
}

/** Herkunft des Bildes ist Pflicht; bei lizenzierten Bildern auch die Quelle */
function parseRights(query: Record<string, unknown>) {
  const rights = portfolioImageRightsSchema.safeParse({ rights: query.rechte ?? query.rights, credit: query.quelle ?? query.credit ?? '' });
  if (!rights.success) {
    throw fieldError('Bitte gib an, woher das Bild stammt.', rights.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  if (rights.data.rights === 'LICENSED' && !rights.data.credit) {
    throw fieldError('Bitte gib die Quelle des Bildes an.', [{ path: 'credit', message: 'Bei lizenzierten Bildern bitte Urheber bzw. Quelle angeben.' }]);
  }
  return rights.data;
}
