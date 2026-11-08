import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, publishBike, registerConfirmed, signInHere } from './accounts';
import { waitForMail, waitForMailLink } from './mailpit';

/**
 * Kontosicherheit für alle Konten: Passwort ändern (mit Warn-E-Mail und Abmelden anderer Geräte),
 * E-Mail-Adresse ändern (beide Adressen bestätigen) und Profilbild privater Konten.
 */
const run = Date.now();
const NEW_PASSWORD = 'Noch-sichereres-Passwort-2027';

/** Navigation im Kontobereich; auf dem Handy ist sie ein Menü, das erst aufgeklappt werden muss */
async function openSecurity(page: Page) {
  await page.goto('/konto');
  const nav = page.getByRole('navigation', { name: 'Kontobereich' });
  await expect(nav.locator('a[aria-current="page"]').first()).toBeAttached();
  const toggle = nav.getByText('Bereich wechseln');
  if (await toggle.isVisible()) await toggle.click();
  await nav.getByRole('link', { name: 'Sicherheit' }).click();
  await expect(page.getByRole('heading', { name: 'Passwort ändern' })).toBeVisible();
}

test('Passwort ändern: nur mit aktuellem Passwort, danach Warn-E-Mail und Anmeldung mit dem neuen Passwort', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const email = `e2e-passwort-${testInfo.project.name}-${run}@example.at`;
  await registerConfirmed(page, 'Paula Passwort', email);
  await openSecurity(page);

  // Falsches aktuelles Passwort: nichts passiert
  await page.getByLabel('Aktuelles Passwort').fill('Falsches-Passwort-123');
  await page.getByLabel(/^Neues Passwort\W*$/).fill(NEW_PASSWORD);
  await page.getByLabel('Neues Passwort wiederholen').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(page.getByText('Das aktuelle Passwort stimmt nicht.')).toBeVisible();

  // Wiederholung stimmt nicht
  await page.getByLabel('Aktuelles Passwort').fill(PASSWORD);
  await page.getByLabel('Neues Passwort wiederholen').fill('anders');
  await page.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(page.getByText('Die Passwörter stimmen nicht überein.')).toBeVisible();

  await page.getByLabel('Aktuelles Passwort').fill(PASSWORD);
  await page.getByLabel(/^Neues Passwort\W*$/).fill(NEW_PASSWORD);
  await page.getByLabel('Neues Passwort wiederholen').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(page.getByText('Dein Passwort ist geändert und alle anderen Geräte sind abgemeldet.')).toBeVisible();
  // Dieses Gerät bleibt angemeldet
  await page.goto('/konto');
  await expect(page.getByText(email)).toBeVisible();

  const mail = await waitForMail(email, /Dein Passwort wurde geändert/);
  expect(mail.text).toContain('Warst du das nicht?');

  // Altes Passwort gilt nicht mehr, neues schon
  await page.context().clearCookies();
  await page.goto('/anmelden');
  await signInHere(page, email);
  await expect(page.getByText('E-Mail-Adresse oder Passwort ist falsch.')).toBeVisible();
  await page.getByLabel('Passwort').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/konto/);
  await expect(page.getByText(email)).toBeVisible();
});

test('E-Mail-Adresse ändern: Links an beide Adressen, erst nach beiden gilt die neue', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}-${run}`;
  const oldEmail = `e2e-email-alt-${tag}@example.at`;
  const newEmail = `e2e-email-neu-${tag}@example.at`;
  await registerConfirmed(page, 'Emil E-Mail', oldEmail);
  await openSecurity(page);

  // Ohne richtiges Passwort keine Änderung
  await page.getByLabel('Neue E-Mail-Adresse').fill(newEmail);
  await page.locator('form', { hasText: 'Neue E-Mail-Adresse' }).getByLabel('Passwort').fill('Falsches-Passwort-123');
  await page.getByRole('button', { name: 'Bestätigungslinks schicken' }).click();
  await expect(page.getByText('Das aktuelle Passwort stimmt nicht.')).toBeVisible();

  await page.locator('form', { hasText: 'Neue E-Mail-Adresse' }).getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Bestätigungslinks schicken' }).click();
  await expect(page.getByText('Fast geschafft: Wir haben je einen Bestätigungslink')).toBeVisible();
  await expect(page.getByText(`Die Änderung zu ${newEmail} wartet noch auf Bestätigung.`)).toBeVisible();

  // Erster Link (bisherige Adresse): noch gilt die alte Adresse
  await page.goto(await waitForMailLink(oldEmail, /Neue E-Mail-Adresse bestätigen/));
  await expect(page).toHaveURL(/\/konto\/sicherheit\?bestaetigt=1/);
  await expect(page.getByText('Danke, dieser Link ist bestätigt.')).toBeVisible();
  await expect(page.getByText(`Aktuell: ${oldEmail}`)).toBeVisible();

  // Zweiter Link (neue Adresse): jetzt gilt die neue
  await page.goto(await waitForMailLink(newEmail, /Neue E-Mail-Adresse bestätigen/));
  await expect(page).toHaveURL(/\/konto\/sicherheit\?bestaetigt=1/);
  await expect(page.getByText(`Deine neue E-Mail-Adresse ist bestätigt. Ab jetzt meldest du dich mit ${newEmail} an.`)).toBeVisible();
  await expect(page.getByText(`Aktuell: ${newEmail}`)).toBeVisible();

  // Anmeldung nur noch mit der neuen Adresse
  await page.context().clearCookies();
  await page.goto('/anmelden');
  await signInHere(page, oldEmail);
  await expect(page.getByText('E-Mail-Adresse oder Passwort ist falsch.')).toBeVisible();
  await page.getByLabel('E-Mail-Adresse').fill(newEmail);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/konto/);
  await expect(page.getByText(newEmail)).toBeVisible();
});

test('Profilbild für private Konten: hochladen, auf der Anzeige sehen, entfernen', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const email = `e2e-profilbild-${testInfo.project.name}-${run}@example.at`;
  await registerConfirmed(page, 'Pia Profilbild', email);

  await page.goto('/konto');
  await expect(page.getByRole('heading', { name: 'Profilbild' })).toBeVisible();
  await page.getByLabel('Profilbild auswählen').setInputFiles(path.join(__dirname, 'fixtures', 'testbild-mit-gps.jpg'));
  await expect(page.getByText('Dein Profilbild ist gespeichert.')).toBeVisible();
  const preview = page.getByRole('img', { name: 'Aktuelles Profilbild' });
  await expect(preview).toBeVisible();
  const src = await preview.getAttribute('src');
  expect(src).toMatch(/\/v1\/dealers\/[0-9a-f-]+\/logo\?v=/);
  // Bild ist tatsächlich abrufbar (Weiterleitung auf den Bildspeicher)
  const response = await page.request.get(src!);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/webp');

  // Auf der eigenen Anzeige erscheint es neben dem Namen
  const url = await publishBike(page, `Profilbild-Rad ${run}`);
  await page.goto(url);
  await expect(page.locator('#kontakt img[src*="/logo?v="]')).toBeVisible();

  await page.goto('/konto');
  await page.getByRole('button', { name: 'Entfernen' }).click();
  await expect(page.getByText('Das Profilbild wurde entfernt.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profilbild hochladen' })).toBeVisible();
});
