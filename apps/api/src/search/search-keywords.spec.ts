import { describe, expect, it } from 'vitest';
import { CATEGORY_KEYWORDS, listingKeywords } from './search-keywords.js';

describe('listingKeywords', () => {
  it('sammelt Wörter aus Kategorie und Oberkategorien', () => {
    const words = listingKeywords(['marktplatz', 'marktplatz/baby-kind', 'marktplatz/baby-kind/kinderbekleidung'], false);
    expect(words).toContain('gewand');
    expect(words).toContain('babykleidung');
    expect(words).not.toContain('gratis');
  });

  it('macht Verschenk-Anzeigen über „gratis“ und „geschenkt“ auffindbar', () => {
    expect(listingKeywords([], true)).toEqual(expect.arrayContaining(['gratis', 'geschenkt', 'verschenken']));
  });

  it('enthält nur kleingeschriebene Wörter ohne Leerzeichen (Meilisearch vergleicht ganze Wörter)', () => {
    for (const words of Object.values(CATEGORY_KEYWORDS)) {
      for (const word of words) expect(word, word).toMatch(/^[a-zäöüß-]+$/);
    }
  });
});
