import {
  expect,
  highlightBox,
  testWithHostAccess as test,
  toolbar,
} from './fixtures';

test('hovering marks the element under the pointer and reports its size', async ({
  openFixture,
  activate,
}) => {
  /*
   * Select shows the ruler, so the mark is the ruler's dashed outline and the
   * size is a chip in its bar. The plain highlight box is still what Comment
   * mode draws -- one outline, not two -- and has its own test in ruler.spec.
   */
  const page = await openFixture('inspect.html');
  await activate(page);

  await toolbar(page).getByRole('button', { name: 'Select' }).click();
  await expect(toolbar(page).getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');

  const cta = page.getByTestId('primary-cta');
  const target = (await cta.boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);

  const outline = page.locator('thursday-root .rl-outline');
  await expect(outline).toHaveAttribute('data-on', 'true');
  await expect(page.locator('thursday-root .rl-hud')).toContainText(
    `${Math.round(target.width)}×${Math.round(target.height)}`,
  );

  // The overlay tracks the element, not the pointer.
  const box = (await outline.boundingBox())!;
  expect(Math.abs(box.x - target.x)).toBeLessThan(2);
  expect(Math.abs(box.y - target.y)).toBeLessThan(2);
  expect(Math.abs(box.width - target.width)).toBeLessThan(2);
});

test('the page cannot react to the pointer while selection is active', async ({ openFixture, activate }) => {
  const page = await openFixture('inspect.html');
  await activate(page);
  // Anchors would navigate; the click must never reach them.
  await page.evaluate(() => {
    (globalThis as unknown as { clicks: number }).clicks = 0;
    document.addEventListener('click', () => {
      (globalThis as unknown as { clicks: number }).clicks += 1;
    });
  });

  await toolbar(page).getByRole('button', { name: 'Select' }).click();
  const cta = page.getByTestId('primary-cta');
  const target = (await cta.boundingBox())!;
  await page.mouse.move(target.x + 5, target.y + 5);
  await page.mouse.click(target.x + 5, target.y + 5);

  expect(await page.evaluate(() => (globalThis as unknown as { clicks: number }).clicks)).toBe(0);
  expect(page.url()).toContain('inspect.html');
});

test('Escape cancels selection and restores the page cursor', async ({ openFixture, activate }) => {
  const page = await openFixture('inspect.html');
  await activate(page);

  await toolbar(page).getByRole('button', { name: 'Select' }).click();
  expect(await page.evaluate(() => document.documentElement.style.cursor)).toBe('crosshair');

  await page.keyboard.press('Escape');
  await expect(toolbar(page).getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false');
  await expect(highlightBox(page)).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.style.cursor)).toBe('');
});

test('right-clicking cancels instead of selecting', async ({ openFixture, activate }) => {
  const page = await openFixture('inspect.html');
  await activate(page);
  await toolbar(page).getByRole('button', { name: 'Select' }).click();

  const target = (await page.getByTestId('primary-cta').boundingBox())!;
  await page.mouse.move(target.x + 5, target.y + 5);
  await page.mouse.click(target.x + 5, target.y + 5, { button: 'right' });

  await expect(toolbar(page).getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false');
});

test('the extension never selects its own toolbar', async ({ openFixture, activate }) => {
  const page = await openFixture('inspect.html');
  await activate(page);
  await toolbar(page).getByRole('button', { name: 'Select' }).click();

  const own = (await toolbar(page).boundingBox())!;
  await page.mouse.move(own.x + own.width / 2, own.y + own.height / 2);
  await expect(highlightBox(page)).toBeHidden();
});
