import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-End-Tests gegen die laufende lokale Umgebung:
 *   pnpm infra:up && pnpm db:migrate && pnpm db:seed && pnpm build && pnpm start (API + Web)
 * E-Mails werden über die Mailpit-API (http://localhost:8025) ausgelesen.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
