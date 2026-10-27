/**
 * Übernimmt einen neueren GeoNames-Download direkt in die Datenbank (siehe docs/geodaten.md).
 * Für den Normalfall reicht `pnpm db:seed`, das die versionierte Datei `data/at-locations.tsv.gz` lädt.
 *
 *   pnpm --filter @marktat/api geo:import --file /pfad/zu/AT.txt
 *
 * Voraussetzung: `pnpm db:seed` wurde ausgeführt (Bundesländer und Bezirke existieren).
 * Idempotent: bestehende Orte (PLZ + Ortsname) werden aktualisiert, keine werden gelöscht.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '../../src/prisma/create-client.js';
import { upsertLocations } from './geo-dataset.js';
import { buildLocations, parseGeoNamesFile } from './geonames.js';

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

  const prisma = createPrismaClient(url);
  try {
    const districtIds = new Set((await prisma.district.findMany({ select: { id: true } })).map((d) => d.id));
    if (districtIds.size === 0) throw new Error('Keine Bezirke gefunden – zuerst `pnpm db:seed` ausführen.');

    const parsed = parseGeoNamesFile(readFileSync(file, 'utf8'));
    const built = buildLocations(parsed.rows, districtIds);
    await upsertLocations(prisma, built.locations);

    console.log(`Importiert/aktualisiert: ${built.locations.length} Orte`);
    console.log("Hinweis: Koordinaten im Suchindex mit `pnpm --filter @marktat/api search:reindex` aktualisieren.");
    for (const [reason, count] of [...parsed.skipped, ...built.skipped]) console.log(`Übersprungen (${reason}): ${count}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
