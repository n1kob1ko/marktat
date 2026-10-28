import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { publishBike, registerConfirmed, setRole } from './accounts';

/**
 * Automatische Barrierefreiheitsprüfung (axe-core, Regeln für WCAG 2.0–2.2 A/AA). Findet nur einen Teil der
 * Probleme – Tastaturbedienung, Screenreader-Texte und Verständlichkeit brauchen zusätzlich manuelle Prüfung.
 * Volle Konformität mit WCAG 2.2 AA ist damit nicht belegt.
 */
test.describe.configure({ mode: 'serial' });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];


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
  test.setTimeout(180_000);
  for (const path of ['/', '/suche?q=rad', '/suche?kategorie=marktplatz/sport-freizeit/fahrraeder', '/deals', '/deals?q=notebook', '/deals/werbung', '/dienstleistungen', '/dienstleistungen?bereich=it-digital', '/dienstleistungen/projekte', '/anmelden', '/registrieren', '/passwort-vergessen', '/impressum', '/gibt-es-nicht']) {
    await page.goto(path);
    await expectNoViolations(page, path);
  }
});

test('320 px breit (WCAG 1.4.10): nichts steht über, Header-Aktionen bleiben im Bild', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/', '/suche?q=rad', '/deals', '/deals/werbung', '/dienstleistungen', '/dienstleistungen/projekte', '/anmelden', '/registrieren', '/agb', '/datenschutz', '/impressum', '/gibt-es-nicht']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path}: seitliches Scrollen`).toBeLessThanOrEqual(0);
    const button = await page.locator('header a[href="/inserieren"]').boundingBox();
    expect(button!.x + button!.width, `${path}: „Inserieren“ im Bild`).toBeLessThanOrEqual(320);
  }
});

test('Angemeldete Seiten ohne automatisch erkennbare WCAG-Verstöße', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const email = `a11y-${testInfo.project.name}-${Date.now()}@example.test`;
  await registerConfirmed(page, 'Barriere Frei', email);
  await expectNoViolations(page, 'Konto');
  for (const path of ['/inserieren', '/konto/anzeigen', '/konto/merkliste', '/konto/merkliste?art=deals', '/konto/merkliste?art=anbieter', '/konto/suchen', '/konto/dienstleistungen', '/konto/projekte', '/konto/projekte/neu', '/konto/benachrichtigungen', '/konto/datenschutz', '/nachrichten']) {
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
  test.setTimeout(180_000);
  const email = `a11y-admin-${testInfo.project.name}-${Date.now()}@example.test`;
  await registerConfirmed(page, 'Admin Barrierefrei', email);
  setRole(email, 'ADMIN');
  for (const adminPath of ['/admin', '/admin/meldungen', '/admin/einsprueche', '/admin/inserate', '/admin/nutzer', '/admin/protokoll', '/admin/system', '/admin/monetarisierung', '/admin/monetarisierung/buchungen', '/admin/deals', '/admin/affiliate', '/admin/dienstleistungen', '/admin/dienstleistungen/projekte']) {
    await page.goto(adminPath);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoViolations(page, adminPath);
  }
});
