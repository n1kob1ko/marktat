import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { registerConfirmed } from './accounts';

/**
 * Bewegung (docs/design-bewegung.md): Drücken, Menüs, Dialoge, mitwandernde Markierung, Wisch-Galerie.
 * Geprüft wird das Verhalten (Zustände, Auslöser, Grenzen), nicht das Aussehen einzelner Zwischenbilder.
 */

const FIXTURE = path.join(__dirname, 'fixtures', 'testbild-mit-gps.jpg');

const style = (locator: Locator, property: string) => locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

async function publishWithTwoPhotos(page: Page, title: string) {
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
  const list = page.getByRole('list', { name: 'Bilder der Anzeige' });
  for (const count of [1, 2, 3]) {
    await page.locator('#bilder-auswahl').setInputFiles(FIXTURE);
    // Erst zählen, wenn das Bild fertig hochgeladen ist (vorher steht dort ein Platzhalter)
    await expect(list.locator('[data-flip-id]')).toHaveCount(count, { timeout: 30_000 });
  }
}

test('Knöpfe geben beim Drücken nach, Menüs wachsen aus dem Auslöser und laufen dorthin zurück', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Am Handy öffnet „Teilen“ das Menü des Geräts');
  await page.goto('/suche');
  const first = page.getByRole('list', { name: 'Suchergebnisse' }).getByRole('link').first();
  await first.click();
  await expect(page).toHaveURL(/\/anzeige\//);

  // Drücken: 97 % Größe, solange gehalten wird
  const share = page.getByRole('button', { name: 'Teilen' });
  await share.hover();
  await page.mouse.down();
  await expect.poll(() => style(share, 'scale')).toBe('0.97');
  await page.mouse.up();
  await expect.poll(() => style(share, 'scale')).toBe('none');

  // Menü: offen, Ursprung an der Ecke des Auslösers; beim Schließen erst ausblenden, dann entfernen
  const menu = page.getByRole('group', { name: 'Teilen über' });
  await expect(menu).toHaveAttribute('data-state', 'open');
  const origin = (await style(menu, 'transform-origin')).split(' ').map((v) => Number.parseFloat(v));
  const menuBox = (await menu.boundingBox())!;
  expect(origin[0]).toBeGreaterThan(menuBox.width * 0.9);
  expect(origin[1]).toBeLessThan(1);
  expect(Number.parseFloat(await style(menu, 'transition-duration'))).toBeCloseTo(0.18, 2);

  // „Link kopiert“ ersetzt „Link kopieren“ an derselben Stelle
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await menu.getByRole('button', { name: 'Link kopieren' }).click();
  await expect(menu.getByRole('button', { name: 'Link kopiert' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('Die Markierung des aktiven Bereichs wandert mit, der Wechsel Hell/Dunkel bleibt bedienbar', async ({ page }, testInfo) => {
  await page.goto('/suche?bereich=marktplatz');
  const nav = page.getByRole('navigation', { name: 'Bereiche' });
  const list = nav.getByRole('list');
  await expect(list).toHaveAttribute('data-indicator', '');
  const indicator = list.locator('.indicator');

  const aligned = async (name: string) => {
    const link = nav.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect
      .poll(async () => {
        const a = await link.boundingBox();
        const b = await indicator.boundingBox();
        return a && b ? Math.abs(a.x - b.x) + Math.abs(a.width - b.width) : 999;
      })
      .toBeLessThan(2);
  };
  await aligned('Marktplatz');
  await nav.getByRole('link', { name: 'Deals', exact: true }).click();
  await expect(page).toHaveURL(/\/deals/);
  await aligned('Deals');

  // Hell/Dunkel: am Desktop im Kopf, am Handy im Fuß
  const area = testInfo.project.name === 'mobile' ? page.getByRole('contentinfo') : page.getByRole('banner');
  const toggle = area.getByRole('button', { name: 'Dunkelmodus' });
  const before = await page.locator('html').getAttribute('data-theme');
  await toggle.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-switch', '');
  await expect(toggle).toHaveAttribute('aria-pressed', before === 'dark' ? 'false' : 'true');
});

test('Filter am Handy blenden ein und aus', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Am Desktop stehen die Filter immer in der Seitenleiste');
  await page.goto('/suche');
  const sheet = page.locator('.sheet');
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: /^Filter/ }).click();
  await expect(sheet).toHaveAttribute('data-open', 'true');
  await expect(page.getByRole('dialog', { name: 'Filter' })).toBeVisible();
  await expect.poll(() => style(sheet, 'opacity')).toBe('1');
  await page.getByRole('button', { name: 'Filter schließen' }).click();
  await expect(sheet).toBeHidden();
});

test('Galerie: Wischen folgt dem Finger, rastet ein und gibt am Ende wie ein Gummiband nach; Dialog schließt mit Ausblenden', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}-${Date.now()}`;
  await registerConfirmed(page, `Bewegung ${tag}`, `bewegung-${tag}@example.at`);
  await publishWithTwoPhotos(page, `Wisch-Rad ${tag}`);

  // Umsortieren: das Bild wechselt den Platz, die Reihenfolge wird gespeichert
  const list = page.getByRole('list', { name: 'Bilder der Anzeige' });
  const firstId = await list.locator('[data-flip-id]').first().getAttribute('data-flip-id');
  await page.getByRole('button', { name: 'Bild 1 nach hinten' }).click();
  await expect(list.locator('[data-flip-id]').nth(1)).toHaveAttribute('data-flip-id', firstId!);

  await page.getByRole('link', { name: 'Fertig' }).click();
  const viewport = page.getByTestId('gallery-viewport');
  const track = page.getByTestId('gallery-track');
  const counter = page.getByTestId('gallery-counter');
  await expect(counter).toContainText('1 / 3');
  let box = (await viewport.boundingBox())!;
  let y = box.y + box.height / 2;
  const trackX = async () => (await track.boundingBox())!.x;
  // Breite eines Bilds (ohne den Rahmen der Galerie) und Ruhelage beim ersten Bild
  const slide = await viewport.evaluate((el) => el.clientWidth);
  const home = await trackX();

  // Ziehen: die Leiste klebt am Zeiger (kein Übergang), der Zähler wechselt erst nach dem Loslassen
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 4 });
  await expect(track).toHaveAttribute('data-dragging', 'true');
  expect(await style(track, 'transition-duration')).toBe('0s');
  expect(Math.abs((await trackX()) - (home - box.width * 0.5))).toBeLessThan(3);
  await expect(counter).toContainText('1 / 3');
  await page.mouse.up();
  await expect(track).not.toHaveAttribute('data-dragging', 'true');
  await expect(counter).toContainText('2 / 3');

  // Vorschaubild: springt zum letzten Bild
  await page.getByRole('button', { name: 'Bild 3 anzeigen' }).click();
  await expect(counter).toContainText('3 / 3');
  await expect.poll(async () => Math.abs((await trackX()) - (home - 2 * slide))).toBeLessThan(2);

  // Am letzten Bild weiterziehen: gibt nach, aber deutlich weniger als der Zeiger zieht – und springt zurück
  const rest = await trackX();
  // Der Klick auf das Vorschaubild kann die Seite gescrollt haben (Galerie dann teils unter dem Kopf)
  await page.evaluate(() => window.scrollTo(0, 0));
  box = (await viewport.boundingBox())!;
  y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, y, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.2, y, { steps: 4 });
  const pulled = rest - (await trackX());
  expect(pulled).toBeGreaterThan(10);
  expect(pulled).toBeLessThan(box.width * 0.6 * 0.6);
  await page.mouse.up();
  await expect(counter).toContainText('3 / 3');
  await expect.poll(async () => Math.abs((await trackX()) - rest)).toBeLessThan(2);

  // Dialog „Suche speichern“: blendet ein, schließt mit Ausblenden und ist danach weg
  await page.goto('/suche?q=Rad');
  await page.getByRole('button', { name: 'Suche speichern' }).click();
  const dialog = page.getByRole('dialog', { name: 'Suche speichern' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => style(dialog, 'opacity')).toBe('1');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Ohne Bewegung (Einstellung des Geräts): Menüs und Markierung funktionieren, aber nichts gleitet', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/suche?bereich=marktplatz');
  const nav = page.getByRole('navigation', { name: 'Bereiche' });
  await expect(nav.getByRole('list')).toHaveAttribute('data-indicator', '');
  const button = page.getByRole('banner').locator('a[href="/inserieren"]');
  expect(Number.parseFloat(await style(button, 'transition-duration'))).toBeLessThan(0.001);
  if (testInfo.project.name === 'mobile') {
    const toggle = page.getByRole('banner').getByTestId('mobile-search-toggle');
    await toggle.click();
    const field = page.getByRole('banner').getByRole('searchbox', { name: 'Anzeigen durchsuchen' }).last();
    await expect(field).toBeFocused();
    await toggle.click();
    await expect(page.getByRole('banner').getByRole('searchbox')).toHaveCount(1);
  }
});
