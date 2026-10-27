import { expect, test, type Page } from '@playwright/test';
import { waitForMailLink } from './mailpit';

const PASSWORD = 'Sicheres-Passwort-2026';

test.describe.configure({ mode: 'serial' });

/** Optional für die visuelle Kontrolle: SCREENSHOT_DIR=/pfad pnpm --filter @marktat/web test:e2e */
async function snap(page: Page, name: string) {
  if (!process.env.SCREENSHOT_DIR) return;
  await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function registerAndConfirm(page: Page, email: string) {
  await page.goto('/registrieren');
  await page.getByLabel('Anzeigename').fill('E2E Händler');
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /Ich akzeptiere/ }).check();
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByText('Bitte bestätige deine E-Mail-Adresse')).toBeVisible();
  await page.goto(await waitForMailLink(email, /bestätige/));
  await expect(page).toHaveURL(/\/konto\?bestaetigt=1/);
}

async function fillBasics(page: Page, title: string, postalCode = '1070') {
  await page.getByLabel('Titel').fill(title);
  await page.getByLabel('Beschreibung').fill('Ausführliche Beschreibung für den Test, gepflegt und sofort verfügbar.');
  await page.getByLabel('Postleitzahl').fill(postalCode);
  await expect(page.getByLabel(/^Ort/)).toHaveValue(/\d+/);
}

test('Kategorieabhängige Felder: Auto anlegen, als Mietwohnung bearbeiten, Job-Entwurf', async ({ page }, testInfo) => {
  const stamp = `${testInfo.project.name} ${Date.now()}`;
  await registerAndConfirm(page, `e2e-felder-${testInfo.project.name}-${Date.now()}@example.at`);

  // 1. Gebrauchtwagen: Fahrzeugfelder erscheinen, Marktplatz-Zustand verschwindet
  await page.goto('/inserieren');
  await page.getByLabel('Bereich & Kategorie').selectOption({ label: 'Sport & Freizeit' });
  await page.getByLabel('Unterkategorie').selectOption({ label: 'Fahrräder' });
  await expect(page.getByLabel('Zustand')).toBeVisible();
  await expect(page.getByLabel('Rahmengröße')).toBeVisible();
  await page.getByLabel('Rahmengröße').fill('56 cm');

  await page.getByLabel('Bereich & Kategorie').selectOption({ label: 'Gebrauchtwagen' });
  await expect(page.getByLabel('Rahmengröße')).toHaveCount(0);
  await expect(page.getByLabel(/^Zustand/)).toHaveCount(0);
  await expect(page.getByLabel('Unterkategorie')).toHaveCount(0);

  const title = `E2E VW Golf ${stamp}`;
  await fillBasics(page, title, '4020');
  await page.getByLabel('Marke').selectOption({ label: 'VW' });
  await page.getByLabel('Modell').fill('Golf 1.5 TSI');
  await page.getByLabel(/^Erstzulassung/).fill('2019');
  await page.getByLabel('Monat der Erstzulassung').selectOption({ label: 'März' });
  await page.getByLabel('Kilometerstand').fill('viel');
  await page.getByText('Verhandlungsbasis').click();
  await page.getByLabel('Preis in Euro').fill('16.900');
  await page.getByRole('button', { name: 'Anzeige veröffentlichen' }).click();
  // Ungültige Zahl und fehlende Pflichtangaben auf einmal
  await expect(page.getByText('Bitte gib bei „Kilometerstand“ eine Zahl ein.')).toBeVisible();
  await page.getByLabel('Kilometerstand').fill('85.000');
  await page.getByRole('button', { name: 'Anzeige veröffentlichen' }).click();
  await expect(page.getByText('Bitte wähle „Kraftstoff“.')).toBeVisible();
  await expect(page.getByText('Bitte wähle „Fahrzeugzustand“.')).toBeVisible();
  await snap(page, '1-auto-fehler');

  await page.getByLabel('Kraftstoff').selectOption({ label: 'Benzin' });
  await page.getByLabel('Getriebe').selectOption({ label: 'Schaltgetriebe' });
  await page.getByLabel('Leistung').fill('110');
  await page.getByLabel('Fahrzeugzustand').selectOption({ label: 'Gebrauchtfahrzeug' });
  await expect(page.getByLabel('Anzeigenvorschau')).toContainText('03/2019 · 85.000 km · Benzin');
  await page.getByRole('button', { name: 'Anzeige veröffentlichen' }).click();
  await expect(page).toHaveURL(/\/anzeige\/\w+\/bilder\?neu=veroeffentlicht/);
  await page.getByRole('link', { name: 'Fertig' }).click();
  await expect(page).toHaveURL(/\/anzeige\/\w+\?hinweis=veroeffentlicht/);
  const listingUrl = page.url().split('?')[0]!;

  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toContainText('Erstzulassung03/2019');
  await expect(details).toContainText('Kilometerstand85.000 km');
  await expect(details).toContainText('Leistung110 kW (150 PS)');
  await expect(details).toContainText('FahrzeugzustandGebrauchtfahrzeug');
  await snap(page, '2-auto-detail');

  await page.goto(`/suche?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole('article').filter({ hasText: title })).toContainText('03/2019 · 85.000 km · Benzin');

  // 2. Bearbeiten: Werte sind vorausgefüllt, Kategoriewechsel zur Mietwohnung
  await page.goto(`${listingUrl}/bearbeiten`);
  await expect(page.getByLabel('Kilometerstand')).toHaveValue('85.000');
  await expect(page.getByLabel('Marke')).toHaveValue('vw');
  await page.getByLabel('Bereich & Kategorie').selectOption({ label: 'Wohnungen' });
  await page.getByLabel('Unterkategorie').selectOption({ label: 'Mietwohnungen' });
  await expect(page.getByLabel('Kilometerstand')).toHaveCount(0);
  await expect(page.getByLabel('Angebotsart')).toHaveValue('Miete');
  await expect(page.getByLabel('Miete pro Monat in Euro')).toBeVisible();
  await page.getByText('Fixpreis').click();
  await page.getByLabel('Miete pro Monat in Euro').fill('950');
  await page.getByRole('button', { name: 'Speichern & veröffentlichen' }).click();
  await expect(page.getByText('Bitte gib „Wohnfläche“ an.')).toBeVisible();
  await expect(page.getByText('Bitte gib „Zimmer“ an.')).toBeVisible();

  await page.getByLabel('Wohnfläche').fill('72,5');
  await page.getByLabel(/^Zimmer/).fill('2,5');
  await page.getByLabel('Stockwerk').selectOption({ label: '3. Stock' });
  await page.getByLabel('Betriebskosten').fill('180');
  await page.getByRole('checkbox', { name: 'Balkon' }).check();
  await page.getByRole('checkbox', { name: 'Lift' }).check();
  await snap(page, '3-wohnung-formular');
  await page.getByRole('button', { name: 'Speichern & veröffentlichen' }).click();
  await expect(page).toHaveURL(/\/anzeige\/\w+\?hinweis=veroeffentlicht/);
  await expect(page.getByText('pro Monat').first()).toBeVisible();
  await expect(details).toContainText('AngebotsartMiete');
  await expect(details).toContainText('Wohnfläche72,5 m²');
  await expect(details).toContainText('Zimmer2,5');
  await expect(details).toContainText('Balkon');
  await expect(details).not.toContainText('Kilometerstand');
  await expect(details).not.toContainText('VW');
  await snap(page, '4-wohnung-detail');

  // 3. Jobs: kein Preis, Arbeitsort statt Standort, Entwurf darf unvollständig sein
  await page.goto('/inserieren');
  await page.getByLabel('Bereich & Kategorie').selectOption({ label: 'Vollzeit' });
  await expect(page.getByRole('heading', { name: 'Preis' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Arbeitsort' })).toBeVisible();
  await page.getByLabel('Titel').fill(`E2E Bürokraft ${stamp}`);
  await page.getByLabel('Berufsbezeichnung').fill('Bürokauffrau/-mann');
  await page.getByLabel('Gehalt (brutto)').fill('2.400');
  await expect(page.getByLabel('Anzeigenvorschau')).toContainText('2.400 brutto');
  await snap(page, '5-job-formular');
  await page.getByRole('button', { name: 'Als Entwurf speichern' }).click();
  await expect(page).toHaveURL(/\/anzeige\/\w+\/bilder\?neu=entwurf/);
  const jobUrl = page.url().split('/bilder')[0]!;
  await page.goto(`${jobUrl}/bearbeiten`);
  await expect(page.getByLabel('Berufsbezeichnung')).toHaveValue('Bürokauffrau/-mann');
  await expect(page.getByLabel('Gehalt (brutto)')).toHaveValue('2.400');
  await page.getByRole('button', { name: 'Anzeige veröffentlichen' }).click();
  await expect(page.getByText('Bitte wähle „Arbeitsort“.')).toBeVisible();
  await expect(page.getByText('Bitte wähle „Gehalt gilt“.')).toBeVisible();
});
