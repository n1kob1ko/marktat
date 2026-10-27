import { describe, expect, it } from 'vitest';
import { authErrorMessage } from './auth-errors';

describe('authErrorMessage', () => {
  it('übersetzt bekannte Fehlercodes', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('E-Mail-Adresse oder Passwort ist falsch.');
  });
  it('erkennt Rate-Limits am Status', () => {
    expect(authErrorMessage({ status: 429 })).toMatch(/Zu viele Versuche/);
  });
  it('liefert eine allgemeine Meldung ohne technische Details', () => {
    expect(authErrorMessage({ code: 'unexpected_failure' })).toMatch(/nicht geklappt/);
  });
  it('meldet einen nicht erreichbaren Anmeldedienst verständlich', () => {
    expect(authErrorMessage({ status: 502 })).toMatch(/gerade nicht erreichbar/);
    expect(authErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(/gerade nicht erreichbar/);
    expect(authErrorMessage({ code: 'invalid_credentials', status: 400 })).toMatch(/falsch/);
  });
  it('erklärt einen fehlgeschlagenen E-Mail-Versand', () => {
    expect(authErrorMessage({ code: 'unexpected_failure', status: 500, message: 'Error sending confirmation email' })).toMatch(/E-Mail konnte gerade nicht verschickt/);
    expect(authErrorMessage({ status: 500, message: 'Error sending recovery email' })).toMatch(/E-Mail konnte/);
  });
});
