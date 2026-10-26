import { describe, expect, it } from 'vitest';
import { formatPriceCents, parseEuroInputToCents } from './format.js';
import { slugify } from './slug.js';
import { isAustrianPostalCode } from './austria.js';

describe('formatPriceCents', () => {
  it('formatiert ganze Euro-Beträge ohne Nachkommastellen im de-AT-Format', () => {
    expect(formatPriceCents(129900)).toBe('€\u00a01.299');
  });
  it('zeigt Cent-Beträge mit Komma', () => {
    expect(formatPriceCents(499)).toBe('€\u00a04,99');
  });
});

describe('parseEuroInputToCents', () => {
  it.each([
    ['1.299,50', 129950],
    ['1299,5', 129950],
    ['1299.5', 129950],
    ['1.299', 129900],
    ['€ 20', 2000],
    ['0,99', 99],
  ])('wandelt %s in %d Cent um', (input, cents) => {
    expect(parseEuroInputToCents(input)).toBe(cents);
  });
  it.each(['', 'abc', '1,2,3', '12,345'])('lehnt ungültige Eingabe „%s“ ab', (input) => {
    expect(parseEuroInputToCents(input)).toBeNull();
  });
});

describe('slugify', () => {
  it('ersetzt Umlaute und Sonderzeichen', () => {
    expect(slugify('Möbel & Wohnen')).toBe('moebel-wohnen');
    expect(slugify('Große Straße 5, Wien')).toBe('grosse-strasse-5-wien');
  });
});

describe('isAustrianPostalCode', () => {
  it('akzeptiert vierstellige PLZ', () => {
    expect(isAustrianPostalCode('1010')).toBe(true);
    expect(isAustrianPostalCode('9020')).toBe(true);
  });
  it('lehnt ungültige PLZ ab', () => {
    expect(isAustrianPostalCode('0123')).toBe(false);
    expect(isAustrianPostalCode('10100')).toBe(false);
    expect(isAustrianPostalCode('A-1010')).toBe(false);
  });
});
