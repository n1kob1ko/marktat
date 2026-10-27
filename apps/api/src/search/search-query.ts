/**
 * Übersetzt eine Suche in Meilisearch-Filter bzw. SQL – beide Wege liefern dieselben Treffer.
 */
import { SALARY_FILTER_KEY, type SearchFilter, type SearchQuery } from '@marktat/shared';
import { Prisma } from '../generated/prisma/client.js';

/** Aufgelöste Suche: Kategoriepfad und Ortsmittelpunkt stehen fest. */
export interface ResolvedSearch {
  query: SearchQuery;
  filters: readonly SearchFilter[];
  categoryPath: string | null;
  /** Ort für Umkreis bzw. PLZ-Filter */
  center: { latitude: number; longitude: number; postalCode: string } | null;
  /** Nur Inserate, die danach veröffentlicht wurden (Benachrichtigungen gespeicherter Suchen) */
  publishedAfter?: Date;
  /** … und spätestens dann (Zeitfenster der Benachrichtigung) */
  publishedUntil?: Date;
}

const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const num = (value: number) => {
  if (!Number.isFinite(value)) throw new Error('Ungültige Zahl im Filter');
  return String(value);
};

/** Filterausdrücke für Meilisearch (UND-verknüpft). */
export function meiliFilters(search: ResolvedSearch, now = new Date()): string[] {
  const { query, center } = search;
  const filters = [`expiresAt > ${Math.floor(now.getTime() / 1000)}`];
  if (search.publishedAfter) filters.push(`publishedAt > ${num(search.publishedAfter.getTime())}`);
  if (search.publishedUntil) filters.push(`publishedAt <= ${num(search.publishedUntil.getTime())}`);
  if (search.categoryPath) filters.push(`categoryPaths = ${quote(search.categoryPath)}`);
  else if (query.vertical) filters.push(`vertical = ${quote(query.vertical)}`);
  if (query.state) filters.push(`stateSlug = ${quote(query.state)}`);
  if (center && query.radiusKm) filters.push(`_geoRadius(${num(center.latitude)}, ${num(center.longitude)}, ${num(query.radiusKm * 1000)})`);
  else if (center) filters.push(`postalCode = ${quote(center.postalCode)}`);
  if (query.priceMin !== undefined) filters.push(`priceCents >= ${num(Math.round(query.priceMin * 100))}`);
  if (query.priceMax !== undefined) filters.push(`priceCents <= ${num(Math.round(query.priceMax * 100))}`);
  if (query.seller) filters.push(`isBusiness = ${query.seller === 'gewerblich'}`);
  if (query.conditions?.length) filters.push(`condition IN [${query.conditions.map(quote).join(', ')}]`);
  for (const filter of search.filters) {
    const value = query.attributes[filter.key];
    if (!value) continue;
    const field = `attributes.${filter.key}`;
    if (value.values?.length) {
      if (filter.kind === 'options' && filter.match === 'all') for (const v of value.values) filters.push(`${field} = ${quote(v)}`);
      else filters.push(`${field} IN [${value.values.map(quote).join(', ')}]`);
    }
    if (value.min !== undefined) filters.push(`${field} >= ${num(value.min)}`);
    if (value.max !== undefined) filters.push(`${field} <= ${num(value.max)}`);
    for (const word of value.words ?? []) filters.push(`${field} = ${quote(word)}`);
    if (value.flag) filters.push(`${field} = true`);
  }
  return filters;
}

/**
 * Sortierung; bei Gleichstand immer das neuere Inserat, zuletzt die ID (stabile Seiten, gleich wie in SQL).
 * „Neueste“ nutzt max(Veröffentlichung, Hochschieben) – Hochgeschobene sinken danach wieder normal ab.
 */
export function meiliSort(search: ResolvedSearch): string[] {
  const { query, center } = search;
  const newest = ['sortedAt:desc', 'id:desc'];
  switch (query.sort) {
    case 'preis_auf':
      return ['priceCents:asc', ...newest];
    case 'preis_ab':
      return ['priceCents:desc', ...newest];
    case 'entfernung':
      return center ? [`_geoPoint(${num(center.latitude)}, ${num(center.longitude)}):asc`, ...newest] : newest;
    default:
      // „Relevanz“: zuerst das Ranking von Meilisearch (Treffergüte), danach wie „Neueste“
      return newest;
  }
}

// --- PostgreSQL ----------------------------------------------------------------------

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Effektiver Preis in Cent wie im Suchindex: „zu verschenken“ = 0, „auf Anfrage“ = kein Preis */
const PRICE = Prisma.sql`(CASE WHEN l.price_type = 'FREE' THEN 0 WHEN l.price_type IN ('FIXED', 'NEGOTIABLE') THEN l.price_cents END)`;

function numericAttribute(key: string): Prisma.Sql {
  if (key === SALARY_FILTER_KEY) {
    // Monatsbrutto wie in monthlySalary(): Jahresgehalt / 14, Stundenlohn × Wochenstunden × 4,33
    const gross = numericAttribute('salaryGross');
    const hours = Prisma.sql`COALESCE(${numericAttribute('weeklyHours')}, 38.5)`;
    return Prisma.sql`(CASE l.attributes->>'salaryPeriod'
      WHEN 'year' THEN round(${gross} / 14)
      WHEN 'hour' THEN round(${gross} * ${hours} * 4.33)
      ELSE ${gross} END)`;
  }
  return Prisma.sql`(CASE WHEN jsonb_typeof(l.attributes->${key}::text) = 'number' THEN (l.attributes->>${key}::text)::numeric END)`;
}

/** WHERE-Bedingungen; die Tabellen heißen l (listings), u (users), c (categories), loc, d, s. */
export function sqlConditions(search: ResolvedSearch): Prisma.Sql[] {
  const { query, center } = search;
  const conditions: Prisma.Sql[] = [
    Prisma.sql`l.status = 'ACTIVE'`,
    Prisma.sql`l.deleted_at IS NULL`,
    // Zeitstempel liegen in UTC (Prisma, timestamp ohne Zeitzone)
    Prisma.sql`l.expires_at > (now() AT TIME ZONE 'UTC')`,
    Prisma.sql`u.status = 'ACTIVE'`,
    Prisma.sql`u.deleted_at IS NULL`,
  ];
  if (search.publishedAfter) conditions.push(Prisma.sql`l.published_at > ${search.publishedAfter}`);
  if (search.publishedUntil) conditions.push(Prisma.sql`l.published_at <= ${search.publishedUntil}`);
  if (query.q) {
    for (const word of query.q.split(' ').slice(0, 10)) {
      const pattern = `%${escapeLike(word)}%`;
      conditions.push(
        Prisma.sql`(l.title ILIKE ${pattern} OR l.description ILIKE ${pattern} OR c.name ILIKE ${pattern} OR l.attributes::text ILIKE ${pattern})`,
      );
    }
  }
  if (search.categoryPath) {
    conditions.push(Prisma.sql`(c.path = ${search.categoryPath} OR c.path LIKE ${`${escapeLike(search.categoryPath)}/%`})`);
  } else if (query.vertical) {
    conditions.push(Prisma.sql`l.vertical::text = ${query.vertical}`);
  }
  if (query.state) conditions.push(Prisma.sql`s.slug = ${query.state}`);
  if (center && query.radiusKm) {
    conditions.push(
      Prisma.sql`ST_DWithin(loc.geom, ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography, ${query.radiusKm * 1000})`,
    );
  } else if (center) {
    conditions.push(Prisma.sql`loc.postal_code = ${center.postalCode}`);
  }
  if (query.priceMin !== undefined) conditions.push(Prisma.sql`${PRICE} >= ${Math.round(query.priceMin * 100)}`);
  if (query.priceMax !== undefined) conditions.push(Prisma.sql`${PRICE} <= ${Math.round(query.priceMax * 100)}`);
  if (query.seller) conditions.push(Prisma.sql`u.account_type::text = ${query.seller === 'gewerblich' ? 'BUSINESS' : 'PRIVATE'}`);
  if (query.conditions?.length) conditions.push(Prisma.sql`l.condition::text = ANY(${query.conditions}::text[])`);

  for (const filter of search.filters) {
    const value = query.attributes[filter.key];
    if (!value) continue;
    if (value.values?.length) {
      if (filter.kind === 'options' && filter.match === 'all') {
        conditions.push(Prisma.sql`l.attributes->${filter.key}::text @> ${JSON.stringify(value.values)}::jsonb`);
      } else {
        conditions.push(Prisma.sql`l.attributes->>${filter.key}::text = ANY(${value.values}::text[])`);
      }
    }
    if (value.min !== undefined) conditions.push(Prisma.sql`${numericAttribute(filter.key)} >= ${value.min}`);
    if (value.max !== undefined) conditions.push(Prisma.sql`${numericAttribute(filter.key)} <= ${value.max}`);
    for (const word of value.words ?? []) {
      conditions.push(Prisma.sql`l.attributes->>${filter.key}::text ILIKE ${`%${escapeLike(word)}%`}`);
    }
    if (value.flag) conditions.push(Prisma.sql`l.attributes->${filter.key}::text = 'true'::jsonb`);
  }
  return conditions;
}

/** max(Veröffentlichung, Hochschieben) wie `sortedAt` im Suchindex (GREATEST ignoriert NULL) */
export const SORTED_AT = Prisma.sql`COALESCE(GREATEST(l.published_at, l.bumped_at), l.created_at)`;

export function sqlOrder(search: ResolvedSearch): Prisma.Sql {
  const { query, center } = search;
  const newest = Prisma.sql`${SORTED_AT} DESC, l.id COLLATE "C" DESC`;
  switch (query.sort) {
    case 'preis_auf':
      return Prisma.sql`${PRICE} ASC NULLS LAST, ${newest}`;
    case 'preis_ab':
      return Prisma.sql`${PRICE} DESC NULLS LAST, ${newest}`;
    case 'entfernung':
      if (center) {
        return Prisma.sql`ST_Distance(loc.geom, ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography) ASC NULLS LAST, ${newest}`;
      }
      return newest;
    case 'relevanz':
      if (query.q) return Prisma.sql`(l.title ILIKE ${`%${escapeLike(query.q)}%`}) DESC, ${newest}`;
      return newest;
    default:
      return newest;
  }
}
