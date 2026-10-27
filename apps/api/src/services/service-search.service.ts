import { BadRequestException, Injectable } from '@nestjs/common';
import { MAX_SEARCH_PAGE, parseServiceSearchParams, type RawSearchParams, type ServiceSearchQuery, type ServiceSearchResult } from '@marktat/shared';
import { Prisma } from '../generated/prisma/client.js';
import { GeoService, locationInclude, toLocationSummary } from '../geo/geo.service.js';
import { MediaUrls } from '../images/media.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { serviceProfileInclude, toServiceProfileSummary } from './services.mapper.js';
import { publicServiceProfileWhere } from './visibility.js';

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Suche nach Anbieterprofilen direkt in PostgreSQL/PostGIS (überschaubare Datenmenge, keine Abhängigkeit von Meilisearch).
 * Ein Ort passt, wenn das Profil österreichweit arbeitet oder der Ort im Umkreis liegt – maßgeblich ist der größere
 * Wert aus gesuchtem Umkreis und Einsatzradius des Profils; ohne beides zählt die gleiche Postleitzahl.
 */
@Injectable()
export class ServiceSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly urls: MediaUrls,
  ) {}

  async searchParams(raw: RawSearchParams): Promise<ServiceSearchResult> {
    const { query, issues } = parseServiceSearchParams(raw);
    if (issues.length) {
      throw new BadRequestException({ statusCode: 400, message: 'Bitte prüfe die Suchparameter.', errors: issues.map((i) => ({ path: i.param, message: i.message })) });
    }
    return this.search(query);
  }

  async search(query: ServiceSearchQuery): Promise<ServiceSearchResult> {
    const center = await this.resolveCenter(query);
    const conditions: Prisma.Sql[] = [Prisma.sql`sp.status = 'ACTIVE'`, Prisma.sql`u.status = 'ACTIVE'`, Prisma.sql`u.deleted_at IS NULL`];
    if (query.q) {
      for (const word of query.q.split(' ').slice(0, 10)) {
        const pattern = `%${escapeLike(word)}%`;
        conditions.push(Prisma.sql`(sp.headline ILIKE ${pattern} OR sp.summary ILIKE ${pattern} OR sp.description ILIKE ${pattern}
          OR array_to_string(sp.skills, ' ') ILIKE ${pattern} OR COALESCE(u.company_name, u.display_name) ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM service_profile_categories pc JOIN service_categories c ON c.id = pc.category_id WHERE pc.profile_id = sp.id AND c.name ILIKE ${pattern}))`);
      }
    }
    if (query.category) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM service_profile_categories pc JOIN service_categories c ON c.id = pc.category_id WHERE pc.profile_id = sp.id AND c.slug = ${query.category})`);
    } else if (query.group) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM service_profile_categories pc JOIN service_categories c ON c.id = pc.category_id WHERE pc.profile_id = sp.id AND c.group_slug = ${query.group})`);
    }
    const point = center ? Prisma.sql`ST_SetSRID(ST_MakePoint(${center.longitude}, ${center.latitude}), 4326)::geography` : null;
    // Remote-Arbeit ist ortsunabhängig: mit „remote“ schränkt der Ort nicht ein (er bleibt für die Entfernung)
    if (center && point && !query.remote) {
      const radiusKm = query.radiusKm ?? 0;
      conditions.push(Prisma.sql`(sp.austria_wide OR (loc.id IS NOT NULL AND (
        loc.postal_code = ${center.postalCode}
        OR ST_DWithin(loc.geom, ${point}, GREATEST(${radiusKm}::int, COALESCE(sp.service_radius_km, 0)) * 1000)
      )))`);
    }
    if (query.remote) conditions.push(Prisma.sql`sp.remote`);
    if (query.available) conditions.push(Prisma.sql`sp.availability IN ('AVAILABLE', 'LIMITED')`);
    if (query.priceMax !== undefined) conditions.push(Prisma.sql`sp.price_type <> 'ON_REQUEST' AND sp.price_cents <= ${Math.round(query.priceMax * 100)}`);
    if (query.providerType === 'gewerblich') conditions.push(Prisma.sql`u.account_type = 'BUSINESS'`);
    if (query.providerType === 'privat') conditions.push(Prisma.sql`u.account_type = 'PRIVATE'`);

    const newest = Prisma.sql`sp.updated_at DESC, sp.id COLLATE "C" DESC`;
    let order: Prisma.Sql;
    switch (query.sort) {
      case 'preis_auf':
        order = Prisma.sql`(sp.price_type = 'ON_REQUEST') ASC, sp.price_cents ASC NULLS LAST, ${newest}`;
        break;
      case 'entfernung':
        order = point ? Prisma.sql`ST_Distance(loc.geom, ${point}) ASC NULLS LAST, ${newest}` : newest;
        break;
      case 'relevanz':
        order = query.q ? Prisma.sql`(sp.headline ILIKE ${`%${escapeLike(query.q)}%`}) DESC, ${newest}` : newest;
        break;
      default:
        order = newest;
    }
    const from = Prisma.sql`FROM service_profiles sp JOIN users u ON u.id = sp.user_id LEFT JOIN locations loc ON loc.id = sp.location_id
      WHERE ${Prisma.join(conditions, ' AND ')}`;
    const offset = (query.page - 1) * query.pageSize;
    const [ids, count] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`SELECT sp.id ${from} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${from}`,
    ]);
    const rows = ids.length
      ? await this.prisma.serviceProfile.findMany({ where: { id: { in: ids.map((r) => r.id) }, ...publicServiceProfileWhere() }, include: serviceProfileInclude })
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids.flatMap(({ id }) => {
      const row = byId.get(id);
      return row ? [toServiceProfileSummary(row, this.urls, center)] : [];
    });
    const total = Number(count[0]?.total ?? 0);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.min(Math.ceil(total / query.pageSize), MAX_SEARCH_PAGE),
      location: center?.summary ?? null,
    };
  }

  /** Ort aus `ort` (ID) bzw. Hauptort der `plz` – wie in der Inserats- und Deal-Suche */
  private async resolveCenter(query: Pick<ServiceSearchQuery, 'locationId' | 'postalCode'>) {
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
