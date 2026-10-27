/**
 * Vollständiges Ortsverzeichnis (`data/at-locations.tsv.gz`, aufbereitet aus GeoNames, CC BY 4.0)
 * lesen und in die Datenbank übernehmen. Siehe docs/geodaten.md.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { fromDatasetLine, locationSlug, type LocationRow } from './geonames.js';

export const DATASET_FILE = fileURLToPath(new URL('./data/at-locations.tsv.gz', import.meta.url));

export function readDataset(file = DATASET_FILE): LocationRow[] {
  return gunzipSync(readFileSync(file))
    .toString('utf8')
    .split('\n')
    .map(fromDatasetLine)
    .filter((row): row is LocationRow => row !== null);
}

const BATCH = 2000;

/**
 * Legt Orte an bzw. aktualisiert sie (Schlüssel PLZ + Ortsname) samt PostGIS-Punkt.
 * Es wird nichts gelöscht – Orte, an denen Inserate hängen, bleiben erhalten.
 */
export async function upsertLocations(prisma: PrismaClient, rows: LocationRow[]): Promise<number> {
  let count = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    count += await prisma.$executeRaw`
      INSERT INTO locations (postal_code, place, municipality, slug, district_id, latitude, longitude, geom)
      SELECT p, pl, m, s, d, lat, lon, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
      FROM unnest(
        ${batch.map((r) => r.postalCode)}::text[],
        ${batch.map((r) => r.place)}::text[],
        ${batch.map((r) => r.municipality)}::text[],
        ${batch.map((r) => locationSlug(r.place))}::text[],
        ${batch.map((r) => r.districtId)}::int[],
        ${batch.map((r) => r.latitude)}::float8[],
        ${batch.map((r) => r.longitude)}::float8[]
      ) AS t(p, pl, m, s, d, lat, lon)
      ON CONFLICT (postal_code, place) DO UPDATE SET
        municipality = EXCLUDED.municipality,
        slug = EXCLUDED.slug,
        district_id = EXCLUDED.district_id,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        geom = EXCLUDED.geom`;
  }
  // Ältere Einträge ohne PostGIS-Punkt (z. B. aus früheren Entwicklungsdaten) ergänzen
  await prisma.$executeRaw`
    UPDATE locations SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography WHERE geom IS NULL`;
  return count;
}
