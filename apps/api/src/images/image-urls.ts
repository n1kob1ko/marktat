import type { ListingImage as ListingImageDto } from '@marktat/shared';
import { hmac, verifyHmac } from '../common/signing.js';
import type { ImageVariant } from './image-processor.js';

const HOUR_MS = 3_600_000;

export interface StoredImage {
  id: string;
  width: number | null;
  height: number | null;
  sortOrder: number;
}

/**
 * Stabile Bild-URLs auf die API (`/v1/images/:id/:variante`). Die API leitet auf eine kurzlebige R2-URL um.
 * Bilder öffentlicher Inserate brauchen keine Signatur; für Entwürfe/pausierte Inserate (nur Eigentümer
 * sieht sie) wird eine zeitlich begrenzte Signatur angehängt.
 */
export class ImageUrls {
  constructor(
    private readonly apiUrl: string,
    private readonly secret: string,
  ) {}

  url(imageId: string, variant: ImageVariant, signed: boolean, now = Date.now()): string {
    const base = `${this.apiUrl}/v1/images/${imageId}/${variant}`;
    if (!signed) return base;
    // Auf volle Stunden gerundet, damit Browser-Caches die URL wiederverwenden können (gültig 1–2 h).
    const exp = Math.ceil(now / HOUR_MS) * HOUR_MS + HOUR_MS;
    return `${base}?exp=${exp}&sig=${hmac(this.secret, `${imageId}:${variant}:${exp}`)}`;
  }

  verify(
    imageId: string,
    variant: string,
    exp: string | undefined,
    sig: string | undefined,
    now = Date.now(),
  ) {
    if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
    return verifyHmac(this.secret, `${imageId}:${variant}:${exp}`, sig);
  }

  toDto(image: StoredImage, position: number, signed: boolean): ListingImageDto {
    return {
      id: image.id,
      url: this.url(image.id, 'large', signed),
      thumbUrl: this.url(image.id, 'thumb', signed),
      width: image.width ?? 0,
      height: image.height ?? 0,
      position,
    };
  }
}
