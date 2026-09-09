import { exchange, expect, openMore, panelOf, panelReady, testWithHostAccess as test, withoutPicker } from './fixtures';
import type { PageSnapshot } from '../../src/shared/types';

/**
 * What the audit could not look at.
 *
 * Frames are enumerated and never entered, so a page assembled out of iframes
 * gets a thin audit. That is a defensible limit and an indefensible silence:
 * without the count, a page whose content is all inside frames reads as a clean
 * page. So the number is measured, carried on the audit, and stated in both the
 * panel and the report.
 */
test('frames are counted, and the ones that loaded nothing are not', async ({
  openFixture,
  activate,
  context,
  extensionId,
}) => {
  await withoutPicker(context);
  const page = await openFixture('frames.html');
  await activate(page);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);

  const snapshot = await exchange<{ payload: PageSnapshot }>(
    panel,
    { type: 'REQUEST_SNAPSHOT', payload: { includeOffscreen: true } },
    'SNAPSHOT_READY',
  ).then((message) => message.payload);

  // Two cross-origin, one same-origin. `about:blank` and a frame with no src
  // loaded nothing, so there is no coverage to have missed.
  expect(snapshot.crossOriginFrames).toBe(2);
  expect(snapshot.sameOriginFrames).toBe(1);
});

test('the panel says what it could not look inside', async ({
  openFixture,
  activate,
  context,
  extensionId,
}) => {
  await withoutPicker(context);
  const page = await openFixture('frames.html');
  await activate(page);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();

  await expect(panel.locator('.panel-body')).toContainText('3 embedded frames (2 from another origin)');
  await expect(panel.locator('.panel-body')).toContainText('not looked inside');
});

test('the report repeats the limit rather than implying full coverage', async ({
  openFixture,
  activate,
  context,
}) => {
  await withoutPicker(context);
  const page = await openFixture('frames.html');
  await activate(page);
  await panelReady(page);
  const panel = panelOf(page);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();

  // Save lives behind the panel's disclosure now.
  await openMore(page);
  const download = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save report' }).click(),
  ]).then(([event]) => event);

  const html = await import('node:fs').then(async (fs) => fs.readFileSync(await download.path(), 'utf8'));
  expect(html).toContain('enumerated but not looked inside');
  expect(html).toContain('3 embedded frames');
});

test('a page with no frames says nothing about frames', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  // A caveat that appears on every page stops being read.
  await withoutPicker(context);
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  await expect(panel.locator('.panel-body')).not.toContainText('not looked inside');
});
