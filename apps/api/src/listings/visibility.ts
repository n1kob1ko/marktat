import type { Prisma } from '../generated/prisma/client.js';

/** Öffentlich sichtbare Inserate – dieselbe Regel wie in Suche und Suchindex (isPubliclyVisible). */
export function publiclyVisibleWhere(now = new Date()): Prisma.ListingWhereInput {
  return {
    status: 'ACTIVE',
    deletedAt: null,
    expiresAt: { gt: now },
    seller: { status: 'ACTIVE', deletedAt: null },
  };
}

/** IDs von Inseraten, Unterhaltungen usw. (cuid). Alles andere wird wie „nicht gefunden“ behandelt. */
export const ENTITY_ID = /^[a-z0-9]{20,40}$/;
