'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { getAccessToken, requireUser } from '@/lib/auth';

const ID_PATTERN = /^[a-z0-9]{20,40}$/;

export type FavoriteResult = { ok: true; favorite: boolean } | { ok: false; reason: 'login' | 'error'; message: string };

/** Herz auf Karten und der Detailseite. Ohne Anmeldung meldet die Action das, der Client leitet zur Anmeldung. */
export async function setFavoriteAction(listingId: string, favorite: boolean): Promise<FavoriteResult> {
  if (!ID_PATTERN.test(listingId)) return { ok: false, reason: 'error', message: 'Diese Anzeige gibt es nicht.' };
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: 'login', message: 'Bitte melde dich an, um Anzeigen zu merken.' };
  try {
    await api(`/me/favorites/${listingId}`, { method: favorite ? 'PUT' : 'DELETE', token });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { ok: false, reason: 'login', message: 'Bitte melde dich an, um Anzeigen zu merken.' };
    const message = error instanceof ApiError ? error.message : 'Das hat nicht geklappt. Bitte versuche es erneut.';
    return { ok: false, reason: 'error', message };
  }
  return { ok: true, favorite };
}

/** Status der Herzen für mehrere Karten auf einmal. Ohne Anmeldung: nichts gemerkt. */
export async function favoriteStateAction(listingIds: string[]): Promise<{ favorites: string[]; own: string[] }> {
  const ids = [...new Set(listingIds)].filter((id) => ID_PATTERN.test(id)).slice(0, 100);
  const token = ids.length ? await getAccessToken() : null;
  if (!token) return { favorites: [], own: [] };
  try {
    const result = await api<{ listingIds: string[]; ownListingIds: string[] }>(`/me/favorites/ids?listingIds=${ids.join(',')}`, {
      token,
      cache: 'no-store',
    });
    return { favorites: result.listingIds, own: result.ownListingIds };
  } catch {
    return { favorites: [], own: [] };
  }
}

/** „Entfernen“ in der Merkliste (funktioniert auch ohne JavaScript). */
export async function removeFavoriteAction(formData: FormData) {
  const listingId = String(formData.get('listingId') ?? '');
  const { token } = await requireUser('/konto/merkliste');
  if (ID_PATTERN.test(listingId)) {
    try {
      await api(`/me/favorites/${listingId}`, { method: 'DELETE', token });
    } catch {
      redirect('/konto/merkliste?fehler=aktion');
    }
  }
  revalidatePath('/konto/merkliste');
  redirect('/konto/merkliste?hinweis=entfernt');
}

export type FavoriteKind = 'deal' | 'service';

const KIND_PATHS: Record<FavoriteKind, string> = { deal: 'deals', service: 'services' };
const KIND_LOGIN: Record<FavoriteKind, string> = {
  deal: 'Bitte melde dich an, um Deals zu merken.',
  service: 'Bitte melde dich an, um Anbieter zu merken.',
};

/** Merken auf der Detailseite eines Deals oder Anbieterprofils (getrennte Listen in der Merkliste) */
export async function setItemFavoriteAction(kind: FavoriteKind, id: string, favorite: boolean): Promise<FavoriteResult> {
  if (!(kind in KIND_PATHS) || !ID_PATTERN.test(id)) return { ok: false, reason: 'error', message: 'Diesen Eintrag gibt es nicht.' };
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: 'login', message: KIND_LOGIN[kind] };
  try {
    await api(`/me/favorites/${KIND_PATHS[kind]}/${id}`, { method: favorite ? 'PUT' : 'DELETE', token });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { ok: false, reason: 'login', message: KIND_LOGIN[kind] };
    const message = error instanceof ApiError ? error.message : 'Das hat nicht geklappt. Bitte versuche es erneut.';
    return { ok: false, reason: 'error', message };
  }
  return { ok: true, favorite };
}

/** „Entfernen“ für Deals und Anbieter in der Merkliste (funktioniert auch ohne JavaScript) */
export async function removeItemFavoriteAction(formData: FormData) {
  const kind = String(formData.get('kind') ?? '');
  const id = String(formData.get('id') ?? '');
  const tab = kind === 'deal' ? 'deals' : 'anbieter';
  const back = `/konto/merkliste?art=${tab}`;
  const { token } = await requireUser(back);
  if ((kind === 'deal' || kind === 'service') && ID_PATTERN.test(id)) {
    try {
      await api(`/me/favorites/${KIND_PATHS[kind]}/${id}`, { method: 'DELETE', token });
    } catch {
      redirect(`${back}&fehler=aktion`);
    }
  }
  revalidatePath('/konto/merkliste');
  redirect(`${back}&hinweis=entfernt`);
}
