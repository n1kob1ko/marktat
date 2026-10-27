import {
  allSearchFilters,
  carryOverAttributes,
  categoryAttributeSchema,
  describeListingAttributes,
  filterValues,
  type ItemCondition,
  type Vertical,
} from '@marktat/shared';
import type { Prisma } from '../generated/prisma/client.js';

/** Was für ein Suchdokument aus der Datenbank geladen wird */
export const searchDocumentInclude = {
  category: { select: { path: true, name: true } },
  location: { include: { district: { include: { state: { select: { slug: true, name: true } } } } } },
  seller: { select: { accountType: true, status: true, deletedAt: true } },
} satisfies Prisma.ListingInclude;

export type IndexableListing = Prisma.ListingGetPayload<{ include: typeof searchDocumentInclude }>;

/**
 * Eintrag im Suchindex. Der Index dient nur zum Finden und Sortieren: angezeigt werden immer die
 * aktuellen Daten aus PostgreSQL (siehe ListingSearchService), damit nie veraltete Inhalte erscheinen.
 */
export interface SearchDocument {
  id: string;
  title: string;
  description: string;
  /** Zusatzangaben als Text, z. B. „VW Golf 1.5 TSI Diesel Schaltgetriebe“ – damit „golf diesel“ trifft */
  attributesText: string;
  categoryNames: string[];
  place: string | null;
  vertical: Vertical;
  /** Kategorie und alle Oberkategorien, z. B. ["marktplatz", "marktplatz/sport-freizeit", …] */
  categoryPaths: string[];
  /** Cent; „zu verschenken“ = 0, „Preis auf Anfrage“ = null */
  priceCents: number | null;
  condition: ItemCondition | null;
  isBusiness: boolean;
  stateSlug: string | null;
  postalCode: string | null;
  _geo?: { lat: number; lng: number };
  /** Unix-Zeit in Millisekunden (Benachrichtigungen gespeicherter Suchen: wirklich neue Inserate) */
  publishedAt: number;
  /** max(Veröffentlichung, Hochschieben) in Millisekunden – Sortierung „Neueste“ */
  sortedAt: number;
  /** Top-Anzeige bis (Unix-Sekunden, 0 = keine) */
  topUntil: number;
  /** Aufbau des Dokuments; ältere Einträge werden beim Abgleich neu geschrieben (kein Neuaufbau nötig) */
  v: number;
  /** Unix-Zeit in Sekunden */
  expiresAt: number;
  /** Letzte Änderung (Unix-Sekunden) – für den Abgleich mit der Datenbank */
  updatedAt: number;
  attributes: Record<string, string | number | boolean | string[]>;
}

/** Nur diese Inserate gehören in den Index – dieselbe Regel wie für die öffentliche Anzeige. */
export function isPubliclyVisible(
  listing: Pick<IndexableListing, 'status' | 'deletedAt' | 'expiresAt'> & { seller: Pick<IndexableListing['seller'], 'status' | 'deletedAt'> },
  now = new Date(),
) {
  return (
    listing.status === 'ACTIVE' &&
    listing.deletedAt === null &&
    listing.expiresAt !== null &&
    listing.expiresAt > now &&
    listing.seller.status === 'ACTIVE' &&
    listing.seller.deletedAt === null
  );
}

export function ancestorPaths(path: string): string[] {
  const segments = path.split('/');
  return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Erhöhen, wenn sich der Aufbau der Dokumente ändert (2 = Phase 7: sortedAt, topUntil) */
export const SEARCH_DOCUMENT_VERSION = 2;

export function toSearchDocument(listing: IndexableListing, categoryNames: (path: string) => string[]): SearchDocument {
  const path = listing.category?.path ?? null;
  const schema = categoryAttributeSchema(path);
  const attributes = carryOverAttributes(schema, listing.attributes);
  const priceCents =
    listing.priceType === 'FREE' ? 0 : listing.priceType === 'ON_REQUEST' || listing.priceCents === null ? null : Number(listing.priceCents);
  const location = listing.location;
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description.slice(0, 5000),
    attributesText: describeListingAttributes(schema, attributes)
      .map((item) => item.value)
      .join(' · '),
    categoryNames: path ? categoryNames(path) : [],
    place: location ? `${location.postalCode} ${location.place}` : null,
    vertical: listing.vertical,
    categoryPaths: path ? ancestorPaths(path) : [],
    priceCents,
    condition: listing.condition,
    isBusiness: listing.seller.accountType === 'BUSINESS',
    stateSlug: location?.district.state.slug ?? null,
    postalCode: location?.postalCode ?? null,
    ...(location && { _geo: { lat: location.latitude, lng: location.longitude } }),
    publishedAt: (listing.publishedAt ?? listing.createdAt).getTime(),
    sortedAt: Math.max((listing.publishedAt ?? listing.createdAt).getTime(), listing.bumpedAt?.getTime() ?? 0),
    topUntil: listing.topUntil ? seconds(listing.topUntil) : 0,
    v: SEARCH_DOCUMENT_VERSION,
    expiresAt: seconds(listing.expiresAt!),
    updatedAt: seconds(listing.updatedAt),
    attributes: filterValues(attributes),
  };
}

/** Indexeinstellungen – werden beim Start abgeglichen und bei jeder Neuindizierung gesetzt. */
export function indexSettings() {
  return {
    displayedAttributes: ['id', 'updatedAt', 'v'],
    searchableAttributes: ['title', 'attributesText', 'categoryNames', 'description', 'place'],
    filterableAttributes: [
      'vertical', 'categoryPaths', 'priceCents', 'condition', 'isBusiness', 'stateSlug', 'postalCode', '_geo', 'expiresAt', 'publishedAt', 'topUntil',
      ...allSearchFilters().map((f) => `attributes.${f.key}`),
    ].sort(),
    sortableAttributes: ['_geo', 'id', 'priceCents', 'publishedAt', 'sortedAt'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
    // Bewusst ohne deutsche Wortzerlegung (localizedAttributes „deu“): sie verhindert Tippfehlertoleranz
    // bei zusammengesetzten Wörtern („Fahrad“ fände „Fahrrad“ nicht mehr).
    typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
    localizedAttributes: null,
    pagination: { maxTotalHits: MAX_TOTAL_HITS },
    synonyms: {
      fahrrad: ['rad', 'bike'],
      rad: ['fahrrad'],
      'e-bike': ['ebike', 'pedelec'],
      ebike: ['e-bike', 'pedelec'],
      auto: ['pkw', 'wagen'],
      pkw: ['auto'],
      handy: ['smartphone', 'mobiltelefon'],
      smartphone: ['handy'],
      wohnung: ['apartment', 'appartement'],
      couch: ['sofa'],
      sofa: ['couch'],
      kasten: ['schrank'],
      schrank: ['kasten'],
    },
  };
}

/** Mehr Treffer zählt Meilisearch nicht genau – die Seitenanzahl wird entsprechend begrenzt. */
export const MAX_TOTAL_HITS = 10_000;
