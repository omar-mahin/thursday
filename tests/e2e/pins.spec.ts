import { expect, testWithHostAccess as test } from './fixtures';

const pins = (page: import('@playwright/test').Page) => page.locator('thursday-root .pin');

async function auditFrom(
  openFixture: (name: string) => Promise<import('@playwright/test').Page>,
  activate: (page: import('@playwright/test').Page) => Promise<void>,
  extensionId: string,
  fixture: string,
) {
  const page = await openFixture(fixture);
  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  return { page, panel };
}

test('an audit draws numbered pins over the elements it found', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const { page, panel } = await auditFrom(openFixture, activate, extensionId, 'accessibility.html');

  await expect(pins(page).first()).toBeVisible();
  const count = await pins(page).count();
  expect(count).toBeGreaterThan(2);

  // Numbering matches the panel: pin 1 is the first listed finding with an element.
  await expect(pins(page).first()).toHaveText('1');
  await expect(panel.locator('.finding-row .row-pin').first()).toHaveText('1');

  // Severity is carried through to the pin, so the page is readable at a glance.
  const severities = await pins(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-severity')),
  );
  expect(new Set(severities).size).toBeGreaterThan(0);
  expect(severities.every((severity) => severity !== null)).toBe(true);
});

test('pins do not touch the page layout', async ({ openFixture, activate, extensionId }) => {
  const page = await openFixture('accessibility.html');
  const before = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    body: document.body.getBoundingClientRect().height,
  }));

  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await page.bringToFront();
  await expect(pins(page).first()).toBeVisible();

  const after = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    body: document.body.getBoundingClientRect().height,
  }));
  expect(after).toEqual(before);
});

test('pins follow the page when it scrolls, and hide when their element leaves', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const { page } = await auditFrom(openFixture, activate, extensionId, 'cro.html');
  await page.bringToFront();

  // cro.html puts its buttons 1400px down, so nothing is pinned on screen yet.
  await expect(pins(page).first()).toBeHidden();

  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect(pins(page).first()).toBeVisible();

  const target = (await page.getByRole('button', { name: 'Start free trial' }).boundingBox())!;
  const pin = (await pins(page).first().boundingBox())!;
  // The pin sits at the element's top-left corner, within half a pin's width.
  expect(Math.abs(pin.x - target.x)).toBeLessThan(16);
  expect(Math.abs(pin.y - target.y)).toBeLessThan(16);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(pins(page).first()).toBeHidden();
});

test('clicking a pin opens that finding in the panel', async ({ openFixture, activate, extensionId }) => {
  const { page, panel } = await auditFrom(openFixture, activate, extensionId, 'accessibility.html');
  await page.bringToFront();

  // Take the third pin, so the assertion is not satisfied by the default selection.
  const third = pins(page).nth(2);
  const label = await third.getAttribute('aria-label');
  await third.click();

  await panel.bringToFront();
  const ordinal = label!.match(/Finding (\d+)/)![1];
  await expect(panel.locator('.detail-pin')).toHaveText(ordinal!);
  await expect(panel.locator('.finding-row[data-selected="true"] .row-pin')).toHaveText(ordinal!);
});

test('the open finding stands out on the page', async ({ openFixture, activate, extensionId }) => {
  const { page, panel } = await auditFrom(openFixture, activate, extensionId, 'accessibility.html');
  await expect(panel.locator('.finding-row[data-selected="true"]')).toBeVisible();

  await page.bringToFront();
  await expect(pins(page).locator('[data-active="true"]').or(page.locator('.pin[data-active="true"]')).first()).toHaveCount(1);
});

test('pins disappear when Thursday is switched off', async ({ openFixture, activate, extensionId }) => {
  const { page, panel } = await auditFrom(openFixture, activate, extensionId, 'accessibility.html');
  await page.bringToFront();
  await expect(pins(page).first()).toBeVisible();

  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('thursday-root')).toHaveCount(0);
});
