import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import {
  DEAL_FACET_BRANDS,
  DEAL_FACET_SHOPS,
  DEAL_VERIFY_DAYS,
  parseDealSearchParams,
  stateBySlug,
  type DealFacets,
  type DealFacetValue,
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

/** Filter mit eigener Auswahlliste (Facette): Feld im Suchindex */
const FACET_FIELDS = { shop: 'merchantName', brand: 'brand', category: 'categorySlug' } as const;
type FacetKey = keyof typeof FACET_FIELDS;
const FACET_KEYS = Object.keys(FACET_FIELDS) as FacetKey[];
const isFacetActive = (query: DealSearchQuery, key: FacetKey) => Boolean(key === 'category' ? query.category : query[key]);

const EMPTY_FACETS: DealFacets = { shops: [], brands: [], categories: {} };

/** Top-Deals: Reihenfolge innerhalb eines Shops (wie „Höchster Rabatt“) */
const TOP_LANE_SORT = ['discountPercent:desc', 'publishedAt:desc', 'id:desc'];
/** Ab so vielen Shops wird nicht mehr gemischt (die Facette liefert höchstens maxValuesPerFacet Werte) */
const MAX_MIX_SHOPS = 200;

/**
 * Shops abwechselnd: Runde für Runde je ein Angebot von jedem Shop, der noch welche hat (größter Shop zuerst).
 * Liefert für die Seite ab `offset` die Reihenfolge der Shops und je Shop, ab welcher Stelle wie viele Treffer nötig sind.
 */
export function roundRobinSlots(counts: [shop: string, count: number][], offset: number, limit: number) {
  const shops = counts.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'));
  const taken = new Map<string, number>();
  const order: string[] = [];
  let position = 0;
  for (let round = 0; position < offset + limit; round++) {
    const active = shops.filter(([, n]) => n > round);
    if (!active.length) break;
    for (const [shop] of active) {
      if (position >= offset + limit) break;
      if (position >= offset) order.push(shop);
      else taken.set(shop, (taken.get(shop) ?? 0) + 1);
      position++;
    }
  }
  const lanes = new Map<string, { offset: number; limit: number }>();
  for (const shop of order) {
    const lane = lanes.get(shop) ?? { offset: taken.get(shop) ?? 0, limit: 0 };
    lane.limit++;
    lanes.set(shop, lane);
  }
  return { order, lanes };
}

function topValues(counts: Record<string, number> | undefined, limit: number): DealFacetValue[] {
  return Object.entries(counts ?? {})
    .filter(([value, count]) => value.trim() !== '' && count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

/** Facettenzählung aus Meilisearch bzw. PostgreSQL in die Form der API bringen */
export function toDealFacets(distribution: Partial<Record<FacetKey, Record<string, number>>>): DealFacets {
  return {
    shops: topValues(distribution.shop, DEAL_FACET_SHOPS),
    brands: topValues(distribution.brand, DEAL_FACET_BRANDS),
    categories: Object.fromEntries(Object.entries(distribution.category ?? {}).filter(([, count]) => count > 0)),
  };
}

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
  filterableAttributes: [
    'brand',
    'categorySlug',
    'discountPercent',
    'endsAt',
    'id',
    'local',
    'merchantId',
    'merchantName',
    'online',
    'postalCodes',
    'priceCents',
    'startsAt',
    'stateCodes',
    'verifiedUntil',
  ],
  sortableAttributes: ['discountPercent', 'endsAt', 'id', 'priceCents', 'publishedAt'],
  rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
  typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
  localizedAttributes: null,
  pagination: { maxTotalHits: MAX_TOTAL_HITS },
  // Häufigste Werte zuerst, damit bei vielen Marken die wichtigen nicht abgeschnitten werden
  faceting: { maxValuesPerFacet: 200, sortFacetValuesBy: { '*': 'count' } },
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
    return this.search(query, { facets: true });
  }

  async search(query: DealSearchQuery, options: { publishedAfter?: Date; publishedUntil?: Date; facets?: boolean } = {}): Promise<DealSearchResult> {
    const center = await this.resolveCenter(query);
    let page: { ids: string[]; total: number; engine: 'meilisearch' | 'postgres'; facets?: DealFacets } | null = null;
    const needsSql = query.sort === 'entfernung' || options.publishedAfter !== undefined;
    if (!needsSql && this.index.enabled && Date.now() >= this.meiliUnavailableUntil) {
      page = await this.searchMeili(query, center, options.facets ?? false).catch((error: Error) => {
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
      ...(page.facets && { facets: page.facets }),
    };
  }

  // --- Meilisearch ---------------------------------------------------------------------

  /** Filter für Meilisearch; null = keine Filiale im Umkreis, also keine Treffer */
  private async meiliFilters(query: DealSearchQuery, center: Center | null): Promise<{ key?: FacetKey; expr: string }[] | null> {
    const now = seconds(new Date());
    const filter: { key?: FacetKey; expr: string }[] = [`startsAt <= ${now}`, `endsAt > ${now}`, `verifiedUntil > ${now}`].map((expr) => ({ expr }));
    const add = (expr: string, key?: FacetKey) => filter.push({ key, expr });
    if (query.category) add(`categorySlug = ${quote(query.category)}`, 'category');
    if (query.shop) add(`merchantName = ${quote(query.shop)}`, 'shop');
    if (query.brand) add(`brand = ${quote(query.brand)}`, 'brand');
    if (query.merchantId) add(`merchantId = ${quote(query.merchantId)}`);
    if (query.channel === 'online') add('online = true');
    if (query.channel === 'lokal') add('local = true');
    if (query.state) add(`stateCodes = ${quote(stateBySlug(query.state)!.code)}`);
    if (center && query.radiusKm) {
      const candidates = await this.dealsNear(center, query.radiusKm, MAX_GEO_CANDIDATES + 1);
      if (candidates.length > MAX_GEO_CANDIDATES) throw new Error('Zu viele Deals im Umkreis für die Vorauswahl');
      if (!candidates.length) return null;
      add(`id IN [${candidates.map(quote).join(', ')}]`);
    } else if (center) {
      add(`postalCodes = ${quote(center.postalCode)}`);
    }
    if (query.priceMin !== undefined) add(`priceCents >= ${Math.round(query.priceMin * 100)}`);
    if (query.priceMax !== undefined) add(`priceCents <= ${Math.round(query.priceMax * 100)}`);
    if (query.discountMin !== undefined) add(`discountPercent >= ${query.discountMin}`);
    return filter;
  }

  private async searchMeili(query: DealSearchQuery, center: Center | null, withFacets: boolean) {
    const client = this.index.client!;
    if (!(await this.index.ensureReady())) throw new Error('Suchindex nicht bereit');
    const filter = await this.meiliFilters(query, center);
    if (!filter) return { ids: [], total: 0, engine: 'meilisearch' as const, ...(withFacets && { facets: EMPTY_FACETS }) };
    const without = (key?: FacetKey) => filter.filter((part) => !key || part.key !== key).map((part) => part.expr);
    const newest = ['publishedAt:desc', 'id:desc'];
    const sort = {
      relevanz: newest,
      top: TOP_LANE_SORT,
      neueste: newest,
      endet_bald: ['endsAt:asc', 'id:desc'],
      rabatt: ['discountPercent:desc', ...newest],
      preis_auf: ['priceCents:asc', ...newest],
      preis_ab: ['priceCents:desc', ...newest],
      entfernung: newest,
    }[query.sort];
    // Facetten ohne eigenen Filter zählen direkt in der Hauptsuche; ein aktiver Filter braucht eine eigene Zählung ohne sich selbst
    const inMain = withFacets ? FACET_KEYS.filter((key) => !isFacetActive(query, key)) : [];
    const separate = withFacets ? FACET_KEYS.filter((key) => isFacetActive(query, key)) : [];
    const base = { q: query.q ?? '', attributesToRetrieve: ['id'], matchingStrategy: 'all' };
    const separateCounts = Promise.all(
      separate.map((key) => client.search<{ id: string }>(this.index.uid, { ...base, filter: without(key), page: 1, hitsPerPage: 0, facets: [FACET_FIELDS[key]] })),
    );
    let page: { ids: string[]; total: number; distribution?: Record<string, Record<string, number>> };
    const mixShops = query.sort === 'top' && !query.shop && !query.merchantId;
    if (mixShops) {
      // Top-Deals: erst die Anzahl je Shop, dann je Shop genau die Treffer, die auf diese Seite fallen
      const head = await client.search<{ id: string }>(this.index.uid, {
        ...base,
        filter: without(),
        page: 1,
        hitsPerPage: 0,
        facets: [...new Set(['merchantName', ...inMain.map((key) => FACET_FIELDS[key])])],
      });
      const shopCounts = Object.entries(head.facetDistribution?.merchantName ?? {});
      const slots = shopCounts.length < MAX_MIX_SHOPS ? roundRobinSlots(shopCounts, (query.page - 1) * query.pageSize, query.pageSize) : null;
      let ids: string[];
      if (slots) {
        const lanes = await Promise.all(
          [...slots.lanes].map(([shop, lane]) =>
            client
              .search<{ id: string }>(this.index.uid, { ...base, filter: [...without(), `merchantName = ${quote(shop)}`], sort: TOP_LANE_SORT, offset: lane.offset, limit: lane.limit })
              .then((res) => [shop, res.hits.map((hit) => hit.id)] as const),
          ),
        );
        const byShop = new Map(lanes);
        ids = slots.order.flatMap((shop) => {
          const id = byShop.get(shop)?.shift();
          return id ? [id] : [];
        });
      } else {
        // Sehr viele Shops: kein Mischen, nur nach Rabatt und Aktualität
        const res = await client.search<{ id: string }>(this.index.uid, { ...base, filter: without(), sort: TOP_LANE_SORT, page: query.page, hitsPerPage: query.pageSize });
        ids = res.hits.map((hit) => hit.id);
      }
      page = { ids, total: head.totalHits ?? 0, distribution: head.facetDistribution };
    } else {
      const response = await client.search<{ id: string }>(this.index.uid, {
        ...base,
        filter: without(),
        sort,
        page: query.page,
        hitsPerPage: query.pageSize,
        ...(inMain.length && { facets: inMain.map((key) => FACET_FIELDS[key]) }),
      });
      page = { ids: response.hits.map((hit) => hit.id), total: response.totalHits ?? 0, distribution: response.facetDistribution };
    }
    const counts = await separateCounts;
    let facets: DealFacets | undefined;
    if (withFacets) {
      const distribution: Partial<Record<FacetKey, Record<string, number>>> = {};
      for (const key of inMain) distribution[key] = page.distribution?.[FACET_FIELDS[key]];
      separate.forEach((key, i) => (distribution[key] = counts[i]?.facetDistribution?.[FACET_FIELDS[key]]));
      facets = toDealFacets(distribution);
    }
    return { ids: page.ids, total: page.total, engine: 'meilisearch' as const, ...(facets && { facets }) };
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

  /** Bedingungen für PostgreSQL; `except` lässt einen Facettenfilter weg (für dessen Auswahlliste) */
  private sqlConditions(query: DealSearchQuery, center: Center | null, options: { publishedAfter?: Date; publishedUntil?: Date }, except?: FacetKey): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [dealVisibleSql()];
    if (options.publishedAfter) conditions.push(Prisma.sql`dl.published_at > ${options.publishedAfter}`);
    if (options.publishedUntil) conditions.push(Prisma.sql`dl.published_at <= ${options.publishedUntil}`);
    if (query.q) {
      for (const word of query.q.split(' ').slice(0, 10)) {
        const pattern = `%${escapeLike(word)}%`;
        conditions.push(Prisma.sql`(dl.title ILIKE ${pattern} OR dl.description ILIKE ${pattern} OR dl.brand ILIKE ${pattern} OR dc.name ILIKE ${pattern} OR ${dealSellerSql} ILIKE ${pattern})`);
      }
    }
    if (query.category && except !== 'category') conditions.push(Prisma.sql`dc.slug = ${query.category}`);
    if (query.shop && except !== 'shop') conditions.push(Prisma.sql`lower(${dealSellerSql}) = lower(${query.shop})`);
    if (query.brand && except !== 'brand') conditions.push(Prisma.sql`lower(dl.brand) = lower(${query.brand})`);
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
    return conditions;
  }

  /** Auswahllisten im Ausweichbetrieb (je Facette ohne deren eigenen Filter) */
  private async postgresFacets(query: DealSearchQuery, center: Center | null): Promise<DealFacets> {
    const from = (except: FacetKey) =>
      Prisma.sql`FROM deals dl ${dealJoinsSql()} JOIN deal_categories dc ON dc.id = dl.category_id WHERE ${Prisma.join(this.sqlConditions(query, center, {}, except), ' AND ')}`;
    type Row = { value: string | null; count: bigint };
    const [shops, brands, categories] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`SELECT ${dealSellerSql} AS value, count(*) AS count ${from('shop')} GROUP BY 1 ORDER BY 2 DESC LIMIT ${DEAL_FACET_SHOPS}`,
      this.prisma.$queryRaw<Row[]>`SELECT dl.brand AS value, count(*) AS count ${from('brand')} AND dl.brand IS NOT NULL AND dl.brand <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT ${DEAL_FACET_BRANDS}`,
      this.prisma.$queryRaw<Row[]>`SELECT dc.slug AS value, count(*) AS count ${from('category')} GROUP BY 1`,
    ]);
    const toRecord = (rows: Row[]) => Object.fromEntries(rows.filter((row) => row.value).map((row) => [row.value!, Number(row.count)]));
    return toDealFacets({ shop: toRecord(shops), brand: toRecord(brands), category: toRecord(categories) });
  }

  private async searchPostgres(query: DealSearchQuery, center: Center | null, options: { publishedAfter?: Date; publishedUntil?: Date; facets?: boolean }) {
    const conditions = this.sqlConditions(query, center, options);

    const newest = Prisma.sql`dl.published_at DESC NULLS LAST, dl.id COLLATE "C" DESC`;
    let order: Prisma.Sql;
    switch (query.sort) {
      case 'top':
        // Wie bei Meilisearch: Runde für Runde je Shop eins (größter Shop zuerst), im Shop höchster Rabatt, dann neueste
        order = query.shop || query.merchantId
          ? Prisma.sql`dl.discount_percent DESC NULLS LAST, ${newest}`
          : Prisma.sql`row_number() OVER (PARTITION BY ${dealSellerSql} ORDER BY dl.discount_percent DESC NULLS LAST, dl.published_at DESC NULLS LAST, dl.id COLLATE "C" DESC) ASC,
              count(*) OVER (PARTITION BY ${dealSellerSql}) DESC, ${dealSellerSql} ASC, dl.id COLLATE "C" DESC`;
        break;
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
    const [rows, count, facets] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`SELECT dl.id ${from} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${from}`,
      options.facets ? this.postgresFacets(query, center) : Promise.resolve(undefined),
    ]);
    return { ids: rows.map((row) => row.id), total: Number(count[0]?.total ?? 0), engine: 'postgres' as const, ...(facets && { facets }) };
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
