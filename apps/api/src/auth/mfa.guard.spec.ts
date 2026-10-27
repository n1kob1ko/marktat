import { mfaDecision, type MfaInput } from './mfa.guard.js';

const base: MfaInput = { aal: 'aal1', mfaVerifiedAt: null, required: false, stepUp: false, maxAgeSeconds: 600, nowSeconds: 10_000 };

describe('mfaDecision', () => {
  it('lässt ohne Pflicht und ohne kritische Aktion alles zu', () => {
    expect(mfaDecision(base)).toBeNull();
  });

  it('verlangt bei Pflicht eine mit dem zweiten Faktor bestätigte Sitzung', () => {
    expect(mfaDecision({ ...base, required: true })).toBe('MFA_REQUIRED');
    expect(mfaDecision({ ...base, required: true, aal: 'aal2', mfaVerifiedAt: 1 })).toBeNull();
  });

  it('verlangt für kritische Aktionen einen Code, der höchstens maxAgeSeconds alt ist', () => {
    const stepUp = { ...base, aal: 'aal2' as const, stepUp: true };
    expect(mfaDecision({ ...stepUp, mfaVerifiedAt: 10_000 - 600 })).toBeNull();
    expect(mfaDecision({ ...stepUp, mfaVerifiedAt: 10_000 - 601 })).toBe('STEP_UP_REQUIRED');
    expect(mfaDecision({ ...stepUp, mfaVerifiedAt: null })).toBe('STEP_UP_REQUIRED');
  });

  it('meldet bei Pflicht ohne 2FA zuerst die fehlende Einrichtung, nicht die Bestätigung', () => {
    expect(mfaDecision({ ...base, required: true, stepUp: true })).toBe('MFA_REQUIRED');
  });

  it('lässt kritische Aktionen ohne Pflicht und ohne eingerichtete 2FA zu (lokale Entwicklung)', () => {
    expect(mfaDecision({ ...base, stepUp: true })).toBeNull();
  });
});
