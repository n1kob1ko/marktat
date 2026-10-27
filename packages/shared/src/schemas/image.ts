import { z } from 'zod';

/** Höchstens so viele Bilder je Inserat (inklusive laufender Uploads). */
export const MAX_IMAGES_PER_LISTING = 10;
/** Höchstgröße einer Bilddatei vor der Verarbeitung: 15 MB. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];
/** Für <input accept> und Fehlermeldungen */
export const IMAGE_ACCEPT = IMAGE_CONTENT_TYPES.join(',');
export const IMAGE_TYPE_LABEL = 'JPEG, PNG oder WebP';

export function isImageContentType(value: string): value is ImageContentType {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Schritt 1: Upload anmelden – liefert eine kurzlebige, signierte Upload-URL. */
export const createImageUploadSchema = z.object({
  contentType: z.enum(IMAGE_CONTENT_TYPES, { error: `Erlaubt sind nur ${IMAGE_TYPE_LABEL}.` }),
  size: z
    .number({ error: 'Dateigröße fehlt.' })
    .int()
    .positive('Die Datei ist leer.')
    .max(MAX_IMAGE_BYTES, 'Ein Bild darf höchstens 15 MB groß sein.'),
});
export type CreateImageUploadInput = z.infer<typeof createImageUploadSchema>;

/** Neue Reihenfolge; das erste Bild ist das Hauptbild. */
export const reorderImagesSchema = z.object({
  imageIds: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(MAX_IMAGES_PER_LISTING)
    .refine((ids) => new Set(ids).size === ids.length, 'Jedes Bild darf nur einmal vorkommen.'),
});
export type ReorderImagesInput = z.infer<typeof reorderImagesSchema>;
