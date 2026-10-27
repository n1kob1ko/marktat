import { DISTRICTS } from './districts.js';
import { readDataset } from './geo-dataset.js';

// Prüft die versionierte Datei data/at-locations.tsv.gz (vollständiges PLZ-Verzeichnis)
describe('Ortsverzeichnis', () => {
  const rows = readDataset();
  const districts = new Map(DISTRICTS.map((d) => [d.id, d]));

  it('deckt alle Bundesländer und Bezirke ab', () => {
    expect(rows.length).toBeGreaterThan(20_000);
    expect(new Set(rows.map((r) => r.postalCode)).size).toBeGreaterThan(2_400);
    expect(new Set(rows.map((r) => districts.get(r.districtId)?.stateId))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(new Set(rows.map((r) => r.districtId)).size).toBe(DISTRICTS.length);
  });

  it('enthält keine Duplikate, nur gültige PLZ, Bezirke und Koordinaten', () => {
    const keys = new Set(rows.map((r) => `${r.postalCode}|${r.place.toLowerCase()}`));
    expect(keys.size).toBe(rows.length);
    for (const r of rows) {
      expect(r.postalCode).toMatch(/^[1-9]\d{3}$/);
      expect(districts.has(r.districtId)).toBe(true);
      expect(r.latitude).toBeGreaterThan(46.3);
      expect(r.latitude).toBeLessThan(49.1);
      expect(r.longitude).toBeGreaterThan(9.4);
      expect(r.longitude).toBeLessThan(17.2);
    }
  });

  it('ordnet PLZ dem richtigen Bundesland zu und kennt mehrere Orte je PLZ', () => {
    const state = (postalCode: string, place: string) => districts.get(rows.find((r) => r.postalCode === postalCode && r.place === place)!.districtId)!.stateId;
    expect(state('1010', 'Wien')).toBe(9);
    expect(state('8010', 'Graz')).toBe(6);
    expect(state('6900', 'Bregenz')).toBe(8);
    expect(state('7000', 'Eisenstadt')).toBe(1);
    expect(rows.filter((r) => r.postalCode === '6020').length).toBeGreaterThan(5);
    // Wien: alle 23 Gemeindebezirke mit ihrer Haupt-PLZ (1010 … 1230)
    for (let i = 1; i <= 23; i++) {
      const postalCode = `1${String(i).padStart(2, '0')}0`;
      expect(rows.find((r) => r.postalCode === postalCode && r.place === 'Wien')?.districtId).toBe(900 + i);
    }
  });
});
