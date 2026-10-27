import sharp, { type Metadata } from 'sharp';
import type { ImageContentType } from '@marktat/shared';

/** Ausgabegrößen. Alle Varianten sind WebP und enthalten keine Metadaten (EXIF, GPS, XMP, IPTC). */
export const IMAGE_VARIANTS = {
  large: { width: 1600, height: 1600, fit: 'inside', quality: 82 },
  thumb: { width: 480, height: 360, fit: 'cover', quality: 76 },
} as const;
export type ImageVariant = keyof typeof IMAGE_VARIANTS;
export const IMAGE_VARIANT_NAMES = Object.keys(IMAGE_VARIANTS) as ImageVariant[];

/** Schutz vor „Dekompressionsbomben“: kleine Datei, riesige Pixelzahl. */
const MAX_INPUT_PIXELS = 60_000_000;
const MIN_EDGE = 200;

const FORMAT_TO_TYPE: Record<string, ImageContentType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export class InvalidImageError extends Error {}

export interface ProcessedImage {
  detectedType: ImageContentType;
  /** Abmessungen der großen Variante */
  width: number;
  height: number;
  variants: {
    name: ImageVariant;
    body: Buffer;
    contentType: 'image/webp';
    width: number;
    height: number;
  }[];
}

/**
 * Prüft den tatsächlichen Bildinhalt (nicht Dateiendung oder angegebenen Typ), richtet das Bild nach der
 * EXIF-Ausrichtung aus, entfernt alle Metadaten und erzeugt optimierte Varianten.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new InvalidImageError('Die Datei ist kein lesbares Bild.');
  }
  const detectedType = metadata.format ? FORMAT_TO_TYPE[metadata.format] : undefined;
  if (!detectedType) throw new InvalidImageError('Erlaubt sind nur JPEG, PNG oder WebP.');
  if (!metadata.width || !metadata.height)
    throw new InvalidImageError('Die Bildgröße konnte nicht gelesen werden.');
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS)
    throw new InvalidImageError('Das Bild hat zu viele Pixel.');
  if (Math.min(metadata.width, metadata.height) < MIN_EDGE) {
    throw new InvalidImageError(
      `Das Bild ist zu klein (mindestens ${MIN_EDGE} × ${MIN_EDGE} Pixel).`,
    );
  }

  const variants: ProcessedImage['variants'] = [];
  try {
    for (const name of IMAGE_VARIANT_NAMES) {
      const spec = IMAGE_VARIANTS[name];
      // failOn 'error': abgeschnittene oder beschädigte Dateien werden abgelehnt statt halb dekodiert.
      const { data, info } = await sharp(input, {
        limitInputPixels: MAX_INPUT_PIXELS,
        failOn: 'error',
      })
        .rotate() // EXIF-Ausrichtung anwenden, bevor die Metadaten entfernt werden
        .resize({
          width: spec.width,
          height: spec.height,
          fit: spec.fit,
          withoutEnlargement: spec.fit === 'inside',
          position: 'attention',
        })
        .toColorspace('srgb')
        .webp({ quality: spec.quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      variants.push({
        name,
        body: data,
        contentType: 'image/webp',
        width: info.width,
        height: info.height,
      });
    }
  } catch {
    throw new InvalidImageError('Die Datei ist beschädigt oder unvollständig.');
  }
  const large = variants.find((v) => v.name === 'large')!;
  return { detectedType, width: large.width, height: large.height, variants };
}
