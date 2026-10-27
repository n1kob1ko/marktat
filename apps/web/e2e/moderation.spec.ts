import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { PASSWORD, publishBike, registerConfirmed, signInHere } from './accounts';
import { waitForMail } from './mailpit';

/**
 * Zielablauf Phase 6 mit vier echten Konten: Meldung → Moderation → Mitteilung und Einspruch → Freigabe,
 * Kontosperre, Rechte je Rolle sowie Datenexport und Kontolöschung.
 * Das erste Administratorkonto entsteht wie in Produktion über die Kommandozeile (admin:role).
 */
test.describe.configure({ mode: 'serial' });

const REPO_ROOT = path.resolve(__dirname, '../../..');

function contextOptions(testInfo: TestInfo): BrowserContextOptions {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL } = testInfo.project.use;
  return { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL };
}

async function newPage(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext(contextOptions(testInfo));
  return { context, page: await context.newPage() };
}

function setRoleViaCli(email: string, role: 'ADMIN' | 'MODERATOR' | 'USER') {
  execFileSync('pnpm', ['--filter', '@marktat/api', 'admin:role', '--', '--email', email, '--role', role], { cwd: REPO_ROOT, stdio: 'pipe' });
}

async function expectNotFound(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Diese Seite gibt es nicht (mehr)' })).toBeVisible();
}

/** Admin-Seiten müssen auch am Handy ohne seitliches Scrollen funktionieren */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const run = Date.now();

test('Melden, moderieren, Einspruch und Sperre – mit getrennten Rollen', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const tag = `${testInfo.project.name}-${run}`;
  const emails = {
    seller: `e2e-mod-anbieter-${tag}@example.at`,
    reporter: `e2e-mod-melder-${tag}@example.at`,
    moderator: `e2e-mod-moderation-${tag}@example.at`,
    admin: `e2e-mod-admin-${tag}@example.at`,
  };
  const title = `E2E Moderationsrad ${tag}`;

  // --- Konten: Anbieter mit Inserat, meldende Person, Moderation, Administration ---
  const seller = await newPage(browser, testInfo);
  await registerConfirmed(seller.page, 'Sepp Anbieter', emails.seller);
  const listingUrl = await publishBike(seller.page, title);
  const listingId = new URL(listingUrl).pathname.split('/').pop()!;
  // Eigene Anzeige: kein Melde-Link
  await expect(seller.page.getByRole('link', { name: 'Anzeige melden' })).toHaveCount(0);

  const reporter = await newPage(browser, testInfo);
  await registerConfirmed(reporter.page, 'Resi Meldung', emails.reporter);
  const moderator = await newPage(browser, testInfo);
  await registerConfirmed(moderator.page, 'Moritz Moderation', emails.moderator);
  const admin = await newPage(browser, testInfo);
  await registerConfirmed(admin.page, 'Adele Admin', emails.admin);
  setRoleViaCli(emails.admin, 'ADMIN');

  // --- Ohne Rolle gibt es den Admin-Bereich nicht ---
  await expectNotFound(reporter.page, '/admin');
  await expectNotFound(moderator.page, '/admin/meldungen');
  await expect(reporter.page.getByRole('link', { name: 'Moderation' })).toHaveCount(0);

  // --- Administration vergibt Moderationsrechte im Admin-Bereich ---
  await admin.page.goto('/admin');
  await expect(admin.page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
  await expect(admin.page.getByText('Registrierungen der letzten 14 Tage')).toBeVisible();
  await expectNoHorizontalScroll(admin.page);
  await admin.page.goto(`/admin/nutzer?q=${encodeURIComponent(emails.moderator)}`);
  await admin.page.getByRole('link', { name: 'Moritz Moderation' }).click();
  await expect(admin.page.getByRole('heading', { level: 2, name: 'Moritz Moderation' })).toBeVisible();
  await admin.page.getByRole('button', { name: 'Moderationsrechte geben' }).click();
  await expect(admin.page.getByText('Das Konto hat jetzt Moderationsrechte.')).toBeVisible();

  // --- Meldung über das Formular (Art. 16 DSA) ---
  await reporter.page.goto(listingUrl);
  await reporter.page.getByRole('link', { name: 'Anzeige melden' }).click();
  await expect(reporter.page.getByRole('heading', { name: 'Anzeige melden' })).toBeVisible();
  await reporter.page.getByRole('button', { name: 'Meldung senden' }).click();
  // Pflichtfelder prüft schon der Browser – die Seite bleibt
  await expect(reporter.page).toHaveURL(/\/melden\?anzeige=/);
  await reporter.page.getByRole('radio', { name: /Betrugsverdacht/ }).check();
  await reporter.page.getByLabel('Begründung').fill('Verlangt Vorauskasse per Gutschein, das Rad gibt es vermutlich nicht.');
  await reporter.page.getByRole('checkbox', { name: /nach bestem Wissen/ }).check();
  await reporter.page.getByRole('button', { name: 'Meldung senden' }).click();
  await expect(reporter.page).toHaveURL(new RegExp(`/anzeige/${listingId}\\?hinweis=gemeldet`));
  await expect(reporter.page.getByText('Danke für deine Meldung.')).toBeVisible();
  // Doppelte Meldung wird abgefangen
  await reporter.page.goto(`/melden?anzeige=${listingId}`);
  await reporter.page.getByRole('radio', { name: /Spam/ }).check();
  await reporter.page.getByLabel('Begründung').fill('Noch einmal dieselbe Anzeige gemeldet.');
  await reporter.page.getByRole('checkbox', { name: /nach bestem Wissen/ }).check();
  await reporter.page.getByRole('button', { name: 'Meldung senden' }).click();
  await expect(reporter.page.getByText(/bereits gemeldet/)).toBeVisible();

  // --- Moderation: Warteschlange, Meldung, Entscheidung mit Begründung ---
  await moderator.page.goto('/admin');
  await expect(moderator.page.getByRole('link', { name: 'Konten' })).toHaveCount(0);
  await expect(moderator.page.getByText('Systemstatistiken')).toHaveCount(0);
  await expectNotFound(moderator.page, '/admin/nutzer');
  await expectNotFound(moderator.page, '/admin/protokoll');
  await moderator.page.goto('/admin/meldungen');
  await moderator.page.locator('tr', { hasText: title }).getByRole('link').first().click();
  await expect(moderator.page.getByRole('heading', { name: 'Betrugsverdacht' })).toBeVisible();
  await expectNoHorizontalScroll(moderator.page);
  await moderator.page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(moderator.page.getByText('Du bearbeitest diese Meldung.')).toBeVisible();
  await moderator.page.getByRole('link', { name: 'Inserat prüfen und entscheiden' }).click();
  await expect(moderator.page.getByRole('heading', { name: title })).toBeVisible();
  await expectNoHorizontalScroll(moderator.page);
  await expect(moderator.page.getByRole('radio', { name: /Deaktivieren/ })).toBeChecked();
  await expect(moderator.page.getByLabel('Art des Verstoßes')).toHaveValue('FRAUD');
  // Zu kurze Begründung: die Person muss die Entscheidung nachvollziehen können
  await moderator.page.getByLabel('Begründung für die betroffene Person').fill('Verstoß.');
  await moderator.page.getByRole('button', { name: 'Deaktivieren – bestätigen' }).click();
  await expect(moderator.page.getByText(/mindestens 20 Zeichen/)).toBeVisible();
  await moderator.page.getByLabel('Begründung für die betroffene Person').fill('Die Anzeige verlangt Vorauskasse per Gutschein. Das ist bei MarktAT nicht erlaubt.');
  await moderator.page.getByRole('button', { name: 'Deaktivieren – bestätigen' }).click();
  await expect(moderator.page.getByText('Die Entscheidung ist gespeichert.', { exact: false })).toBeVisible();
  await expect(moderator.page.getByText('Inserat deaktiviert').first()).toBeVisible();

  // Öffentlich weg: Detailseite und Suche
  const guest = await newPage(browser, testInfo);
  await expectNotFound(guest.page, listingUrl);
  await expect(async () => {
    await guest.page.goto(`/suche?q=${encodeURIComponent(title)}`);
    await expect(guest.page.getByText('Keine passenden Anzeigen gefunden')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // --- Anbieter: Mitteilung, E-Mail, Begründung, Einspruch ---
  await waitForMail(emails.seller, /deaktiviert/);
  await seller.page.goto('/konto/mitteilungen');
  await expect(seller.page.getByText('Deine Anzeige wurde deaktiviert')).toBeVisible();
  await seller.page.goto(listingUrl);
  await expect(seller.page.getByText('Die Anzeige verlangt Vorauskasse per Gutschein.', { exact: false })).toBeVisible();
  await seller.page.getByRole('link', { name: 'Begründung und Einspruch' }).click();
  await expect(seller.page.getByText('Diese Entscheidung hat ein Mensch aus unserem Team getroffen', { exact: false })).toBeVisible();
  await seller.page.getByLabel('Begründung deines Einspruchs').fill('Ich verlange keine Vorauskasse, Übergabe nur persönlich in Graz. Bitte prüft das noch einmal.');
  await seller.page.getByRole('button', { name: 'Einspruch einreichen' }).click();
  await expect(seller.page.getByText('Dein Einspruch ist eingegangen.')).toBeVisible();
  await expect(seller.page.getByText('In Prüfung')).toBeVisible();

  // --- Administration entscheidet den Einspruch (nicht die ursprüngliche Moderation) ---
  await admin.page.goto('/admin/einsprueche');
  await admin.page.locator('tr', { hasText: title }).getByRole('link').first().click();
  await admin.page.getByRole('radio', { name: /Stattgeben/ }).check();
  await admin.page.getByLabel('Antwort an die Person').fill('Nach erneuter Prüfung konnten wir keinen Verstoß feststellen. Danke für die Erklärung.');
  await admin.page.getByRole('button', { name: 'Einspruch entscheiden' }).click();
  // Danach zeigt die Seite das Ergebnis statt des Formulars
  await expect(admin.page.getByText('Einspruch: Stattgegeben – Entscheidung aufgehoben')).toBeVisible();
  await expect(admin.page.getByRole('heading', { name: 'Ergebnis' })).toBeVisible();

  await guest.page.goto(listingUrl);
  await expect(guest.page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await seller.page.goto('/konto/mitteilungen');
  await expect(seller.page.getByText('Deinem Einspruch wurde stattgegeben')).toBeVisible();
  await reporter.page.goto('/konto/mitteilungen');
  await expect(reporter.page.getByText('Deine Meldung wurde bearbeitet')).toBeVisible();

  // --- Kontosperre: Moderation sperrt, nur Administration hebt auf ---
  await moderator.page.goto(`/admin/inserate/${listingId}`);
  await moderator.page.getByRole('link', { name: 'Sepp Anbieter' }).first().click();
  await expect(moderator.page.getByRole('heading', { level: 2, name: 'Sepp Anbieter' })).toBeVisible();
  const suspendForm = moderator.page.locator('form', { has: moderator.page.getByRole('button', { name: 'Konto sperren – bestätigen' }) });
  await suspendForm.getByLabel('Art des Verstoßes').selectOption('SPAM');
  await suspendForm.getByLabel('Begründung für die betroffene Person').fill('Wiederholte Werbung trotz Hinweis. Das Konto ist deshalb gesperrt.');
  await suspendForm.getByRole('button', { name: 'Konto sperren – bestätigen' }).click();
  await expect(moderator.page.getByText('Das Konto ist gesperrt. Die Person wurde mit Begründung informiert.')).toBeVisible();
  await expect(moderator.page.getByText('Sperren heben nur Administratoren auf', { exact: false })).toBeVisible();

  await seller.page.goto('/konto/anzeigen');
  await expect(seller.page).toHaveURL(/\/konto\/entscheidungen/);
  await expect(seller.page.getByText('Dein Konto ist gesperrt')).toBeVisible();
  await expectNotFound(guest.page, listingUrl);

  await admin.page.goto(`/admin/nutzer?q=${encodeURIComponent(emails.seller)}`);
  await admin.page.getByRole('link', { name: 'Sepp Anbieter' }).click();
  await expect(admin.page.getByRole('heading', { level: 2, name: 'Sepp Anbieter' })).toBeVisible();
  await admin.page.getByLabel('Begründung für die betroffene Person').fill('Die Sperre wird nach Rücksprache aufgehoben. Bitte beachte unsere Regeln.');
  await admin.page.getByRole('button', { name: 'Sperre aufheben – bestätigen' }).click();
  await expect(admin.page.getByText('Die Sperre ist aufgehoben.')).toBeVisible();
  await seller.page.goto('/konto/anzeigen');
  await expect(seller.page.getByText(title)).toBeVisible();

  // --- Protokoll: die Entscheidungen sind nachvollziehbar ---
  await admin.page.goto(`/admin/protokoll?action=moderation.&entityId=${listingId}`);
  await expect(admin.page.getByText('moderation.listing_rejected')).toBeVisible();
  await expectNoHorizontalScroll(admin.page);

  // Aufräumen: das Testrad soll die Suchtests (gleiche Kategorie) nicht beeinflussen
  const card = seller.page.locator('li', { hasText: title });
  await card.getByRole('button', { name: 'Löschen' }).click();
  await card.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(seller.page.getByText('Die Anzeige wurde gelöscht.')).toBeVisible();

  for (const p of [seller, reporter, moderator, admin, guest]) await p.context.close();
});

test('Datenexport und Kontolöschung im Konto', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}-${run}`;
  const email = `e2e-loeschen-${tag}@example.at`;
  const { context, page } = await newPage(browser, testInfo);
  await registerConfirmed(page, 'Lotte Löschen', email);
  await publishBike(page, `E2E Löschrad ${tag}`);

  await page.goto('/konto/datenschutz');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Datenexport herunterladen' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^marktat-export-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8')) as {
    profile: { email: string };
    listings: { title: string }[];
  };
  expect(exported.profile.email).toBe(email);
  expect(exported.listings.map((l) => l.title)).toContain(`E2E Löschrad ${tag}`);

  await page.getByRole('button', { name: 'Konto löschen …' }).click();
  await page.getByLabel('Dein Passwort').fill('falsches-Passwort-123');
  await page.getByLabel(/Tippe LÖSCHEN/).fill('löschen');
  await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
  await expect(page.getByText('Das Passwort ist nicht richtig.')).toBeVisible();
  await page.getByLabel('Dein Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
  await expect(page.getByRole('heading', { name: 'Dein Konto wird gelöscht' })).toBeVisible();

  // Abgemeldet und keine erneute Anmeldung möglich
  await page.goto('/konto');
  await expect(page).toHaveURL(/\/anmelden/);
  await signInHere(page, email);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/anmelden/);
  await context.close();
});
