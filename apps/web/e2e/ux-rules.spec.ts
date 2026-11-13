import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { registerConfirmed } from './accounts';

/**
 * Bedienung (docs/design-bedienung.md): Tippflächen, Schnellmenü, Wegwischen der Filter, Foto-Platzhalter
 * und der Weg des Fotos von der Karte in die Anzeige. Geprüft wird das Verhalten, nicht das Aussehen.
 * „Rückgängig“ statt Sicherheitsabfrage prüfen interactions.spec.ts (gespeicherte Suche) und deals.spec.ts (Merkliste).
 */

const FIXTURE = path.join(__dirname, 'fixtures', 'testbild-mit-gps.jpg');

async function publishWithPhoto(page: Page, title: string) {
  await page.goto('/inserieren');
  await page.getByLabel('Bereich & Kategorie').selectOption({ label: 'Sport & Sportgeräte' });
  await page.getByLabel('Unterkategorie').selectOption({ label: 'Fahrräder' });
  await page.getByLabel('Titel').fill(title);
  await page.getByLabel('Beschreibung').fill('Gepflegtes Trekkingrad, 28 Zoll, frisch serviciert. Abholung in Graz.');
  await page.getByText('Verhandlungsbasis').click();
  await page.getByLabel('Preis in Euro').fill('320');
  await page.getByLabel('Postleitzahl').fill('8010');
  await expect(page.getByLabel('Ort')).toHaveValue(/\d+/);
  await page.getByRole('button', { name: 'Anzeige veröffentlichen' }).click();
  await expect(page).toHaveURL(/\/anzeige\/\w+\/bilder/);
  await page.locator('#bilder-auswahl').setInputFiles(FIXTURE);
  await expect(page.getByRole('list', { name: 'Bilder der Anzeige' }).locator('[data-flip-id]')).toHaveCount(1, { timeout: 30_000 });
  await page.getByRole('link', { name: 'Fertig' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

test('Tippflächen am Handy sind mindestens 44 × 44 px groß', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Die vergrößerte Tippfläche gilt nur für Finger');
  for (const path of ['/', '/suche', '/deals']) {
    await page.goto(path);
    await expect(page.getByRole('banner')).toBeVisible();
    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.tap')]
        .filter((el) => el.checkVisibility() && el.getClientRects().length > 0)
        .map((el) => {
          const box = el.getBoundingClientRect();
          const slop = getComputedStyle(el, '::after');
          // Die Tippfläche ist das größere von Element und unsichtbarer Erweiterung
          const width = Math.max(box.width, parseFloat(slop.width) || 0);
          const height = Math.max(box.height, parseFloat(slop.height) || 0);
          return { label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40), width, height };
        })
        .filter((item) => item.width < 43.5 || item.height < 43.5),
    );
    expect(tooSmall, `zu kleine Tippflächen auf ${path}`).toEqual([]);
  }
  // Notch und Home-Leiste: Die Seite darf bis an den Rand, die Abstände kommen aus den Safe-Area-Werten
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
});

test('Schnellmenü: Strg+K öffnet es, Tippen filtert, Enter springt hin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Tastenkürzel gibt es nur mit Tastatur');
  await page.goto('/');
  // Hinweis auf das Kürzel im Suchfeld – verschwindet, sobald dort Text steht
  const hint = page.getByTestId('search-shortcut');
  await expect(hint).toContainText('K');
  const menu = page.getByTestId('command-menu');
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass();
  const input = menu.getByRole('combobox', { name: 'Suchen oder springen zu' });
  await expect(input).toBeFocused();
  // Ohne Eingabe: die häufigsten Wege, aber keine Einstellungen
  await expect(menu.getByRole('option', { name: 'Inserat aufgeben' })).toBeVisible();
  await expect(menu.getByRole('option', { name: /Hell\/Dunkel/ })).toHaveCount(0);

  await input.fill('dunkel');
  await expect(menu.getByRole('option', { name: /Hell\/Dunkel/ })).toBeVisible();

  // Freier Text sucht nach Anzeigen
  await input.fill('fahrrad');
  await expect(menu.getByRole('option').first()).toContainText('Nach „fahrrad“ suchen');
  await input.fill('merk');
  await expect(menu.getByRole('option', { name: 'Merkliste' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('option', { name: 'Merkliste' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  // Nicht angemeldet: Die Merkliste führt über die Anmeldung
  await expect(page).toHaveURL(/merkliste/);
  await expect(menu).toBeHidden();

  // Escape schließt, der Klick auf den Hinweis öffnet
  await page.goto('/');
  await expect(async () => {
    await page.getByTestId('search-shortcut').click();
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('Filter am Handy lassen sich nach unten wegwischen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Am Desktop stehen die Filter immer in der Seitenleiste');
  await page.goto('/suche');
  const sheet = page.locator('.sheet');
  const open = async () => {
    await expect(async () => {
      await page.getByRole('button', { name: /^Filter/ }).click();
      await expect(sheet).toHaveAttribute('data-open', 'true', { timeout: 2_000 });
    }).toPass();
    await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  };
  await open();
  const header = page.getByTestId('sheet-header');
  const box = (await header.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 12;
  const touch = await page.context().newCDPSession(page);
  const point = (py: number) => [{ x: Math.round(x), y: Math.round(py) }];

  // Ein kleines Stück ziehen und loslassen: Das Menü klebt am Finger und geht wieder an seinen Platz
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(y) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(y + 30) });
  await page.waitForTimeout(700);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(y + 60) });
  await expect(sheet).toHaveAttribute('data-dragging', 'true');
  expect(await sheet.evaluate((el) => el.style.translate)).toContain('60');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(sheet).not.toHaveAttribute('data-dragging');
  await expect(sheet).toHaveAttribute('data-open', 'true');
  await expect.poll(() => sheet.evaluate((el) => el.style.translate)).toBe('');
  // Warten, bis es wieder ganz oben steht – sonst trifft der nächste Finger die Seite dahinter
  await expect.poll(async () => Math.round((await header.boundingBox())!.y)).toBe(Math.round(box.y));

  // Weit nach unten ziehen: Das Menü schließt
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(y) });
  for (const dy of [60, 140, 220, 300]) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(y + dy) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(sheet).toBeHidden();

  // Beim nächsten Öffnen steht es wieder an seinem Platz
  await open();
  expect(await sheet.evaluate((el) => el.style.translate)).toBe('');
  await page.getByRole('button', { name: 'Filter schließen' }).click();
  await expect(sheet).toBeHidden();
});

test('Fotos: verschwommener Platzhalter auf der Karte, das Foto steht in der Anzeige sofort da', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const tag = `${testInfo.project.name}-${Date.now()}`;
  const title = `Platzhalter-Rad ${tag}`;
  await registerConfirmed(page, `Bedienung ${tag}`, `bedienung-${tag}@example.at`);
  await publishWithPhoto(page, title);

  const card = page.getByRole('article').filter({ hasText: title });
  // Die Suche nimmt neue Anzeigen mit kurzer Verzögerung auf
  await expect(async () => {
    await page.goto(`/suche?q=${encodeURIComponent(title)}`);
    await expect(card).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });

  // Die winzige Miniatur steckt im HTML und liegt hinter dem Foto, bis es geladen ist
  const photo = card.locator('img[data-card-photo]');
  await expect(photo).toHaveAttribute('data-placeholder', /^data:image\/webp;base64,/);
  expect(await photo.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('data:image/webp');
  // Preise stehen in gleich breiten Ziffern
  expect(await card.locator('p.tabular-nums').first().evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');

  // Klick auf die Karte: Die Anzeige zeigt das schon geladene Vorschaubild, bis das große Bild da ist
  await card.getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(/\/anzeige\//);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const landing = page.getByTestId('gallery-landing');
  await expect(landing).toHaveCount(1);
  expect(await landing.evaluate((el) => el.style.backgroundImage)).toContain('/thumb');
  await expect(page.getByTestId('gallery-viewport').getByRole('img', { name: title })).toBeVisible();

  // Direkter Aufruf (kein Klick auf eine Karte): kein Vorschaubild nötig, nur das große Bild
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByTestId('gallery-landing')).toHaveCount(0);
});
