import { expect, test, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { PASSWORD } from './accounts';
import { waitForMailLink } from './mailpit';

/**
 * Phase 10, Deals: Händler bestätigt seine Angaben, legt eine Filiale an und veröffentlicht ein Angebot mit
 * belegbarem Vergleichspreis; Käufer:innen finden es über Suche und Umkreis, „Zum Angebot“ läuft über MarktAT.
 * Am Ende wird das Angebot gelöscht, damit andere Specs nicht von Testdaten abhängen.
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

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Datum in Wien als yyyy-mm-dd (für <input type="date">) */
function viennaDay(offsetDays: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

async function registerBusiness(page: Page, companyName: string, email: string) {
  await page.goto('/registrieren');
  await page.getByText('Gewerblich', { exact: true }).click();
  await page.getByLabel('Anzeigename').fill(companyName);
  await page.getByLabel('Firmenname').fill(companyName);
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /Ich akzeptiere/ }).check();
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByText('Bitte bestätige deine E-Mail-Adresse')).toBeVisible();
  await page.goto(await waitForMailLink(email, /bestätige/));
  await expect(page).toHaveURL(/\/konto\?bestaetigt=1/);
}

test('Startseite zeigt den Deals-Abschnitt, ohne die Kleinanzeigen zu verdrängen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Aktuelle Deals & Angebote' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Neu eingestellt' })).toBeVisible();
  // Kleinanzeigen stehen vor den Deals
  const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
  expect(headings.indexOf('Neu eingestellt')).toBeLessThan(headings.indexOf('Aktuelle Deals & Angebote'));
  await page.goto('/deals');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aktuelle Angebote von Händlern');
  await expectNoHorizontalScroll(page);
});

test('Händler veröffentlicht einen Deal mit Filiale; er ist auffindbar, pausierbar und löschbar', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const tag = `${testInfo.project.name}-${run}`;
  const word = `Dealtest${run}${testInfo.project.name === 'mobile' ? 'm' : 'd'}`;
  const title = `E2E ${word} Notebook`;
  const company = `E2E Elektro ${tag}`;

  const merchant = await newPage(browser, testInfo);
  const page = merchant.page;
  await registerBusiness(page, company, `e2e-deals-${tag}@example.at`);

  // Ohne Adresse und Telefon: Hinweis statt Formular zum Bestätigen
  await page.goto('/konto/deals');
  await expect(page.getByText('Bitte ergänze zuerst deine Firmenangaben')).toBeVisible();
  await page.goto('/konto');
  await page.getByLabel('Telefon (optional)').fill('+43 316 123456');
  await page.getByLabel('Geschäftsanschrift').fill('Annenstraße 1, 8020 Graz');
  await page.getByRole('button', { name: 'Profil speichern' }).click();
  await expect(page.getByText(/gespeichert/).first()).toBeVisible();

  await page.goto('/konto/deals');
  await page.getByRole('checkbox', { name: /Ich bestätige, dass meine Firmenangaben/ }).check();
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(page.getByText('Danke! Du kannst jetzt Angebote veröffentlichen.')).toBeVisible();

  // Filiale in Graz
  await page.goto('/konto/deals/filialen');
  await page.getByLabel('Name der Filiale').fill('Filiale Graz-Lend');
  await page.getByLabel('Straße und Hausnummer').fill('Annenstraße 1');
  await page.getByLabel('PLZ und Ort').fill('8020');
  await page.getByRole('option', { name: /8020/ }).first().click();
  await page.getByRole('button', { name: 'Filiale anlegen' }).click();
  await expect(page.getByText('Die Filiale wurde angelegt.', { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Deal: online und im Geschäft, UVP mit Quelle → −25 %
  await page.goto('/konto/deals/neu');
  await page.getByLabel('Titel').fill(title);
  await page.getByLabel('Kategorie').selectOption({ label: 'Elektronik & Computer' });
  await page.getByLabel('Beschreibung').fill('15 Zoll, 16 GB RAM, 512 GB SSD. Testangebot aus der automatischen Prüfung.');
  await page.getByLabel('Angebotspreis in € (inkl. USt.)').fill('599');
  await page.getByLabel('Unverbindliche Preisempfehlung (UVP)').check();
  await page.getByLabel('Vergleichspreis in €').fill('799');
  await page.getByLabel('Quelle').fill('UVP laut Hersteller, Preisliste 10/2026');
  await page.getByRole('checkbox', { name: /Ich bestätige, dass der Vergleichspreis stimmt/ }).check();
  await page.getByLabel('Online und im Geschäft').check();
  await page.getByLabel('Link zum Angebot').fill('https://shop.example.at/notebook');
  await page.getByRole('checkbox', { name: /Filiale Graz-Lend/ }).check();
  await page.getByLabel('Gültig ab').fill(viennaDay(0));
  await page.getByLabel('Gültig bis (einschließlich)').fill(viennaDay(7));
  await page.getByRole('button', { name: 'Veröffentlichen' }).click();
  await expect(page).toHaveURL(/\/konto\/deals\/\w+\?hinweis=deal-gespeichert/);
  const dealId = new URL(page.url()).pathname.split('/').pop()!;
  await expectNoHorizontalScroll(page);

  // Öffentlich: Suche mit Begriff, lokal im Umkreis von Graz
  const visitor = await newPage(browser, testInfo);
  await visitor.page.goto(`/deals?q=${word}`);
  const card = visitor.page.getByRole('article').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText('−25');
  await expect(card).toContainText(company);
  await expect(card).toContainText('Zuletzt geprüft am');
  await visitor.page.goto(`/deals?q=${word}&kanal=lokal&plz=8010&umkreis=10`);
  await expect(visitor.page.getByRole('article').filter({ hasText: title })).toBeVisible();
  await visitor.page.goto(`/deals?q=${word}&kanal=lokal&plz=1010&umkreis=10`);
  await expect(visitor.page.getByRole('article').filter({ hasText: title })).toHaveCount(0);
  await expectNoHorizontalScroll(visitor.page);

  // Detailseite: Vergleichspreis mit Quelle, Filiale, „Zum Angebot“ über die eigene Weiterleitung
  await visitor.page.goto(`/deals/${dealId}`);
  await expect(visitor.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(visitor.page.getByText('UVP laut Hersteller, Preisliste 10/2026', { exact: false })).toBeVisible();
  await expect(visitor.page.getByText('Filiale Graz-Lend').first()).toBeVisible();
  const cta = visitor.page.getByRole('link', { name: 'Zum Angebot' });
  await expect(cta).toHaveAttribute('href', `/deals/${dealId}/zum-angebot`);
  await expect(cta).toHaveAttribute('rel', /sponsored|nofollow/);
  await expectNoHorizontalScroll(visitor.page);

  // Pausieren: nicht mehr öffentlich
  await page.goto(`/konto/deals/${dealId}`);
  await page.getByRole('button', { name: 'Pausieren' }).click();
  await expect(page.getByText('Das Angebot ist pausiert und nicht mehr öffentlich sichtbar.')).toBeVisible();
  await visitor.page.goto(`/deals?q=${word}`);
  await expect(visitor.page.getByRole('article').filter({ hasText: title })).toHaveCount(0);

  // Löschen
  await page.getByRole('button', { name: 'Löschen' }).click();
  await expect(page).toHaveURL(/\/konto\/deals\?hinweis=deal-geloescht/);
  await expect(page.getByText('Das Angebot wurde gelöscht.')).toBeVisible();

  await visitor.context.close();
  await merchant.context.close();
});
