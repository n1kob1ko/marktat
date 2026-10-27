import { rotateTopAds } from './listing-search.service.js';

const ids = Array.from({ length: 12 }, (_, i) => `listing${String(i).padStart(2, '0')}`);
const at = (minutes: number) => new Date(Date.parse('2026-10-27T12:00:00Z') + minutes * 60_000);

describe('rotateTopAds', () => {
  it('zeigt höchstens drei, ohne Doppelte, stabil innerhalb von 10 Minuten', () => {
    const shown = rotateTopAds([...ids, ids[0]!], at(0));
    expect(shown).toHaveLength(3);
    expect(new Set(shown).size).toBe(3);
    expect(rotateTopAds(ids, at(9))).toEqual(shown);
    // Reihenfolge der Eingabe (z. B. Relevanz) spielt keine Rolle
    expect(rotateTopAds([...ids].reverse(), at(0))).toEqual(shown);
  });

  it('wechselt über die Zeit, sodass jede Top-Anzeige drankommt und keine dauerhaft dominiert', () => {
    const counts = new Map<string, number>();
    const buckets = 400;
    for (let i = 0; i < buckets; i++) for (const id of rotateTopAds(ids, at(i * 10))) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(counts.size).toBe(ids.length);
    const expected = (buckets * 3) / ids.length;
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.5);
      expect(count).toBeLessThan(expected * 1.5);
    }
  });
});
