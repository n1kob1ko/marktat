import { describe, expect, it } from 'vitest';
import { csvCell, dealImportRowToFields, dealImportTemplateCsv, parseCsv, parseJsonFeed, suggestDealImportMapping, toCsv, CsvParseError, missingRequiredFields } from '../index.js';

const context = {
  categories: [{ slug: 'elektronik-computer', name: 'Elektronik & Computer' }],
  stores: [{ id: 'store1', name: 'Filiale Graz-Lend' }],
  today: '2026-11-01',
};

describe('CSV einlesen', () => {
  it('erkennt Semikolon, Anführungszeichen, Zeilenumbrüche in Feldern und BOM', () => {
    const table = parseCsv('﻿artikelnummer;titel;preis\r\nA1;"Notebook; 15"" Zoll";599,00\r\n\r\nA2;"Zeile 1\nZeile 2";1.299,90\n');
    expect(table.delimiter).toBe(';');
    expect(table.headers).toEqual(['artikelnummer', 'titel', 'preis']);
    expect(table.rows).toEqual([
      ['A1', 'Notebook; 15" Zoll', '599,00'],
      ['A2', 'Zeile 1\nZeile 2', '1.299,90'],
    ]);
  });

  it('erkennt Komma als Trennzeichen und lehnt kaputte Dateien ab', () => {
    expect(parseCsv('sku,title\nA,B').delimiter).toBe(',');
    expect(() => parseCsv('a;b\n"offen;x')).toThrow(CsvParseError);
    expect(() => parseCsv('a;a\n1;2')).toThrow(/dieselbe Überschrift/);
    expect(() => parseCsv('a;b\n')).toThrow(/keine Angebote/);
    expect(() => parseCsv('a\n1\n2\n3', 2)).toThrow(/mehr als 2 Zeilen/);
  });

  it('liest JSON-Feeds als Tabelle', () => {
    const table = parseJsonFeed(JSON.stringify({ angebote: [{ sku: 'A', price: 5.5, filialen: ['X', 'Y'] }, { sku: 'B' }] }));
    expect(table.headers).toEqual(['sku', 'price', 'filialen']);
    expect(table.rows).toEqual([
      ['A', '5.5', 'X|Y'],
      ['B', '', ''],
    ]);
    expect(() => parseJsonFeed('{"a":1}')).toThrow(CsvParseError);
  });
});

describe('Zuordnung und Umwandlung', () => {
  it('ordnet Vorlagen- und übliche Spaltennamen automatisch zu', () => {
    const mapping = suggestDealImportMapping(['SKU', 'Title', 'Price', 'Gültig bis', 'Kategorie', 'UVP']);
    expect(mapping).toMatchObject({ externalId: 'SKU', title: 'Title', price: 'Price', endsOn: 'Gültig bis', category: 'Kategorie', referencePrice: 'UVP' });
    expect(missingRequiredFields(mapping)).toEqual([]);
    expect(missingRequiredFields({ title: 'Title' })).toContain('externalId');
  });

  it('wandelt eine vollständige Zeile um und leitet den Kanal ab', () => {
    const headers = ['artikelnummer', 'titel', 'kategorie', 'preis', 'vergleichspreis', 'vergleichspreis_art', 'link', 'filialen', 'ende', 'verfuegbarkeit'];
    const mapping = suggestDealImportMapping(headers);
    const { fields, issues } = dealImportRowToFields(
      headers,
      ['NB-1', 'Notebook 15 Zoll', 'Elektronik & Computer', '599', '799,00', 'UVP', 'https://shop.example.at/nb', 'Filiale Graz-Lend', '30.11.2026', 'lagernd'],
      mapping,
      context,
    );
    expect(issues).toEqual([]);
    expect(fields).toMatchObject({
      externalId: 'NB-1',
      categorySlug: 'elektronik-computer',
      priceCents: 59900,
      referencePriceCents: 79900,
      referencePriceType: 'RRP',
      channel: 'BOTH',
      storeIds: ['store1'],
      startsOn: '2026-11-01',
      endsOn: '2026-11-30',
      availability: 'IN_STOCK',
      isAffiliateLink: false,
    });
  });

  it('meldet unbrauchbare Werte je Feld, statt zu raten', () => {
    const headers = ['artikelnummer', 'titel', 'kategorie', 'preis', 'vergleichspreis', 'filialen', 'ende', 'werbelink'];
    const { issues } = dealImportRowToFields(headers, ['', 'X', 'Autos', 'gratis', '10', 'Unbekannt', '31.02.2026', 'vielleicht'], suggestDealImportMapping(headers), context);
    expect(issues.map((i) => i.field).sort()).toEqual(['categorySlug', 'endsOn', 'externalId', 'isAffiliateLink', 'priceCents', 'referencePriceType', 'storeIds'].sort());
  });
});

describe('Schutz vor Formel-Injection', () => {
  it('entschärft Zellen, die Tabellenprogramme als Formel ausführen würden', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+43 316')).toBe("'+43 316");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(toCsv([['a', 'b']])).toBe('﻿a;b\r\n');
    expect(dealImportTemplateCsv()).toContain('artikelnummer;titel;kategorie;preis;ende');
  });
});
