import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerConfirmed } from './accounts';
import { startFakeClaude } from './fake-claude';

/**
 * Foto-Assistent: Foto auswählen → Kategorie, Titel, Beschreibung, Zustand und Grafikkarten-Details sind ausgefüllt,
 * „Rückgängig“ stellt den Stand davor wieder her; nach dem Veröffentlichen wird das Foto als erstes Bild hochgeladen.
 *
 * Braucht einen lokalen Claude-Testserver: nur mit E2E_CLAUDE_FAKE_PORT und einer passend gestarteten API (siehe
 * e2e/fake-claude.ts). Ohne diese Variable – also auch in der Generalprobe und online – wird der Test übersprungen.
 */
const PORT = Number(process.env.E2E_CLAUDE_FAKE_PORT ?? 0);
const PHOTO = path.join(__dirname, 'fixtures', 'testbild-mit-gps.jpg');

test('Foto füllt das Inserat aus und wird zum ersten Bild der Anzeige', async ({ page }, testInfo) => {
  test.skip(!PORT, 'Nur mit lokalem Claude-Testserver (E2E_CLAUDE_FAKE_PORT)');
  test.skip(testInfo.project.name !== 'desktop', 'Testserver auf festem Port; das Formular ist auf dem Handy dasselbe');
  const fake = await startFakeClaude(PORT);
  try {
    await registerConfirmed(page, 'Foto Tester', `foto-${Date.now()}@example.at`);
    await page.goto('/inserieren');
    await expect(page.getByRole('heading', { name: 'Foto machen – wir füllen aus' })).toBeVisible();

    // Erst selbst etwas eintippen: „Rückgängig“ soll genau diesen Stand zurückbringen
    await page.getByLabel('Titel').fill('Mein eigener Titel');
    await page.getByLabel('Bild auswählen').setInputFiles(PHOTO);
    await expect(page.getByText(/Ausgefüllt: Kategorie, Titel, Beschreibung, Zustand, .*Grafikspeicher/)).toBeVisible({ timeout: 30_000 });
    expect(fake.stats.requests).toBe(1);

    await expect(page.getByLabel('Titel')).toHaveValue('ASUS Dual GeForce RTX 4070 Super 12 GB');
    await expect(page.getByLabel('Genauere Kategorie')).toHaveValue(/.+/);
    await expect(page.getByLabel('Genauere Kategorie').locator('option:checked')).toHaveText('Grafikkarten');
    await expect(page.getByLabel('Grafikspeicher')).toHaveValue('12');
    await expect(page.getByLabel('Grafikchip')).toHaveValue('GeForce RTX 4070 Super');
    await expect(page.getByLabel('Zustand')).toHaveValue('LIKE_NEW');

    await page.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.getByLabel('Titel')).toHaveValue('Mein eigener Titel');
    await expect(page.getByLabel('Bereich & Kategorie')).toHaveValue('');

    // Noch einmal auswerten und veröffentlichen
    await page.getByLabel('Bild auswählen').setInputFiles(PHOTO);
    await expect(page.getByLabel('Titel')).toHaveValue('ASUS Dual GeForce RTX 4070 Super 12 GB', { timeout: 30_000 });
    await page.getByText('Verhandlungsbasis').click();
    await page.getByLabel('Preis in Euro').fill('520');
    await page.getByLabel('Postleitzahl').fill('1010');
    await expect(page.getByLabel('Ort')).toHaveValue(/\d+/);
    await page.getByRole('button', { name: 'Anzeige veröffentlichen' }).click();

    await expect(page).toHaveURL(/\/anzeige\/\w+\/bilder/);
    await expect(page.getByText('1 von 10 Bildern')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Fertig' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ASUS Dual GeForce RTX 4070 Super 12 GB' })).toBeVisible();
    await expect(page.getByText('12 GB').first()).toBeVisible();
  } finally {
    await fake.close();
  }
});
