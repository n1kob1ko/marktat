import type { Env } from '../config/env.js';
import { r2ConfigFromEnv, r2Endpoint } from './r2-config.js';
import { StorageNotConfiguredError } from './storage.types.js';

const ACCOUNT = '0123456789abcdef0123456789abcdef';

describe('r2Endpoint', () => {
  it('verwendet für EU- und FedRAMP-Buckets den jurisdiktionsspezifischen Endpoint', () => {
    expect(r2Endpoint(ACCOUNT)).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com`);
    expect(r2Endpoint(ACCOUNT, 'eu')).toBe(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com`);
    expect(r2Endpoint(ACCOUNT, 'fedramp')).toBe(
      `https://${ACCOUNT}.fedramp.r2.cloudflarestorage.com`,
    );
  });

  it('lehnt offensichtlich falsche Account-IDs ab', () => {
    expect(() => r2Endpoint('mein-account')).toThrow('32-stellige Account-ID');
  });
});

describe('r2ConfigFromEnv', () => {
  const base = { R2_JURISDICTION: 'eu' } as Env;

  it('nennt alle fehlenden Variablen (ohne Werte)', () => {
    try {
      r2ConfigFromEnv(base);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StorageNotConfiguredError);
      expect((error as StorageNotConfiguredError).missing).toEqual([
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
      ]);
    }
  });

  it('baut den Endpoint aus Account-ID und Jurisdiktion, R2_ENDPOINT hat Vorrang', () => {
    const env = {
      ...base,
      R2_ACCOUNT_ID: ACCOUNT,
      R2_ACCESS_KEY_ID: 'k',
      R2_SECRET_ACCESS_KEY: 's',
      R2_BUCKET: 'marktat-dev',
    } as Env;
    expect(r2ConfigFromEnv(env).endpoint).toBe(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com`);
    expect(r2ConfigFromEnv({ ...env, R2_ENDPOINT: 'https://example.test' }).endpoint).toBe(
      'https://example.test',
    );
  });
});
