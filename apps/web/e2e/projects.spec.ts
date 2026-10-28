import { expect, test, type Page } from '@playwright/test';
import { becomeStaff, registerConfirmed } from './accounts';
import { expectNoHorizontalScroll, newPage } from './merchant';

/**
 * Phase 10, Projektaufträge: Eine Privatperson beschreibt ein Vorhaben und veröffentlicht es nach Bestätigung.
 * Ohne Anbieterprofil kann niemand antworten; eine Anbieterin mit Profil findet den Auftrag über die Filter und
 * antwortet über die Nachrichten. Ein Konto meldet den Auftrag, die Moderation blendet ihn aus.
 * Am Ende wird der Auftrag gelöscht, damit andere Specs nicht von Testdaten abhängen.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now();

/** Das sichtbare Filterformular (Smartphone: aufklappbar, Desktop: Seitenleiste) */
async function filters(page: Page) {
  // Ergebnisse und Filter kommen gestreamt – erst danach steht fest, ob die Filter eingeklappt sind
  await expect(page.locator('#projects-heading')).toBeVisible();
  const summary = page.locator('summary', { hasText: 'Filter' });
  const form = page.getByTestId('project-filters').filter({ visible: true });
  if (await summary.isVisible()) {
    await expect(async () => {
      if (!(await form.count())) await summary.click();
      await expect(form).toBeVisible({ timeout: 1_000 });
    }).toPass();
  }
  return form;
}

test('Übersicht /dienstleistungen/projekte grenzt Aufträge von Jobs ab und passt auf kleine Bildschirme', async ({ page }) => {
  await page.goto('/dienstleistungen/projekte');
  await expect(page.getByRole('heading', { level: 1, name: 'Projektaufträge' })).toBeVisible();
  await expect(page.getByText('Kein Jobangebot und keine Ausschreibung:')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Stellenangebote unter Jobs' })).toHaveAttribute('href', '/suche?bereich=jobs');
  await expectNoHorizontalScroll(page);
  // Von der Übersicht der Dienstleistungen erreichbar
  await page.goto('/dienstleistungen');
  await expect(page.getByRole('link', { name: /Zu den Projektaufträgen/ })).toHaveAttribute('href', '/dienstleistungen/projekte');
});

test('Projektauftrag beschreiben, finden, beantworten, melden und moderieren', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const tag = `${testInfo.project.name}-${run}`;
  const word = `Projekttest${run}${testInfo.project.name === 'mobile' ? 'm' : 'd'}`;
  const title = `E2E ${word} Stiegenhaus ausmalen`;
  const emails = {
    client: `e2e-pa-kunde-${tag}@example.at`,
    provider: `e2e-pa-anbieter-${tag}@example.at`,
    moderator: `e2e-pa-moderation-${tag}@example.at`,
  };

  // --- Auftraggeberin: Entwurf, Prüfung der Angaben, Veröffentlichen mit Bestätigung ---
  const owner = await newPage(browser, testInfo);
  const page = owner.page;
  await registerConfirmed(page, 'Rosa Rath', emails.client);
  await page.goto('/konto/projekte');
  await expect(page.getByText('Noch keine Aufträge')).toBeVisible();
  await page.getByRole('link', { name: 'Neuer Auftrag' }).click();
  await expect(page.getByText('Das ist ein Stellenangebot', { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const form = page.getByTestId('project-form');
  await form.getByLabel('Titel').fill(title);
  await form.getByRole('button', { name: 'Als Entwurf speichern' }).click();
  await expect(page.getByText('Bitte prüfe die markierten Felder.')).toBeVisible();
  await expect(form.getByLabel('Titel')).toHaveValue(title);

  await form.getByLabel('Beschreibung').fill('Unser Stiegenhaus im Altbau (drei Stockwerke) soll neu ausgemalt werden. Farbe stellen wir bei. Testauftrag aus der automatischen Prüfung.');
  await form.getByLabel('Kategorie').selectOption('maler');
  await form.getByLabel('PLZ und Ort').fill('8020');
  await page.getByRole('option', { name: /8020/ }).first().click();
  await form.getByRole('combobox', { name: 'Budget', exact: true }).selectOption('FIXED');
  await form.getByLabel('Betrag in €').fill('1200');
  await form.getByLabel('Zeitraum').fill('bis Ende November');
  await form.getByRole('button', { name: 'Als Entwurf speichern' }).click();
  await expect(page.getByText('Dein Projektauftrag ist gespeichert.')).toBeVisible();
  await expect(page.getByText('Entwurf', { exact: true }).first()).toBeVisible();
  const projectId = page.url().split('/').pop()!.split('?')[0]!;

  await page.getByRole('button', { name: /Für 30 Tage veröffentlichen/ }).click();
  await expect(page.getByText('Bitte bestätige zuerst.')).toBeVisible();
  await page.getByRole('checkbox', { name: /Es geht um eine selbstständige Leistung/ }).check();
  await page.getByRole('button', { name: /Für 30 Tage veröffentlichen/ }).click();
  await expect(page.getByText('Dein Projektauftrag ist veröffentlicht.', { exact: false })).toBeVisible();
  await expect(page.getByText('Sichtbar', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  // --- Anbieterin: ohne Profil kein Antworten, mit Profil schon ---
  const provider = await newPage(browser, testInfo);
  const visitor = provider.page;
  await registerConfirmed(visitor, 'Mia Malerin', emails.provider);
  await visitor.goto(`/dienstleistungen/projekte/${projectId}`);
  await expect(visitor.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(visitor.getByTestId('project-budget')).toHaveText(/Budget\s€\s1\.200\spauschal/);
  await expect(visitor.getByTestId('contact-reason')).toContainText('Anbieterprofil');
  await expectNoHorizontalScroll(visitor);

  await visitor.getByRole('link', { name: 'Anbieterprofil anlegen' }).click();
  await visitor.getByLabel('Überschrift').fill(`Malerarbeiten ${word}`);
  await visitor.getByLabel('Kurzbeschreibung').fill('Malerarbeiten in Graz und Umgebung, sauber und pünktlich.');
  await visitor.getByLabel('Ausführliche Beschreibung').fill('Ich male Wohnungen, Stiegenhäuser und Fassaden in Graz und Umgebung. Testprofil aus der automatischen Prüfung.');
  await visitor.getByRole('checkbox', { name: /^Maler/ }).check();
  await visitor.getByRole('checkbox', { name: /auch remote/ }).check();
  await visitor.getByLabel('Preisangabe').selectOption('ON_REQUEST');
  await visitor.getByRole('button', { name: 'Profil als Entwurf speichern' }).click();
  await expect(visitor.getByText('Dein Anbieterprofil ist gespeichert.')).toBeVisible();
  await visitor.getByRole('checkbox', { name: /Ich bestätige, dass die Angaben stimmen/ }).check();
  await visitor.getByRole('button', { name: 'Veröffentlichen' }).click();
  await expect(visitor.getByText('Dein Anbieterprofil ist jetzt unter „Dienstleistungen“ sichtbar.')).toBeVisible();

  // Suche über das Filterformular: Begriff und PLZ mit Umkreis
  await visitor.goto('/dienstleistungen/projekte');
  let filter = await filters(visitor);
  await filter.getByLabel('Suchbegriff').fill(word);
  await filter.getByLabel('PLZ').fill('8010');
  await filter.getByLabel('Umkreis').selectOption('10');
  await filter.getByRole('button', { name: 'Anzeigen' }).click();
  await expect(visitor).toHaveURL(/umkreis=10/);
  const card = visitor.getByTestId('project-card').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText('8020 Graz');
  await expect(visitor.getByRole('link', { name: 'Filter entfernen: 8010 Graz + 10 km' })).toBeVisible();
  await expectNoHorizontalScroll(visitor);
  // Wien liegt außerhalb, „nur remote“ passt nicht
  await visitor.goto(`/dienstleistungen/projekte?q=${word}&plz=1010&umkreis=10`);
  await expect(visitor.getByTestId('project-card')).toHaveCount(0);
  filter = await filters(visitor);
  await filter.getByLabel('PLZ').fill('');
  await filter.getByRole('checkbox', { name: /Nur remote/ }).check();
  await filter.getByRole('button', { name: 'Anzeigen' }).click();
  await expect(visitor).toHaveURL(/remote=ja/);
  await expect(visitor.getByText('Keine passenden Aufträge gefunden')).toBeVisible();

  // Antworten über die bestehenden Nachrichten
  await visitor.goto(`/dienstleistungen/projekte/${projectId}`);
  await visitor.getByLabel('Nachricht an Rosa Rath').fill('Guten Tag, ich könnte das Stiegenhaus Mitte November ausmalen. Wann darf ich es mir ansehen?');
  await visitor.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(visitor).toHaveURL(/\/nachrichten\/\w+/);
  await expect(visitor.getByRole('link', { name: new RegExp(`Projektauftrag: ${title}`) }).last()).toBeVisible();
  await expect(visitor.getByText('Stiegenhaus Mitte November', { exact: false }).last()).toBeVisible();

  // Auftraggeberin sieht die Anfrage
  await page.goto('/konto/projekte');
  await expect(page.locator('li', { hasText: title })).toContainText('1 Anfrage');
  await page.goto('/nachrichten');
  await expect(page.getByText(`Dein Projektauftrag: ${title}`).first()).toBeVisible();

  // --- Meldung und Moderation ---
  await visitor.goto(`/dienstleistungen/projekte/${projectId}`);
  await expect(visitor.getByRole('link', { name: 'Zur Unterhaltung' })).toBeVisible();
  await visitor.getByRole('link', { name: 'Auftrag melden' }).click();
  await expect(visitor.getByRole('heading', { level: 1, name: 'Projektauftrag melden' })).toBeVisible();
  await visitor.getByRole('radio', { name: /Irreführende Angaben/ }).check();
  await visitor.getByLabel('Begründung').fill('Das klingt nach einer Anstellung mit fixen Arbeitszeiten, bitte prüfen.');
  await visitor.getByRole('checkbox', { name: /nach bestem Wissen/ }).check();
  await visitor.getByRole('button', { name: 'Meldung senden' }).click();
  await expect(visitor).toHaveURL(new RegExp(`/dienstleistungen/projekte/${projectId}\\?hinweis=gemeldet`));
  await expect(visitor.getByText('Danke für deine Meldung.')).toBeVisible();

  const moderator = await newPage(browser, testInfo);
  await registerConfirmed(moderator.page, 'Mona Moderation', emails.moderator);
  await becomeStaff(moderator.page, emails.moderator, 'MODERATOR');
  const mod = moderator.page;
  await mod.goto(`/admin/dienstleistungen/projekte?q=${word}`);
  await expect(mod.getByRole('link', { name: 'Projektaufträge', exact: true })).toHaveAttribute('aria-current', 'page');
  const row = mod.locator('tr', { hasText: title });
  await expect(row).toContainText('1 Meldung(en)');
  await expectNoHorizontalScroll(mod);
  await row.getByRole('link').first().click();
  await expect(mod.getByRole('heading', { level: 2, name: title })).toBeVisible();
  await mod.getByRole('radio', { name: /Bis zur Prüfung ausblenden/ }).check();
  await mod.getByLabel('Begründung für die betroffene Person').fill('Der Auftrag wird geprüft, weil er möglicherweise ein Arbeitsverhältnis beschreibt.');
  await mod.getByRole('button', { name: /bestätigen/ }).click();
  await expect(mod.getByText('Die Entscheidung zum Projektauftrag ist gespeichert', { exact: false })).toBeVisible();
  await expectNoHorizontalScroll(mod);

  // Öffentlich weg, die Auftraggeberin sieht Begründung und Einspruch
  await visitor.goto(`/dienstleistungen/projekte?q=${word}`);
  await expect(visitor.getByTestId('project-card')).toHaveCount(0);
  await page.goto(`/konto/projekte/${projectId}`);
  await expect(page.getByText('Der Auftrag wird geprüft, weil er möglicherweise', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Begründung und Einspruch' })).toBeVisible();

  // --- Aufräumen ---
  await page.getByRole('checkbox', { name: 'Ja, ich möchte diesen Auftrag löschen.' }).check();
  await page.getByRole('button', { name: 'Auftrag löschen' }).click();
  await expect(page.getByText('Der Auftrag wurde gelöscht.')).toBeVisible();
  await visitor.goto('/konto/dienstleistungen');
  await visitor.getByRole('checkbox', { name: /Ja, ich möchte mein Anbieterprofil/ }).check();
  await visitor.getByRole('button', { name: 'Profil löschen' }).click();
  await expect(visitor.getByText('Dein Anbieterprofil wurde gelöscht.', { exact: false })).toBeVisible();

  await moderator.context.close();
  await provider.context.close();
  await owner.context.close();
});
