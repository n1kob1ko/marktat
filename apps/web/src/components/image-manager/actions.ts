'use server';

import { updateTag } from 'next/cache';
import {
  createImageUploadSchema,
  reorderImagesSchema,
  type ImageUploadTicket,
  type ListingImage,
} from '@marktat/shared';
import { api, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';

/**
 * Server Actions für die Bildverwaltung. Das Access-Token bleibt auf dem Server; der Browser bekommt nur
 * die kurzlebige Upload-URL für genau eine Datei. Berechtigungen prüft die API.
 */
export type ImageActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const LISTING_ID = /^[a-z0-9]{20,40}$/;
const IMAGE_ID = /^[0-9a-f-]{36}$/;

async function call<T>(
  listingId: string,
  run: (token: string) => Promise<T>,
  changed = true,
): Promise<ImageActionResult<T>> {
  if (!LISTING_ID.test(listingId)) return { ok: false, message: 'Unbekannte Anzeige.' };
  const { token } = await requireUser(`/anzeige/${listingId}/bilder`);
  try {
    const data = await run(token);
    if (changed) updateTag('listings');
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function requestImageUpload(
  listingId: string,
  file: { contentType: string; size: number },
) {
  const parsed = createImageUploadSchema.safeParse(file);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message } as const;
  return call(
    listingId,
    (token) =>
      api<ImageUploadTicket>(`/listings/${listingId}/images/uploads`, {
        method: 'POST',
        token,
        body: parsed.data,
      }),
    false,
  );
}

export async function completeImageUpload(listingId: string, imageId: string) {
  if (!IMAGE_ID.test(imageId)) return { ok: false, message: 'Unbekanntes Bild.' } as const;
  return call(listingId, (token) =>
    api<ListingImage>(`/listings/${listingId}/images/${imageId}/complete`, {
      method: 'POST',
      token,
    }),
  );
}

export async function deleteImage(listingId: string, imageId: string) {
  if (!IMAGE_ID.test(imageId)) return { ok: false, message: 'Unbekanntes Bild.' } as const;
  return call(listingId, async (token) => {
    await api(`/listings/${listingId}/images/${imageId}`, { method: 'DELETE', token });
    return api<ListingImage[]>(`/listings/${listingId}/images`, { token, cache: 'no-store' });
  });
}

export async function setMainImage(listingId: string, imageId: string) {
  if (!IMAGE_ID.test(imageId)) return { ok: false, message: 'Unbekanntes Bild.' } as const;
  return call(listingId, (token) =>
    api<ListingImage[]>(`/listings/${listingId}/images/${imageId}/main`, { method: 'POST', token }),
  );
}

export async function reorderImages(listingId: string, imageIds: string[]) {
  const parsed = reorderImagesSchema.safeParse({ imageIds });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message } as const;
  return call(listingId, (token) =>
    api<ListingImage[]>(`/listings/${listingId}/images/order`, {
      method: 'PUT',
      token,
      body: parsed.data,
    }),
  );
}
