import { expect, test } from '@playwright/test';
import { becomeStaff, registerConfirmed } from './accounts';
import { completeMerchantProfile, expectNoHorizontalScroll, newPage, registerBusiness } from './merchant';

/**
 * Phase 10, Händlerimporte: Vorlage, CSV hochladen, Vorschau mit Fehlern je Zeile, Bestätigung der Vergleichspreise,
 * Übernahme, erneuter Import (Aktualisierung statt Doppel), Fehlerliste ohne Formeln, Produktfeed einreichen.
 * Am Ende werden die importierten Angebote und der Feed gelöscht.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now();

/** Wiener Datum als TT.MM.JJJJ (Format der Vorlage) */
function day(offset: number) {
  return new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(Date.now() + offset * 86_400_000));
}

test('Händler importiert Deals per CSV, aktualisiert sie und reicht einen Feed ein', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const tag = `${testInfo.project.name}-${run}`;
  const word = `Importtest${run}${testInfo.project.name === 'mobile' ? 'm' : 'd'}`;
  const { context, page } = await newPage(browser, testInfo);
  await registerBusiness(page, `E2E Import ${tag}`, `e2e-import-${tag}@example.at`);
  await completeMerchantProfile(page);

  await page.goto('/konto/deals');
  await page.getByRole('link', { name: 'Importieren' }).click();
  await expect(page.getByRole('heading', { name: 'Deals importieren' })).toBeVisible();
  const template = await page.request.get('/api/deals/importe/vorlage');
  expect(template.ok()).toBe(true);
  expect(await template.text()).toContain('artikelnummer;titel;kategorie;preis;ende');
  await expectNoHorizontalScroll(page);

  const upload = async (name: string, content: string) => {
    // Erst nach dem Laden der Seite (Hydration) reagiert die Dateiauswahl
    await page.waitForLoadState('networkidle');
    const response = page.waitForResponse((r) => r.url().includes('/api/deals/importe?') && r.request().method() === 'POST');
    await page.getByTestId('deal-import-file').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) });
    const result = await response;
    expect(result.status(), await result.text()).toBe(201);
  };
  const header = 'artikelnummer;titel;kategorie;preis;ende;link;vergleichspreis;vergleichspreis_art;vergleichspreis_quelle';
  const file = (price: string) =>
    [
      header,
      `${word}-1;${word} Notebook 15 Zoll;Elektronik & Computer;${price};${day(10)};https://shop.example.at/nb;799,00;uvp;UVP laut Hersteller 10/2026`,
      `${word}-2;${word} Kopfhörer kabellos;tv-audio;79,90;${day(10)};https://shop.example.at/kh;;;`,
      `=HYPERLINK("x");Formel statt Titel;Raumfahrt;gratis;${day(10)};https://shop.example.at/x;;;`,
    ].join('\r\n');
  await upload('angebote.csv', file('599,00'));
  await expect(page).toHaveURL(/\/konto\/deals\/import\/\w+$/);
  const importId = new URL(page.url()).pathname.split('/').pop()!;
  const rows = page.getByTestId('deal-import-rows');
  await expect(rows.getByText('Neu', { exact: true })).toHaveCount(2);
  await expect(rows.getByText('Fehler', { exact: true })).toHaveCount(1);
  await expect(rows).toContainText('Raumfahrt');
  await expectNoHorizontalScroll(page);

  // Ohne Bestätigung der Vergleichspreise wird nichts übernommen
  await page.getByRole('button', { name: 'Import übernehmen' }).click();
  await expect(page.getByText('Bitte bestätige die Vergleichspreise')).toBeVisible();
  await page.getByRole('checkbox', { name: /Jeder Vergleichspreis in der Datei ist belegbar/ }).check();
  await page.getByRole('button', { name: 'Import übernehmen' }).click();
  await expect(page).toHaveURL(/hinweis=import-uebernommen/);
  await expect(page.getByTestId('deal-import-counts')).toContainText('2 neu');

  // Fehlerliste: Formeln sind entschärft
  const errors = await page.request.get(`/api/deals/importe/${importId}/fehler`);
  expect(errors.ok()).toBe(true);
  const errorCsv = await errors.text();
  expect(errorCsv).toContain('Raumfahrt');
  expect(errorCsv).toContain(`'=HYPERLINK`);

  // Öffentlich sichtbar, mit Rabatt aus der UVP
  const visitor = await newPage(browser, testInfo);
  await visitor.page.goto(`/deals?q=${word}`);
  await expect(visitor.page.getByRole('article').filter({ hasText: word })).toHaveCount(2);
  await expect(visitor.page.getByRole('article').filter({ hasText: 'Notebook' })).toContainText('−25');

  // Erneuter Import mit neuem Preis: Aktualisierung statt Doppel
  await page.goto('/konto/deals/import');
  await upload('angebote-2.csv', file('549,00'));
  await expect(page).toHaveURL(/\/konto\/deals\/import\/\w+$/);
  await expect(rows.getByText('Aktualisieren', { exact: true })).toHaveCount(1);
  await expect(rows.getByText('Unverändert', { exact: true })).toHaveCount(1);
  await expect(rows).toContainText('Ändert: Preis');
  await page.getByRole('checkbox', { name: /Jeder Vergleichspreis in der Datei ist belegbar/ }).check();
  await page.getByRole('button', { name: 'Import übernehmen' }).click();
  await expect(page).toHaveURL(/hinweis=import-uebernommen/);
  await expect(page.getByTestId('deal-import-counts')).toContainText('1 aktualisiert');
  await visitor.page.goto(`/deals?q=${word}`);
  await expect(visitor.page.getByRole('article').filter({ hasText: word })).toHaveCount(2);
  await expect(visitor.page.getByRole('article').filter({ hasText: 'Notebook' })).toContainText('549');

  // Importhistorie
  await page.goto('/konto/deals/import');
  await expect(page.getByRole('link', { name: 'angebote-2.csv' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'angebote.csv', exact: true })).toBeVisible();

  // Produktfeed einreichen: wartet auf Freigabe, wird vorher nicht abgerufen
  await page.goto('/konto/deals/feeds');
  await page.getByLabel('Name').fill('Webshop-Feed');
  await page.getByLabel('Adresse des Feeds').fill('https://feeds.example.at/angebote.csv');
  await page.getByLabel('Herkunft und Nutzungsrechte').fill('Eigener Feed unseres Webshops, alle Daten und Bilder von uns.');
  await page.getByRole('checkbox', { name: /Der Feed ist mein eigener/ }).check();
  await page.getByRole('button', { name: 'Feed zur Prüfung einreichen' }).click();
  await expect(page.getByText('abgerufen wird er erst nach der Freigabe')).toBeVisible();
  await expect(page.getByText('Wartet auf Freigabe')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Moderation: Feed freigeben, Importfehler einsehen
  const moderator = await newPage(browser, testInfo);
  const moderatorEmail = `e2e-import-mod-${tag}@example.at`;
  await registerConfirmed(moderator.page, `E2E Mod ${tag}`, moderatorEmail);
  await becomeStaff(moderator.page, moderatorEmail, 'MODERATOR');
  await moderator.page.goto('/admin/deals');
  await moderator.page.getByRole('link', { name: 'Produktfeeds' }).click();
  const feedCard = moderator.page.getByRole('listitem').filter({ hasText: `E2E Import ${tag}` });
  await expect(feedCard).toContainText('Eigener Feed unseres Webshops');
  await feedCard.getByRole('button', { name: 'Freigeben' }).click();
  // Nach der Freigabe verschwindet der Feed aus „Wartet auf Freigabe“
  await expect(feedCard).toHaveCount(0);
  await moderator.page.goto('/admin/deals/feeds?status=APPROVED');
  await expect(moderator.page.getByRole('listitem').filter({ hasText: `E2E Import ${tag}` })).toContainText('Freigegeben');
  await expectNoHorizontalScroll(moderator.page);
  await moderator.page.goto('/admin/deals/importe');
  await moderator.page.getByRole('link', { name: 'CSV-Import: angebote.csv' }).first().click();
  await expect(moderator.page.getByTestId('deal-import-rows')).toContainText('Raumfahrt');
  await moderator.context.close();
  await page.reload();
  await expect(page.getByText('Freigegeben', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entfernen', exact: true }).click();
  await expect(page.getByText('Der Feed wurde entfernt.')).toBeVisible();

  // Aufräumen
  await page.goto('/konto/deals');
  for (let i = 0; i < 2; i++) {
    await page.getByRole('link', { name: new RegExp(word) }).first().click();
    await expect(page).toHaveURL(/\/konto\/deals\/\w+$/);
    await page.getByRole('button', { name: 'Löschen' }).click();
    await expect(page).toHaveURL(/hinweis=deal-geloescht/);
  }
  await visitor.page.goto(`/deals?q=${word}`);
  await expect(visitor.page.getByRole('article').filter({ hasText: word })).toHaveCount(0);
  await visitor.context.close();
  await context.close();
});
