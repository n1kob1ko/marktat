/**
 * Erzeugt `data/at-locations.tsv.gz` neu aus einem GeoNames-Download (siehe docs/geodaten.md).
 *
 *   pnpm --filter @marktat/api geo:build --file /pfad/zu/AT.txt
 *
 * Die Datei wird versioniert, damit `pnpm db:seed` ohne Internetzugang das vollständige Verzeichnis hat.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { DISTRICTS } from './districts.js';
import { DATASET_FILE } from './geo-dataset.js';
import { buildLocations, DATASET_HEADER, parseGeoNamesFile, toDatasetLine } from './geonames.js';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = argValue('--file');
if (!file || !existsSync(file)) {
  throw new Error('Bitte die GeoNames-Datei angeben: geo:build --file /pfad/zu/AT.txt');
}

const parsed = parseGeoNamesFile(readFileSync(file, 'utf8'));
const built = buildLocations(parsed.rows, new Set(DISTRICTS.map((d) => d.id)));
const content = [DATASET_HEADER, ...built.locations.map(toDatasetLine)].join('\n') + '\n';
writeFileSync(DATASET_FILE, gzipSync(content, { level: 9 }));

console.log(`GeoNames-Zeilen: ${parsed.rows.length}`);
for (const [reason, count] of [...parsed.skipped, ...built.skipped]) console.log(`Übersprungen (${reason}): ${count}`);
console.log(`Orte: ${built.locations.length}, Postleitzahlen: ${new Set(built.locations.map((l) => l.postalCode)).size}`);
console.log(`Geschrieben: ${DATASET_FILE}`);
