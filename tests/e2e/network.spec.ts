import { resolve } from 'node:path';
import {
  FIXTURE_ORIGIN,
  expect,
  injectContentScript,
  openMore,
  panelOf,
  panelReady,
  test,
  testWithHostAccess,
  toolbar,
  withoutPicker,
} from './fixtures';

/**
 * Guard 4 (PLAN.md section 7). The zero-network claim is the product's main
 * promise, so it gets a runtime test rather than a code review.
 *
 * Every request the browser makes during a full exercise of the extension must
 * be either the locally-fulfilled fixture page or an internal extension URL.
 */
test('the extension makes no network requests at all', async ({ context, extensionId, requests, openFixture }) => {
  // The panel document on its own, before any page: the point here is that
  // loading every surface asks the network for nothing.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
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

/**
 * The same claim across everything Sprint 5 added: storing audits, reading a
 * file from disk, writing one out, and rendering a report. These are the
 * surfaces where a "just sync it" or "just fetch the logo" would be easiest to
 * slip in, so they are exercised explicitly rather than covered by inference.
 */
testWithHostAccess(
  'storing, exporting and reopening audits makes no network requests either',
  async ({ context, extensionId, requests, openFixture, activate }) => {
    await withoutPicker(context);
    const page = await openFixture('accessibility.html');
    await activate(page);
    await panelReady(page);
    const panel = panelOf(page);

    // Run, triage, store.
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.detail')).toBeVisible();
    await panel.locator('.detail').getByRole('button', { name: 'Add to report' }).click();
    await panel.locator('.detail-note textarea').fill('A note that stays on this machine');
    await openMore(page);
    await expect(panel.locator('.history-row').first()).toBeVisible();

    // Write both file formats.
    // Saving and opening live behind the panel's disclosure now.
    await openMore(page);
    await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save audit' }).click(),
    ]);
    await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save report' }).click(),
    ]);

    // Read one back in.
    await panel.getByLabel('Open a saved audit file').setInputFiles(resolve('tests/fixtures/sample.thursday.json'));
    await expect(panel.locator('.notice')).toContainText('Opened from a file');

    // Re-audit, so the comparison path runs too.
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    // Reopen from history, and inspect storage usage in options.
    await panel.locator('.history-open').first().click();
    await expect(panel.locator('.notice')).toContainText('Reopened from history');

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator('.origins li').first()).toBeVisible();

    /*
     * `blob:chrome-extension://<this extension>/...` is allowed, and only that.
     *
     * The browser reports loading an object URL as a request, and the panel
     * makes them: a comment's attached image and a screenshot crop are shown
     * from `URL.createObjectURL`. A blob URL on our own origin is a handle to
     * memory in this page -- there is no fetch, no socket and nowhere for it to
     * go. The exemption is written narrowly on purpose, so a blob URL belonging
     * to any other origin would still fail this test.
     */
    const ownBlob = `blob:chrome-extension://${extensionId}/`;
    const offenders = requests.filter(
      (url) =>
        !url.startsWith(`${FIXTURE_ORIGIN}/`) &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith(ownBlob),
    );
    expect(offenders, `unexpected requests:\n${offenders.join('\n')}`).toEqual([]);
  },
);
