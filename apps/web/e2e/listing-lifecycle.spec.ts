import { expect, test } from '@playwright/test';
import { publishBike, registerConfirmed } from './accounts';

/**
 * Reserviert und Verkauft aus Sicht von Anbieter:in und Besucher:in sowie die Einstellung für Ablauf-E-Mails.
 * Braucht Mailpit und die API aus `pnpm start`.
 */
test('Reservieren, als verkauft markieren und erneut veröffentlichen', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}-${Date.now()}`;
  const title = `E2E Lebenslauf-Rad ${tag}`;
  await registerConfirmed(page, 'Lena Lebenslauf', `e2e-lebenslauf-${tag}@example.at`);
  const url = await publishBike(page, title);

  // Besucher:in ohne Anmeldung in eigenem Fenster
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL } = testInfo.project.use;
  const guestContext = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL });
  const guest = await guestContext.newPage();

  // Reservieren: Kennzeichnung für alle, Anfragen weiterhin möglich
  await page.getByRole('button', { name: 'Reservieren' }).click();
  await expect(page.getByText('Die Anzeige ist als reserviert gekennzeichnet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reservierung aufheben' })).toBeVisible();
  await guest.goto(url);
  await expect(guest.getByText('Reserviert', { exact: true }).first()).toBeVisible();
  await expect(guest.getByRole('link', { name: 'Nachricht schreiben' })).toBeVisible();
  // In der Suche mit Abzeichen (der Suchindex zieht kurz nach)
  await expect(async () => {
    await guest.goto(`/suche?q=${encodeURIComponent(title)}`);
    const card = guest.locator('article').filter({ hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 2_000 });
    await expect(card.getByText('Reserviert', { exact: true })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // Verkauft: Seite bleibt mit Hinweis erreichbar, ohne Kontakt, nicht mehr in der Suche
  await page.getByRole('button', { name: 'Als verkauft markieren' }).click();
  await expect(page.getByText('Glückwunsch zum Verkauf!')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Erneut veröffentlichen' })).toBeVisible();
  await guest.goto(url);
  await expect(guest.getByText('Diese Anzeige ist verkauft.')).toBeVisible();
  await expect(guest.getByRole('link', { name: 'Nachricht schreiben' })).toHaveCount(0);
  await expect(guest.getByText('Verkauft – Anfragen sind nicht mehr möglich.')).toBeVisible();
  await expect(async () => {
    await guest.goto(`/suche?q=${encodeURIComponent(title)}`);
    await expect(guest.locator('article').filter({ hasText: title })).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // „Meine Anzeigen“ zeigt den Status; erneut veröffentlichen macht die Anzeige wieder aktiv
  await page.goto('/konto/anzeigen');
  const row = page.locator('li').filter({ hasText: title });
  await expect(row.getByText('Verkauft', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Erneut veröffentlichen' }).click();
  await expect(page.getByText('Deine Anzeige ist jetzt online.')).toBeVisible();
  await expect(page.locator('li').filter({ hasText: title }).getByText('Aktiv', { exact: true })).toBeVisible();
  await guest.goto(url);
  await expect(guest.getByRole('link', { name: 'Nachricht schreiben' })).toBeVisible();
  await guestContext.close();
});

test('Einstellung für Ablauf-E-Mails lässt sich abschalten', async ({ page }, testInfo) => {
  const tag = `${testInfo.project.name}-${Date.now()}`;
  await registerConfirmed(page, 'Anna Ablauf', `e2e-ablauf-${tag}@example.at`);
  await page.goto('/konto/benachrichtigungen');
  const box = page.getByRole('checkbox', { name: /Ablauf meiner Anzeigen/ });
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
  await expect(page.getByText('Deine Einstellungen wurden gespeichert.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Ablauf meiner Anzeigen/ })).not.toBeChecked();
});
