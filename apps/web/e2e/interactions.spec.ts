import { expect, test, type Browser, type BrowserContextOptions, type TestInfo } from '@playwright/test';
import { publishBike, registerConfirmed, signInHere } from './accounts';
import { mailCount, waitForMail } from './mailpit';

/**
 * Zielablauf Phase 5 mit zwei echten Konten: Interessent merkt und schreibt, Anbieterin bekommt Zähler und
 * E-Mail, antwortet, die Antwort kommt ohne Neuladen an. Dazu gespeicherte Suchen.
 * Voraussetzung: API mit MESSAGE_EMAIL_DELAY_SECONDS=0 (CI), Mailpit und Redis aus `pnpm infra:up`.
 */
test.describe.configure({ mode: 'serial' });

function contextOptions(testInfo: TestInfo): BrowserContextOptions {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL } = testInfo.project.use;
  return { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL };
}

async function newPage(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext(contextOptions(testInfo));
  return { context, page: await context.newPage() };
}

const run = Date.now();

test('Merken, anschreiben, antworten – in Echtzeit zwischen zwei Konten', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const mobile = testInfo.project.name === 'mobile';
  const tag = `${testInfo.project.name}-${run}`;
  const sellerEmail = `e2e-anbieterin-${tag}@example.at`;
  const buyerEmail = `e2e-interessent-${tag}@example.at`;
  const title = `E2E Chat-Rad ${tag}`;

  const seller = await newPage(browser, testInfo);
  await registerConfirmed(seller.page, 'Vera Verkauf', sellerEmail);
  const listingUrl = await publishBike(seller.page, title);
  const listingPath = new URL(listingUrl).pathname;
  // Eigene Anzeige: kein Herz, kein Kontaktformular
  await expect(seller.page.getByRole('button', { name: /Merken|Gemerkt/ })).toHaveCount(0);
  await expect(seller.page.getByRole('link', { name: 'Anfragen zu deinen Anzeigen' })).toBeVisible();

  // --- Ohne Anmeldung: Herz und „Nachricht schreiben“ führen zur Anmeldung und wieder zurück ---
  const buyer = await newPage(browser, testInfo);
  await buyer.page.goto(listingUrl);
  await buyer.page.getByRole('button', { name: 'Merken' }).click();
  await expect(buyer.page).toHaveURL(new RegExp(`/anmelden\\?weiter=${encodeURIComponent(listingPath)}&hinweis=merken`));
  await expect(buyer.page.getByText('Melde dich an, um Anzeigen auf deiner Merkliste zu speichern.')).toBeVisible();
  await buyer.page.goto(listingUrl);
  await buyer.page.getByRole('link', { name: 'Nachricht schreiben' }).click();
  await expect(buyer.page.getByText('Melde dich an, um dem Anbieter eine Nachricht zu schreiben.')).toBeVisible();

  await registerConfirmed(buyer.page, 'Ivo Interesse', buyerEmail);
  await buyer.page.context().clearCookies();
  await buyer.page.goto(`/anmelden?weiter=${encodeURIComponent(listingPath)}&hinweis=nachricht`);
  await signInHere(buyer.page, buyerEmail);
  await expect(buyer.page).toHaveURL(listingUrl);

  // --- Merken: Status bleibt nach Neuladen und über eine neue Sitzung erhalten ---
  await buyer.page.getByRole('button', { name: 'Merken' }).click();
  await expect(buyer.page.getByRole('button', { name: 'Gemerkt' })).toHaveAttribute('aria-pressed', 'true');
  // Optimistische Anzeige: erst neu laden, wenn der Server gespeichert hat
  await expect(buyer.page.getByRole('button', { name: 'Gemerkt' })).not.toHaveAttribute('aria-busy', 'true');
  await buyer.page.reload();
  await expect(buyer.page.getByRole('button', { name: 'Gemerkt' })).toBeVisible();
  const second = await newPage(browser, testInfo);
  await second.page.goto('/anmelden?weiter=%2Fkonto%2Fmerkliste');
  await signInHere(second.page, buyerEmail);
  await expect(second.page).toHaveURL(/\/konto\/merkliste/);
  await expect(second.page.getByRole('article').filter({ hasText: title })).toBeVisible();
  // Herz auf der Karte zeigt den Status
  await expect(second.page.getByRole('button', { name: `„${title}“ von der Merkliste entfernen` })).toHaveAttribute('aria-pressed', 'true');
  await second.context.close();

  // Herz auf Suchergebnis-Karten
  await buyer.page.goto(`/suche?q=${encodeURIComponent(title)}`);
  await expect(buyer.page.getByRole('button', { name: `„${title}“ von der Merkliste entfernen` })).toBeVisible();

  // --- Anbieterin wartet im Konto; Zähler im Header kommt live ---
  await seller.page.goto('/konto/anzeigen');
  await expect(seller.page.getByTestId('unread-badge')).toHaveCount(0);

  // --- Interessent schreibt von der Detailseite aus ---
  await buyer.page.goto(listingUrl);
  const firstMessage = 'Hallo Vera, ist das Rad noch zu haben? <b>Probefahrt</b> am Samstag?';
  await buyer.page.getByLabel('Nachricht an Vera Verkauf').fill(firstMessage);
  await buyer.page.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(buyer.page).toHaveURL(/\/nachrichten\/\w+/);
  const chatUrl = buyer.page.url();
  const buyerLog = buyer.page.getByTestId('chat-log');
  // HTML erscheint als Text, nicht als Formatierung
  await expect(buyerLog.getByText(firstMessage)).toBeVisible();
  await expect(buyerLog.locator('b')).toHaveCount(0);
  await expect(buyer.page.getByTestId('read-receipt')).toHaveText('Zugestellt');

  // Zähler bei der Anbieterin ohne Neuladen
  await expect(seller.page.getByTestId('unread-badge')).toHaveText('1');
  // E-Mail an die Anbieterin – ohne Nachrichtentext
  const mail = await waitForMail(sellerEmail, /Neue Nachricht von Ivo Interesse/);
  expect(mail.subject).toContain(title);
  expect(mail.text).toContain('/nachrichten/');
  expect(mail.text).not.toContain('Probefahrt');

  // Zweite Nachricht, solange ungelesen: keine zweite E-Mail
  await buyer.page.getByLabel('Nachricht schreiben').fill('Ich könnte auch schon morgen.');
  await buyer.page.getByRole('button', { name: 'Senden' }).click();
  await expect(buyerLog.getByText('Ich könnte auch schon morgen.')).toBeVisible();
  await expect(seller.page.getByTestId('unread-badge')).toHaveText('2');

  // --- Anbieterin öffnet das Postfach ---
  await seller.page.getByTestId('header-messages').click();
  await expect(seller.page).toHaveURL(/\/nachrichten$/);
  const item = seller.page.getByTestId('conversation-item').filter({ hasText: 'Ivo Interesse' });
  await expect(item).toContainText(title);
  await expect(item).toContainText('Ich könnte auch schon morgen.');
  await expect(item.getByText('Ungelesen:')).toBeAttached();
  await item.click();
  await expect(seller.page).toHaveURL(chatUrl);
  const sellerLog = seller.page.getByTestId('chat-log');
  await expect(sellerLog.getByTestId('chat-message')).toHaveCount(2);
  await expect(sellerLog.getByTestId('chat-message').first()).toHaveAttribute('data-mine', 'nein');
  await expect(seller.page.getByTestId('unread-badge')).toHaveCount(0);
  if (mobile) {
    // Mobil: nur der Chat, mit Zurück-Pfeil zur Liste
    await expect(seller.page.getByRole('link', { name: 'Zurück zu allen Nachrichten' })).toBeVisible();
    await expect(seller.page.getByRole('region', { name: 'Unterhaltungen' })).toBeHidden();
  } else {
    await expect(seller.page.getByRole('region', { name: 'Unterhaltungen' })).toBeVisible();
  }
  expect(await mailCount(sellerEmail, /Neue Nachricht von Ivo Interesse/)).toBe(1);

  // Lesebestätigung beim Interessenten, ohne Neuladen
  await expect(buyer.page.getByTestId('read-receipt')).toHaveText('Gelesen');

  // --- Antwort kommt beim Interessenten live an ---
  await seller.page.getByLabel('Nachricht schreiben').fill('Ja, gerne! Samstag um 10 Uhr passt.');
  // Desktop: Enter sendet; Touch: Enter ist ein Zeilenumbruch, gesendet wird mit dem Button
  if (mobile) await seller.page.getByRole('button', { name: 'Senden' }).click();
  else await seller.page.getByLabel('Nachricht schreiben').press('Enter');
  await expect(sellerLog.getByText('Ja, gerne! Samstag um 10 Uhr passt.')).toBeVisible();
  await expect(buyerLog.getByText('Ja, gerne! Samstag um 10 Uhr passt.')).toBeVisible();
  await expect(buyerLog.getByTestId('chat-message').last()).toHaveAttribute('data-mine', 'nein');

  // Detailseite verweist jetzt auf die Unterhaltung statt auf ein neues Formular
  await buyer.page.goto(listingUrl);
  await expect(buyer.page.getByRole('link', { name: 'Zur Unterhaltung' })).toHaveAttribute('href', new URL(chatUrl).pathname);

  // --- Fremde können die Unterhaltung nicht öffnen ---
  const stranger = await newPage(browser, testInfo);
  await registerConfirmed(stranger.page, 'Fremde Person', `e2e-fremd-${tag}@example.at`);
  await stranger.page.goto(chatUrl);
  // Gestreamte Seite: Statuscode steht schon fest, die API hat aber nichts herausgegeben
  await expect(stranger.page.getByRole('heading', { name: 'Diese Seite gibt es nicht (mehr)' })).toBeVisible();
  await expect(stranger.page.getByText('Probefahrt')).toHaveCount(0);
  await expect(stranger.page.getByTestId('chat-log')).toHaveCount(0);
  await stranger.context.close();

  // --- Blockieren sperrt das Schreiben in beide Richtungen ---
  await seller.page.goto(chatUrl);
  await seller.page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await seller.page.getByRole('button', { name: 'Ivo Interesse blockieren' }).click();
  await seller.page.getByRole('button', { name: 'Blockieren', exact: true }).click();
  await expect(seller.page.getByText('Die Person ist blockiert.')).toBeVisible();
  await expect(seller.page.getByTestId('send-blocked')).toBeVisible();
  await buyer.page.goto(chatUrl);
  await expect(buyer.page.getByTestId('send-blocked')).toContainText('keine Nachrichten mehr senden');
  await seller.page.goto('/konto/benachrichtigungen');
  await seller.page.getByRole('button', { name: 'Aufheben' }).click();
  await expect(seller.page.getByText('Die Blockierung ist aufgehoben.')).toBeVisible();

  // --- Melden ---
  await buyer.page.goto(chatUrl);
  await buyer.page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await buyer.page.getByRole('button', { name: 'Vera Verkauf melden' }).click();
  const dialog = buyer.page.getByRole('dialog', { name: 'Vera Verkauf melden' });
  await dialog.getByLabel('Spam').check();
  await dialog.getByRole('button', { name: 'Meldung senden' }).click();
  await expect(dialog.getByText('Danke für deine Meldung.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fertig' }).click();

  // --- Benachrichtigungen abschalten: keine weitere E-Mail ---
  await buyer.page.goto('/konto/benachrichtigungen');
  await buyer.page.getByRole('checkbox', { name: /Neue Nachrichten/ }).uncheck();
  await buyer.page.getByRole('button', { name: 'Einstellungen speichern' }).click();
  await expect(buyer.page.getByText('Deine Einstellungen wurden gespeichert.')).toBeVisible();

  await seller.context.close();
  await buyer.context.close();
});

test('Suche speichern, umbenennen, Benachrichtigung schalten, ausführen und löschen', async ({ page }, testInfo) => {
  const tag = `${testInfo.project.name}-${run}`;
  await registerConfirmed(page, 'Sabine Suche', `e2e-suche-${tag}@example.at`);
  const query = `/suche?q=${encodeURIComponent('Trekkingrad')}&plz=8010&umkreis=25&preis_bis=500`;
  await page.goto(query);
  await page.getByRole('button', { name: 'Suche speichern' }).click();
  const dialog = page.getByRole('dialog', { name: 'Suche speichern' });
  await expect(dialog.getByText('8010 Graz + 25 km')).toBeVisible();
  await dialog.getByLabel('Name').fill('Trekkingrad Graz');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog.getByText('Wir schicken dir eine E-Mail')).toBeVisible();
  await dialog.getByRole('link', { name: 'Gespeicherte Suchen' }).click();

  const saved = page.getByTestId('saved-search').filter({ hasText: 'Trekkingrad Graz' });
  await expect(saved).toContainText('bis');
  await expect(saved.getByRole('button', { name: 'Benachrichtigung an' })).toBeVisible();

  // Gleiche Suche ein zweites Mal: freundlicher Hinweis statt Duplikat
  await page.goto(query);
  await page.getByRole('button', { name: 'Suche speichern' }).click();
  await page.getByRole('dialog', { name: 'Suche speichern' }).getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Diese Suche hast du bereits gespeichert.')).toBeVisible();

  await page.goto('/konto/suchen');
  await saved.getByRole('link', { name: '„Trekkingrad Graz“ umbenennen' }).click();
  await page.getByLabel('Neuer Name').fill('Rad für den Arbeitsweg');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Der Name der Suche wurde geändert.')).toBeVisible();
  const renamed = page.getByTestId('saved-search').filter({ hasText: 'Rad für den Arbeitsweg' });
  await renamed.getByRole('button', { name: 'Benachrichtigung an' }).click();
  await expect(page.getByText('Die E-Mail-Benachrichtigung für diese Suche ist ausgeschaltet.')).toBeVisible();
  await expect(renamed.getByRole('button', { name: 'Benachrichtigung aus' })).toBeVisible();

  // Ausführen: alle Filter sind wieder gesetzt
  await renamed.getByRole('link', { name: 'Suchen' }).click();
  await expect(page).toHaveURL(/q=Trekkingrad/);
  await expect(page).toHaveURL(/umkreis=25/);
  await expect(page).toHaveURL(/preis_bis=500/);

  await page.goto('/konto/suchen');
  await renamed.getByRole('button', { name: 'Löschen' }).click();
  await renamed.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByText('Die gespeicherte Suche wurde gelöscht.')).toBeVisible();
  await expect(page.getByText('Noch keine gespeicherten Suchen')).toBeVisible();
});
