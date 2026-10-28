import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { waitForMailLink } from './mailpit';
import { nextTotp } from './totp';

const REPO_ROOT = path.resolve(__dirname, '../../..');

export const PASSWORD = 'Sicheres-Passwort-2026';

/** Registriert ein Konto und bestätigt die E-Mail über Mailpit; danach ist die Seite angemeldet. */
export async function registerConfirmed(page: Page, displayName: string, email: string) {
  await page.goto('/registrieren');
  await page.getByLabel('Anzeigename').fill(displayName);
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /Ich akzeptiere/ }).check();
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByText('Bitte bestätige deine E-Mail-Adresse')).toBeVisible();
  await page.goto(await waitForMailLink(email, /bestätige/));
  await expect(page).toHaveURL(/\/konto\?bestaetigt=1/);
}

/** Anmeldeformular ausfüllen (die Seite muss /anmelden zeigen) */
export async function signInHere(page: Page, email: string) {
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

/** Veröffentlicht ein Fahrrad-Inserat in Graz und gibt die URL der Detailseite zurück. */
export async function publishBike(page: Page, title: string): Promise<string> {
  await page.goto('/inserieren');
  await page.getByLabel('Bereich & Kategorie').selectOption({ label: 'Sport & Freizeit' });
  await page.getByLabel('Unterkategorie').selectOption({ label: 'Fahrräder' });
  await page.getByLabel('Titel').fill(title);
  await page.getByLabel('Beschreibung').fill('Gepflegtes Trekkingrad, 28 Zoll, frisch serviciert. Abholung in Graz.');
  await page.getByText('Verhandlungsbasis').click();
  await page.getByLabel('Preis in Euro').fill('320');
  await page.getByLabel('Postleitzahl').fill('8010');
  await expect(page.getByLabel('Ort')).toHaveValue(/\d+/);
  await page.getByRole('button', { name: 'Anzeige veröffentlichen' }).click();
  await expect(page).toHaveURL(/\/anzeige\/\w+\/bilder/);
  await page.getByRole('link', { name: 'Fertig' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  return page.url().split('?')[0]!;
}

/**
 * Rolle über die Kommandozeile setzen – so entsteht auch online das erste Administratorkonto (admin:role).
 * Standard: gegen die lokale Datenbank. Für die Generalprobe (docs/deployment.md) E2E_ROLE_COMMAND setzen, z. B.
 * `docker compose -p marktat-probe exec -T api pnpm --silent admin:role --`; E-Mail und Rolle werden angehängt.
 */
export function setRole(email: string, role: 'ADMIN' | 'MODERATOR' | 'USER') {
  const args = ['--email', email, '--role', role];
  const custom = process.env.E2E_ROLE_COMMAND?.trim().split(/\s+/);
  if (custom?.length) execFileSync(custom[0]!, [...custom.slice(1), ...args], { stdio: 'pipe' });
  else execFileSync('pnpm', ['--filter', '@marktat/api', 'admin:role', '--', ...args], { cwd: REPO_ROOT, stdio: 'pipe' });
}

/**
 * Rolle vergeben und – wenn die Umgebung 2FA für das Team verlangt (STAFF_MFA_REQUIRED, z. B. in der Generalprobe) –
 * direkt einen Authenticator einrichten. Gibt den TOTP-Schlüssel zurück (für Bestätigungscodes) oder null ohne 2FA-Pflicht.
 */
export async function becomeStaff(page: Page, email: string, role: 'ADMIN' | 'MODERATOR'): Promise<string | null> {
  setRole(email, role);
  return ensureStaffMfa(page);
}

/** Für Konten, die ihre Rolle schon haben (z. B. im Admin-Bereich vergeben): 2FA einrichten, falls verlangt */
export async function ensureStaffMfa(page: Page): Promise<string | null> {
  await page.goto('/admin');
  // Die Weiterleitung zur Einrichtung kommt beim Streamen erst nach dem Laden – auf eines von beiden warten
  const device = page.getByLabel('Name des Geräts');
  await expect(page.getByRole('heading', { level: 1, name: 'Moderation' }).or(device)).toBeVisible();
  if (!(await device.isVisible())) return null;
  await device.fill('E2E-Authenticator');
  await page.getByRole('button', { name: 'Weiter' }).click();
  const secret = (await page.getByLabel('Schlüssel zum manuellen Eingeben').textContent())!.replace(/\s/g, '');
  await page.getByLabel('Code aus der App').fill(await nextTotp(secret));
  await page.getByRole('button', { name: 'Bestätigen und aktivieren' }).click();
  await expect(page.getByRole('heading', { name: 'Zwei-Faktor-Anmeldung: aktiv' })).toBeVisible();
  return secret;
}
