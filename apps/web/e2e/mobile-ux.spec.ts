import { expect, test } from '@playwright/test';

/**
 * Handy-Abläufe: Suche aus dem Kopf heraus, Schnellsuche neben dem Filter-Knopf und der feste Kontakt-Balken
 * auf der Anzeigenseite. Braucht die Demodaten (pnpm db:seed -- --demo).
 */

test('Suche aus dem Kopf: Lupe klappt ein Suchfeld auf, Desktop hat das Feld direkt', async ({ page }, testInfo) => {
  await page.goto('/deals');
  const header = page.getByRole('banner');
  // Beim Öffnen wechselt der Name auf „Suche schließen“, deshalb über die Test-ID statt über den Namen
  const toggle = header.getByTestId('mobile-search-toggle');
  // Im Kopf stehen zwei Felder mit diesem Namen: das Desktop-Feld (am Handy verborgen) und das ausklappbare
  const headerField = header.locator('#header-search');
  if (testInfo.project.name === 'mobile') {
    await expect(headerField).toBeHidden();
    await expect(toggle).toBeVisible();
    // Vor dem Hydrieren reagiert der Knopf noch nicht – bei Bedarf noch einmal antippen
    await expect(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
    }).toPass();
    const field = header.getByRole('searchbox', { name: 'Anzeigen durchsuchen' }).filter({ visible: true });
    await expect(field).toBeFocused();
    await field.fill('rad');
    await field.press('Enter');
    await expect(page).toHaveURL(/\/suche\?q=rad/);
    // Nach dem Navigieren ist das Feld wieder eingeklappt
    await expect(page.getByRole('banner').getByTestId('mobile-search-toggle')).toHaveAttribute('aria-expanded', 'false');
  } else {
    await expect(toggle).toBeHidden();
    await expect(headerField).toBeVisible();
  }
});

test('Suchseite am Handy: Suchbegriff neben dem Filter ändern, Filter bleiben erhalten', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'nur am Handy');
  await page.goto('/suche?bereich=marktplatz&anbieter=privat');
  const quick = page.getByRole('searchbox', { name: 'Suchbegriff' });
  await expect(quick).toBeVisible();
  await quick.fill('sofa');
  await quick.press('Enter');
  await expect(page).toHaveURL(/q=sofa/);
  await expect(page).toHaveURL(/bereich=marktplatz/);
  await expect(page).toHaveURL(/anbieter=privat/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('sofa');
});

test('Anzeigenseite: fester Kontakt-Balken nur am Handy, führt zur Anmeldung', async ({ page }, testInfo) => {
  await page.goto('/suche?bereich=marktplatz');
  await page.getByRole('list', { name: 'Suchergebnisse' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/anzeige\//);
  const bar = page.getByTestId('mobile-contact-bar');
  if (testInfo.project.name === 'mobile') {
    await expect(bar).toBeVisible();
    await expect(bar.getByText('€')).toBeVisible();
    await expect(bar.locator('a')).toHaveAttribute('href', /\/anmelden\?weiter=/);
    await expect(bar.locator('a')).toHaveText(/Nachricht schreiben/);
    // Steht der Kontakt-Knopf selbst im Bild, zieht sich der Balken zurück
    await page.locator('#kontakt-aktion').scrollIntoViewIfNeeded();
    await expect(bar).not.toBeInViewport();
    // Oben angelangt kommt er wieder
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(bar).toBeInViewport();
  } else {
    await expect(bar).toBeHidden();
  }
});
