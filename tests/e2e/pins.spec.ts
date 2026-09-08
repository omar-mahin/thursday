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
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  /*
   * Wait for the screenshot sweep before touching the page.
   *
   * An audit photographs its findings, which means scrolling the page for a
   * few seconds and then putting it back. A test that scrolls during that gets
   * its scroll undone by the restore -- which is exactly what happened here:
   * the pin was correct and then the page went back to the top underneath it.
   *
   * Worth being clear that this is the product's behaviour, not a test
   * workaround. Thursday moves the page for a moment after an audit, and
   * anything that reads scroll position has to let it finish.
   */
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });
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
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
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

test('a pin keeps its severity colour under the pointer', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  /*
   * A pin is a coloured disc with a white number on it, and the colour is the
   * severity. It used to lose that colour on hover: the toolbar's generic
   * button:hover rule is a type plus two pseudo-classes, which outranks the
   * class-plus-attribute selector the fills were written with -- so the disc
   * turned pale grey and the white ordinal on it became unreadable, exactly
   * when somebody was about to click it.
   *
   * Found by looking at a screenshot with the pointer resting where it had
   * just clicked, which is where a pointer usually is.
   */
  const { page } = await auditFrom(openFixture, activate, extensionId, 'accessibility.html');
  await page.bringToFront();
  const pin = pins(page).first();
  await expect(pin).toBeVisible();

  const before = await pin.evaluate((node) => getComputedStyle(node).backgroundColor);
  await pin.hover();
  const after = await pin.evaluate((node) => getComputedStyle(node).backgroundColor);

  expect(after).toBe(before);
  // And it is a real severity fill rather than a default or a hover grey.
  expect(after).not.toBe('rgba(0, 0, 0, 0)');
  expect(after).toMatch(/^rgb\(/);
});
