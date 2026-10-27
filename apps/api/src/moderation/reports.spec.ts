import { initialPriority } from './reports.service.js';

describe('initialPriority', () => {
  it('stellt Betrug und verbotene Artikel nach vorne, ohne etwas automatisch zu sperren', () => {
    expect(initialPriority('FRAUD')).toBe('HIGH');
    expect(initialPriority('PROHIBITED_ITEM')).toBe('HIGH');
    expect(initialPriority('SPAM')).toBe('NORMAL');
    expect(initialPriority('OTHER')).toBe('NORMAL');
  });
});
