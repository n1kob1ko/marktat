/**
 * Importiert das vollständige österreichische PLZ-Verzeichnis aus GeoNames (siehe docs/geodaten.md).
 *
 *   pnpm --filter @marktat/api geo:import --file /pfad/zu/AT.txt
 *
 * Voraussetzung: `pnpm db:seed` wurde ausgeführt (Bundesländer und Bezirke existieren).
 * Idempotent: bestehende Orte (PLZ + Ortsname) werden aktualisiert, keine werden gelöscht.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slugify } from '@marktat/shared';
import { createPrismaClient } from '../../src/prisma/create-client.js';
import { parseGeoNamesLine, type GeoNamesRow } from './geonames.js';

const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const file = argValue('--file');
  if (!file || !existsSync(file)) {
    throw new Error('Bitte die GeoNames-Datei angeben: geo:import --file /pfad/zu/AT.txt');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ist nicht gesetzt.');

  const rows = new Map<string, GeoNamesRow>();
  const skipped = new Map<string, number>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const result = parseGeoNamesLine(line);
    if (result.ok) rows.set(`${result.row.postalCode}|${result.row.place}`, result.row);
    else skipped.set(result.reason, (skipped.get(result.reason) ?? 0) + 1);
  }

  const prisma = createPrismaClient(url);
  try {
    const districtIds = new Set((await prisma.district.findMany({ select: { id: true } })).map((d) => d.id));
    if (districtIds.size === 0) throw new Error('Keine Bezirke gefunden – zuerst `pnpm db:seed` ausführen.');

    let imported = 0;
    for (const row of rows.values()) {
      if (!districtIds.has(row.districtId)) {
        const reason = `unbekannter Bezirk ${row.districtId}`;
        skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
        continue;
      }
      const data = { districtId: row.districtId, latitude: row.latitude, longitude: row.longitude, slug: slugify(row.place) };
      await prisma.location.upsert({
        where: { postalCode_place: { postalCode: row.postalCode, place: row.place } },
        update: data,
        create: { postalCode: row.postalCode, place: row.place, ...data },
      });
      imported += 1;
    }
    await prisma.$executeRaw`
      UPDATE locations
      SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      WHERE geom IS NULL OR NOT ST_Equals(geom::geometry, ST_SetSRID(ST_MakePoint(longitude, latitude), 4326))`;

    console.log(`Importiert/aktualisiert: ${imported} Orte`);
    for (const [reason, count] of skipped) console.log(`Übersprungen (${reason}): ${count}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
