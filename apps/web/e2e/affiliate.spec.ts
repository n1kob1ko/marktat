import { devices, expect, test, type Page } from '@playwright/test';
import { becomeStaff, registerConfirmed } from './accounts';
import { startFakeAwin } from './fake-awin';
import { expectNoHorizontalScroll, newPage } from './merchant';

/**
 * Partnerangebote über Awin (Publisher): Admin gibt ein Programm mit dokumentierter Freigabe frei, aktiviert den Feed
 * und startet den Abruf; Besucher:innen sehen die Angebote als „Werbung“ mit Händler, Quelle, unverändertem Bild und
 * Provisionshinweis, dazu Aktionen & Gutscheine. Anhalten blendet alles wieder aus.
 *
 * Braucht einen lokalen Awin-Testserver: nur mit E2E_AWIN_FAKE_PORT und einer passend gestarteten API (siehe
 * e2e/fake-awin.ts). Ohne diese Variable – also auch in der Generalprobe und online – wird der Test übersprungen.
 */
const PORT = Number(process.env.E2E_AWIN_FAKE_PORT ?? 0);
const run = Date.now();

test.describe.configure({ mode: 'serial' });

/** Admin-Seite neu laden, bis der Text erscheint (Abrufe laufen im Hintergrund) */
async function reloadUntil(page: Page, url: string, text: string | RegExp, timeoutMs = 90_000) {
  await expect(async () => {
    await page.goto(url);
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: timeoutMs, intervals: [2_000] });
}

test('Admin gibt ein Awin-Programm frei; Partnerangebote erscheinen gekennzeichnet und verschwinden nach dem Anhalten', async ({ browser }, testInfo) => {
  test.skip(!PORT, 'Nur mit lokalem Awin-Testserver (E2E_AWIN_FAKE_PORT)');
  test.skip(testInfo.project.name !== 'desktop', 'Ein Durchlauf genügt (Testserver auf festem Port); die Handyansicht prüft der Test mit eigenem Kontext');
  test.setTimeout(300_000);

  const advertiser = String(700_000 + (run % 100_000));
  const feedId = String(800_000 + (run % 100_000));
  const shop = `E2E Elektro ${run}`;
  const product = `Kopfhörer Affiliate ${run}`;
  const fake = await startFakeAwin(PORT, [
    {
      id: advertiser,
      name: shop,
      feedId,
      products: [{ sku: `E2E-${run}`, name: product, price: '79.99', rrp: '99.99' }],
      voucher: { title: `Gutschein ${run}: 10 € ab 50 €`, code: 'E2EZEHN' },
    },
  ]);

  try {
    const admin = await newPage(browser, testInfo);
    const email = `e2e-affiliate-admin-${run}@example.at`;
    await registerConfirmed(admin.page, 'Ada Affiliate', email);
    await becomeStaff(admin.page, email, 'ADMIN');
    const page = admin.page;

    // --- Verbindung und manueller Abruf der Feedliste ---
    await page.goto('/admin/affiliate');
    await expect(page.getByRole('heading', { name: 'Partnerprogramme (Affiliate)' })).toBeVisible();
    await expect(page.getByText('vollständig (Werte werden nie angezeigt)')).toBeVisible();
    await page.getByRole('button', { name: 'Jetzt abrufen', exact: true }).click();
    await expect(page.getByText('Abruf gestartet.')).toBeVisible();
    await reloadUntil(page, '/admin/affiliate', `Feed ${feedId}`);

    const program = page.getByTestId('affiliate-program').filter({ hasText: shop });
    await expect(program).toContainText('Wartet auf Freigabe');
    await expect(program).toContainText('Awin: Partnerschaft aktiv');
    // Feed ist noch nicht aktiv, ohne Freigabe des Programms lässt er sich nicht aktivieren
    await expect(program.getByTestId('affiliate-feed')).toContainText('Wartet auf Freigabe');
    await expect(program.getByRole('button', { name: 'Aktivieren' })).toHaveCount(0);

    // --- Freigabe mit Dokumentation ---
    await program.getByText('Freigabe bearbeiten').click();
    await program.getByLabel('Dokumentation (Pflicht)').fill('kurz');
    await program.getByRole('button', { name: 'Freigeben' }).click();
    await expect(program.getByText(/mindestens 20 Zeichen/).first()).toBeVisible();
    // Die Eingabe bleibt nach dem Fehler erhalten; React setzt das Formular kurz danach zurück – erst dann weitertippen
    const documentation = `Partnerschaft am ${new Date().toLocaleDateString('de-AT')} bestätigt; Bedingungen erlauben Bilder, UVP und Gutscheine.`;
    await expect(program.getByLabel('Dokumentation (Pflicht)')).toHaveValue('kurz');
    await expect(async () => {
      await program.getByLabel('Dokumentation (Pflicht)').fill(documentation);
      await page.waitForTimeout(300);
      await expect(program.getByLabel('Dokumentation (Pflicht)')).toHaveValue(documentation, { timeout: 100 });
    }).toPass({ timeout: 10_000 });
    await program.getByLabel(/Produktbilder des Händlers/).check();
    await program.getByLabel(/Vergleichspreis/).check();
    await program.getByLabel(/Gutscheincodes/).check();
    await program.getByRole('button', { name: 'Freigeben' }).click();
    await expect(program.getByText('Gespeichert.')).toBeVisible();

    await page.goto('/admin/affiliate');
    await expect(program).toContainText('Freigegeben');
    await program.getByRole('button', { name: 'Aktivieren' }).click();
    await expect(program.getByText('Gespeichert.')).toBeVisible();
    await page.goto('/admin/affiliate');
    await program.getByRole('button', { name: 'Feed jetzt abrufen' }).click();
    await expect(program.getByText('Abruf gestartet.')).toBeVisible();
    await reloadUntil(page, '/admin/affiliate', /1 sichtbare Angebote/);
    await expect(page.getByRole('row').filter({ hasText: 'Produktfeed' }).first()).toContainText('1 neu');
    expect(fake.stats.feedDownloads).toBeGreaterThan(0);

    // --- Öffentlich: Karte, Detailseite, Bild, Weiterleitung ---
    const visitor = await newPage(browser, testInfo);
    const v = visitor.page;
    await expect(async () => {
      await v.goto(`/deals?q=${encodeURIComponent(`Affiliate ${run}`)}`);
      await expect(v.getByRole('link', { name: product })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000] });
    const card = v.getByRole('article').filter({ hasText: product });
    await expect(card).toContainText('Werbung');
    await expect(card).toContainText(shop);
    await expect(card).toContainText('Quelle: Awin · Provisionslink');
    // Rabatt nur aus dem Vergleichspreis des Feeds (UVP), weil das Programm das erlaubt
    await expect(card).toContainText('20 %');
    await expect(card).toContainText('statt € 99,99 UVP');
    await expect(card).toContainText('Datenstand vom');

    await card.getByRole('link', { name: product }).click();
    await expect(v.getByRole('heading', { level: 1, name: product })).toBeVisible();
    await expect(v.getByText('Partnerangebot über Awin')).toBeVisible();
    await expect(v.getByText(`Quelle: Produktfeed von ${shop} über Awin`)).toBeVisible();
    await expect(v.getByText(/MarktAT erhält bei einem Kauf eventuell eine Provision von Awin/)).toBeVisible();
    // Bild kommt unverändert über den Bild-Proxy der API, nicht direkt vom Händler
    const image = v.locator('img[src*="partner-image"]').first();
    await expect(image).toBeVisible();
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(48);
    const href = await v.getByRole('link', { name: /Zum Angebot/ }).getAttribute('href');
    expect(href).toMatch(/\/deals\/\w+\/zum-angebot$/);
    const redirect = await v.request.get(href!, { maxRedirects: 0 });
    expect(redirect.status()).toBeGreaterThanOrEqual(300);
    expect(redirect.headers().location).toMatch(/^https:\/\/www\.awin1\.com\/pclick\.php\?p=9E2E-/);
    const dealUrl = v.url();

    // Handyansicht ohne seitliches Scrollen
    const mobile = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-AT', timezoneId: 'Europe/Vienna', baseURL: testInfo.project.use.baseURL, ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors });
    const m = await mobile.newPage();
    await m.goto(dealUrl);
    await expect(m.getByRole('heading', { level: 1, name: product })).toBeVisible();
    await expectNoHorizontalScroll(m);

    // --- Aktionen & Gutscheine auf /deals, Infoseite ---
    await reloadUntil(v, '/deals', `Gutschein ${run}: 10 € ab 50 €`);
    const promotions = v.getByRole('region', { name: 'Aktionen & Gutscheine' });
    await expect(promotions).toContainText('Werbung');
    await expect(promotions).toContainText('E2EZEHN');
    await expect(promotions).toContainText('Quelle: Awin');
    await v.getByRole('link', { name: 'Warum Werbung?' }).click();
    await expect(v.getByRole('heading', { level: 1, name: 'Werbung und Partnerangebote' })).toBeVisible();
    await m.goto('/deals');
    await expectNoHorizontalScroll(m);
    await m.goto('/deals/werbung');
    await expectNoHorizontalScroll(m);

    // --- Anhalten: Angebote und Aktionen sind sofort weg ---
    await page.goto('/admin/affiliate');
    await program.getByText('Freigabe bearbeiten').click();
    await program.getByLabel('Dokumentation (Pflicht)').fill('E2E-Test beendet');
    await program.locator('details').getByRole('button', { name: 'Anhalten' }).click();
    await expect(program.getByText('Gespeichert.')).toBeVisible();
    await v.goto(dealUrl);
    await expect(v.getByRole('heading', { name: 'Diese Seite gibt es nicht (mehr)' })).toBeVisible();
    // „Zum Angebot“ führt dann nicht mehr zum Shop, sondern zurück zur Detailseite
    expect((await v.request.get(href!, { maxRedirects: 0 })).headers().location).not.toMatch(/awin1\.com/);
    await v.goto('/deals');
    await expect(v.getByText(`Gutschein ${run}: 10 € ab 50 €`)).toHaveCount(0);

    // Aufräumen: Programm ablehnen, damit spätere Läufe nicht davon abhängen
    await page.goto('/admin/affiliate');
    await program.getByText('Freigabe bearbeiten').click();
    await program.getByLabel('Dokumentation (Pflicht)').fill('E2E-Test aufgeräumt');
    await program.locator('details').getByRole('button', { name: 'Ablehnen' }).click();
    await expect(program.getByText('Gespeichert.')).toBeVisible();
    await mobile.close();
  } finally {
    await fake.close();
  }
});

test('Admin-Seite der Partnerprogramme ist ohne Liveimport bedienbar und erklärt den Zustand', async ({ browser }, testInfo) => {
  test.skip(!!PORT, 'Mit Testserver deckt der Test oben die Seite ab');
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}-${run}`;
  const admin = await newPage(browser, testInfo);
  const email = `e2e-affiliate-off-${tag}@example.at`;
  await registerConfirmed(admin.page, 'Otto Ohneimport', email);
  await becomeStaff(admin.page, email, 'ADMIN');
  await admin.page.goto('/admin/affiliate');
  await expect(admin.page.getByRole('heading', { name: 'Partnerprogramme (Affiliate)' })).toBeVisible();
  await expect(admin.page.getByText('aus (AWIN_ENABLED=false)', { exact: true })).toBeVisible();
  // Ohne Liveimport gibt es keinen Abruf-Knopf
  await expect(admin.page.getByRole('button', { name: 'Jetzt abrufen', exact: true })).toHaveCount(0);
  await expectNoHorizontalScroll(admin.page);

  // Öffentliche Infoseite und Hinweis auf /deals
  await admin.page.goto('/deals');
  await expect(admin.page.getByRole('link', { name: 'Mehr zu Werbung und Partnerangeboten' })).toBeVisible();
  await admin.page.goto('/deals/werbung');
  await expect(admin.page.getByRole('heading', { level: 1, name: 'Werbung und Partnerangebote' })).toBeVisible();
  await expectNoHorizontalScroll(admin.page);
});
