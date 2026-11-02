import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerConfirmed } from './accounts';
import { startFakeClaude } from './fake-claude';

/**
 * Fotos im Formular + „Mit KI ausfüllen“: zwei Fotos auswählen → Kategorie, Titel, Beschreibung und
 * Grafikkarten-Details sind ausgefüllt (der Zustand nicht), „Rückgängig“ stellt den Stand davor wieder her; nach dem
 * Veröffentlichen werden die Fotos automatisch als Bilder der Anzeige hochgeladen.
 *
 * Braucht einen lokalen Claude-Testserver: nur mit E2E_CLAUDE_FAKE_PORT und einer passend gestarteten API (siehe
 * e2e/fake-claude.ts). Ohne diese Variable – also auch in der Generalprobe und online – wird der Test übersprungen.
 */
const PORT = Number(process.env.E2E_CLAUDE_FAKE_PORT ?? 0);
const PHOTO = path.join(__dirname, 'fixtures', 'testbild-mit-gps.jpg');

test('KI füllt das Inserat aus mehreren Fotos aus, die Fotos werden zu Bildern der Anzeige', async ({ page }, testInfo) => {
  test.skip(!PORT, 'Nur mit lokalem Claude-Testserver (E2E_CLAUDE_FAKE_PORT)');
  test.skip(testInfo.project.name !== 'desktop', 'Testserver auf festem Port; das Formular ist auf dem Handy dasselbe');
  const fake = await startFakeClaude(PORT);
  try {
    await registerConfirmed(page, 'Foto Tester', `foto-${Date.now()}@example.at`);
    await page.goto('/inserieren');
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible();
    // Ohne Fotos gibt es noch nichts auszuwerten
    await expect(page.getByRole('button', { name: 'Mit KI ausfüllen' })).toHaveCount(0);

    // Erst selbst etwas eintippen: „Rückgängig“ soll genau diesen Stand zurückbringen
    await page.getByLabel('Titel').fill('Mein eigener Titel');
    await page.getByLabel('Aus Galerie wählen').setInputFiles([PHOTO, PHOTO]);
    const photos = page.getByRole('list', { name: 'Deine Fotos' });
    await expect(photos.getByRole('img')).toHaveCount(2);
    await expect(photos.getByText('Titelbild')).toHaveCount(1);
    await page.getByRole('button', { name: 'Mit KI ausfüllen' }).click();
    await expect(page.getByText(/Ausgefüllt: Kategorie, Titel, Beschreibung, .*Grafikspeicher/)).toBeVisible({ timeout: 30_000 });
    expect(fake.stats).toEqual({ requests: 1, images: 2 });

    await expect(page.getByLabel('Titel')).toHaveValue('ASUS Dual GeForce RTX 4070 Super 12 GB');
    await expect(page.getByLabel('Genauere Kategorie').locator('option:checked')).toHaveText('Grafikkarten');
    await expect(page.getByLabel('Grafikspeicher')).toHaveValue('12');
    await expect(page.getByLabel('Grafikchip')).toHaveValue('GeForce RTX 4070 Super');
    // Den Zustand wählt die Person selbst
    await expect(page.getByRole('radio', { name: 'Keine Angabe' })).toBeChecked();

    await page.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.getByLabel('Titel')).toHaveValue('Mein eigener Titel');
    await expect(page.getByLabel('Bereich & Kategorie')).toHaveValue('');

    // Ein Foto entfernen, noch einmal auswerten und veröffentlichen
    await page.getByRole('button', { name: 'Foto 2 entfernen' }).click();
    await expect(photos.getByRole('img')).toHaveCount(1);
    await page.getByRole('button', { name: 'Mit KI ausfüllen' }).click();
    await expect(page.getByLabel('Titel')).toHaveValue('ASUS Dual GeForce RTX 4070 Super 12 GB', { timeout: 30_000 });
    expect(fake.stats).toEqual({ requests: 2, images: 1 });
    await page.getByRole('radiogroup', { name: 'Zustand' }).getByText('Wie neu', { exact: true }).click();
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
