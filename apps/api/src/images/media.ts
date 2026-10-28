import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { hmac, verifyHmac } from '../common/signing.js';
import type { ObjectStorage } from '../storage/storage.types.js';
import { IMAGE_VARIANT_NAMES, InvalidImageError, processImage, type ImageVariant } from './image-processor.js';

/**
 * Bilder weiterer Inhalte (Deals, Portfolio): gleiche Verarbeitung wie Inseratsbilder (Inhaltsprüfung, EXIF entfernt,
 * WebP-Varianten), aber direkt über die API hochgeladen (Rohdaten unter `/v1/media/...`).
 * Ausgeliefert wird über die Route des jeweiligen Bereichs, die Sichtbarkeit prüft und auf R2 weiterleitet.
 */
export const MEDIA_UPLOAD_PREFIX = 'media';
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const HOUR_MS = 3_600_000;
const VARIANT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export type MediaKind = 'deal' | 'portfolio';

export function mediaVariantKey(prefix: string, variant: ImageVariant) {
  return `${prefix}/${variant}.webp`;
}

/** Prüft und speichert ein hochgeladenes Bild unter `prefix`; Fehler im Bild ergeben 400. */
export async function storeMediaImage(storage: ObjectStorage, prefix: string, body: unknown): Promise<{ width: number; height: number }> {
  if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('Bitte wähle ein Bild aus (JPEG, PNG oder WebP).');
  if (body.length > MAX_MEDIA_BYTES) throw new BadRequestException('Ein Bild darf höchstens 15 MB groß sein.');
  let processed;
  try {
    processed = await processImage(body);
  } catch (error) {
    if (error instanceof InvalidImageError) throw new BadRequestException(error.message);
    throw error;
  }
  for (const variant of processed.variants) {
    await storage.put(mediaVariantKey(prefix, variant.name), variant.body, variant.contentType, VARIANT_CACHE_CONTROL);
  }
  return { width: processed.width, height: processed.height };
}

export function deleteMediaImage(storage: ObjectStorage, prefix: string) {
  return storage.deleteMany(IMAGE_VARIANT_NAMES.map((variant) => mediaVariantKey(prefix, variant)));
}

/** Stabile Bild-URLs; nicht öffentliche Inhalte (Entwürfe) bekommen eine zeitlich begrenzte Signatur. */
export class MediaUrls {
  constructor(
    private readonly apiUrl: string,
    private readonly secret: string,
  ) {}

  /** `path`: Route des Bereichs ohne Variante, z. B. „deals/<id>/bild“. `key` macht die URL nach einem Bildwechsel neu. */
  url(kind: MediaKind, path: string, id: string, key: string, variant: ImageVariant, signed: boolean, now = Date.now()): string {
    const version = createHash('sha256').update(key).digest('base64url').slice(0, 10);
    const base = `${this.apiUrl}/v1/${path}/${variant}?v=${version}`;
    if (!signed) return base;
    const exp = Math.ceil(now / HOUR_MS) * HOUR_MS + HOUR_MS;
    return `${base}&exp=${exp}&sig=${hmac(this.secret, `${kind}:${id}:${variant}:${exp}`)}`;
  }

  verify(kind: MediaKind, id: string, variant: string, exp: string | undefined, sig: string | undefined, now = Date.now()) {
    if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
    return verifyHmac(this.secret, `${kind}:${id}:${variant}:${exp}`, sig);
  }
}

export function isImageVariant(value: string): value is ImageVariant {
  return (IMAGE_VARIANT_NAMES as string[]).includes(value);
}
