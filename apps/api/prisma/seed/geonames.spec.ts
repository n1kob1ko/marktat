import { parseGeoNamesLine } from './geonames.js';

// Beispielzeilen im GeoNames-Format (Werte zur Veranschaulichung, keine Originaldaten)
const VIENNA = ['AT', '1010', 'Wien, Innere Stadt', 'Wien', '09', 'Wien Stadt', '900', 'Wien, Innere Stadt', '90101', '48.2077', '16.3705', '4'].join('\t');
const GRAZ = ['AT', '8010', 'Graz', 'Steiermark', '06', 'Graz (Stadt)', '601', 'Graz', '60101', '47.0667', '15.45', '4'].join('\t');

describe('parseGeoNamesLine', () => {
  it('leitet den Bezirk aus der Gemeindekennziffer ab', () => {
    expect(parseGeoNamesLine(VIENNA)).toEqual({
      ok: true,
      row: { postalCode: '1010', place: 'Wien, Innere Stadt', districtId: 901, latitude: 48.2077, longitude: 16.3705 },
    });
    expect(parseGeoNamesLine(GRAZ)).toMatchObject({ ok: true, row: { districtId: 601 } });
  });

  it('verwirft fehlerhafte Zeilen mit Begründung', () => {
    expect(parseGeoNamesLine('AT\t1010')).toEqual({ ok: false, reason: 'zu wenige Spalten' });
    expect(parseGeoNamesLine(VIENNA.replace('AT', 'DE'))).toMatchObject({ ok: false });
    expect(parseGeoNamesLine(VIENNA.replace('90101', ''))).toMatchObject({ ok: false });
    expect(parseGeoNamesLine(VIENNA.replace('48.2077', '52.52'))).toMatchObject({ ok: false });
  });
});
