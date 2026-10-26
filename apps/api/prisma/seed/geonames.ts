/**
 * Parser für das GeoNames-Postleitzahlenverzeichnis (Datei AT.txt aus
 * https://download.geonames.org/export/zip/AT.zip, Lizenz CC BY 4.0).
 *
 * Format laut GeoNames-Readme (tabulatorgetrennt, 12 Spalten):
 *   country code, postal code, place name, admin name1, admin code1, admin name2, admin code2,
 *   admin name3, admin code3, latitude, longitude, accuracy
 * Für Österreich ist „admin code3“ die Gemeindekennziffer von Statistik Austria (5-stellig);
 * die ersten drei Ziffern ergeben die Bezirkskennziffer (z. B. 90101 → 901, 31235 → 312).
 */
import { isAustrianPostalCode } from '@marktat/shared';

export interface GeoNamesRow {
  postalCode: string;
  place: string;
  districtId: number;
  latitude: number;
  longitude: number;
}

export type ParseResult = { ok: true; row: GeoNamesRow } | { ok: false; reason: string };

export function parseGeoNamesLine(line: string): ParseResult {
  const cols = line.split('\t');
  if (cols.length < 11) return { ok: false, reason: 'zu wenige Spalten' };
  const [country, postalCode, place, , , , , , municipalityCode, lat, lon] = cols.map((c) => c.trim());
  if (country !== 'AT') return { ok: false, reason: `Land ${country}` };
  if (!isAustrianPostalCode(postalCode)) return { ok: false, reason: `ungültige PLZ ${postalCode}` };
  if (!place) return { ok: false, reason: 'Ortsname fehlt' };
  if (!/^\d{5}$/.test(municipalityCode)) return { ok: false, reason: `Gemeindekennziffer ${municipalityCode || 'fehlt'}` };
  const latitude = Number(lat);
  const longitude = Number(lon);
  // Grobe Bounding Box Österreichs
  if (!(latitude > 46 && latitude < 49.1 && longitude > 9.4 && longitude < 17.2)) {
    return { ok: false, reason: 'Koordinaten außerhalb Österreichs' };
  }
  return {
    ok: true,
    row: { postalCode, place, districtId: Number(municipalityCode.slice(0, 3)), latitude, longitude },
  };
}
