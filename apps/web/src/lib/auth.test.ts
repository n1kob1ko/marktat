import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('./supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));

const { safeRedirectPath } = await import('./auth');

describe('safeRedirectPath', () => {
  it('erlaubt relative Pfade', () => {
    expect(safeRedirectPath('/konto/anzeigen')).toBe('/konto/anzeigen');
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'konto', undefined, 42])(
    'blockiert unsichere Ziele (%s)',
    (value) => {
      expect(safeRedirectPath(value)).toBe('/konto');
    },
  );
});
