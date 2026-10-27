import type { Env } from '../config/env.js';
import { StorageNotConfiguredError } from './storage.types.js';

export type R2Jurisdiction = 'default' | 'eu' | 'fedramp';

/**
 * S3-Endpoint von Cloudflare R2. Buckets mit EU- oder FedRAMP-Jurisdiktion sind nur über den
 * jurisdiktionsspezifischen Endpoint erreichbar (sonst „NoSuchBucket“):
 *   default  https://<ACCOUNT_ID>.r2.cloudflarestorage.com
 *   eu       https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
 *   fedramp  https://<ACCOUNT_ID>.fedramp.r2.cloudflarestorage.com
 */
export function r2Endpoint(accountId: string, jurisdiction: R2Jurisdiction = 'default'): string {
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error(
      'R2_ACCOUNT_ID muss die 32-stellige Account-ID aus dem Cloudflare-Dashboard sein.',
    );
  }
  const prefix = jurisdiction === 'default' ? '' : `${jurisdiction}.`;
  return `https://${accountId}.${prefix}r2.cloudflarestorage.com`;
}

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Liest die R2-Konfiguration; wirft StorageNotConfiguredError mit den fehlenden Variablennamen. */
export function r2ConfigFromEnv(env: Env): R2Config {
  const missing = [
    !env.R2_ACCOUNT_ID && !env.R2_ENDPOINT ? 'R2_ACCOUNT_ID' : null,
    !env.R2_ACCESS_KEY_ID ? 'R2_ACCESS_KEY_ID' : null,
    !env.R2_SECRET_ACCESS_KEY ? 'R2_SECRET_ACCESS_KEY' : null,
    !env.R2_BUCKET ? 'R2_BUCKET' : null,
  ].filter((v): v is string => v !== null);
  if (missing.length) throw new StorageNotConfiguredError(missing);
  return {
    endpoint: env.R2_ENDPOINT ?? r2Endpoint(env.R2_ACCOUNT_ID!, env.R2_JURISDICTION),
    bucket: env.R2_BUCKET!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
  };
}
