import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { waitForMailLink } from './mailpit';

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
