import { describe, expect, it } from 'vitest';
import { roundRobinSlots } from './deal-search.service.js';

describe('Top-Deals: Shops abwechselnd', () => {
  const counts: [string, number][] = [
    ['Klein', 1],
    ['Groß', 5],
    ['Mittel', 2],
  ];

  it('wechselt die Shops ab, größter zuerst, und lässt erschöpfte aus', () => {
    const { order } = roundRobinSlots(counts, 0, 10);
    expect(order).toEqual(['Groß', 'Mittel', 'Klein', 'Groß', 'Mittel', 'Groß', 'Groß', 'Groß']);
  });

  it('berechnet für spätere Seiten, ab welcher Stelle jeder Shop weitermacht', () => {
    const { order, lanes } = roundRobinSlots(counts, 4, 3);
    expect(order).toEqual(['Mittel', 'Groß', 'Groß']);
    expect(lanes.get('Groß')).toEqual({ offset: 2, limit: 2 });
    expect(lanes.get('Mittel')).toEqual({ offset: 1, limit: 1 });
    expect(lanes.has('Klein')).toBe(false);
  });

  it('liefert hinter dem Ende nichts', () => {
    expect(roundRobinSlots(counts, 8, 4).order).toEqual([]);
    expect(roundRobinSlots([], 0, 24).order).toEqual([]);
  });
});
