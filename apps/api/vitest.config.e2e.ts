import { defineConfig } from 'vitest/config';

/**
 * Integrationstests gegen eine echte PostgreSQL-Datenbank (TEST_DATABASE_URL).
 * Voraussetzung: `pnpm infra:up`. Die Testdatenbank wird migriert, geseedet und zwischen Tests geleert.
 */
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
