/**
 * Erzeugt die Punktkarte von Österreich (src/components/listing/austria-dots.ts) aus dem Ortsverzeichnis
 * apps/api/prisma/seed/data/at-locations.tsv.gz: jedes Rasterfeld (ca. 7,8 km), in dem ein Ort liegt, wird ein Punkt.
 * Aufruf: node apps/web/scripts/build-austria-map.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const root = new URL('../../../', import.meta.url);
const source = new URL('apps/api/prisma/seed/data/at-locations.tsv.gz', root);
const target = new URL('apps/web/src/components/listing/austria-dots.ts', root);

// Muss zu MAP_GRID in austria-map.tsx passen
const LON0 = 9.5;
const LAT0 = 49.05;
const STEP = 0.07;
const COS = Math.cos((47.6 * Math.PI) / 180);

const cells = new Set();
let cols = 0;
let rows = 0;
for (const line of gunzipSync(readFileSync(source)).toString('utf8').split('\n').slice(1)) {
  const parts = line.split('\t');
  if (parts.length < 6) continue;
  const lat = Number(parts[4]);
  const lon = Number(parts[5]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const x = Math.round(((lon - LON0) * COS) / STEP);
  const y = Math.round((LAT0 - lat) / STEP);
  cells.add(`${x},${y}`);
  cols = Math.max(cols, x + 1);
  rows = Math.max(rows, y + 1);
}

// Lücken schließen (Felder ohne Ort, aber fast ganz umgeben, z. B. Seen und Hochgebirge)
const on = (x, y) => cells.has(`${x},${y}`);
for (let pass = 0; pass < 2; pass++) {
  const add = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (on(x, y)) continue;
      let n = 0;
      for (const [dx, dy] of [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ])
        if (on(x + dx, y + dy)) n++;
      const enclosed = on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1);
      if (n >= 5 || enclosed) add.push(`${x},${y}`);
    }
  }
  for (const cell of add) cells.add(cell);
}

// Ein Punkt je Feld als „M x y h0“ (runde Linienenden); stroke-dasharray-Tricks verlieren in Browsern Punkte
const dots = [];
for (let y = 0; y < rows; y++)
  for (let x = 0; x < cols; x++) if (on(x, y)) dots.push(`M${x} ${y}h0`);
const count = dots.length;

writeFileSync(
  target,
  `// Erzeugt von apps/web/scripts/build-austria-map.mjs aus dem Ortsverzeichnis (GeoNames, CC BY 4.0) – nicht von Hand ändern.\n` +
    `export const AUSTRIA_DOTS = {\n  cols: ${cols},\n  rows: ${rows},\n  count: ${count},\n  path: '${dots.join('')}',\n} as const;\n`,
);
console.log(`${count} Punkte, ${cols}×${rows}`);
