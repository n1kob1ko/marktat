import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types.js';
import { imagePlaceholder } from './image-processor.js';
import { variantKey } from './listing-images.service.js';

export const IMAGE_PLACEHOLDER_JOB = 'image-placeholders';
const INTERVAL_MS = 5 * 60_000;
const BATCH = 100;
/** Das Vorschaubild ist klein; alles darüber ist kein gültiges Vorschaubild */
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

/**
 * Trägt den verschwommenen Platzhalter für Bilder nach, die vor seiner Einführung hochgeladen wurden.
 * Neue Bilder bekommen ihn gleich beim Upload (ListingImagesService.complete). Läuft in kleinen Portionen
 * im Hintergrund und hat nichts mehr zu tun, sobald alle Bilder einen Platzhalter haben.
 * Lässt sich ein Vorschaubild nicht lesen, bleibt ein leerer Text stehen – das Bild wird nicht erneut versucht.
 */
@Injectable()
export class ImagePlaceholderService implements OnModuleInit {
  private readonly logger = new Logger(ImagePlaceholderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onModuleInit() {
    this.jobs.register(IMAGE_PLACEHOLDER_JOB, () => this.backfill().then(() => undefined));
    this.jobs.every(IMAGE_PLACEHOLDER_JOB, INTERVAL_MS);
  }

  async backfill(limit = BATCH): Promise<{ filled: number; failed: number }> {
    const images = await this.prisma.listingImage.findMany({
      where: { status: 'READY', placeholder: null },
      select: { id: true, storageKey: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    let filled = 0;
    let failed = 0;
    for (const image of images) {
      let placeholder = '';
      try {
        placeholder = await imagePlaceholder(
          await this.storage.getBytes(variantKey(image.storageKey, 'thumb'), MAX_THUMB_BYTES),
        );
        filled++;
      } catch (error) {
        failed++;
        this.logger.warn(`Platzhalter für Bild ${image.id} nicht erzeugt: ${(error as Error).message}`);
      }
      await this.prisma.listingImage.updateMany({ where: { id: image.id }, data: { placeholder } });
    }
    if (images.length) this.logger.log(`Bild-Platzhalter nachgetragen: ${filled}, fehlgeschlagen: ${failed}`);
    return { filled, failed };
  }
}
