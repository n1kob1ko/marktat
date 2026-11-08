import { describe, expect, it } from 'vitest';
import { isSocialProvider, parseAuthProviders } from './auth-providers';

describe('Anmeldeanbieter aus AUTH_PROVIDERS', () => {
  it('liest nur bekannte Anbieter, unabhängig von Schreibweise und Leerzeichen', () => {
    expect(parseAuthProviders('google, Apple')).toEqual(['google', 'apple']);
    expect(parseAuthProviders('facebook,google')).toEqual(['google']);
    expect(parseAuthProviders('')).toEqual([]);
    expect(parseAuthProviders(undefined)).toEqual([]);
  });

  it('erkennt gültige Anbieter aus Formulardaten', () => {
    expect(isSocialProvider('google')).toBe(true);
    expect(isSocialProvider('github')).toBe(false);
    expect(isSocialProvider(null)).toBe(false);
  });
});
