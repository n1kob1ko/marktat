import { execFileSync } from 'node:child_process';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { publishBike, registerConfirmed } from './accounts';

/**
 * Automatische Barrierefreiheitsprüfung (axe-core, Regeln für WCAG 2.0–2.2 A/AA). Findet nur einen Teil der
 * Probleme – Tastaturbedienung, Screenreader-Texte und Verständlichkeit brauchen zusätzlich manuelle Prüfung.
 * Volle Konformität mit WCAG 2.2 AA ist damit nicht belegt.
 */
test.describe.configure({ mode: 'serial' });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Prüft zusätzlich, dass nichts seitlich übersteht (Handy: kein horizontales Scrollen) */
async function expectNoViolations(page: Page, label: string) {
  // Auf Streaming-Inhalte warten (Suspense-Grenzen), sonst prüft axe Ladeplatzhalter
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: seitliches Scrollen`).toBeLessThanOrEqual(0);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `${label}: ${page.url()}`).toEqual([]);
}

test('Öffentliche Seiten ohne automatisch erkennbare WCAG-Verstöße', async ({ page }) => {
  for (const path of ['/', '/suche?q=rad', '/suche?kategorie=marktplatz/sport-freizeit/fahrraeder', '/anmelden', '/registrieren', '/passwort-vergessen', '/impressum', '/gibt-es-nicht']) {
    await page.goto(path);
    await expectNoViolations(page, path);
  }
});

test('Angemeldete Seiten ohne automatisch erkennbare WCAG-Verstöße', async ({ page }, testInfo) => {
  const email = `a11y-${testInfo.project.name}-${Date.now()}@example.test`;
  await registerConfirmed(page, 'Barriere Frei', email);
  await expectNoViolations(page, 'Konto');
  for (const path of ['/inserieren', '/konto/anzeigen', '/konto/merkliste', '/konto/suchen', '/konto/benachrichtigungen', '/konto/datenschutz', '/nachrichten']) {
    await page.goto(path);
    await expectNoViolations(page, path);
  }
  const url = await publishBike(page, `Barrierefrei-Rad ${testInfo.project.name}-${Date.now()}`);
  await expectNoViolations(page, 'Inserat (eigenes)');
  await page.goto(`${url}/bearbeiten`);
  await expectNoViolations(page, 'Inserat bearbeiten');
  await page.goto(`${url}/bilder`);
  await expectNoViolations(page, 'Bilder');

  // Fremdes Inserat mit Kontaktformular, ohne Anmeldung
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL } = testInfo.project.use;
  const guestContext = await page.context().browser()!.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL });
  const guest = await guestContext.newPage();
  await guest.goto(url);
  await expectNoViolations(guest, 'Inserat (öffentlich)');
  await guestContext.close();
});

test('Admin-Bereich ohne automatisch erkennbare WCAG-Verstöße', async ({ page }, testInfo) => {
  const email = `a11y-admin-${testInfo.project.name}-${Date.now()}@example.test`;
  await registerConfirmed(page, 'Admin Barrierefrei', email);
  execFileSync('pnpm', ['--filter', '@marktat/api', 'admin:role', '--', '--email', email, '--role', 'ADMIN'], { cwd: REPO_ROOT, stdio: 'pipe' });
  for (const adminPath of ['/admin', '/admin/meldungen', '/admin/einsprueche', '/admin/inserate', '/admin/nutzer', '/admin/protokoll', '/admin/system', '/admin/monetarisierung', '/admin/monetarisierung/buchungen']) {
    await page.goto(adminPath);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoViolations(page, adminPath);
  }
});
