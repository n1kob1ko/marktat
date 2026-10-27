import { Injectable } from '@nestjs/common';
import { type LocationSummary } from '@marktat/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const locationInclude = { district: { include: { state: true } } } as const;

type LocationWithDistrict = {
  id: number;
  postalCode: string;
  place: string;
  municipality: string | null;
  district: { name: string; state: { name: string; code: string } };
};

export function toLocationSummary(location: LocationWithDistrict): LocationSummary {
  return {
    id: location.id,
    postalCode: location.postalCode,
    place: location.place,
    municipality: location.municipality && location.municipality !== location.place ? location.municipality : null,
    district: location.district.name,
    state: location.district.state.name,
    stateCode: location.district.state.code,
  };
}

@Injectable()
export class GeoService {
  constructor(private readonly prisma: PrismaService) {}

  states() {
    return this.prisma.state.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        districts: { orderBy: { id: 'asc' }, select: { id: true, slug: true, name: true } },
      },
    });
  }

  /**
   * Ortssuche für Eingabefelder: PLZ (exakt oder Präfix), Ortsname (Wortanfang, ohne Groß-/Kleinschreibung,
   * „St.“ = „Sankt“) oder beides („1010 Wien“).
   * Reihenfolge: genauer Treffer vor Präfix, Gemeinde vor Ortsteil, Statutarstadt vor Umland,
   * Haupt-PLZ (z. B. 1070) vor Sonder-PLZ für Großkunden (z. B. 1072).
   */
  async searchLocations(query: string, limit = 20): Promise<LocationSummary[]> {
    const q = query.trim().replace(/\s+/g, ' ');
    if (q.length < 2) return [];
    const combined = /^(\d{4})[\s,]+(\D.*)$/.exec(q);
    const postalCode = combined ? combined[1]! : /^\d{2,4}$/.test(q) ? q : null;
    const name = combined ? combined[2]! : postalCode ? null : q;

    const conditions: Prisma.Sql[] = [];
    if (postalCode) conditions.push(Prisma.sql`l.postal_code LIKE ${postalCode + '%'}`);
    const order: Prisma.Sql[] = [];
    if (name) {
      const variants = placeVariants(name);
      const patterns = variants.flatMap((v) => [`${escapeLike(v)}%`, `% ${escapeLike(v)}%`, `%-${escapeLike(v)}%`]);
      conditions.push(Prisma.sql`(l.place ILIKE ANY(${patterns}::text[]) OR l.municipality ILIKE ANY(${variants.map((v) => `${escapeLike(v)}%`)}::text[]))`);
      order.push(Prisma.sql`CASE
        WHEN lower(l.place) = ANY(${variants.map((v) => v.toLowerCase())}::text[]) THEN 0
        WHEN l.place ILIKE ANY(${variants.map((v) => `${escapeLike(v)}%`)}::text[]) THEN 1
        ELSE 2 END`);
    }
    order.push(
      Prisma.sql`(l.place = l.municipality) IS TRUE DESC`,
      Prisma.sql`(d.name LIKE '%(Stadt)' OR d.state_id = 9) DESC`,
      // Haupt-PLZ endet auf 0; in Wien stehen die 2. und 3. Ziffer für den Gemeindebezirk (1070 → 7.)
      Prisma.sql`(l.postal_code LIKE '%0' AND (d.state_id <> 9 OR substring(l.postal_code, 2, 2)::int = l.district_id - 900)) DESC`,
    );
    if (postalCode) order.push(Prisma.sql`l.postal_code`);
    const ids = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT l.id
      FROM locations l JOIN districts d ON d.id = l.district_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${Prisma.join(order, ', ')}, length(l.place), l.place, l.postal_code
      LIMIT ${limit}`;
    const rows = await this.prisma.location.findMany({ where: { id: { in: ids.map((r) => r.id) } }, include: locationInclude });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap(({ id }) => (byId.has(id) ? [toLocationSummary(byId.get(id)!)] : []));
  }

  async findLocation(id: number) {
    const row = await this.prisma.location.findUnique({ where: { id }, include: locationInclude });
    return row ? toLocationSummary(row) : null;
  }
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** „St. Veit“ und „Sankt Veit“ finden dieselben Orte. */
export function placeVariants(name: string): string[] {
  const variants = new Set([name]);
  const saint = /^(?:sankt\s+|st\.\s*|st\s+)(.*)$/i.exec(name);
  if (saint) {
    const rest = saint[1]!;
    variants.add(rest ? `St. ${rest}` : 'St.');
    variants.add(rest ? `Sankt ${rest}` : 'Sankt');
  }
  return [...variants];
}
