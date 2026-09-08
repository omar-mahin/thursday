import { expect, panelReady, testWithHostAccess as test } from './fixtures';

/**
 * The window the panel lives in.
 *
 * Everything here is about the frame rather than the panel inside it: that it
 * mounts, that it can be moved and resized, that it remembers where it was
 * put, and -- the reason this file exists -- that it says something useful when
 * the panel will not load.
 *
 * That last one is not hypothetical. The resource was declared with
 * `use_dynamic_url`, which makes the address `chrome.runtime.getURL()` returns
 * unloadable from a page, and the panel came up as Chrome's grey "This page has
 * been blocked" screen inside Thursday's own window: no explanation, no way
 * out, and nothing to say which half was broken. Every test passed at the time,
 * because the failure only appears in a real browser.
 */

test('the panel mounts as a movable, resizable window on the page', async ({ openFixture, activate }) => {
  const page = await openFixture('cro.html');
  await page.setViewportSize({ width: 1200, height: 900 });
  await activate(page);
  await panelReady(page);

  const frame = page.locator('thursday-root .pf-root');
  const before = (await frame.boundingBox())!;
  expect(before.width).toBeGreaterThanOrEqual(300);

  /*
   * Resized first, then moved.
   *
   * The corner handle is at the panel's bottom-right, and the panel starts at
   * the bottom-right of the window -- so dragging the whole thing first puts
   * the handle somewhere the pointer cannot reach it.
   */
  const corner = page.locator('thursday-root .pf-resize');
  const handle = (await corner.boundingBox())!;
  await page.mouse.move(handle.x + 8, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + 60, handle.y + 40, { steps: 6 });
  await page.mouse.up();
  const resized = (await frame.boundingBox())!;
  expect(resized.width, 'the panel did not widen').toBeGreaterThan(before.width + 20);

  // Then dragged by its bar.
  const bar = page.locator('thursday-root .pf-bar');
  const grip = (await bar.boundingBox())!;
  await page.mouse.move(grip.x + 40, grip.y + 10);
  await page.mouse.down();
  await page.mouse.move(grip.x - 200, grip.y - 80, { steps: 8 });
  await page.mouse.up();
  const moved = (await frame.boundingBox())!;
  expect(moved.x, 'the panel did not move left').toBeLessThan(resized.x - 100);

  // Collapsed to its bar, and back.
  await page.locator('thursday-root .pf-btn').first().click();
  await expect(page.locator('thursday-root iframe.pf-frame')).toBeHidden();
  await page.locator('thursday-root .pf-btn').first().click();
  await expect(page.locator('thursday-root iframe.pf-frame')).toBeVisible();
});

test('the panel comes back where it was left', async ({ openFixture, activate }) => {
  const page = await openFixture('cro.html');
  await page.setViewportSize({ width: 1200, height: 900 });
  await activate(page);
  await panelReady(page);

  const bar = (await page.locator('thursday-root .pf-bar').boundingBox())!;
  await page.mouse.move(bar.x + 40, bar.y + 10);
  await page.mouse.down();
  await page.mouse.move(bar.x - 250, bar.y - 100, { steps: 8 });
  await page.mouse.up();
  const placed = (await page.locator('thursday-root .pf-root').boundingBox())!;

  // A fresh page, so the geometry can only have come out of storage.
  const again = await openFixture('cro.html');
  await again.setViewportSize({ width: 1200, height: 900 });
  await activate(again);
  await panelReady(again);
  const remembered = (await again.locator('thursday-root .pf-root').boundingBox())!;

  expect(Math.abs(remembered.x - placed.x)).toBeLessThan(3);
  expect(Math.abs(remembered.y - placed.y)).toBeLessThan(3);
});

test('a panel that will not load says so, and offers a way out', async ({ openFixture, activate }) => {
  const page = await openFixture('cro.html');
  await activate(page);
  await panelReady(page);

  /*
   * The failure, forced.
   *
   * Pointing the frame at a resource that cannot load is the same situation a
   * blocked extension URL produces, and it is the only way to reach that state
   * on purpose: the real cause was a manifest setting whose effect does not
   * reproduce in this browser.
   */
  await page.evaluate(() => {
    const frame = document
      .querySelector('thursday-root')
      ?.shadowRoot?.querySelector('iframe.pf-frame') as HTMLIFrameElement | null;
    if (frame) frame.src = 'chrome-extension://invalid/nothing-here.html';
  });

  const trouble = page.locator('thursday-root .pf-trouble');
  await expect(trouble).toBeVisible({ timeout: 20_000 });
  await expect(trouble).toContainText('could not load inside this page');
  // And the iframe is out of the way rather than showing a grey error screen
  // next to the explanation of it.
  await expect(page.locator('thursday-root iframe.pf-frame')).toBeHidden();

  // The way out opens the panel as its own tab, which needs no frame at all.
  const opened = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByRole('button', { name: 'Open the panel in a tab' }).click(),
  ]).then(([tab]) => tab);
  await opened.waitForLoadState();
  expect(opened.url()).toMatch(/\/panel\.html$/);
  await expect(opened.getByRole('button', { name: 'Full audit' })).toBeVisible();
});
