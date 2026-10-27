import { describe, expect, it } from 'vitest';
import { ENTITY_ID, pick, totalPages, UUID, withQuery } from './admin';

describe('Admin-Filter', () => {
  it('reicht nur bekannte Filter weiter', () => {
    expect(pick({ status: 'OPEN', foo: 'bar', reason: ['FRAUD', 'SPAM'], priority: '' }, ['status', 'reason', 'priority'])).toEqual({
      status: 'OPEN',
      reason: 'FRAUD',
    });
  });

  it('baut Links ohne leere Werte und ohne Seite 1', () => {
    expect(withQuery('/admin/meldungen', { status: 'OPEN', q: '', page: 1 })).toBe('/admin/meldungen?status=OPEN');
    expect(withQuery('/admin/meldungen', { page: 3 })).toBe('/admin/meldungen?page=3');
    expect(withQuery('/admin/inserate', { q: 'a&b=c' })).toBe('/admin/inserate?q=a%26b%3Dc');
  });

  it('rechnet Seiten', () => {
    expect(totalPages(0, 25)).toBe(1);
    expect(totalPages(51, 25)).toBe(3);
  });

  it('lässt nur echte IDs in API-Pfade', () => {
    expect(ENTITY_ID.test('cmvqlzgid000tl67d7e2reugs')).toBe(true);
    expect(ENTITY_ID.test('../users')).toBe(false);
    expect(UUID.test('01fc2729-f160-48b4-86a1-baf380d8fc59')).toBe(true);
    expect(UUID.test('01fc2729-f160-48b4-86a1-baf380d8fc59/role')).toBe(false);
  });
});
