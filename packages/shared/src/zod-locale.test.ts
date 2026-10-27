import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sendMessageSchema } from './index.js';

// Die deutsche Sprache für zod hängt an schemas/zod.ts (nicht mehr am Paketeinstieg),
// damit Seiten ohne Formular zod nicht laden müssen.
describe('zod-Fehlermeldungen', () => {
  it('sind auf Deutsch, sobald ein Schema verwendet wird', () => {
    expect(sendMessageSchema.safeParse({ body: 'Hallo', extra: 1 }).error?.issues[0]?.message).toBe('Unbekannter Schlüssel: "extra"');
    // gilt global, also auch für eigene Schemas der API
    expect(z.string().safeParse(1).error?.issues[0]?.message).toMatch(/Ungültige Eingabe/);
  });
});
