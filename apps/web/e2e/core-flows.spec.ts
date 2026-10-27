import path from 'node:path';
import { expect, test } from '@playwright/test';
import { waitForMailLink } from './mailpit';

const PASSWORD = 'Sicheres-Passwort-2026';
const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

test.describe.configure({ mode: 'serial' });

test('Startseite zeigt Suche, Bereiche und Kategorien', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Gutes findet man');
  await expect(page.getByRole('searchbox', { name: 'Suchbegriff' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Auto & Motor/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Kategorien im Marktplatz' })).toBeVisible();
});

test('geschützte Seiten leiten zur Anmeldung weiter', async ({ page }) => {
  await page.goto('/inserieren');
  await expect(page).toHaveURL(/\/anmelden\?weiter=%2Finserieren/);
  await expect(page.getByText('Bitte melde dich an, um fortzufahren.')).toBeVisible();
});

test('Registrierung zeigt Feldfehler auf Deutsch', async ({ page }) => {
  await page.goto('/registrieren');
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByText('Der Anzeigename muss mindestens 2 Zeichen lang sein.')).toBeVisible();
  await expect(page.getByText('Bitte akzeptiere die Nutzungsbedingungen')).toBeVisible();
});

test('Registrieren, E-Mail bestätigen, inserieren, finden, abmelden, Passwort zurücksetzen', async ({ page }, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.at`;
  const title = `E2E Testrad ${testInfo.project.name} ${Date.now()}`;

  // 1. Registrieren
  await page.goto('/registrieren');
  await page.getByLabel('Anzeigename').fill('E2E Tester');
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /Ich akzeptiere/ }).check();
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByText('Bitte bestätige deine E-Mail-Adresse')).toBeVisible();

  // 2. Bestätigungslink aus der E-Mail öffnen -> angemeldet im Konto
  const confirmLink = await waitForMailLink(email, /bestätige/);
  await page.goto(confirmLink);
  await expect(page).toHaveURL(/\/konto\?bestaetigt=1/);
  await expect(page.getByText('Deine E-Mail-Adresse ist bestätigt.')).toBeVisible();
  await expect(page.getByLabel('Anzeigename')).toHaveValue('E2E Tester');

  // 3. Inserat aufgeben
  await page.goto('/inserieren');
  await page.getByLabel('Bereich & Kategorie').selectOption({ label: 'Sport & Freizeit' });
  await page.getByLabel('Unterkategorie').selectOption({ label: 'Fahrräder' });
  await page.getByLabel('Titel').fill(title);
  await page.getByLabel('Beschreibung').fill('Gepflegtes Trekkingrad, 28 Zoll, frisch serviciert. Abholung in Graz.');
  await page.getByText('Verhandlungsbasis').click();
  await page.getByLabel('Preis in Euro').fill('249,50');
  await page.getByLabel('Postleitzahl').fill('8010');
  await expect(page.getByLabel('Ort')).toHaveValue(/\d+/);
  await expect(page.getByLabel('Anzeigenvorschau')).toContainText('8010 Graz');
  await page.getByRole('button', { name: 'Anzeige veröffentlichen' }).click();

  // 3b. Bilder: nach dem Veröffentlichen direkt zur Bildverwaltung
  await expect(page).toHaveURL(/\/anzeige\/\w+\/bilder\?neu=veroeffentlicht/);
  await expect(page.getByText('Deine Anzeige ist online. Füge jetzt Bilder hinzu')).toBeVisible();
  await page.locator('#bilder-auswahl').setInputFiles(fixture('kein-erlaubtes-format.gif'));
  await expect(page.getByText('Erlaubt sind nur JPEG, PNG oder WebP.')).toBeVisible();
  await page.locator('#bilder-auswahl').setInputFiles([fixture('testbild-mit-gps.jpg'), fixture('testbild-mit-gps.jpg')]);
  const gallery = page.getByRole('list', { name: 'Bilder der Anzeige' });
  await expect(gallery.getByRole('img')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByText('2 von 10 Bildern')).toBeVisible();
  await expect(gallery.getByText('Hauptbild')).toHaveCount(1);
  await page.getByRole('button', { name: 'Bild 2 als Hauptbild' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Das Hauptbild wurde geändert.' })).toBeAttached();
  await page.getByRole('button', { name: 'Bild 2 löschen' }).click();
  await expect(gallery.getByRole('img')).toHaveCount(1);
  // Das verarbeitete Bild muss tatsächlich laden (Weiterleitung API -> Speicher)
  await expect
    .poll(() => gallery.getByRole('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(480);
  await page.getByRole('link', { name: 'Fertig' }).click();

  await expect(page).toHaveURL(/\/anzeige\/\w+\?hinweis=veroeffentlicht/);
  await expect(page.getByText('Deine Anzeige ist jetzt online.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText('€ 249,50').first()).toBeVisible();
  const mainImage = page.getByRole('img', { name: title });
  await expect.poll(() => mainImage.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1200);
  const listingUrl = page.url().split('?')[0]!;

  // 4. Über die Suche auffindbar
  await page.goto(`/suche?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: title });
  await expect.poll(() => card.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(480);

  // 5. Pausieren entfernt die Anzeige aus der öffentlichen Ansicht
  await page.goto(listingUrl);
  await page.getByRole('button', { name: 'Pausieren' }).click();
  await expect(page.getByText('Die Anzeige ist pausiert')).toBeVisible();
  await page.goto(`/suche?q=${encodeURIComponent(title)}`);
  await expect(page.getByText('Keine passenden Anzeigen gefunden')).toBeVisible();

  // 6. Abmelden (auf Mobil über das Konto-Menü nicht sichtbar -> Cookies löschen)
  await page.context().clearCookies();
  await page.goto('/konto');
  await expect(page).toHaveURL(/\/anmelden/);

  // 7. Passwort vergessen -> neues Passwort -> Anmeldung
  await page.goto('/passwort-vergessen');
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByRole('button', { name: 'Link anfordern' }).click();
  await expect(page.getByText('Wenn ein Konto mit dieser Adresse existiert')).toBeVisible();
  const resetLink = await waitForMailLink(email, /Passwort zurücksetzen/);
  await page.goto(resetLink);
  await expect(page).toHaveURL(/\/passwort-neu/);
  const newPassword = `${PASSWORD}-neu`;
  await page.getByLabel('Neues Passwort').fill(newPassword);
  await page.getByLabel('Passwort wiederholen').fill(newPassword);
  await page.getByRole('button', { name: 'Passwort speichern' }).click();
  await expect(page.getByText('Dein Passwort wurde geändert.')).toBeVisible();

  await page.context().clearCookies();
  await page.goto('/anmelden');
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByText('E-Mail-Adresse oder Passwort ist falsch.')).toBeVisible();
  await page.getByLabel('Passwort').fill(newPassword);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/konto/);
});
