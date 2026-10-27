import { expect, test, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { PASSWORD, publishBike, registerConfirmed, setRole } from './accounts';
import { waitForMailLink } from './mailpit';

/**
 * Phase 7 im kostenlosen Betrieb: Einführungsaktion, kostenlose Zusatzleistungen (Hervorheben, Top, Hochschieben)
 * mit Limits, Top-Anzeigen in der Suche, Aufrufstatistik ohne Eigenaufrufe, Händlerprofil und Preisverwaltung im Admin.
 * Es wird nichts bezahlt; Stripe ist in der Entwicklungsumgebung nicht eingerichtet.
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

/** Eigenes Testinserat wieder löschen, damit andere Specs (Suche) nicht von der Zahl der Testdaten abhängen */
async function deleteOwnListing(page: Page, title: string) {
  await page.goto('/konto/anzeigen');
  const item = page.getByRole('listitem').filter({ hasText: title });
  await item.getByRole('button', { name: 'Löschen' }).click();
  await item.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByText('Die Anzeige wurde gelöscht.')).toBeVisible();
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

test('Kostenlos inserieren und kostenlose Zusatzleistungen mit Limits, Top-Anzeigen und Statistik', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const tag = `${testInfo.project.name}-${run}`;
  const word = `Monetarad${run}${testInfo.project.name === 'mobile' ? 'm' : 'd'}`;
  const title = `E2E ${word} Trekking`;

  const seller = await newPage(browser, testInfo);
  await registerConfirmed(seller.page, 'Mona Leistung', `e2e-monet-${tag}@example.at`);

  // Einführungsaktion: 0,00 €, ohne künstliche Frist und ohne durchgestrichenen Preis
  await seller.page.goto('/inserieren');
  const intro = seller.page.getByRole('region', { name: 'Einführungsaktion' });
  await expect(intro).toContainText('Einführungsaktion');
  await expect(intro).toContainText('0,00');
  await expect(intro).toContainText('Jetzt kostenlos inserieren');
  await expect(intro).not.toContainText('bis zum');
  await expect(seller.page.locator('s, del')).toHaveCount(0);

  const listingUrl = await publishBike(seller.page, title);
  const listingId = new URL(listingUrl).pathname.split('/').pop()!;

  // Meine Anzeigen: hervorheben und Top – sofort aktiv, ohne Zahlung
  await seller.page.goto('/konto/anzeigen');
  const card = seller.page.getByRole('listitem').filter({ hasText: title });
  await card.getByRole('button', { name: 'Hervorheben' }).click();
  await expect(seller.page.getByText('Deine Anzeige ist jetzt hervorgehoben.')).toBeVisible();
  await expect(card.getByText(/^Hervorgehoben bis/)).toBeVisible();
  await card.getByRole('button', { name: 'Top-Anzeige' }).click();
  await expect(seller.page.getByText(/ist jetzt eine Top-Anzeige/)).toBeVisible();
  await expect(card.getByText(/^Top-Anzeige bis/)).toBeVisible();
  // Laufende Leistungen haben keinen zweiten Knopf
  await expect(card.getByRole('button', { name: 'Hervorheben' })).toHaveCount(0);
  await expectNoHorizontalScroll(seller.page);

  // Hochschieben direkt nach dem Veröffentlichen: Mindestabstand – mit Begründung statt totem Knopf
  await card.getByRole('button', { name: 'Hochschieben' }).click();
  await expect(seller.page).toHaveURL(new RegExp(`/konto/anzeigen/${listingId}/leistungen\\?fehler=nicht-buchbar`));
  await expect(seller.page.getByText('Diese Leistung ist für die Anzeige gerade nicht möglich.')).toBeVisible();
  await expect(seller.page.getByText(/^Wieder möglich ab/)).toBeVisible();
  await expect(seller.page.getByText('Alle Leistungen sind während der Einführungsphase kostenlos.')).toBeVisible();
  await expectNoHorizontalScroll(seller.page);

  // Konto: gebuchte Leistungen und Verlauf, alles kostenlos
  await seller.page.goto('/konto/leistungen');
  await expect(seller.page.getByText('Alle Leistungen sind derzeit kostenlos.')).toBeVisible();
  const active = seller.page.getByRole('region', { name: 'Laufende Leistungen' });
  await expect(active.getByText('Hervorhebung')).toBeVisible();
  await expect(active.getByText('Top-Anzeige')).toBeVisible();
  await expect(seller.page.getByText('Solange MarktAT kostenlos ist, fallen keine an.', { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(seller.page);

  // Suche: Top-Anzeigen über passenden Ergebnissen, gekennzeichnet, aber nicht als bezahlt
  const visitor = await newPage(browser, testInfo);
  await expect(async () => {
    await visitor.page.goto(`/suche?q=${word}`);
    await expect(visitor.page.getByRole('region', { name: 'Top-Anzeigen' }).getByRole('link', { name: title })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  const topAds = visitor.page.getByRole('region', { name: 'Top-Anzeigen' });
  await expect(topAds).toContainText('während der Einführungsphase kostenlos');
  await expect(topAds.getByText('Top', { exact: true })).toBeVisible();
  await expect(visitor.page.getByText('Gesponsert')).toHaveCount(0);
  // Nicht passende Suche: keine Top-Anzeige
  await visitor.page.goto(`/suche?q=${word}&preis_bis=10`);
  await expect(visitor.page.getByRole('region', { name: 'Top-Anzeigen' })).toHaveCount(0);

  // Aufruf durch eine andere Person zählt, eigene Aufrufe nicht
  const counted = visitor.page.waitForResponse((r) => r.url().endsWith('/api/aufrufe') && r.request().method() === 'POST');
  await visitor.page.goto(listingUrl);
  await counted;
  await seller.page.goto(listingUrl);
  await seller.page.goto(`/konto/anzeigen/${listingId}/statistik`);
  const total = seller.page.getByText('Aufrufe gesamt').locator('..');
  await expect(async () => {
    await seller.page.reload();
    await expect(total).toContainText('1', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(seller.page.getByRole('heading', { name: 'Aufrufe pro Tag (letzte 30 Tage)' })).toBeVisible();
  await expect(seller.page.getByText('Deine eigenen Aufrufe, Aufrufe unseres Teams und erkannte Bots zählen nicht.', { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(seller.page);
  // Fremde sehen die Statistik nicht
  await visitor.page.goto(`/konto/anzeigen/${listingId}/statistik`);
  await expect(visitor.page).toHaveURL(/\/anmelden/);

  await deleteOwnListing(seller.page, title);
  await Promise.all([seller.context.close(), visitor.context.close()]);
});

test('Händlerprofil mit Firmenangaben, aktiven Anzeigen und Händler-Dashboard', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}-${run}`;
  const company = `Radhaus E2E ${testInfo.project.name}`;
  const dealer = await newPage(browser, testInfo);
  await registerBusiness(dealer.page, company, `e2e-haendler-${tag}@example.at`);

  await dealer.page.getByLabel('Geschäftsanschrift').fill('Annenstraße 1, 8020 Graz');
  await dealer.page.getByLabel('Website (optional)').fill('https://www.radhaus.example');
  await dealer.page.getByLabel('Über mich (optional)').fill('Fahrräder, Service und Zubehör seit 1998.');
  await dealer.page.getByRole('button', { name: 'Profil speichern' }).click();
  await expect(dealer.page.getByText('Dein Profil wurde gespeichert.')).toBeVisible();
  await expect(dealer.page.getByRole('heading', { name: 'Firmenlogo' })).toBeVisible();

  const title = `E2E Händlerrad ${tag}`;
  const listingUrl = await publishBike(dealer.page, title);
  await dealer.page.getByRole('link', { name: 'Händlerprofil und alle Anzeigen' }).click();
  await expect(dealer.page.getByRole('heading', { level: 1, name: company })).toBeVisible();
  await expect(dealer.page.getByText('Annenstraße 1, 8020 Graz')).toBeVisible();
  await expect(dealer.page.getByRole('link', { name: 'www.radhaus.example' })).toBeVisible();
  await expect(dealer.page.getByRole('link', { name: title })).toBeVisible();
  await expect(dealer.page.getByText('1 aktive Anzeige')).toBeVisible();
  await expectNoHorizontalScroll(dealer.page);

  await dealer.page.goto('/konto/haendler');
  await expect(dealer.page.getByText('Aktive Anzeigen', { exact: true })).toBeVisible();
  await expect(dealer.page.getByRole('link', { name: title })).toBeVisible();
  // Firmenbuchnummer/UID fehlen noch
  await expect(dealer.page.getByText('Dein Händlerprofil ist noch unvollständig')).toBeVisible();
  await expectNoHorizontalScroll(dealer.page);
  expect(listingUrl).toContain('/anzeige/');
  await deleteOwnListing(dealer.page, title);
  await dealer.context.close();
});

test('Admin verwaltet Preise und Einführungsaktion – ohne Umstellung auf kostenpflichtig', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}-${run}`;
  const email = `e2e-monet-admin-${tag}@example.at`;
  const admin = await newPage(browser, testInfo);
  await registerConfirmed(admin.page, 'Ada Preise', email);
  setRole(email, 'ADMIN');

  await admin.page.goto('/admin/monetarisierung');
  await expect(admin.page.getByRole('heading', { name: 'Monetarisierung' })).toBeVisible();
  await expect(admin.page.getByText('Kostenloser Plattformbetrieb', { exact: true })).toBeVisible();
  // Ohne Stripe-Konfiguration lässt sich nicht umschalten
  await expect(admin.page.getByText('Der kostenpflichtige Betrieb ist derzeit nicht möglich:')).toBeVisible();
  await expect(admin.page.getByRole('button', { name: 'Kostenpflichtigen Betrieb einschalten' })).toBeDisabled();
  await expectNoHorizontalScroll(admin.page);

  // Preise ändern nur im Desktop-Lauf: beide Läufe gleichzeitig würden sich gegenseitig als Versionskonflikt abweisen
  if (testInfo.project.name === 'desktop') {
    // Geplanter Preis fürs Inserat und Anzeige in der Einführungsaktion
    const listingForm = admin.page.locator('form').filter({ has: admin.page.getByRole('button', { name: 'Inserat speichern' }) });
    await listingForm.getByLabel('Geplanter Preis (€, optional)').fill('2,90');
    await listingForm.getByRole('button', { name: 'Inserat speichern' }).click();
    await expect(listingForm.getByText('Gespeichert. Die Änderung ist protokolliert.')).toBeVisible();
    const introForm = admin.page.locator('form').filter({ has: admin.page.getByRole('button', { name: 'Einführungsaktion speichern' }) });
    await introForm.getByRole('checkbox', { name: 'Geplanten Standardpreis nennen' }).check();
    await introForm.getByRole('button', { name: 'Einführungsaktion speichern' }).click();
    await expect(introForm.getByText('Gespeichert. Die Änderung ist protokolliert.')).toBeVisible();

    await admin.page.goto('/inserieren');
    const intro = admin.page.getByRole('region', { name: 'Einführungsaktion' });
    await expect(intro).toContainText('Geplanter Standardpreis nach der Einführungsphase: € 2,90.');
    await expect(intro).toContainText('0,00');

    // Geplanter Preis verrechnet nichts: das Inserat ist weiterhin kostenlos
    await admin.page.goto('/admin/monetarisierung');
    const listingCard = admin.page.locator('form').filter({ has: admin.page.getByRole('button', { name: 'Inserat speichern' }) }).locator('xpath=..').locator('xpath=..');
    await expect(listingCard).toContainText('Aktuell gültig · Kostenloser Plattformbetrieb');

    // Protokoll enthält die Preisänderung
    await admin.page.goto('/admin/protokoll?action=admin.product_updated');
    await expect(admin.page.getByText('admin.product_updated').first()).toBeVisible();

    // Aufräumen: Ausgangszustand wiederherstellen
    await admin.page.goto('/admin/monetarisierung');
    const resetListing = admin.page.locator('form').filter({ has: admin.page.getByRole('button', { name: 'Inserat speichern' }) });
    await resetListing.getByLabel('Geplanter Preis (€, optional)').fill('');
    await resetListing.getByRole('button', { name: 'Inserat speichern' }).click();
    await expect(resetListing.getByText('Gespeichert. Die Änderung ist protokolliert.')).toBeVisible();
    const resetIntro = admin.page.locator('form').filter({ has: admin.page.getByRole('button', { name: 'Einführungsaktion speichern' }) });
    await resetIntro.getByRole('checkbox', { name: 'Geplanten Standardpreis nennen' }).uncheck();
    await resetIntro.getByRole('button', { name: 'Einführungsaktion speichern' }).click();
    await expect(resetIntro.getByText('Gespeichert. Die Änderung ist protokolliert.')).toBeVisible();

  }

  // Moderation ohne Adminrolle sieht den Bereich nicht
  setRole(email, 'MODERATOR');
  await admin.page.goto('/admin/monetarisierung');
  await expect(admin.page.getByRole('heading', { name: 'Diese Seite gibt es nicht (mehr)' })).toBeVisible();
  await admin.context.close();
});
