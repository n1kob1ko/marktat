import { describe, expect, it } from 'vitest';
import { newClientId } from './client-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newClientId', () => {
  it('liefert eindeutige UUIDs', () => {
    const ids = new Set(Array.from({ length: 100 }, newClientId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('funktioniert auch ohne crypto.randomUUID (Aufruf per IP im WLAN, kein HTTPS)', () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(newClientId()).toMatch(UUID_V4);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
