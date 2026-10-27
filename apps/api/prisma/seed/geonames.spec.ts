import { buildLocations, fromDatasetLine, normalizePlace, parseGeoNamesLine, toDatasetLine, type GeoNamesRow } from './geonames.js';

// Beispielzeilen im GeoNames-Format (Werte zur Veranschaulichung, keine Originaldaten)
const VIENNA = ['AT', '1070', 'Wien, Neubau', 'Wien', '09', 'Wien Stadt', '900', 'Gemeindebezirk Neubau', '907', '48.2016', '16.3488', '4'].join('\t');
const GRAZ = ['AT', '8010', 'Graz,09.Bez.:Waltendorf', 'Steiermark', '06', 'Graz(Stadt)', '601', 'Graz', '60101', '47.0667', '15.47', '4'].join('\t');
const CSV = 'AT,9020,"Klagenfurt,01.Bez.:Innere Stadt",Kärnten,02,Klagenfurt Stadt,201,Klagenfurt am Wörthersee,20101,46.6249,14.3077';

const row = (overrides: Partial<GeoNamesRow>): GeoNamesRow => ({
  postalCode: '6020', place: 'Innsbruck', stateCode: '7', districtId: 701, municipality: 'Innsbruck', latitude: 47.26, longitude: 11.39, ...overrides,
});

describe('parseGeoNamesLine', () => {
  it('liest Tabulator- und CSV-Format und leitet den Bezirk aus der Gemeindekennziffer ab', () => {
    expect(parseGeoNamesLine(VIENNA)).toEqual({
      ok: true,
      row: { postalCode: '1070', place: 'Wien, Neubau', stateCode: '9', districtId: 907, municipality: null, latitude: 48.2016, longitude: 16.3488 },
    });
    expect(parseGeoNamesLine(GRAZ)).toMatchObject({ ok: true, row: { districtId: 601, municipality: 'Graz' } });
    expect(parseGeoNamesLine(CSV)).toMatchObject({ ok: true, row: { place: 'Klagenfurt,01.Bez.:Innere Stadt', districtId: 201 } });
    expect(parseGeoNamesLine(VIENNA.replace('907', ''))).toMatchObject({ ok: true, row: { districtId: null } });
  });

  it('verwirft fehlerhafte Zeilen mit Begründung', () => {
    expect(parseGeoNamesLine('AT\t1010')).toEqual({ ok: false, reason: 'zu wenige Spalten' });
    expect(parseGeoNamesLine(VIENNA.replace('AT', 'DE'))).toMatchObject({ ok: false });
    expect(parseGeoNamesLine(VIENNA.replace('1070', '107'))).toMatchObject({ ok: false, reason: 'ungültige PLZ' });
    expect(parseGeoNamesLine(VIENNA.replace('907', 'x1'))).toMatchObject({ ok: false });
    expect(parseGeoNamesLine(VIENNA.replace('48.2016', '52.52'))).toMatchObject({ ok: false, reason: 'Koordinaten außerhalb Österreichs' });
    expect(parseGeoNamesLine(VIENNA.replace('Wien, Neubau', 'Wien Postfach'))).toMatchObject({ ok: false, reason: 'Postfach (kein Wohnort)' });
    expect(parseGeoNamesLine('country_code,zipcode,place,state,state_code,province,province_code,community,community_code,latitude,longitude'))
      .toEqual({ ok: false, reason: 'Kopfzeile' });
  });
});

describe('normalizePlace', () => {
  it('vereinheitlicht Stadtbezirke, Wien und zweisprachige Namen', () => {
    expect(normalizePlace({ place: 'Wien, Neubau', stateCode: '9', municipality: null })).toBe('Wien');
    expect(normalizePlace({ place: 'Graz,09.Bez.:Waltendorf', stateCode: '6', municipality: 'Graz' })).toBe('Graz');
    expect(normalizePlace({ place: 'Oberwart / Felsöör', stateCode: '1', municipality: 'Oberwart' })).toBe('Oberwart');
    expect(normalizePlace({ place: 'Linz, Donau', stateCode: '4', municipality: 'Linz' })).toBe('Linz');
  });
});

describe('buildLocations', () => {
  const known = new Set([701, 703, 907]);

  it('führt Duplikate zusammen und ergänzt fehlende Bezirke und Gemeinden', () => {
    const { locations, skipped } = buildLocations(
      [
        row({ place: 'Wilten', latitude: 47.258, longitude: 11.388 }),
        row({ place: 'Wilten', latitude: 47.259, longitude: 11.389 }),
        row({ place: 'Amras', districtId: null, municipality: null, latitude: 47.25, longitude: 11.42 }),
        row({ place: 'Mutters', districtId: 703, municipality: 'Mutters', latitude: 47.23, longitude: 11.38 }),
      ],
      known,
    );
    expect(skipped.get('Duplikat zusammengeführt')).toBe(1);
    expect(locations.map((l) => `${l.postalCode} ${l.place} (${l.municipality ?? '-'}, ${l.districtId})`)).toEqual([
      '6020 Amras (-, 701)',
      '6020 Innsbruck (Innsbruck, 701)',
      '6020 Mutters (Mutters, 703)',
      '6020 Wilten (Innsbruck, 701)',
    ]);
    // Gemeinde-Eintrag liegt im Mittel ihrer Ortsteile
    expect(locations.find((l) => l.place === 'Innsbruck')).toMatchObject({ latitude: 47.2585, longitude: 11.3885 });
  });

  it('verwirft unbekannte Bezirke und unplausible Koordinaten', () => {
    const { locations, skipped } = buildLocations(
      [
        row({ place: 'Wilten' }),
        row({ place: 'Pradl' }),
        row({ place: 'Hötting' }),
        row({ place: 'Weit weg', latitude: 48.2, longitude: 16.3 }),
        row({ place: 'Unbekannt', districtId: 999 }),
      ],
      known,
    );
    expect(locations.map((l) => l.place)).not.toContain('Weit weg');
    expect(skipped.get('unbekannter Bezirk 999')).toBe(1);
    expect(skipped.get('Koordinaten unplausibel (über 80 km vom Bezirk entfernt)')).toBe(1);
  });

  it('setzt in Wien den Mittelpunkt des Gemeindebezirks statt des Stadtzentrums', () => {
    const { locations } = buildLocations(
      [row({ postalCode: '1210', place: 'Wien, Floridsdorf', stateCode: '9', districtId: 921, municipality: null, latitude: 48.2085, longitude: 16.3721 })],
      new Set([921]),
    );
    expect(locations).toEqual([{ postalCode: '1210', place: 'Wien', municipality: 'Wien', districtId: 921, latitude: 48.278, longitude: 16.41 }]);
  });

  it('Datensatzzeilen lassen sich verlustfrei schreiben und lesen', () => {
    const location = { postalCode: '6020', place: 'Wilten', municipality: 'Innsbruck', districtId: 701, latitude: 47.258, longitude: 11.388 };
    expect(fromDatasetLine(toDatasetLine(location))).toEqual(location);
    expect(fromDatasetLine(toDatasetLine({ ...location, municipality: null }))).toMatchObject({ municipality: null });
  });
});
