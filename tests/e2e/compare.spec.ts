import { expect, openMore, panelReady, testWithHostAccess as test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Re-auditing a page and seeing what moved.
 *
 * The comparison is a pure function with its own unit tests; what these check
 * is that the panel actually feeds it the right two sets -- the audit the user
 * was looking at, with their triage applied, against the fresh one.
 */
/**
 * The panel as it ships: floating on the page being audited.
 *
 * Not a second panel document -- with the panel mounted on every activated
 * page, a second one is a second panel, and pressing Audit made both of them
 * run an audit.
 */
const openPanel = (page: Page): Promise<Page> => panelReady(page);

test('re-auditing an unchanged page reports nothing fixed and nothing new', async ({
  openFixture,
  activate,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(page);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  const before = await panel.locator('.finding-row').count();

  await panel.getByRole('button', { name: 'Full audit' }).click();
  // The comparison lives behind the panel's disclosure now.
  await openMore(page);
  await expect(panel.locator('.compare')).toBeVisible();

  // The comparison lives behind the panel's disclosure now.
  await openMore(page);
  await expect(panel.locator('.compare')).toContainText('Nothing changed.');
  await expect(panel.locator('.diff-totals li[data-kind="fixed"]')).toHaveText('0 fixed');
  await expect(panel.locator('.diff-totals li[data-kind="new"]')).toHaveText('0 new');
  expect(await panel.locator('.finding-row').count()).toBe(before);
});

test('fixing the page in place is reported as fixed', async ({
  openFixture,
  activate,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(page);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();

  // Give every unlabelled image alt text and every unlabelled control a label:
  // a real fix, made the way a developer would make it.
  const fixed = await page.evaluate(() => {
    let changed = 0;
    for (const image of document.querySelectorAll('img:not([alt])')) {
      image.setAttribute('alt', 'A descriptive alternative text for this image');
      changed += 1;
    }
    return changed;
  });
  expect(fixed).toBeGreaterThan(0);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  // The comparison lives behind the panel's disclosure now.
  await openMore(page);
  await expect(panel.locator('.compare')).toBeVisible();

  const fixedCount = await panel.locator('.diff-totals li[data-kind="fixed"]').innerText();
  expect(Number.parseInt(fixedCount, 10)).toBeGreaterThanOrEqual(fixed);
  // The comparison lives behind the panel's disclosure now.
  await openMore(page);
  await expect(panel.locator('.compare')).toContainText('the page improved');

  // A fixed finding is listed but not clickable: it no longer exists, so there
  // is nothing to open and nothing to pin.
  await expect(panel.locator('.diff-list li[data-kind="fixed"]').first()).toBeVisible();
  await expect(panel.locator('.diff-list li[data-kind="fixed"] button')).toHaveCount(0);
});

test('breaking the page in place is reported as new', async ({
  openFixture,
  activate,
}) => {
  const page = await openFixture('control.html');
  await activate(page);
  const panel = await openPanel(page);

  // The control page is clean, so the first audit is the clean baseline.
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.getByText(/Nothing found in/)).toBeVisible();

  await page.evaluate(() => {
    const image = document.createElement('img');
    image.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    image.width = 400;
    image.height = 300;
    document.body.append(image);
  });

  await panel.getByRole('button', { name: 'Full audit' }).click();
  // The comparison lives behind the panel's disclosure now.
  await openMore(page);
  await expect(panel.locator('.compare')).toBeVisible();
  await expect(panel.locator('.diff-totals li[data-kind="new"]')).not.toHaveText('0 new');
  // The comparison lives behind the panel's disclosure now.
  await openMore(page);
  await expect(panel.locator('.compare')).toContainText('more to look at than last time');

  // A new finding can be opened straight from the comparison.
  await panel.locator('.diff-list li[data-kind="new"] button').first().click();
  await expect(panel.locator('.detail')).toBeVisible();
});

test('a dismissed finding stays dismissed through a re-audit', async ({
  openFixture,
  activate,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(page);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.detail').first()).toBeVisible();

  const title = await panel.locator('.detail-title').innerText();
  await panel.locator('.detail').getByRole('button', { name: 'Dismiss' }).click();
  await expect(panel.locator('.finding-row', { hasText: title })).toHaveCount(0);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  // The comparison lives behind the panel's disclosure now.
  await openMore(page);
  await expect(panel.locator('.compare')).toBeVisible();

  // Re-running the audit must not resurrect what the user already triaged: the
  // finding is absent from the open list, and counted among the closed ones.
  await expect(panel.locator('.finding-row', { hasText: title })).toHaveCount(0);
  await expect(panel.locator('.closed-toggle')).toContainText('dismissed or resolved');

  // Revealed on request, still marked closed.
  await panel.locator('.closed-toggle input').check();
  const revealed = panel.locator('.finding-row', { hasText: title }).first();
  if ((await revealed.count()) === 0) {
    // Repeats of one rule collapse into a group; open the one that holds it.
    await panel.locator('.finding.group > button').first().click();
  }
  await expect(panel.locator('.finding-row', { hasText: title }).first()).toBeVisible();
  await expect(panel.locator('.finding-row', { hasText: title }).first()).toHaveAttribute(
    'data-status',
    'dismissed',
  );
});

test('the comparison can be dismissed without losing the audit', async ({
  openFixture,
  activate,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(page);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Full audit' }).click();
  // The comparison lives behind the panel's disclosure now.
  await openMore(page);
  await expect(panel.locator('.compare')).toBeVisible();

  await panel.locator('.compare').getByRole('button', { name: 'Hide the comparison' }).click();
  // The comparison lives behind the panel's disclosure now.
  await openMore(page);
  await expect(panel.locator('.compare')).toHaveCount(0);
  await expect(panel.locator('.finding-row').first()).toBeVisible();
});
