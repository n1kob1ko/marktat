import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import type { CategoryNode, ListingSummary, Paginated } from '@marktat/shared';
import { api } from './api';

/**
 * Öffentliche, für alle Besucher gleiche Daten – serverseitig zwischengespeichert.
 * Fehler werden bewusst nicht im Cache abgefangen: Ein leeres Ergebnis während einer kurzen API-Störung
 * bliebe sonst stundenlang gespeichert (z. B. keine Kategorien im Inserat-Formular). Fehler speichert
 * „use cache“ nicht – der nächste Aufruf versucht es erneut.
 */

async function cachedCategories(): Promise<CategoryNode[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('categories');
  return api<CategoryNode[]>('/categories');
}

export async function getCategories(): Promise<CategoryNode[]> {
  return cachedCategories().catch(() => []);
}

async function cachedLatestListings(pageSize: number): Promise<ListingSummary[]> {
  'use cache';
  cacheLife('minutes');
  cacheTag('listings');
  return (await api<Paginated<ListingSummary>>(`/listings?pageSize=${pageSize}`)).items;
}

export async function getLatestListings(pageSize = 12): Promise<ListingSummary[]> {
  return cachedLatestListings(pageSize).catch(() => []);
}

export function findCategory(tree: CategoryNode[], id: string): CategoryNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    const child = findCategory(node.children, id);
    if (child) return child;
  }
  return undefined;
}
