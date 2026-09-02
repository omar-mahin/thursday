import { expect, FIXTURE_ORIGIN, injectContentScript, test, toolbar } from './fixtures';

/**
 * Guard 4 (PLAN.md section 7). The zero-network claim is the product's main
 * promise, so it gets a runtime test rather than a code review.
 *
 * Every request the browser makes during a full exercise of the extension must
 * be either the locally-fulfilled fixture page or an internal extension URL.
 */
test('the extension makes no network requests at all', async ({ context, extensionId, requests, openFixture }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByText('Not running', { exact: true })).toBeVisible();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('heading', { name: 'Thursday' })).toBeVisible();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel('Minimum touch target in CSS pixels').fill('48');

  const page = await openFixture('control.html');
  await injectContentScript(page);
  await toolbar(page).locator('button[tabindex="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await toolbar(page).getByRole('button', { name: 'Close Thursday' }).click();

  const offenders = requests.filter(
    (url) => !url.startsWith(`${FIXTURE_ORIGIN}/`) && !url.startsWith('chrome-extension://'),
  );
  expect(offenders, `unexpected requests:\n${offenders.join('\n')}`).toEqual([]);
});
