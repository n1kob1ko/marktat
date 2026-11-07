import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import { publishBike, registerConfirmed } from './accounts';

/**
 * Bewertungen nach einem Kontakt: beide schreiben, der Käufer bewertet im Chat, die Sterne erscheinen bei der
 * Anzeige und auf der Bewertungsseite, die Verkäuferin antwortet öffentlich.
 */
test.describe.configure({ mode: 'serial' });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function contextOptions(testInfo: TestInfo): BrowserContextOptions {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL } = testInfo.project.use;
  return { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL };
}

async function newPage(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext(contextOptions(testInfo));
  return { context, page: await context.newPage() };
}

async function expectNoViolations(page: Page, label: string) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: seitliches Scrollen`).toBeLessThanOrEqual(0);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`), label).toEqual([]);
}

test('Nach dem Kontakt bewerten, Sterne bei der Anzeige, öffentliche Antwort', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}-${Date.now()}`;
  const title = `E2E Bewertungs-Rad ${tag}`;

  const seller = await newPage(browser, testInfo);
  await registerConfirmed(seller.page, 'Bea Bewertet', `e2e-bewertet-${tag}@example.at`);
  const listingUrl = await publishBike(seller.page, title);
  await expect(seller.page.getByText('Noch keine Bewertungen')).toBeVisible();

  const buyer = await newPage(browser, testInfo);
  await registerConfirmed(buyer.page, 'Ben Bewerter', `e2e-bewerter-${tag}@example.at`);
  await buyer.page.goto(listingUrl);
  await buyer.page.getByLabel('Nachricht an Bea Bewertet').fill('Hallo, ist das Rad noch da?');
  await buyer.page.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(buyer.page).toHaveURL(/\/nachrichten\/\w+/);
  const chatUrl = buyer.page.url();
  const conversationId = new URL(chatUrl).pathname.split('/').pop()!;

  // Erst wenn beide geschrieben haben, gibt es „Bewerten“
  await expect(buyer.page.getByRole('link', { name: 'Bea Bewertet bewerten' })).toHaveCount(0);
  await seller.page.goto(chatUrl);
  await seller.page.getByLabel('Nachricht schreiben').fill('Ja, komm gerne vorbei.');
  await seller.page.getByRole('button', { name: 'Senden' }).click();
  await expect(seller.page.getByTestId('chat-log').getByText('Ja, komm gerne vorbei.')).toBeVisible();
  // Erst wenn die Nachricht beim Server ist („Zugestellt“), kennt die Gegenseite nach dem Neuladen das Bewerten
  await expect(seller.page.getByTestId('chat-log').getByText(/Zugestellt|Gelesen/)).toBeVisible();

  await buyer.page.reload();
  await buyer.page.getByRole('link', { name: 'Bea Bewertet bewerten' }).click();
  await expect(buyer.page).toHaveURL(`/bewerten/${conversationId}`);
  await expect(buyer.page.getByRole('heading', { level: 1, name: 'Bea Bewertet bewerten' })).toBeVisible();
  await expectNoViolations(buyer.page, 'Bewerten');

  // Ohne Sterne geht es nicht; dann 4 Sterne mit Text
  await buyer.page.getByRole('button', { name: 'Bewertung abschicken' }).click();
  await expect(buyer.page).toHaveURL(`/bewerten/${conversationId}`);
  await buyer.page.locator('label', { has: buyer.page.getByRole('radio', { name: '4 Sterne – Gut' }) }).click();
  await expect(buyer.page.getByRole('radio', { name: '4 Sterne – Gut' })).toBeChecked();
  await buyer.page.getByLabel('Ein paar Worte dazu').fill('Freundlich und pünktlich, Rad wie beschrieben.');
  await buyer.page.getByRole('button', { name: 'Bewertung abschicken' }).click();
  await expect(buyer.page.getByText('Danke für deine Bewertung!')).toBeVisible();
  await expect(buyer.page.getByRole('button', { name: 'Bewertung ändern' })).toBeVisible();

  // Im Chat: bewertet
  await buyer.page.goto(chatUrl);
  await expect(buyer.page.getByRole('link', { name: 'Deine Bewertung: 4 von 5 Sternen – ändern' })).toBeVisible();

  // Sterne bei der Anzeige, verlinkt auf alle Bewertungen
  await buyer.page.goto(listingUrl);
  const summary = buyer.page.getByRole('link', { name: /4,0.*1 Bewertung/ });
  await expect(summary.getByRole('img', { name: '4,0 von 5 Sternen' })).toBeVisible();
  await summary.click();
  await expect(buyer.page).toHaveURL(/\/bewertungen\/[0-9a-f-]{36}$/);
  const ratingsUrl = buyer.page.url();
  await expect(buyer.page.getByRole('heading', { level: 1, name: 'Bea Bewertet' })).toBeVisible();
  const entry = buyer.page.getByRole('article', { name: 'Bewertung von Ben Bewerter' });
  await expect(entry).toContainText('Freundlich und pünktlich, Rad wie beschrieben.');
  await expect(entry).toContainText(`Käufer:in · `);
  await expect(entry).toContainText(title);
  await expectNoViolations(buyer.page, 'Bewertungen');

  // Verkäuferin antwortet öffentlich in ihrem Konto
  await seller.page.goto('/konto/bewertungen');
  await expect(seller.page.getByRole('article', { name: 'Bewertung von Ben Bewerter' })).toBeVisible();
  await seller.page.getByText('Öffentlich antworten', { exact: true }).click();
  await seller.page.getByLabel('Deine Antwort').fill('Danke, viel Freude mit dem Rad!');
  await seller.page.getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(seller.page.getByText('Deine Antwort ist gespeichert und öffentlich sichtbar.')).toBeVisible();
  await expectNoViolations(seller.page, 'Konto › Bewertungen');

  await buyer.page.goto(ratingsUrl);
  await expect(entry).toContainText('Antwort von Bea Bewertet');
  await expect(entry).toContainText('Danke, viel Freude mit dem Rad!');

  await seller.context.close();
  await buyer.context.close();
});
