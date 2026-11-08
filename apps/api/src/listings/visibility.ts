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

/** So lange bleibt eine als verkauft markierte Anzeige noch als „Verkauft“-Seite erreichbar (ohne Suche, ohne Kontakt) */
export const SOLD_PUBLIC_DAYS = 30;

export function soldPublicSince(now = new Date()) {
  return new Date(now.getTime() - SOLD_PUBLIC_DAYS * 86_400_000);
}

/** Öffentlich erreichbar: sichtbare Inserate sowie kürzlich verkaufte (Seite mit „Verkauft“-Hinweis) */
export function publiclyReachableWhere(now = new Date()): Prisma.ListingWhereInput {
  return {
    OR: [publiclyVisibleWhere(now), { status: 'SOLD', soldAt: { gt: soldPublicSince(now) }, deletedAt: null, seller: { status: 'ACTIVE', deletedAt: null } }],
  };
}

/** IDs von Inseraten, Unterhaltungen usw. (cuid). Alles andere wird wie „nicht gefunden“ behandelt. */
export const ENTITY_ID = /^[a-z0-9]{20,40}$/;
