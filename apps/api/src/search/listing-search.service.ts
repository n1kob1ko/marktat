import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  filterScope,
  isCategoryPath,
  parseSearchParams,
  peekFilterScope,
  searchFiltersFor,
  type RawSearchParams,
  type SearchQuery,
  type SearchResult,
} from '@marktat/shared';
import { Prisma } from '../generated/prisma/client.js';
import { CategoriesService } from '../categories/categories.service.js';
import { GeoService, locationInclude, toLocationSummary } from '../geo/geo.service.js';
import { ImageUrls } from '../images/image-urls.js';
import { listingInclude, toListingSummary } from '../listings/listings.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAX_TOTAL_HITS } from './search-document.js';
import { SearchIndexService } from './search-index.service.js';
import { meiliFilters, meiliSort, sqlConditions, sqlOrder, type ResolvedSearch } from './search-query.js';

/** Nach einem Fehler von Meilisearch so lange direkt PostgreSQL verwenden (keine Wartezeiten je Anfrage) */
const BACKOFF_MS = 30_000;

type Center = NonNullable<ResolvedSearch['center']> & { summary: SearchResult['location'] };

/**
 * Öffentliche Suche. Primär über Meilisearch (Tippfehlertoleranz, Relevanz), bei Ausfall oder ohne
 * Konfiguration über PostgreSQL mit denselben Filtern. In beiden Fällen kommen die angezeigten Daten
 * frisch aus PostgreSQL und werden dort nochmals auf Sichtbarkeit geprüft.
 */
@Injectable()
export class ListingSearchService {
  private readonly logger = new Logger(ListingSearchService.name);
  private meiliUnavailableUntil = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly index: SearchIndexService,
    private readonly urls: ImageUrls,
    private readonly geo: GeoService,
  ) {}

  /** Prüft die Parameter (400 bei ungültigen Werten) und sucht. */
  async searchParams(raw: RawSearchParams): Promise<SearchResult> {
    let scope = peekFilterScope(raw);
    const categoryParam = [raw.kategorie, raw.categoryId].flat().find(Boolean)?.trim();
    let categoryPath: string | null = null;
    if (categoryParam) {
      const category = isCategoryPath(categoryParam)
        ? await this.categories.findByPath(categoryParam)
        : await this.categories.findActive(categoryParam);
      if (!category) throw new BadRequestException({ statusCode: 400, message: 'Diese Kategorie gibt es nicht.', errors: [{ path: 'kategorie', message: 'Unbekannte Kategorie.' }] });
      categoryPath = category.path;
      scope = category.path;
    }
    const filters = searchFiltersFor(scope);
    const { query, issues } = parseSearchParams(raw, filters);
    if (issues.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Bitte prüfe die Suchparameter.',
        errors: issues.map((i) => ({ path: i.param, message: i.message })),
      });
    }
    if (categoryPath) query.category = categoryPath;
    return this.search(query, categoryPath);
  }

  /** `categoryPath`: bereits aufgelöste Kategorie (`query.category` kann eine alte ID sein). */
  async search(query: SearchQuery, categoryPath: string | null): Promise<SearchResult> {
    const center = await this.resolveCenter(query);
    const search: ResolvedSearch = { query, filters: searchFiltersFor(categoryPath ?? filterScope(query)), categoryPath, center };

    let page: { ids: string[]; total: number; engine: SearchResult['engine'] } | null = null;
    if (this.index.enabled && Date.now() >= this.meiliUnavailableUntil) {
      page = await this.searchMeili(search).catch((error: Error) => {
        this.meiliUnavailableUntil = Date.now() + BACKOFF_MS;
        this.logger.warn(`Meilisearch-Suche fehlgeschlagen, Ausweichbetrieb über PostgreSQL: ${error.message}`);
        return null;
      });
    }
    page ??= await this.searchPostgres(search);

    const rows = page.ids.length
      ? await this.prisma.listing.findMany({
          where: {
            id: { in: page.ids },
            status: 'ACTIVE',
            deletedAt: null,
            expiresAt: { gt: new Date() },
            seller: { status: 'ACTIVE', deletedAt: null },
          },
          include: listingInclude,
        })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Index noch nicht nachgezogen (z. B. eben pausiert): Treffer verwerfen und Eintrag korrigieren
    const stale = page.ids.filter((id) => !byId.has(id));
    for (const id of stale) this.index.sync(id);

    const items = page.ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const summary = toListingSummary(row, this.urls);
      if (center && row.location) summary.distanceKm = distanceKm(center, row.location);
      return [summary];
    });
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Math.max(0, page.total - stale.length),
      totalPages: Math.min(Math.ceil(Math.max(0, page.total - stale.length) / query.pageSize), Math.floor(MAX_TOTAL_HITS / query.pageSize)),
      location: center?.summary ?? null,
      engine: page.engine,
    };
  }

  private async searchMeili(search: ResolvedSearch) {
    const client = this.index.client!;
    if (!(await this.index.ensureReady())) throw new Error('Suchindex nicht bereit');
    const { query } = search;
    const response = await client.search<{ id: string }>(this.index.indexUid, {
      q: query.q ?? '',
      filter: meiliFilters(search),
      sort: meiliSort(search),
      page: query.page,
      hitsPerPage: query.pageSize,
      attributesToRetrieve: ['id'],
      matchingStrategy: 'all',
    });
    return { ids: response.hits.map((hit) => hit.id), total: response.totalHits ?? 0, engine: 'meilisearch' as const };
  }

  private async searchPostgres(search: ResolvedSearch) {
    const { query } = search;
    const from = Prisma.sql`
      FROM listings l
      JOIN users u ON u.id = l.seller_id
      LEFT JOIN categories c ON c.id = l.category_id
      LEFT JOIN locations loc ON loc.id = l.location_id
      LEFT JOIN districts d ON d.id = loc.district_id
      LEFT JOIN states s ON s.id = d.state_id
      WHERE ${Prisma.join(sqlConditions(search), ' AND ')}`;
    const offset = (query.page - 1) * query.pageSize;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`SELECT l.id ${from} ORDER BY ${sqlOrder(search)} LIMIT ${query.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${from}`,
    ]);
    return { ids: rows.map((r) => r.id), total: Number(count[0]?.total ?? 0), engine: 'postgres' as const };
  }

  /** Ort aus `ort` (ID) bzw. Hauptort der `plz` */
  private async resolveCenter(query: SearchQuery): Promise<Center | null> {
    if (!query.locationId && !query.postalCode) return null;
    const location = query.locationId
      ? await this.prisma.location.findUnique({ where: { id: query.locationId }, include: locationInclude })
      : await this.mainLocation(query.postalCode!);
    if (!location) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Diesen Ort kennen wir nicht.',
        errors: [{ path: query.locationId ? 'ort' : 'plz', message: 'Unbekannter Ort bzw. unbekannte Postleitzahl.' }],
      });
    }
    return { latitude: location.latitude, longitude: location.longitude, postalCode: location.postalCode, summary: toLocationSummary(location) };
  }

  /** Hauptort einer PLZ – dieselbe Reihenfolge wie die Ortsvorschläge (8010 → Graz, 2340 → Mödling) */
  private async mainLocation(postalCode: string) {
    const [first] = await this.geo.searchLocations(postalCode, 1);
    return first ? this.prisma.location.findUnique({ where: { id: first.id }, include: locationInclude }) : null;
  }
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}
