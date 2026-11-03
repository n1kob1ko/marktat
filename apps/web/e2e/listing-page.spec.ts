import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContextOptions, type TestInfo } from '@playwright/test';
import { publishBike, registerConfirmed } from './accounts';

/** Anzeigenseite: Karte mit ungefährem Standort, weitere Anzeigen des Anbieters und ähnliche in der Nähe */
test.describe.configure({ mode: 'serial' });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function contextOptions(testInfo: TestInfo): BrowserContextOptions {
  const {
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    locale,
    timezoneId,
    baseURL,
  } = testInfo.project.use;
  return {
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    locale,
    timezoneId,
    baseURL,
  };
}

test('Karte, mehr vom Anbieter und ähnliche Anzeigen in der Nähe', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}-${Date.now()}`;

  const sellerContext = await browser.newContext(contextOptions(testInfo));
  const seller = await sellerContext.newPage();
  await registerConfirmed(seller, 'Sina Seitenblick', `e2e-seite-a-${tag}@example.at`);
  const mainUrl = await publishBike(seller, `E2E Hauptrad ${tag}`);
  await publishBike(seller, `E2E Zweitrad ${tag}`);

  const otherContext = await browser.newContext(contextOptions(testInfo));
  const other = await otherContext.newPage();
  await registerConfirmed(other, 'Otto Umgebung', `e2e-seite-b-${tag}@example.at`);
  await publishBike(other, `E2E Nachbarrad ${tag}`);

  await other.goto(mainUrl);
  // Ungefährer Standort ohne Kartendienst
  await expect(
    other.getByRole('img', { name: /ungefähren Standort 8010 Graz, Steiermark/ }),
  ).toBeVisible();
  await expect(other.getByText('Ungefährer Standort:')).toContainText('8010 Graz');
  await expect(other.getByRole('link', { name: /In OpenStreetMap ansehen/ })).toHaveAttribute(
    'href',
    /openstreetmap\.org\/#map=13\/47\.\d+\/15\.\d+/,
  );

  const fromSeller = other.getByRole('region', { name: 'Mehr von Sina Seitenblick' });
  await expect(fromSeller.getByRole('link', { name: `E2E Zweitrad ${tag}` })).toBeVisible();
  await expect(fromSeller.getByRole('link', { name: `E2E Hauptrad ${tag}` })).toHaveCount(0);

  const similar = other.getByRole('region', { name: 'Ähnliche Anzeigen in der Nähe' });
  await expect(similar.getByRole('link', { name: `E2E Nachbarrad ${tag}` })).toBeVisible();
  // Eigene weitere Anzeigen stehen nur unter „Mehr von“
  await expect(similar.getByRole('link', { name: `E2E Zweitrad ${tag}` })).toHaveCount(0);

  await other.waitForLoadState('networkidle').catch(() => undefined);
  const overflow = await other.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'seitliches Scrollen').toBeLessThanOrEqual(0);
  const { violations } = await new AxeBuilder({ page: other }).withTags(TAGS).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await sellerContext.close();
  await otherContext.close();
});
