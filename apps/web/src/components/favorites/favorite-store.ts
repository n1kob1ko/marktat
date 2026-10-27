'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { favoriteStateAction } from './actions';

/**
 * Gemeinsamer Merkstatus aller Herzen auf der Seite. Karten fragen ihren Status gesammelt in einer
 * Anfrage ab (die Suchergebnisse bleiben dadurch für alle gleich und zwischenspeicherbar).
 */
export type FavoriteState = 'unknown' | 'yes' | 'no' | 'own';

const states = new Map<string, FavoriteState>();
const listeners = new Set<() => void>();
let queue = new Set<string>();
let scheduled = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Beim An- oder Abmelden: alle bekannten Zustände verwerfen und für sichtbare Herzen neu laden */
export function resetFavoriteStates() {
  if (!states.size) return;
  const ids = [...states.keys()];
  states.clear();
  for (const id of ids) request(id);
  emit();
}

export function setFavoriteState(listingId: string, state: FavoriteState) {
  states.set(listingId, state);
  emit();
}

function request(listingId: string) {
  if (states.has(listingId) || queue.has(listingId)) return;
  queue.add(listingId);
  if (scheduled) return;
  scheduled = true;
  setTimeout(async () => {
    const ids = [...queue];
    queue = new Set();
    scheduled = false;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const result = await favoriteStateAction(chunk).catch(() => ({ favorites: [], own: [] }));
      const favorites = new Set(result.favorites);
      const own = new Set(result.own);
      for (const id of chunk) if (!states.has(id)) states.set(id, own.has(id) ? 'own' : favorites.has(id) ? 'yes' : 'no');
    }
    emit();
  }, 0);
}

/** Merkstatus eines Inserats; `initial` (vom Server bekannt) spart die Abfrage. */
export function useFavoriteState(listingId: string, initial?: boolean): FavoriteState {
  useEffect(() => {
    if (initial !== undefined) {
      // Vom Server frisch geladen: gilt vor einem älteren Stand aus einer vorherigen Seite
      if (states.get(listingId) !== (initial ? 'yes' : 'no')) setFavoriteState(listingId, initial ? 'yes' : 'no');
    } else {
      request(listingId);
    }
  }, [listingId, initial]);
  return useSyncExternalStore(
    subscribe,
    () => states.get(listingId) ?? (initial === undefined ? 'unknown' : initial ? 'yes' : 'no'),
    () => (initial === undefined ? 'unknown' : initial ? 'yes' : 'no'),
  );
}
