import { expect, injectContentScript, test, toolbar } from './fixtures';

test('the toolbar mounts in a shadow root and survives hostile page CSS', async ({ openFixture }) => {
  const page = await openFixture('control.html');
  const layoutBefore = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.getBoundingClientRect().height,
  }));

  await injectContentScript(page);

  // The page sets `button { display: none !important }` and a cursive font.
  // Neither crosses the shadow boundary.
  await expect(toolbar(page)).toBeVisible();
  await expect(toolbar(page).getByRole('button', { name: 'Audit' })).toBeVisible();
  const font = await toolbar(page)
    .getByRole('button', { name: 'Audit' })
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(font).not.toContain('Comic Sans');

  // And the page's own layout is untouched: no reflow, no scrollbars.
  const layoutAfter = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.getBoundingClientRect().height,
  }));
  expect(layoutAfter).toEqual(layoutBefore);
});

test('injecting twice re-attaches instead of stacking a second toolbar', async ({ openFixture }) => {
  const page = await openFixture('control.html');
  await injectContentScript(page);
  await injectContentScript(page);
  await expect(page.locator('thursday-root')).toHaveCount(1);
  await expect(toolbar(page)).toHaveCount(1);
});

test('the toolbar is a keyboard-operable toolbar widget', async ({ openFixture }) => {
  const page = await openFixture('control.html');
  await injectContentScript(page);

  await expect(toolbar(page)).toHaveAttribute('role', 'toolbar');
  await expect(toolbar(page)).toHaveAttribute('aria-label', 'Thursday');

  // Roving tabindex: exactly one stop, arrows move focus within the widget.
  const tabbable = await toolbar(page).locator('button[tabindex="0"]').count();
  expect(tabbable).toBe(1);

  await toolbar(page).locator('button[tabindex="0"]').focus();
  const first = await page.evaluate(
    () => document.querySelector('thursday-root')?.shadowRoot?.activeElement?.getAttribute('aria-label'),
  );
  await page.keyboard.press('ArrowRight');
  const second = await page.evaluate(
    () => document.querySelector('thursday-root')?.shadowRoot?.activeElement?.getAttribute('aria-label'),
  );
  expect(second).not.toBe(first);
});

test('dragging by the grip moves the toolbar and keeps it in the viewport', async ({ openFixture }) => {
  const page = await openFixture('control.html');
  await injectContentScript(page);

  const before = await toolbar(page).boundingBox();
  const grip = toolbar(page).locator('.grip');
  const gripBox = await grip.boundingBox();
  expect(gripBox).not.toBeNull();

  await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox!.x + 160, gripBox!.y + 220, { steps: 8 });
  await page.mouse.up();

  const after = await toolbar(page).boundingBox();
  expect(after!.y).toBeGreaterThan(before!.y + 100);

  // Dragged far off-screen, it clamps back rather than becoming unreachable.
  await page.mouse.move(after!.x + 10, after!.y + 10);
  await page.mouse.down();
  await page.mouse.move(9000, 9000, { steps: 4 });
  await page.mouse.up();
  const clamped = await toolbar(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(clamped!.x + clamped!.width).toBeLessThanOrEqual(viewport.width);
  expect(clamped!.y + clamped!.height).toBeLessThanOrEqual(viewport.height);
});

test('close removes every trace from the page', async ({ openFixture }) => {
  const page = await openFixture('control.html');
  await injectContentScript(page);
  await toolbar(page).getByRole('button', { name: 'Close Thursday' }).click();
  await expect(page.locator('thursday-root')).toHaveCount(0);
  const leftovers = await page.evaluate(() =>
    [...document.documentElement.querySelectorAll('*')].filter((element) =>
      element.tagName.toLowerCase().startsWith('thursday'),
    ).length,
  );
  expect(leftovers).toBe(0);
});

test('the toolbar does not leak its events into the page', async ({ openFixture }) => {
  // Events fired inside a shadow root retarget to the host and keep bubbling,
  // so without containment the page sees every click on our own UI -- closing
  // its menus, firing its analytics, stealing its keyboard shortcuts.
  const page = await openFixture('control.html');
  await injectContentScript(page);
  await page.evaluate(() => {
    (globalThis as unknown as { seen: string[] }).seen = [];
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown']) {
      document.addEventListener(type, () => {
        (globalThis as unknown as { seen: string[] }).seen.push(type);
      });
    }
  });

  await toolbar(page).locator('.grip').click();
  await toolbar(page).getByRole('button', { name: 'Settings' }).click();
  await toolbar(page).locator('button[tabindex="0"]').focus();
  await page.keyboard.press('ArrowRight');

  expect(await page.evaluate(() => (globalThis as unknown as { seen: string[] }).seen)).toEqual([]);
});
