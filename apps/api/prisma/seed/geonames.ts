/**
 * Parser und Aufbereitung des GeoNames-Postleitzahlenverzeichnisses für Österreich
 * (https://download.geonames.org/export/zip/AT.zip, Lizenz CC BY 4.0, „GeoNames, geonames.org“).
 *
 * Akzeptiert zwei Formate mit derselben Spaltenfolge:
 *   - Original `AT.txt`: tabulatorgetrennt, 12 Spalten, ohne Kopfzeile
 *   - CSV-Umwandlung derselben Daten (z. B. zauberware/postal-codes-json-xml-csv): Komma, Kopfzeile, Anführungszeichen
 * Spalten: country code, postal code, place name, admin name1, admin code1, admin name2, admin code2,
 *          admin name3, admin code3, latitude, longitude[, accuracy]
 *
 * Für Österreich ist „admin code3“ die Gemeindekennziffer von Statistik Austria (5-stellig, die ersten drei
 * Ziffern ergeben den Bezirk, z. B. 60101 → 601). In Wien steht dort der Gemeindebezirk (901 … 923).
 */
import { isAustrianPostalCode, slugify } from '@marktat/shared';

export interface GeoNamesRow {
  postalCode: string;
  place: string;
  stateCode: string;
  /** null, wenn GeoNames keine Gemeinde liefert (wird über Nachbarn ergänzt) */
  districtId: number | null;
  municipality: string | null;
  latitude: number;
  longitude: number;
}

export interface LocationRow {
  postalCode: string;
  place: string;
  municipality: string | null;
  districtId: number;
  latitude: number;
  longitude: number;
}

export type ParseResult = { ok: true; row: GeoNamesRow } | { ok: false; reason: string };

/** Zerlegt eine CSV-Zeile mit Anführungszeichen („Klagenfurt,01.Bez.:Innere Stadt“). */
function splitCsv(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      cols.push(current);
      current = '';
    } else current += c;
  }
  cols.push(current);
  return cols;
}

export function parseGeoNamesLine(line: string): ParseResult {
  const cols = (line.includes('\t') ? line.split('\t') : splitCsv(line)).map((c) => c.trim());
  if (cols.length < 11) return { ok: false, reason: 'zu wenige Spalten' };
  const [country, postalCode, place, , stateCode, , , municipality, municipalityCode, lat, lon] = cols as string[] & { length: 11 };
  if (country === 'country_code') return { ok: false, reason: 'Kopfzeile' };
  if (country !== 'AT') return { ok: false, reason: `Land ${country}` };
  if (!isAustrianPostalCode(postalCode)) return { ok: false, reason: 'ungültige PLZ' };
  if (!place) return { ok: false, reason: 'Ortsname fehlt' };
  if (/postfach/i.test(place)) return { ok: false, reason: 'Postfach (kein Wohnort)' };
  if (!/^0?[1-9]$/.test(stateCode)) return { ok: false, reason: 'Bundesland fehlt' };

  let districtId: number | null = null;
  if (/^9\d{2}$/.test(municipalityCode)) districtId = Number(municipalityCode); // Wiener Gemeindebezirk
  else if (/^\d{5}$/.test(municipalityCode)) districtId = Number(municipalityCode.slice(0, 3));
  else if (municipalityCode) return { ok: false, reason: 'Gemeindekennziffer unbekannt' };

  const latitude = Number(lat);
  const longitude = Number(lon);
  // Grobe Bounding Box Österreichs
  if (!(latitude > 46.3 && latitude < 49.1 && longitude > 9.4 && longitude < 17.2)) {
    return { ok: false, reason: 'Koordinaten außerhalb Österreichs' };
  }
  return {
    ok: true,
    row: {
      postalCode,
      place,
      stateCode: String(Number(stateCode)),
      districtId,
      municipality: municipality && !municipality.startsWith('Gemeindebezirk ') ? municipality : null,
      latitude,
      longitude,
    },
  };
}

const CITY_DISTRICT = /^(.+?),\s*\d+\.\s*Bez\.?:?\s*(.+)$/;

/**
 * Lesbare Ortsnamen:
 *  - Wien: „Wien, Neubau“ → „Wien“ (der Gemeindebezirk steckt in PLZ und Bezirk)
 *  - Graz/Klagenfurt: „Graz,09.Bez.:Waltendorf“ → „Graz“
 *  - Zweisprachige Namen im Burgenland: „Oberwart / Felsöör“ → „Oberwart“
 *  - „Linz, Donau“ → „Linz“
 */
export function normalizePlace(row: Pick<GeoNamesRow, 'place' | 'stateCode' | 'municipality'>): string {
  if (row.stateCode === '9') return 'Wien';
  const city = CITY_DISTRICT.exec(row.place);
  if (city) return row.municipality ?? city[1]!.trim();
  let place = row.place.split(' / ')[0]!.trim();
  if (place === 'Linz, Donau') place = 'Linz';
  return place.replace(/\s+/g, ' ');
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

export interface BuildResult {
  locations: LocationRow[];
  skipped: Map<string, number>;
}

/**
 * Baut aus GeoNames-Zeilen das Ortsverzeichnis:
 *  - fehlender Bezirk: vom Ort mit derselben PLZ bzw. vom nächstgelegenen Ort im selben Bundesland übernehmen
 *  - Koordinaten: mehr als 80 km vom Bezirksmittelpunkt entfernt → unplausibel, verworfen
 *  - Duplikate (gleiche PLZ + gleicher Name nach Normalisierung) zusammenführen
 *  - Gemeinde ohne gleichnamige Ortschaft (z. B. 9500 Villach) als eigener Eintrag ergänzen
 */
export function buildLocations(rows: GeoNamesRow[], knownDistricts: ReadonlySet<number>): BuildResult {
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  const withDistrict = rows.filter((r) => r.districtId !== null);
  const byPostalCode = new Map<string, number[]>();
  for (const r of withDistrict) byPostalCode.set(r.postalCode, [...(byPostalCode.get(r.postalCode) ?? []), r.districtId!]);

  const resolved: (GeoNamesRow & { districtId: number })[] = [];
  for (const row of rows) {
    let districtId = row.districtId;
    if (districtId === null) {
      const samePostalCode = byPostalCode.get(row.postalCode);
      if (samePostalCode?.length) districtId = median(samePostalCode);
      else {
        const nearest = withDistrict
          .filter((r) => r.stateCode === row.stateCode)
          .reduce<GeoNamesRow | null>((best, r) => (!best || distanceKm(row, r) < distanceKm(row, best) ? r : best), null);
        districtId = nearest?.districtId ?? null;
      }
    }
    if (districtId === null || !knownDistricts.has(districtId)) {
      skip(districtId === null ? 'Bezirk nicht ermittelbar' : `unbekannter Bezirk ${districtId}`);
      continue;
    }
    resolved.push({ ...row, districtId });
  }

  const centre = new Map<number, { latitude: number; longitude: number }>();
  const groups = new Map<number, typeof resolved>();
  for (const r of resolved) groups.set(r.districtId, [...(groups.get(r.districtId) ?? []), r]);
  for (const [districtId, group] of groups) {
    centre.set(districtId, { latitude: median(group.map((r) => r.latitude)), longitude: median(group.map((r) => r.longitude)) });
  }

  const locations = new Map<string, LocationRow>();
  const communities = new Map<string, { row: LocationRow; points: { latitude: number; longitude: number }[] }>();
  for (const r of resolved) {
    if (distanceKm(r, centre.get(r.districtId)!) > 80) {
      skip('Koordinaten unplausibel (über 80 km vom Bezirk entfernt)');
      continue;
    }
    const place = normalizePlace(r);
    const key = `${r.postalCode}|${place.toLowerCase()}`;
    if (locations.has(key)) {
      skip('Duplikat zusammengeführt');
    } else {
      locations.set(key, {
        postalCode: r.postalCode,
        place,
        municipality: r.stateCode === '9' ? 'Wien' : r.municipality,
        districtId: r.districtId,
        latitude: r.latitude,
        longitude: r.longitude,
      });
    }
    if (r.municipality && r.stateCode !== '9') {
      const communityKey = `${r.postalCode}|${r.municipality.toLowerCase()}`;
      const entry = communities.get(communityKey);
      if (entry) entry.points.push(r);
      else {
        communities.set(communityKey, {
          row: { postalCode: r.postalCode, place: r.municipality, municipality: r.municipality, districtId: r.districtId, latitude: 0, longitude: 0 },
          points: [r],
        });
      }
    }
  }
  for (const [key, { row, points }] of communities) {
    if (locations.has(key)) continue;
    const latitude = points.reduce((s, p) => s + p.latitude, 0) / points.length;
    const longitude = points.reduce((s, p) => s + p.longitude, 0) / points.length;
    locations.set(key, { ...row, latitude: Number(latitude.toFixed(4)), longitude: Number(longitude.toFixed(4)) });
  }
  return {
    locations: [...locations.values()].sort((a, b) => a.postalCode.localeCompare(b.postalCode) || a.place.localeCompare(b.place, 'de')),
    skipped,
  };
}

export function parseGeoNamesFile(content: string): { rows: GeoNamesRow[]; skipped: Map<string, number> } {
  const rows: GeoNamesRow[] = [];
  const skipped = new Map<string, number>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const result = parseGeoNamesLine(line);
    if (result.ok) rows.push(result.row);
    else if (result.reason !== 'Kopfzeile') skipped.set(result.reason, (skipped.get(result.reason) ?? 0) + 1);
  }
  return { rows, skipped };
}

/** Kompaktes, versioniertes Format für `data/at-locations.tsv.gz` (eine Zeile je Ort). */
export const DATASET_HEADER = 'postal_code\tplace\tmunicipality\tdistrict_id\tlatitude\tlongitude';

export function toDatasetLine(row: LocationRow): string {
  return [row.postalCode, row.place, row.municipality ?? '', row.districtId, row.latitude, row.longitude].join('\t');
}

export function fromDatasetLine(line: string): LocationRow | null {
  const [postalCode, place, municipality, districtId, latitude, longitude] = line.split('\t');
  if (!postalCode || !place || postalCode === 'postal_code') return null;
  return {
    postalCode,
    place,
    municipality: municipality || null,
    districtId: Number(districtId),
    latitude: Number(latitude),
    longitude: Number(longitude),
  };
}

export const locationSlug = (place: string) => slugify(place);
