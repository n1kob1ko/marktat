import { effectiveStatus } from './listings.mapper.js';

describe('effectiveStatus', () => {
  const now = new Date('2026-10-26T12:00:00Z');

  it('meldet aktive Inserate nach Ablaufdatum als abgelaufen', () => {
    expect(effectiveStatus({ status: 'ACTIVE', expiresAt: new Date('2026-10-01T00:00:00Z') }, now)).toBe('EXPIRED');
  });
  it('lässt laufende Inserate aktiv', () => {
    expect(effectiveStatus({ status: 'ACTIVE', expiresAt: new Date('2026-12-01T00:00:00Z') }, now)).toBe('ACTIVE');
  });
  it('ändert andere Status nicht', () => {
    expect(effectiveStatus({ status: 'PAUSED', expiresAt: new Date('2026-10-01T00:00:00Z') }, now)).toBe('PAUSED');
  });
});
