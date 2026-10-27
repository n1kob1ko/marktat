import { describe, expect, it } from 'vitest';
import { clientIp, forwardedFor } from './client-ip';

describe('clientIp', () => {
  it('nimmt den ersten Eintrag aus X-Forwarded-For (von Caddy gesetzt)', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 172.30.0.10' }))).toBe('203.0.113.7');
  });

  it('liefert nichts ohne Header', () => {
    expect(clientIp(new Headers())).toBeUndefined();
    expect(forwardedFor(new Headers({ 'x-forwarded-for': ' ' }))).toEqual({});
  });

  it('reicht die IP für Supabase Auth weiter', () => {
    expect(forwardedFor(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toEqual({ 'X-Forwarded-For': '2001:db8::1' });
  });
});
