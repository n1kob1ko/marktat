import { expect, test, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { registerConfirmed, setRole, signInHere } from './accounts';
import { nextTotp } from './totp';

/**
 * Zwei-Faktor-Anmeldung mit echtem Supabase Auth (lokales GoTrue): Einrichten, Anmelden mit Code,
 * Bestätigen kritischer Aktionen und Zurücksetzen durch eine andere Administration (Aussperr-Schutz).
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now();

function contextOptions(testInfo: TestInfo): BrowserContextOptions {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL } = testInfo.project.use;
  return { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL };
}

async function newPage(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext(contextOptions(testInfo));
  return { context, page: await context.newPage() };
}

/** Richtet auf /konto/sicherheit ein Gerät ein und gibt den Schlüssel zurück */
async function enroll(page: Page, name: string): Promise<string> {
  await page.goto('/konto/sicherheit');
  await expect(page.getByRole('heading', { name: 'Zwei-Faktor-Anmeldung: nicht eingerichtet' })).toBeVisible();
  await page.getByLabel('Name des Geräts').fill(name);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByRole('img', { name: 'QR-Code zum Einrichten in der Authenticator-App' })).toBeVisible();
  const secret = (await page.getByLabel('Schlüssel zum manuellen Eingeben').textContent())!.replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

  // Falscher Code: Einrichtung bleibt offen, nichts ist aktiv
  await page.getByLabel('Code aus der App').fill('000000');
  await page.getByRole('button', { name: 'Bestätigen und aktivieren' }).click();
  await expect(page.getByText('Der Code stimmt nicht', { exact: false })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR-Code/ })).toBeVisible();

  await page.getByLabel('Code aus der App').fill(await nextTotp(secret));
  await page.getByRole('button', { name: 'Bestätigen und aktivieren' }).click();
  await expect(page.getByText('Die Zwei-Faktor-Anmeldung ist aktiv.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Zwei-Faktor-Anmeldung: aktiv' })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  return secret;
}

async function logout(page: Page) {
  await page.context().clearCookies();
}

test('2FA einrichten, mit Code anmelden, kritische Aktion bestätigen und Zurücksetzen durch die Administration', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const tag = `${testInfo.project.name}-${run}`;
  const emails = { admin: `e2e-2fa-admin-${tag}@example.at`, moderator: `e2e-2fa-mod-${tag}@example.at` };

  const admin = await newPage(browser, testInfo);
  await registerConfirmed(admin.page, 'Alma Zweifaktor', emails.admin);
  const moderator = await newPage(browser, testInfo);
  await registerConfirmed(moderator.page, 'Max Zweifaktor', emails.moderator);
  setRole(emails.admin, 'ADMIN');

  // Normale Konten sehen den Reiter nicht
  await moderator.page.goto('/konto');
  await expect(moderator.page.getByRole('link', { name: 'Sicherheit' })).toHaveCount(0);

  // --- Einrichten ---
  await admin.page.goto('/konto');
  await admin.page.getByRole('navigation', { name: 'Kontobereich' }).getByRole('link', { name: 'Sicherheit' }).click();
  const secret = await enroll(admin.page, 'Handy');

  // --- Anmelden: nach dem Passwort wird der Code verlangt, ohne Code kein Zugriff ---
  await logout(admin.page);
  await admin.page.goto('/anmelden?weiter=/admin');
  await signInHere(admin.page, emails.admin);
  await expect(admin.page).toHaveURL(/\/anmelden\/zwei-faktor/);
  await admin.page.goto('/admin');
  await expect(admin.page).toHaveURL(/\/anmelden\/zwei-faktor/);
  await admin.page.getByLabel('Bestätigungscode').fill('123456');
  await admin.page.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(admin.page.getByText('Der Code stimmt nicht', { exact: false })).toBeVisible();
  await admin.page.getByLabel('Bestätigungscode').fill(await nextTotp(secret));
  await admin.page.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(admin.page).toHaveURL(/\/admin$/);
  await expect(admin.page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();

  // --- Kritische Aktion: Moderationsrechte vergeben; ein falscher Code verhindert sie ---
  await admin.page.goto(`/admin/nutzer?q=${encodeURIComponent(emails.moderator)}`);
  await admin.page.getByRole('link', { name: 'Max Zweifaktor' }).click();
  const roleForm = admin.page.locator('form').filter({ has: admin.page.getByRole('button', { name: 'Moderationsrechte geben' }) });
  await roleForm.getByLabel('Bestätigungscode (Authenticator-App)').fill('000000');
  await roleForm.getByRole('button', { name: 'Moderationsrechte geben' }).click();
  await expect(roleForm.getByText('Der Code stimmt nicht', { exact: false })).toBeVisible();
  await roleForm.getByLabel('Bestätigungscode (Authenticator-App)').fill(await nextTotp(secret));
  await roleForm.getByRole('button', { name: 'Moderationsrechte geben' }).click();
  await expect(admin.page.getByText('Das Konto hat jetzt Moderationsrechte.')).toBeVisible();
  const targetUrl = admin.page.url();

  // --- Moderation richtet 2FA ein und verliert das Gerät: die Administration setzt zurück ---
  await moderator.page.goto('/konto');
  await expect(moderator.page.getByRole('link', { name: 'Sicherheit' })).toBeVisible();
  await enroll(moderator.page, 'Diensthandy');
  await admin.page.goto(targetUrl);
  await expect(admin.page.getByText('Diensthandy · eingerichtet', { exact: false })).toBeVisible();
  const resetForm = admin.page.locator('form').filter({ has: admin.page.getByRole('button', { name: 'Zurücksetzen' }) });
  await resetForm.getByRole('button', { name: 'Zurücksetzen' }).click();
  await expect(resetForm.getByText('Bitte bestätige, dass du die Identität der Person geprüft hast.')).toBeVisible();
  await resetForm.getByLabel('Identität geprüft – Zwei-Faktor-Anmeldung zurücksetzen').check();
  await resetForm.getByRole('button', { name: 'Zurücksetzen' }).click();
  await expect(admin.page.getByText('Die Zwei-Faktor-Anmeldung ist zurückgesetzt.', { exact: false })).toBeVisible();

  // Danach genügt das Passwort wieder, und die Einrichtung ist neu möglich
  await logout(moderator.page);
  await moderator.page.goto('/anmelden?weiter=/konto/sicherheit');
  await signInHere(moderator.page, emails.moderator);
  await expect(moderator.page).toHaveURL(/\/konto\/sicherheit/);
  await expect(moderator.page.getByRole('heading', { name: 'Zwei-Faktor-Anmeldung: nicht eingerichtet' })).toBeVisible();

  // Protokoll enthält Einrichtung und Zurücksetzen
  await admin.page.goto('/admin/protokoll');
  await expect(admin.page.getByText('admin.mfa_reset').first()).toBeVisible();
  await expect(admin.page.getByText('security.mfa_enrolled').first()).toBeVisible();

  await admin.context.close();
  await moderator.context.close();
});
