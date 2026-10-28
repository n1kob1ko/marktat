import { expect, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { PASSWORD } from './accounts';
import { waitForMailLink } from './mailpit';

/** Gemeinsame Schritte der Händler-Specs (Deals, Importe) */

export function contextOptions(testInfo: TestInfo): BrowserContextOptions {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL } = testInfo.project.use;
  return { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL };
}

export async function newPage(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext(contextOptions(testInfo));
  return { context, page: await context.newPage() };
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Datum in Wien als yyyy-mm-dd (für <input type="date">) */
export function viennaDay(offsetDays: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

export async function registerBusiness(page: Page, companyName: string, email: string) {
  await page.goto('/registrieren');
  await page.getByText('Gewerblich', { exact: true }).click();
  await page.getByLabel('Anzeigename').fill(companyName);
  await page.getByLabel('Firmenname').fill(companyName);
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /Ich akzeptiere/ }).check();
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByText('Bitte bestätige deine E-Mail-Adresse')).toBeVisible();
  await page.goto(await waitForMailLink(email, /bestätige/));
  await expect(page).toHaveURL(/\/konto\?bestaetigt=1/);
}

/** Geschäftsanschrift und Telefon ergänzen und als Händler bestätigen (Voraussetzung zum Veröffentlichen) */
export async function completeMerchantProfile(page: Page) {
  await page.goto('/konto');
  await page.getByLabel('Telefon (optional)').fill('+43 316 123456');
  await page.getByLabel('Geschäftsanschrift').fill('Annenstraße 1, 8020 Graz');
  await page.getByRole('button', { name: 'Profil speichern' }).click();
  await expect(page.getByText(/gespeichert/).first()).toBeVisible();
  await page.goto('/konto/deals');
  await page.getByRole('checkbox', { name: /Ich bestätige, dass meine Firmenangaben/ }).check();
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(page.getByText('Danke! Du kannst jetzt Angebote veröffentlichen.')).toBeVisible();
}
