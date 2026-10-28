import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import {
  DEAL_VERIFY_DAYS,
  parseDealSearchParams,
  stateBySlug,
  type DealSearchQuery,
  type DealSearchResult,
  type LocationSummary,
  type RawSearchParams,
} from '@marktat/shared';
import { Prisma } from '../generated/prisma/client.js';
import { loadEnv } from '../config/env.js';
import { GeoService, locationInclude, toLocationSummary } from '../geo/geo.service.js';
import { MediaUrls } from '../images/media.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createMeiliClient, SecondaryIndex } from '../search/secondary-index.js';
import { dealInclude, dealJoinsSql, dealSellerName, dealSellerSql, dealVisibleSql, isDealPublic, publicDealWhere, toDealSummary, type DealWithRelations } from './deals.mapper.js';

const BACKOFF_MS = 30_000;
const MAINTENANCE_INTERVAL_MS = 60_000;
const MAX_TOTAL_HITS = 5_000;
/** Umkreissuche: so viele Deals mit Filiale im Umkreis gehen als Vorauswahl an Meilisearch, sonst PostgreSQL */
const MAX_GEO_CANDIDATES = 2_000;
export const DEAL_DOCUMENT_VERSION = 2;

const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

type Center = { latitude: number; longitude: number; postalCode: string; summary: LocationSummary };

/** Suchdokument: nur, was Suche, Filter und Sortierung brauchen */
export function toDealDocument(deal: DealWithRelations) {
  const states = new Set<string>();
  const postalCodes = new Set<string>();
  for (const { store } of deal.stores) {
    postalCodes.add(store.location.postalCode);
    states.add(store.location.district.state.code);
  }
  return {
    id: deal.id,
    v: DEAL_DOCUMENT_VERSION,
    updatedAt: seconds(deal.updatedAt),
    title: deal.title,
    brand: deal.brand ?? '',
    description: deal.description.slice(0, 1000),
    merchantName: dealSellerName(deal),
    categoryName: deal.category.name,
    categorySlug: deal.category.slug,
    merchantId: deal.merchantId,
    online: deal.channel !== 'LOCAL',
    local: deal.channel !== 'ONLINE',
    priceCents: deal.priceCents,
    ...(deal.discountPercent !== null && { discountPercent: deal.discountPercent }),
    startsAt: seconds(deal.startsAt),
    endsAt: seconds(deal.endsAt),
    // Ohne erneute Bestätigung bis dahin sichtbar (DEAL_VERIFY_DAYS)
    verifiedUntil: deal.lastVerifiedAt ? seconds(deal.lastVerifiedAt) + DEAL_VERIFY_DAYS * 86_400 : 0,
    publishedAt: deal.publishedAt?.getTime() ?? 0,
    stateCodes: [...states],
    postalCodes: [...postalCodes],
  };
}

const INDEX_SETTINGS = {
  displayedAttributes: ['id', 'updatedAt', 'v'],
  searchableAttributes: ['title', 'brand', 'merchantName', 'categoryName', 'description'],
  filterableAttributes: ['categorySlug', 'discountPercent', 'endsAt', 'id', 'local', 'merchantId', 'online', 'postalCodes', 'priceCents', 'startsAt', 'stateCodes', 'verifiedUntil'],
  sortableAttributes: ['discountPercent', 'endsAt', 'id', 'priceCents', 'publishedAt'],
  rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
  typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
  localizedAttributes: null,
  pagination: { maxTotalHits: MAX_TOTAL_HITS },
  synonyms: {
    handy: ['smartphone'],
    smartphone: ['handy'],
    laptop: ['notebook'],
    notebook: ['laptop'],
    fernseher: ['tv'],
    tv: ['fernseher'],
  },
};

/**
 * Suche in Deals: Meilisearch (Tippfehler, Relevanz) mit PostgreSQL als Ausweichweg und für Entfernungen.
 * Die Umkreissuche läuft über PostGIS (Filialen eines Deals) – das Ergebnis schränkt die Meilisearch-Suche ein.
 * Angezeigte Daten kommen immer frisch aus PostgreSQL und werden dort erneut auf Sichtbarkeit geprüft.
 */
@Injectable()
export class DealSearchService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DealSearchService.name);
  readonly index: SecondaryIndex<DealWithRelations>;
  private meiliUnavailableUntil = 0;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: MediaUrls,
    private readonly geo: GeoService,
  ) {
    this.index = new SecondaryIndex(
      createMeiliClient(),
      {
        uid: `${loadEnv().MEILI_INDEX}_deals`,
        settings: INDEX_SETTINGS,
        version: DEAL_DOCUMENT_VERSION,
        load: (ids) => this.prisma.deal.findMany({ where: { id: { in: ids } }, include: dealInclude }),
        isVisible: (deal, now) => isDealPublic(deal, now),
        toDocument: toDealDocument,
        visiblePage: (cursor, take) =>
          this.prisma.deal.findMany({
            where: publicDealWhere(),
            select: { id: true, updatedAt: true },
            orderBy: { id: 'asc' },
            take,
            ...(cursor && { skip: 1, cursor: { id: cursor } }),
          }),
        expiredFilter: (now) => `endsAt <= ${now} OR verifiedUntil <= ${now}`,
      },
      'DealIndex',
    );
  }

  onApplicationBootstrap() {
    if (!this.index.enabled || loadEnv().NODE_ENV === 'test') return;
    void this.index.ensureReady().then((ok) => ok && this.index.track(this.index.reconcile()));
    this.timer = setInterval(() => this.index.track(this.index.maintenance()), MAINTENANCE_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.index.flush();
  }

  /** Alle Deals eines Händlers neu bewerten (Sperre, Kontostatus, Firmenname) */
  syncMerchant(merchantId: string) {
    if (!this.index.enabled) return;
    this.index.track(
      this.prisma.deal
        .findMany({ where: { merchantId, status: { not: 'DELETED' } }, select: { id: true } })
        .then((rows) => this.index.syncNow(rows.map((r) => r.id), loadEnv().NODE_ENV === 'test')),
    );
  }

  async searchParams(raw: RawSearchParams): Promise<DealSearchResult> {
    const { query, issues } = parseDealSearchParams(raw);
    if (issues.length) {
      throw new BadRequestException({ statusCode: 400, message: 'Bitte prüfe die Suchparameter.', errors: issues.map((i) => ({ path: i.param, message: i.message })) });
    }
    return this.search(query);
  }

  async search(query: DealSearchQuery, options: { publishedAfter?: Date; publishedUntil?: Date } = {}): Promise<DealSearchResult> {
    const center = await this.resolveCenter(query);
    let page: { ids: string[]; total: number; engine: 'meilisearch' | 'postgres' } | null = null;
    const needsSql = query.sort === 'entfernung' || options.publishedAfter !== undefined;
    if (!needsSql && this.index.enabled && Date.now() >= this.meiliUnavailableUntil) {
      page = await this.searchMeili(query, center).catch((error: Error) => {
        this.meiliUnavailableUntil = Date.now() + BACKOFF_MS;
        this.logger.warn(`Meilisearch-Suche (Deals) fehlgeschlagen, Ausweichbetrieb über PostgreSQL: ${error.message}`);
        return null;
      });
    }
    page ??= await this.searchPostgres(query, center, options);

    const rows = page.ids.length ? await this.prisma.deal.findMany({ where: { id: { in: page.ids }, ...publicDealWhere() }, include: dealInclude }) : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const stale = page.ids.filter((id) => !byId.has(id));
    if (stale.length) this.index.syncMany(stale);
    const items = page.ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toDealSummary(row, this.urls, center)] : [];
    });
    const total = Math.max(0, page.total - stale.length);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.min(Math.ceil(total / query.pageSize), Math.floor(MAX_TOTAL_HITS / query.pageSize)),
      location: center?.summary ?? null,
      engine: page.engine,
    };
  }

  // --- Meilisearch ---------------------------------------------------------------------

  private async searchMeili(query: DealSearchQuery, center: Center | null) {
    const client = this.index.client!;
    if (!(await this.index.ensureReady())) throw new Error('Suchindex nicht bereit');
    const now = seconds(new Date());
    const filter = [`startsAt <= ${now}`, `endsAt > ${now}`, `verifiedUntil > ${now}`];
    if (query.category) filter.push(`categorySlug = ${quote(query.category)}`);
    if (query.merchantId) filter.push(`merchantId = ${quote(query.merchantId)}`);
    if (query.channel === 'online') filter.push('online = true');
    if (query.channel === 'lokal') filter.push('local = true');
    if (query.state) filter.push(`stateCodes = ${quote(stateBySlug(query.state)!.code)}`);
    if (center && query.radiusKm) {
      const candidates = await this.dealsNear(center, query.radiusKm, MAX_GEO_CANDIDATES + 1);
      if (candidates.length > MAX_GEO_CANDIDATES) throw new Error('Zu viele Deals im Umkreis für die Vorauswahl');
      if (!candidates.length) return { ids: [], total: 0, engine: 'meilisearch' as const };
      filter.push(`id IN [${candidates.map(quote).join(', ')}]`);
    } else if (center) {
      filter.push(`postalCodes = ${quote(center.postalCode)}`);
    }
    if (query.priceMin !== undefined) filter.push(`priceCents >= ${Math.round(query.priceMin * 100)}`);
    if (query.priceMax !== undefined) filter.push(`priceCents <= ${Math.round(query.priceMax * 100)}`);
    if (query.discountMin !== undefined) filter.push(`discountPercent >= ${query.discountMin}`);
    const newest = ['publishedAt:desc', 'id:desc'];
    const sort = {
      relevanz: newest,
      neueste: newest,
      endet_bald: ['endsAt:asc', 'id:desc'],
      rabatt: ['discountPercent:desc', ...newest],
      preis_auf: ['priceCents:asc', ...newest],
      preis_ab: ['priceCents:desc', ...newest],
      entfernung: newest,
    }[query.sort];
    const response = await client.search<{ id: string }>(this.index.uid, {
      q: query.q ?? '',
      filter,
      sort,
      page: query.page,
      hitsPerPage: query.pageSize,
      attributesToRetrieve: ['id'],
      matchingStrategy: 'all',
    });
    return { ids: response.hits.map((hit) => hit.id), total: response.totalHits ?? 0, engine: 'meilisearch' as const };
  }

  /** Deals mit mindestens einer Filiale im Umkreis (PostGIS, Ortsmittelpunkt der PLZ) */
  private async dealsNear(center: Center, radiusKm: number, limit: number) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ds.deal_id AS id
      FROM deal_stores ds
      JOIN dealer_stores st ON st.id = ds.store_id AND st.deleted_at IS NULL
      JOIN locations loc ON loc.id = st.location_id
      JOIN deals dl ON dl.id = ds.deal_id
      ${dealJoinsSql()}
      WHERE ${dealVisibleSql()}
        AND ST_DWithin(loc.geom, ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography, ${radiusKm * 1000})
      LIMIT ${limit}`;
    return rows.map((row) => row.id);
  }

  // --- PostgreSQL ----------------------------------------------------------------------

  private async searchPostgres(query: DealSearchQuery, center: Center | null, options: { publishedAfter?: Date; publishedUntil?: Date }) {
    const conditions: Prisma.Sql[] = [dealVisibleSql()];
    if (options.publishedAfter) conditions.push(Prisma.sql`dl.published_at > ${options.publishedAfter}`);
    if (options.publishedUntil) conditions.push(Prisma.sql`dl.published_at <= ${options.publishedUntil}`);
    if (query.q) {
      for (const word of query.q.split(' ').slice(0, 10)) {
        const pattern = `%${escapeLike(word)}%`;
        conditions.push(Prisma.sql`(dl.title ILIKE ${pattern} OR dl.description ILIKE ${pattern} OR dl.brand ILIKE ${pattern} OR dc.name ILIKE ${pattern} OR ${dealSellerSql} ILIKE ${pattern})`);
      }
    }
    if (query.category) conditions.push(Prisma.sql`dc.slug = ${query.category}`);
    if (query.merchantId) conditions.push(Prisma.sql`dl.merchant_id = ${query.merchantId}::uuid`);
    if (query.channel === 'online') conditions.push(Prisma.sql`dl.channel IN ('ONLINE', 'BOTH')`);
    if (query.channel === 'lokal') conditions.push(Prisma.sql`dl.channel IN ('LOCAL', 'BOTH')`);
    const storeConditions: Prisma.Sql[] = [];
    if (query.state) storeConditions.push(Prisma.sql`s.slug = ${query.state}`);
    if (center && query.radiusKm) {
      storeConditions.push(Prisma.sql`ST_DWithin(loc.geom, ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography, ${query.radiusKm * 1000})`);
    } else if (center) {
      storeConditions.push(Prisma.sql`loc.postal_code = ${center.postalCode}`);
    }
    if (storeConditions.length) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM deal_stores ds
        JOIN dealer_stores st ON st.id = ds.store_id AND st.deleted_at IS NULL
        JOIN locations loc ON loc.id = st.location_id
        JOIN districts d ON d.id = loc.district_id
        JOIN states s ON s.id = d.state_id
        WHERE ds.deal_id = dl.id AND ${Prisma.join(storeConditions, ' AND ')})`);
    }
    if (query.priceMin !== undefined) conditions.push(Prisma.sql`dl.price_cents >= ${Math.round(query.priceMin * 100)}`);
    if (query.priceMax !== undefined) conditions.push(Prisma.sql`dl.price_cents <= ${Math.round(query.priceMax * 100)}`);
    if (query.discountMin !== undefined) conditions.push(Prisma.sql`dl.discount_percent >= ${query.discountMin}`);

    const newest = Prisma.sql`dl.published_at DESC NULLS LAST, dl.id COLLATE "C" DESC`;
    let order: Prisma.Sql;
    switch (query.sort) {
      case 'endet_bald':
        order = Prisma.sql`dl.ends_at ASC, dl.id COLLATE "C" DESC`;
        break;
      case 'rabatt':
        order = Prisma.sql`dl.discount_percent DESC NULLS LAST, ${newest}`;
        break;
      case 'preis_auf':
        order = Prisma.sql`dl.price_cents ASC, ${newest}`;
        break;
      case 'preis_ab':
        order = Prisma.sql`dl.price_cents DESC, ${newest}`;
        break;
      case 'entfernung':
        order = center
          ? Prisma.sql`(SELECT min(ST_Distance(loc.geom, ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography))
              FROM deal_stores ds JOIN dealer_stores st ON st.id = ds.store_id AND st.deleted_at IS NULL JOIN locations loc ON loc.id = st.location_id
              WHERE ds.deal_id = dl.id) ASC NULLS LAST, ${newest}`
          : newest;
        break;
      case 'relevanz':
        order = query.q ? Prisma.sql`(dl.title ILIKE ${`%${escapeLike(query.q)}%`}) DESC, ${newest}` : newest;
        break;
      default:
        order = newest;
    }
    const from = Prisma.sql`FROM deals dl ${dealJoinsSql()} JOIN deal_categories dc ON dc.id = dl.category_id WHERE ${Prisma.join(conditions, ' AND ')}`;
    const offset = (query.page - 1) * query.pageSize;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`SELECT dl.id ${from} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${from}`,
    ]);
    return { ids: rows.map((row) => row.id), total: Number(count[0]?.total ?? 0), engine: 'postgres' as const };
  }

  /** Ort aus `ort` (ID) bzw. Hauptort der `plz` – wie in der Inseratssuche */
  async resolveCenter(query: Pick<DealSearchQuery, 'locationId' | 'postalCode'>): Promise<Center | null> {
    if (!query.locationId && !query.postalCode) return null;
    let location = query.locationId ? await this.prisma.location.findUnique({ where: { id: query.locationId }, include: locationInclude }) : null;
    if (!query.locationId && query.postalCode) {
      const [first] = await this.geo.searchLocations(query.postalCode, 1);
      location = first ? await this.prisma.location.findUnique({ where: { id: first.id }, include: locationInclude }) : null;
    }
    if (!location) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Diesen Ort kennen wir nicht.',
        errors: [{ path: query.locationId ? 'ort' : 'plz', message: 'Unbekannter Ort bzw. unbekannte Postleitzahl.' }],
      });
    }
    return { latitude: location.latitude, longitude: location.longitude, postalCode: location.postalCode, summary: toLocationSummary(location) };
  }
}
