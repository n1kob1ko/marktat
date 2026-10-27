import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_LISTING,
  type CreateImageUploadInput,
  type ImageUploadTicket,
  type ListingImage as ListingImageDto,
} from '@marktat/shared';
import type { ListingImage } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { effectiveStatus } from '../listings/listings.mapper.js';
import {
  OBJECT_STORAGE,
  ObjectTooLargeError,
  type ObjectStorage,
} from '../storage/storage.types.js';
import {
  IMAGE_VARIANT_NAMES,
  InvalidImageError,
  processImage,
  type ImageVariant,
} from './image-processor.js';
import { ImageUrls } from './image-urls.js';

/** Gültigkeit der Upload-URL. Kurz, weil sie ohne weitere Prüfung einen Schreibzugriff erlaubt. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
/** Gültigkeit der Weiterleitung auf R2 für fertige Bilder */
export const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;
/** Nicht abgeschlossene Uploads werden nach dieser Zeit verworfen und zählen nicht mehr zum Limit. */
export const STALE_UPLOAD_MS = 60 * 60 * 1000;
/** Varianten ändern sich nie (neues Bild = neue ID), daher dauerhaft cachebar. */
const VARIANT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function variantKey(storageKey: string, variant: ImageVariant) {
  return `${storageKey}/${variant}.webp`;
}

@Injectable()
export class ListingImagesService {
  private readonly logger = new Logger(ListingImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly urls: ImageUrls,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Schritt 1: Platz reservieren und eine kurzlebige Upload-URL ausstellen. */
  async createUpload(
    user: AuthUser,
    listingId: string,
    input: CreateImageUploadInput,
  ): Promise<ImageUploadTicket> {
    await this.requireOwnedListing(user, listingId);
    await this.purgeStaleUploads(listingId);
    const count = await this.prisma.listingImage.count({ where: { listingId } });
    if (count >= MAX_IMAGES_PER_LISTING) {
      throw new ConflictException(
        `Ein Inserat kann höchstens ${MAX_IMAGES_PER_LISTING} Bilder haben.`,
      );
    }

    const id = randomUUID();
    const uploadKey = `uploads/${listingId}/${id}`;
    const upload = await this.storage.presignUpload(uploadKey, {
      contentType: input.contentType,
      contentLength: input.size,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
    await this.prisma.listingImage.create({
      data: {
        id,
        listingId,
        uploadKey,
        storageKey: `images/${listingId}/${id}`,
        declaredType: input.contentType,
        declaredSize: input.size,
      },
    });
    return {
      imageId: id,
      uploadUrl: upload.url,
      method: 'PUT',
      headers: upload.headers,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Schritt 2 (nach dem PUT): Datei prüfen, bereinigen, Varianten speichern, Rohdatei löschen. */
  async complete(
    user: AuthUser,
    listingId: string,
    imageId: string,
    ip?: string,
  ): Promise<ListingImageDto> {
    const listing = await this.requireOwnedListing(user, listingId);
    const image = await this.requireImage(listingId, imageId);
    if (image.status === 'READY') return this.toDto(image, listing);
    const uploadKey = image.uploadKey!;

    const head = await this.storage.head(uploadKey);
    if (!head) throw new ConflictException('Die Datei wurde noch nicht hochgeladen.');
    if (head.size > MAX_IMAGE_BYTES)
      return this.reject(user, image, 'Ein Bild darf höchstens 15 MB groß sein.', ip);
    if (head.size !== image.declaredSize) {
      return this.reject(
        user,
        image,
        'Die hochgeladene Datei entspricht nicht der angemeldeten Datei.',
        ip,
      );
    }

    let processed;
    try {
      processed = await processImage(await this.storage.getBytes(uploadKey, MAX_IMAGE_BYTES));
    } catch (error) {
      if (error instanceof InvalidImageError) return this.reject(user, image, error.message, ip);
      if (error instanceof ObjectTooLargeError)
        return this.reject(user, image, 'Ein Bild darf höchstens 15 MB groß sein.', ip);
      throw error;
    }

    for (const variant of processed.variants) {
      await this.storage.put(
        variantKey(image.storageKey, variant.name),
        variant.body,
        variant.contentType,
        VARIANT_CACHE_CONTROL,
      );
    }
    const readyCount = await this.prisma.listingImage.count({
      where: { listingId, status: 'READY' },
    });
    // Bedingtes Update: Bei zwei gleichzeitigen Abschlüssen gewinnt genau einer.
    await this.prisma.listingImage.updateMany({
      where: { id: image.id, status: 'PENDING' },
      data: {
        status: 'READY',
        uploadKey: null,
        detectedType: processed.detectedType,
        width: processed.width,
        height: processed.height,
        storedBytes: processed.variants.reduce((sum, v) => sum + v.body.length, 0),
        sortOrder: readyCount,
        processedAt: new Date(),
      },
    });
    await this.deleteObjects([uploadKey]);
    this.audit.log({
      action: 'listing.image_added',
      actorId: user.id,
      entityType: 'listing',
      entityId: listingId,
      ip,
      metadata: {
        imageId: image.id,
        type: processed.detectedType,
        width: processed.width,
        height: processed.height,
      },
    });
    return this.toDto(await this.requireImage(listingId, imageId), listing);
  }

  async list(user: AuthUser, listingId: string): Promise<ListingImageDto[]> {
    const listing = await this.requireOwnedListing(user, listingId);
    const images = await this.readyImages(listingId);
    const signed = effectiveStatus(listing) !== 'ACTIVE';
    return images.map((image, index) => this.urls.toDto(image, index, signed));
  }

  /** Neue Reihenfolge; die Liste muss genau alle fertigen Bilder enthalten. Erstes Bild = Hauptbild. */
  async reorder(
    user: AuthUser,
    listingId: string,
    imageIds: string[],
    ip?: string,
  ): Promise<ListingImageDto[]> {
    await this.requireOwnedListing(user, listingId);
    const current = await this.readyImages(listingId);
    const known = new Set(current.map((image) => image.id));
    if (imageIds.length !== known.size || imageIds.some((id) => !known.has(id))) {
      throw new BadRequestException(
        'Die neue Reihenfolge muss alle Bilder des Inserats genau einmal enthalten.',
      );
    }
    await this.prisma.$transaction(
      imageIds.map((id, index) =>
        this.prisma.listingImage.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    this.audit.log({
      action: 'listing.images_reordered',
      actorId: user.id,
      entityType: 'listing',
      entityId: listingId,
      ip,
    });
    return this.list(user, listingId);
  }

  async setMain(
    user: AuthUser,
    listingId: string,
    imageId: string,
    ip?: string,
  ): Promise<ListingImageDto[]> {
    await this.requireOwnedListing(user, listingId);
    const current = await this.readyImages(listingId);
    if (!current.some((image) => image.id === imageId))
      throw new NotFoundException('Dieses Bild gibt es nicht.');
    const order = [imageId, ...current.map((image) => image.id).filter((id) => id !== imageId)];
    return this.reorder(user, listingId, order, ip);
  }

  async remove(user: AuthUser, listingId: string, imageId: string, ip?: string): Promise<void> {
    await this.requireOwnedListing(user, listingId);
    const image = await this.requireImage(listingId, imageId);
    await this.prisma.listingImage.delete({ where: { id: image.id } });
    await this.deleteObjects(this.objectKeys(image));
    const rest = await this.readyImages(listingId);
    await this.prisma.$transaction(
      rest.map((other, index) =>
        this.prisma.listingImage.update({ where: { id: other.id }, data: { sortOrder: index } }),
      ),
    );
    this.audit.log({
      action: 'listing.image_deleted',
      actorId: user.id,
      entityType: 'listing',
      entityId: listingId,
      ip,
      metadata: { imageId: image.id },
    });
  }

  /** Öffentliche Auslieferung: kurzlebige R2-URL für eine fertige Variante – oder null (= 404). */
  async resolveDownload(
    imageId: string,
    variant: string,
    signatureValid: (signedVariant: string) => boolean,
  ) {
    if (!IMAGE_VARIANT_NAMES.includes(variant as ImageVariant)) return null;
    const image = await this.prisma.listingImage.findUnique({
      where: { id: imageId },
      select: {
        status: true,
        storageKey: true,
        listing: { select: { status: true, expiresAt: true, seller: { select: { status: true, deletedAt: true } } } },
      },
    });
    if (!image || image.status !== 'READY' || image.listing.status === 'DELETED') return null;
    // Wie in Suche und Detailseite: nur aktive Inserate aktiver Konten sind öffentlich
    const seller = image.listing.seller;
    const isPublic = effectiveStatus(image.listing) === 'ACTIVE' && seller.status === 'ACTIVE' && !seller.deletedAt;
    if (!isPublic && !signatureValid(variant)) return null;
    const url = await this.storage.presignDownload(
      variantKey(image.storageKey, variant as ImageVariant),
      DOWNLOAD_URL_TTL_SECONDS,
    );
    return { url, isPublic };
  }

  // --- Hilfsfunktionen -------------------------------------------------------

  /** Nur der Eigentümer verwaltet Bilder. Fremde oder gelöschte Inserate liefern 404. */
  private async requireOwnedListing(user: AuthUser, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true, expiresAt: true },
    });
    if (!listing || listing.status === 'DELETED' || listing.sellerId !== user.id) {
      throw new NotFoundException('Dieses Inserat gibt es nicht.');
    }
    return listing;
  }

  private async requireImage(listingId: string, imageId: string) {
    const image = await this.prisma.listingImage.findFirst({ where: { id: imageId, listingId } });
    if (!image) throw new NotFoundException('Dieses Bild gibt es nicht.');
    return image;
  }

  private readyImages(listingId: string) {
    return this.prisma.listingImage.findMany({
      where: { listingId, status: 'READY' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private toDto(
    image: ListingImage,
    listing: { status: Parameters<typeof effectiveStatus>[0]['status']; expiresAt: Date | null },
  ) {
    return this.urls.toDto(image, image.sortOrder, effectiveStatus(listing) !== 'ACTIVE');
  }

  private objectKeys(image: Pick<ListingImage, 'storageKey' | 'uploadKey'>) {
    return [
      ...IMAGE_VARIANT_NAMES.map((v) => variantKey(image.storageKey, v)),
      ...(image.uploadKey ? [image.uploadKey] : []),
    ];
  }

  /** Ungültige Datei: Rohdatei und Eintrag entfernen, Grund an den Browser zurückgeben. */
  private async reject(
    user: AuthUser,
    image: ListingImage,
    message: string,
    ip?: string,
  ): Promise<never> {
    await this.prisma.listingImage.delete({ where: { id: image.id } }).catch(() => undefined);
    await this.deleteObjects(image.uploadKey ? [image.uploadKey] : []);
    this.audit.log({
      action: 'listing.image_rejected',
      actorId: user.id,
      entityType: 'listing',
      entityId: image.listingId,
      ip,
      metadata: { imageId: image.id, reason: message },
    });
    throw new UnprocessableEntityException(message);
  }

  /** Abgebrochene Uploads eines Inserats aufräumen (zusätzlich räumt eine R2-Lifecycle-Regel „uploads/“ auf). */
  private async purgeStaleUploads(listingId: string) {
    const stale = await this.prisma.listingImage.findMany({
      where: {
        listingId,
        status: 'PENDING',
        createdAt: { lt: new Date(Date.now() - STALE_UPLOAD_MS) },
      },
    });
    if (stale.length === 0) return;
    await this.prisma.listingImage.deleteMany({
      where: { id: { in: stale.map((image) => image.id) } },
    });
    await this.deleteObjects(stale.flatMap((image) => (image.uploadKey ? [image.uploadKey] : [])));
  }

  /** Löschen im Speicher ist „best effort“: Verwaiste Objekte sind privat und über keine URL erreichbar. */
  private async deleteObjects(keys: string[]) {
    try {
      await this.storage.deleteMany(keys);
    } catch (error) {
      this.logger.warn(
        `Objekte konnten nicht gelöscht werden (${keys.length}): ${(error as Error).name}`,
      );
    }
  }
}
