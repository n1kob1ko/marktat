import path from 'node:path';
import { expect, test } from '@playwright/test';
import { registerConfirmed, setRole } from './accounts';
import { expectNoHorizontalScroll, newPage } from './merchant';

/**
 * Phase 10, Dienstleistungen: Eine Privatperson legt im bestehenden Konto ein Anbieterprofil an (keine zweite
 * Registrierung), mit Portfolio und Qualifikation. Kund:innen finden es über Begriff und Umkreis, schreiben über die
 * Nachrichten und melden es; die Moderation prüft die Qualifikation und blendet einen Portfolio-Eintrag aus.
 * Am Ende wird das Profil gelöscht, damit andere Specs nicht von Testdaten abhängen.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now();
const IMAGE = path.join(__dirname, 'fixtures', 'testbild-mit-gps.jpg');

test('Übersicht /dienstleistungen zeigt die Bereiche und passt auf kleine Bildschirme', async ({ page }) => {
  await page.goto('/dienstleistungen');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Handwerk/ }).first()).toBeVisible();
  await expect(page.getByText(/GISA/).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('Anbieterprofil anlegen, finden, kontaktieren, melden und moderieren', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const tag = `${testInfo.project.name}-${run}`;
  const word = `Diensttest${run}${testInfo.project.name === 'mobile' ? 'm' : 'd'}`;
  const headline = `E2E ${word} Elektroinstallationen`;
  const emails = {
    provider: `e2e-dl-anbieter-${tag}@example.at`,
    client: `e2e-dl-kunde-${tag}@example.at`,
    moderator: `e2e-dl-moderation-${tag}@example.at`,
  };

  // --- Anbieter:in: Profil im bestehenden Konto ---
  const provider = await newPage(browser, testInfo);
  const page = provider.page;
  await registerConfirmed(page, 'Elli Elektro', emails.provider);
  await page.goto('/konto/dienstleistungen');
  await expect(page.getByText('eine eigene Registrierung brauchst du nicht', { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Fehlende Pflichtangaben werden angezeigt, die Eingaben bleiben erhalten
  await page.getByLabel('Überschrift').fill(headline);
  await page.getByRole('button', { name: 'Profil als Entwurf speichern' }).click();
  await expect(page.getByText('Bitte prüfe die markierten Felder.')).toBeVisible();
  await expect(page.getByLabel('Überschrift')).toHaveValue(headline);

  await page.getByLabel('Kurzbeschreibung').fill('Elektroinstallationen, Reparaturen und E-Checks im Raum Graz.');
  await page.getByLabel('Ausführliche Beschreibung').fill(
    'Ich übernehme Elektroinstallationen in Wohnungen und Häusern, tausche Sicherungskästen und mache E-Checks. Testprofil aus der automatischen Prüfung.',
  );
  await page.getByRole('checkbox', { name: /^Elektriker/ }).check();
  await page.getByLabel('Fähigkeiten').fill('E-Check, Smart Home, Photovoltaik');
  await page.getByLabel('PLZ und Ort').fill('8020');
  await page.getByRole('option', { name: /8020/ }).first().click();
  await page.getByLabel('Einsatzgebiet in km rund um deinen Ort').fill('15');
  await page.getByLabel('Preisangabe').selectOption('HOURLY');
  await page.getByLabel('Betrag pro Stunde in €').fill('68');
  await page.getByRole('button', { name: 'Profil als Entwurf speichern' }).click();
  await expect(page.getByText('Dein Anbieterprofil ist gespeichert.')).toBeVisible();
  await expect(page.getByText('Entwurf', { exact: true }).first()).toBeVisible();

  // Qualifikation: öffentlich nur als Angabe, bis das Team sie geprüft hat
  const qualifications = page.locator('#qualifikationen');
  await qualifications.getByRole('textbox', { name: 'Qualifikation', exact: true }).fill('Meisterprüfung Elektrotechnik');
  await qualifications.getByLabel(/Ausgestellt von/).fill('Meisterprüfungsstelle Steiermark');
  await qualifications.getByLabel(/Nummer bzw. Referenz/).fill(`MP-${run}`);
  await qualifications.getByRole('button', { name: 'Qualifikation hinzufügen' }).click();
  await expect(page.getByText('Die Qualifikation ist gespeichert.', { exact: false })).toBeVisible();

  // Portfolio-Eintrag mit eigenem Bild (Bildrechte sind Pflicht)
  const newItem = page.getByTestId('portfolio-new');
  await newItem.getByLabel('Titel').fill('Sanierung Altbauwohnung');
  await newItem.getByLabel('Beschreibung').fill('Komplette Neuverkabelung einer 80-m²-Wohnung.');
  await newItem.getByRole('button', { name: 'Eintrag hinzufügen' }).click();
  await expect(page.getByText('Der Portfolio-Eintrag ist gespeichert.', { exact: false })).toBeVisible();
  const item = page.locator('details', { hasText: 'Sanierung Altbauwohnung' });
  await expect(item).toHaveAttribute('open', '');
  await item.getByLabel('Herkunft des Bildes').selectOption('OWN');
  await item.locator('input[type=file]').setInputFiles(IMAGE);
  await expect(item.getByText('Das Bild ist gespeichert.')).toBeVisible({ timeout: 20_000 });

  // Veröffentlichen nur mit Bestätigung
  await page.getByRole('button', { name: 'Veröffentlichen' }).click();
  await expect(page.getByText('Bitte bestätige zuerst.')).toBeVisible();
  await page.getByRole('checkbox', { name: /Ich bestätige, dass die Angaben stimmen/ }).check();
  await page.getByRole('button', { name: 'Veröffentlichen' }).click();
  await expect(page.getByText('Dein Anbieterprofil ist jetzt unter „Dienstleistungen“ sichtbar.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  const profileHref = await page.getByRole('link', { name: 'Ansehen' }).getAttribute('href');
  const profileId = profileHref!.split('/').pop()!;

  // --- Kund:in: Suche mit Begriff und Umkreis ---
  const client = await newPage(browser, testInfo);
  await registerConfirmed(client.page, 'Karl Kunde', emails.client);
  const visitor = client.page;
  await visitor.goto(`/dienstleistungen?q=${word}`);
  const card = visitor.getByTestId('service-card').filter({ hasText: headline });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Elli Elektro');
  await expect(card).toContainText('68');
  await visitor.goto(`/dienstleistungen?q=${word}&plz=8010&umkreis=10`);
  await expect(visitor.getByTestId('service-card').filter({ hasText: headline })).toBeVisible();
  await visitor.goto(`/dienstleistungen?q=${word}&plz=1010&umkreis=10`);
  await expect(visitor.getByTestId('service-card').filter({ hasText: headline })).toHaveCount(0);
  await visitor.goto(`/dienstleistungen?q=${word}&remote=1`);
  await expect(visitor.getByTestId('service-card').filter({ hasText: headline })).toHaveCount(0);
  await expectNoHorizontalScroll(visitor);

  // Detailseite: Hinweis auf Berufsberechtigung, Qualifikation nicht geprüft, Portfolio
  await visitor.goto(`/dienstleistungen/${profileId}`);
  await expect(visitor.getByRole('heading', { level: 1, name: headline })).toBeVisible();
  await expect(visitor.getByText('Hinweis zu Berufsberechtigungen')).toBeVisible();
  await expect(visitor.getByTestId('qualifications')).toContainText('Angabe der Anbieter:in, nicht geprüft');
  // Die Nummer ist erst nach der Prüfung öffentlich
  await expect(visitor.getByTestId('qualifications')).not.toContainText(`MP-${run}`);
  await expect(visitor.getByTestId('portfolio')).toContainText('Sanierung Altbauwohnung');
  await expectNoHorizontalScroll(visitor);

  // Merken (eigene Liste „Anbieter“ in der Merkliste)
  await visitor.getByRole('button', { name: 'Merken' }).click();
  await expect(visitor.getByRole('button', { name: 'Gemerkt' })).toHaveAttribute('aria-pressed', 'true');
  // Erst weiter, wenn die Anfrage durch ist (der Knopf schaltet sofort um)
  await expect(visitor.getByRole('button', { name: 'Gemerkt' })).not.toHaveAttribute('aria-busy');
  await visitor.goto('/konto/merkliste?art=anbieter');
  await expect(visitor.getByTestId('service-card').filter({ hasText: headline })).toBeVisible();
  await expectNoHorizontalScroll(visitor);

  // Suche speichern: tägliche Sammelmail statt Einzelmails
  await visitor.goto(`/dienstleistungen?q=${word}`);
  await visitor.getByRole('button', { name: 'Suche speichern' }).click();
  const dialog = visitor.getByRole('dialog', { name: 'Suche speichern' });
  await expect(dialog.getByText('Neue passende Anbieter per E-Mail schicken', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  // Erfolgsmeldung (der Hinweis „höchstens einmal am Tag“ steht schon am Häkchen)
  await expect(dialog.getByText('Neue passende Anbieter bekommst du gesammelt', { exact: false })).toBeVisible();
  await visitor.goto('/konto/suchen');
  const saved = visitor.getByTestId('saved-search').filter({ hasText: word });
  await expect(saved.getByTestId('saved-search-kind')).toHaveText('Dienstleistungen');
  await expect(saved.getByRole('link', { name: 'Suchen' })).toHaveAttribute('href', `/dienstleistungen?q=${word}`);

  await visitor.goto(`/dienstleistungen/${profileId}`);

  // Kontakt über die bestehenden Nachrichten
  await visitor.getByLabel('Nachricht an Elli Elektro').fill('Hallo, könnten Sie nächste Woche einen E-Check bei mir in Graz machen?');
  await visitor.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(visitor).toHaveURL(/\/nachrichten\/\w+/);
  // Kopf der Unterhaltung nennt das Anbieterprofil (auf dem Handy ist die Liste daneben ausgeblendet)
  await expect(visitor.getByRole('link', { name: new RegExp(`Anbieterprofil: ${headline}`) }).last()).toBeVisible();
  await expect(visitor.getByText('könnten Sie nächste Woche einen E-Check', { exact: false }).last()).toBeVisible();

  // Melden
  await visitor.goto(`/dienstleistungen/${profileId}`);
  await expect(visitor.getByRole('link', { name: 'Zur Unterhaltung' })).toBeVisible();
  await visitor.getByRole('link', { name: 'Profil melden' }).click();
  await visitor.getByRole('radio', { name: /Irreführende Angaben/ }).check();
  await visitor.getByLabel('Begründung').fill('Die Meisterprüfung lässt sich nicht nachvollziehen, bitte prüfen.');
  await visitor.getByRole('checkbox', { name: /nach bestem Wissen/ }).check();
  await visitor.getByRole('button', { name: 'Meldung senden' }).click();
  await expect(visitor).toHaveURL(new RegExp(`/dienstleistungen/${profileId}\\?hinweis=gemeldet`));
  await expect(visitor.getByText('Danke für deine Meldung.')).toBeVisible();

  // --- Moderation: Qualifikation prüfen, Portfolio-Eintrag ausblenden ---
  const moderator = await newPage(browser, testInfo);
  await registerConfirmed(moderator.page, 'Mona Moderation', emails.moderator);
  setRole(emails.moderator, 'MODERATOR');
  const mod = moderator.page;
  await mod.goto(`/admin/dienstleistungen?q=${word}`);
  await expect(mod.locator('tr', { hasText: headline })).toContainText('1 Meldung(en)');
  await expect(mod.locator('tr', { hasText: headline })).toContainText('1 Qualifikation(en) offen');
  await expectNoHorizontalScroll(mod);
  await mod.locator('tr', { hasText: headline }).getByRole('link').first().click();
  await expect(mod.getByRole('heading', { level: 2, name: headline })).toBeVisible();
  await expect(mod.getByTestId('admin-qualifications')).toContainText(`MP-${run}`);
  await mod.getByTestId('admin-qualifications').getByLabel('Notiz zur Prüfung').fill('Abgleich mit dem Meisterprüfungszeugnis (Test).');
  await mod.getByRole('button', { name: 'Nachweis geprüft – bestätigen' }).click();
  await expect(mod.getByText('Die Prüfung der Qualifikation ist gespeichert.', { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(mod);

  await mod.getByText('Eintrag ausblenden …').click();
  const portfolioForm = mod.getByTestId('admin-portfolio');
  await portfolioForm.getByLabel('Art des Verstoßes').selectOption({ index: 1 });
  await portfolioForm.getByLabel('Begründung für die betroffene Person').fill('Das Bild zeigt eine fremde Baustelle, für die kein Nutzungsrecht nachgewiesen ist.');
  await portfolioForm.getByRole('button', { name: 'Eintrag ausblenden – bestätigen' }).click();
  await expect(mod.getByText('Der Portfolio-Eintrag ist ausgeblendet.', { exact: false })).toBeVisible();

  // Öffentlich: Qualifikation geprüft (mit Nummer), Portfolio-Eintrag weg
  await visitor.goto(`/dienstleistungen/${profileId}`);
  await expect(visitor.getByTestId('qualifications')).toContainText('Von MarktAT geprüft');
  await expect(visitor.getByTestId('qualifications')).toContainText(`MP-${run}`);
  await expect(visitor.getByTestId('portfolio')).toHaveCount(0);
  await visitor.goto(`/dienstleistungen?q=${word}`);
  await expect(visitor.getByTestId('service-card').filter({ hasText: headline })).toContainText('geprüft');

  // Anbieter:in sieht die Entscheidung am Eintrag
  await page.goto('/konto/dienstleistungen');
  await expect(page.locator('details', { hasText: 'Sanierung Altbauwohnung' })).toContainText('Vom Team ausgeblendet');

  // --- Pausieren und löschen ---
  await page.getByRole('button', { name: 'Pausieren' }).click();
  await expect(page.getByText('Dein Anbieterprofil ist pausiert', { exact: false })).toBeVisible();
  await visitor.goto(`/dienstleistungen?q=${word}`);
  await expect(visitor.getByTestId('service-card').filter({ hasText: headline })).toHaveCount(0);

  await page.getByRole('checkbox', { name: /Ja, ich möchte mein Anbieterprofil/ }).check();
  await page.getByRole('button', { name: 'Profil löschen' }).click();
  await expect(page.getByText('Dein Anbieterprofil wurde gelöscht.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profil als Entwurf speichern' })).toBeVisible();
  // Gelöschte Profile verschwinden aus der Merkliste
  await visitor.goto('/konto/merkliste?art=anbieter');
  await expect(visitor.getByText('Noch keine Anbieter gemerkt')).toBeVisible();

  await moderator.context.close();
  await client.context.close();
  await provider.context.close();
});
