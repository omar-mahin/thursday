import { expect, testWithHostAccess as test, toolbar } from './fixtures';

/**
 * The full Sprint 2 slice: pick an element on the page, read its measured facts
 * in the panel, then jump back to it -- across a reload, so the resolution
 * ladder is exercised for real rather than reusing a live DOM handle.
 */
test('selecting an element shows its measured facts in the panel', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const page = await openFixture('inspect.html');
  await activate(page);

  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Assertions about a tab's rendering need that tab in front: Chrome does not
  // lay out background tabs.
  await expect(panel.getByText('Connected', { exact: true })).toBeVisible();
  // A panel opened after activation still learns which page it is looking at.
  await expect(panel.getByText('fixture.thursday.test', { exact: true })).toBeVisible();

  // Pick the primary CTA on the page.
  await page.bringToFront();
  await toolbar(page).getByRole('button', { name: 'Select' }).click();
  const target = (await page.getByTestId('primary-cta').boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  // The panel follows the user to the element it was just handed.
  await panel.bringToFront();
  await expect(panel.getByRole('tab', { name: /Element/ })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByText('button#start-trial')).toBeVisible();

  const identity = panel.locator('[data-card="identity"]');
  await expect(identity).toContainText('Start free trial');
  await expect(identity).toContainText('text content');

  // The header badge rounds; the Box card keeps sub-pixel precision, because a
  // fractional width is itself a finding a designer wants to see.
  await expect(panel.locator('#panel-element .badge')).toHaveText(
    `${Math.round(target.width)} × ${Math.round(target.height)}`,
  );
  const tenth = (value: number): number => Math.round(value * 10) / 10;
  const box = panel.locator('[data-card="box"]');
  await expect(box).toContainText(`${tenth(target.width)} × ${tenth(target.height)}`);

  const type = panel.locator('[data-card="type"]');
  await expect(type).toContainText('700');

  const reference = panel.locator('[data-card="reference"]');
  await expect(reference).toContainText('data-testid="primary-cta"');
});

test('the panel can find the element again after a reload', async ({ openFixture, activate, extensionId }) => {
  const page = await openFixture('inspect.html');
  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.bringToFront();

  await toolbar(page).getByRole('button', { name: 'Select' }).click();
  const target = (await page.getByTestId('primary-cta').boundingBox())!;
  await page.mouse.move(target.x + 5, target.y + 5);
  await page.mouse.down();
  await page.mouse.up();
  await panel.bringToFront();
  await expect(panel.getByText('button#start-trial')).toBeVisible();

  // Reload: the live handle is gone, so "Show on page" must re-find it.
  await page.reload();
  await activate(page);
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Show on page' }).click();

  // Level 2 of the ladder: the element carries a data-testid.
  await expect(panel.getByText('found by test attribute')).toBeVisible();
  await expect(page.locator('thursday-root .hl-box')).toBeVisible();
});

test('the panel admits when a selected element is gone', async ({ openFixture, activate, extensionId }) => {
  const page = await openFixture('inspect.html');
  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.bringToFront();

  await toolbar(page).getByRole('button', { name: 'Select' }).click();
  const target = (await page.getByTestId('primary-cta').boundingBox())!;
  await page.mouse.move(target.x + 5, target.y + 5);
  await page.mouse.down();
  await page.mouse.up();

  // Remove the element and everything that could identify it.
  await page.evaluate(() => document.querySelector('[data-testid="primary-cta"]')?.remove());
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Show on page' }).click();

  await expect(panel.getByText('This element is no longer on the page.')).toBeVisible();
});

test('hovering during selection streams a live readout to the panel', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const page = await openFixture('inspect.html');
  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.bringToFront();

  await toolbar(page).getByRole('button', { name: 'Select' }).click();
  const target = (await page.getByRole('link', { name: 'Pricing' }).boundingBox())!;
  await page.mouse.move(target.x + 2, target.y + 2);
  // Wait for the on-page overlay first: backgrounding a tab pauses its
  // requestAnimationFrame, so switching too early can drop the hover tick.
  await expect(page.locator('thursday-root .hl-box')).toBeVisible();

  await panel.bringToFront();
  const readout = panel.locator('.card[data-selecting="true"]');
  await expect(readout).toContainText('Selecting');
  await expect(readout).toContainText('link');
  await expect(readout).toContainText('Pricing');
});
