import { Injectable } from '@nestjs/common';
import { isAustrianPostalCode, type LocationSummary } from '@marktat/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export const locationInclude = { district: { include: { state: true } } } as const;

type LocationWithDistrict = {
  id: number;
  postalCode: string;
  place: string;
  district: { name: string; state: { name: string; code: string } };
};

export function toLocationSummary(location: LocationWithDistrict): LocationSummary {
  return {
    id: location.id,
    postalCode: location.postalCode,
    place: location.place,
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

  /** Suche nach PLZ (exakt oder Präfix) oder Ortsname (Präfix, ohne Groß-/Kleinschreibung). */
  async searchLocations(query: string, limit = 20): Promise<LocationSummary[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const where = /^\d+$/.test(q)
      ? isAustrianPostalCode(q)
        ? { postalCode: q }
        : { postalCode: { startsWith: q } }
      : { place: { startsWith: q, mode: 'insensitive' as const } };
    const rows = await this.prisma.location.findMany({
      where,
      include: locationInclude,
      orderBy: [{ postalCode: 'asc' }, { place: 'asc' }],
      take: limit,
    });
    return rows.map(toLocationSummary);
  }

  async findLocation(id: number) {
    const row = await this.prisma.location.findUnique({ where: { id }, include: locationInclude });
    return row ? toLocationSummary(row) : null;
  }
}
