import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Setzt die Umgebung für Integrationstests: Testdatenbank statt Entwicklungsdatenbank. */
export function applyTestEnv() {
  const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL ist nicht gesetzt (siehe .env.example).');
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_JWT_SECRET ||= 'test-secret-for-integration-tests-only-0123456789';
  process.env.SUPABASE_URL ||= 'http://localhost:54321';
  process.env.RATE_LIMIT_PER_MINUTE = '1000';
  // Tests sprechen nie mit Cloudflare: lokaler Speichertreiber in einem eigenen Verzeichnis.
  process.env.STORAGE_DRIVER = 'local';
  process.env.LOCAL_STORAGE_DIR = fileURLToPath(new URL('../.storage-test', import.meta.url));
  process.env.API_URL = 'http://localhost:4000';
  // Eigener Suchindex, damit Tests die Entwicklungsdaten nicht berühren
  process.env.MEILI_INDEX = 'listings_test';
}
