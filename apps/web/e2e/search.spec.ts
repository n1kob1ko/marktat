import { expect, test, type Page } from '@playwright/test';

/**
 * Suche und Filter gegen die Demodaten aus `pnpm db:seed`:
 * E-Bike in 2340 Mödling (~15 km von 1010 Wien), Kinderrad in 3100 St. Pölten (~60 km),
 * VW Golf (Benzin) in Linz, Jobs mit 2.400 € bzw. 48.000 € im Jahr (≈ 3.429 € im Monat).
 */
const BIKES = 'marktplatz/sport-freizeit/fahrraeder';

const isMobile = () => test.info().project.name === 'mobile';
const card = (page: Page, title: RegExp) => page.getByRole('link', { name: title });

/** Filter auf dem Smartphone im Menü, auf dem Desktop in der Seitenleiste */
async function openFilters(page: Page) {
  if (!isMobile()) return page.getByRole('complementary', { name: 'Filter' });
  await page.getByRole('button', { name: /^Filter/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Filter' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Desktop wendet Auswahlfelder sofort an, auf dem Smartphone bestätigt der Knopf „N Anzeigen“. */
async function confirmFilters(page: Page) {
  if (isMobile()) await page.getByRole('dialog', { name: 'Filter' }).getByRole('button', { name: /Anzeige/ }).click();
}

test('Umkreissuche: Fahrräder 25 km um 1010 Wien, Filter teilen und entfernen', async ({ page, context }) => {
  // Nach Preis sortiert: die Demoräder sind günstiger als die Testinserate anderer Specs und stehen so immer auf Seite 1
  await page.goto(`/suche?kategorie=${BIKES}&sortierung=preis_auf`);
  await expect(card(page, /Kinderrad 20 Zoll/)).toBeVisible();
  await page.goto(`/suche?kategorie=${BIKES}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Fahrräder/);

  let filters = await openFilters(page);
  await filters.getByRole('combobox', { name: 'PLZ oder Ort' }).fill('1010');
  await filters.getByRole('option', { name: /^1010 Wien/ }).click();
  if (!isMobile()) await expect(page).toHaveURL(/ort=\d+/);
  await filters.getByLabel('Umkreis').selectOption('25');
  await confirmFilters(page);

  await expect(page).toHaveURL(/umkreis=25/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fahrräder in 1010 Wien + 25 km');
  await expect(card(page, /E-Bike Trekking/)).toBeVisible();
  await expect(card(page, /Kinderrad 20 Zoll/)).toHaveCount(0);
  // Entfernung auf der Karte
  await expect(page.locator('article').filter({ has: card(page, /E-Bike Trekking/) })).toContainText(/Mödling\s*· \d+ km/);

  // Eigenschaftsfilter aus den Kategorie-Feldern
  filters = await openFilters(page);
  await filters.getByRole('checkbox', { name: 'E-Bike' }).check();
  await confirmFilters(page);
  await expect(page).toHaveURL(/radtyp=e-bike/);
  const chips = page.getByLabel('Aktive Filter');
  await expect(chips.getByRole('link', { name: 'Filter entfernen: Fahrradart: E-Bike' })).toBeVisible();

  // Geteilter Link ergibt dieselbe Suche
  const shared = await context.newPage();
  await shared.goto(page.url());
  await expect(shared.getByRole('heading', { level: 1 })).toHaveText('Fahrräder in 1010 Wien + 25 km');
  await expect(shared.getByLabel('Aktive Filter').getByRole('link', { name: /Fahrradart: E-Bike/ })).toBeVisible();
  await shared.close();

  // Einzelnen Filter entfernen: Ort weg, Fahrradart bleibt
  await chips.getByRole('link', { name: 'Filter entfernen: 1010 Wien + 25 km' }).click();
  await expect(page).not.toHaveURL(/umkreis/);
  await expect(page).toHaveURL(/radtyp=e-bike/);
  await expect(card(page, /E-Bike Trekking/)).toBeVisible();

  await page.getByRole('link', { name: 'Alle zurücksetzen' }).click();
  await expect(page).toHaveURL(/\/suche$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alle Anzeigen');
});

test('Bereichsfilter für Auto, Jobs und Immobilien', async ({ page }) => {
  await page.goto('/suche?bereich=auto-motor&kraftstoff=petrol');
  await expect(card(page, /VW Golf 1.5 TSI/)).toBeVisible();
  const filters = await openFilters(page);
  // Nur Filter, die zum Bereich passen
  await expect(filters.getByRole('group', { name: 'Kraftstoff' })).toBeVisible();
  await expect(filters.getByRole('group', { name: 'Fahrradart' })).toHaveCount(0);
  await expect(filters.getByRole('group', { name: 'Zimmer' })).toHaveCount(0);

  await page.goto('/suche?bereich=auto-motor&kraftstoff=diesel&marke=vw');
  await expect(page.getByText('Keine passenden Anzeigen gefunden')).toBeVisible();

  await page.goto('/suche?bereich=jobs&gehalt_ab=3000');
  await expect(card(page, /Softwareentwickler/)).toBeVisible();
  await expect(card(page, /Bürokauffrau/)).toHaveCount(0);
  await expect(page.getByLabel('Aktive Filter')).toContainText(/Gehalt \(brutto pro Monat\): ab €\s3\.000/);

  await page.goto('/suche?bereich=immobilien&angebot=BUY&zimmer_ab=3');
  await expect(card(page, /Eigentumswohnung 3 Zimmer/)).toBeVisible();
  await expect(card(page, /2,5-Zimmer-Wohnung/)).toHaveCount(0);
});

test('Volltextsuche verzeiht Tippfehler, sortiert nach Preis und blättert', async ({ page }) => {
  // Viele Testinserate passen ebenfalls; nach Preis sortiert stehen die günstigeren Demoräder auf Seite 1
  await page.goto('/suche?q=fahrad&sortierung=preis_auf');
  await expect(card(page, /Kinderrad 20 Zoll/)).toBeVisible();
  await expect(card(page, /Citybike Damen/)).toBeVisible();

  await page.goto(`/suche?kategorie=${BIKES}`);
  await page.getByLabel('Sortieren').selectOption('preis_auf');
  await expect(page).toHaveURL(/sortierung=preis_auf/);
  // Nur die Ergebnisliste (darüber können Top-Anzeigen stehen)
  const titles = await page.getByRole('list', { name: 'Suchergebnisse' }).locator('article h3').allTextContents();
  expect(titles[0]).toMatch(/Kinderrad/);

  await page.goto('/suche?seite=999');
  await expect(page).toHaveURL(/\/suche(\?seite=\d+)?$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alle Anzeigen');
});

test('Mobiles Filtermenü öffnet und schließt per Escape', async ({ page }) => {
  test.skip(!isMobile(), 'nur auf dem Smartphone');
  await page.goto('/suche');
  await openFilters(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Filter' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Filter/ })).toBeFocused();
});
