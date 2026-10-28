import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './merchant';

/**
 * Phase 10, Integration: Die Bereichsleiste mit sechs Bereichen ist auf jeder Seite da, markiert den aktuellen
 * Bereich und passt auf kleine Bildschirme. Alte Adressen funktionieren weiter.
 */
const AREAS = ['Marktplatz', 'Auto & Motor', 'Immobilien', 'Jobs', 'Deals', 'Dienstleistungen'];

test('Bereichsleiste zeigt sechs Bereiche und markiert den aktuellen', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Bereiche' });
  await expect(nav.getByRole('link')).toHaveText(AREAS);
  await expectNoHorizontalScroll(page);

  await nav.getByRole('link', { name: 'Deals' }).click();
  await expect(page).toHaveURL(/\/deals$/);
  await expect(nav.getByRole('link', { name: 'Deals' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aktuelle Angebote von Händlern');

  // Auf dem Smartphone liegt der letzte Eintrag eventuell außerhalb; die Leiste scrollt dann seitlich
  const services = nav.getByRole('link', { name: 'Dienstleistungen' });
  await services.scrollIntoViewIfNeeded();
  await services.click();
  await expect(page).toHaveURL(/\/dienstleistungen$/);
  await expect(services).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);

  await page.goto('/dienstleistungen/projekte');
  await expect(services).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Jobs' }).click();
  await expect(page).toHaveURL(/\/suche\?bereich=jobs/);
  await expect(nav.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Deals' })).not.toHaveAttribute('aria-current', 'page');
});

test('Alte Adressen der Kleinanzeigen funktionieren weiter', async ({ page }) => {
  for (const url of ['/suche', '/suche?bereich=marktplatz', '/suche?kategorie=auto-motor/gebrauchtwagen', '/suche?q=Fahrrad']) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBeLessThan(400);
  }
  // Merkliste ohne Anmeldung: weiter zur Anmeldung, Rücksprung auf die Liste der Anzeigen
  await page.goto('/konto/merkliste');
  await expect(page).toHaveURL(/\/anmelden\?weiter=%2Fkonto%2Fmerkliste$/);
  await page.goto('/suche?kategorie=auto-motor/gebrauchtwagen');
  await expect(page.getByRole('navigation', { name: 'Bereiche' }).getByRole('link', { name: 'Auto & Motor' })).toHaveAttribute('aria-current', 'page');
});

test('Startseite verlinkt alle sechs Bereiche', async ({ page }) => {
  await page.goto('/');
  for (const [name, href] of [
    ['Deals', '/deals'],
    ['Dienstleistungen', '/dienstleistungen'],
  ]) {
    await expect(page.locator('main').getByRole('link', { name: new RegExp(`^${name}`) }).first()).toHaveAttribute('href', href);
  }
  await expectNoHorizontalScroll(page);
});
