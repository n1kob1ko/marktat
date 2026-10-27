import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import type { CategoryNode, ListingSummary, Paginated } from '@marktat/shared';
import { api } from './api';

/**
 * Öffentliche, für alle Besucher gleiche Daten – serverseitig zwischengespeichert.
 * Bei einer API-Störung gibt es einen leeren Ersatzwert, der nur Sekunden gilt (`cacheLife('seconds')`):
 * Mit der normalen Dauer bliebe er sonst stundenlang stehen (z. B. keine Kategorien im Inserat-Formular).
 * Werfen ist keine Lösung – ein Fehler beim Vorrendern bricht den Build ab, wenn die API dann nicht läuft.
 */

export async function getCategories(): Promise<CategoryNode[]> {
  'use cache';
  cacheTag('categories');
  try {
    const categories = await api<CategoryNode[]>('/categories');
    cacheLife('hours');
    return categories;
  } catch {
    cacheLife('seconds');
    return [];
  }
}

export async function getLatestListings(pageSize = 12): Promise<ListingSummary[]> {
  'use cache';
  cacheTag('listings');
  try {
    const page = await api<Paginated<ListingSummary>>(`/listings?pageSize=${pageSize}`);
    cacheLife('minutes');
    return page.items;
  } catch {
    cacheLife('seconds');
    return [];
  }
}

export function findCategory(tree: CategoryNode[], id: string): CategoryNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    const child = findCategory(node.children, id);
    if (child) return child;
  }
  return undefined;
}
