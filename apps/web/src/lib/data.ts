import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import type { CategoryNode, ListingSummary, Paginated } from '@marktat/shared';
import { api } from './api';

/** Öffentliche, für alle Besucher gleiche Daten – serverseitig zwischengespeichert. */

export async function getCategories(): Promise<CategoryNode[]> {
  'use cache';
  cacheLife('hours');
  cacheTag('categories');
  try {
    return await api<CategoryNode[]>('/categories');
  } catch {
    return [];
  }
}

export async function getLatestListings(pageSize = 12): Promise<ListingSummary[]> {
  'use cache';
  cacheLife('minutes');
  cacheTag('listings');
  try {
    return (await api<Paginated<ListingSummary>>(`/listings?pageSize=${pageSize}`)).items;
  } catch {
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
