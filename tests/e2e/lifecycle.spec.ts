import { expect, test, testWithHostAccess, toolbar } from './fixtures';

/**
 * Starting, stopping, restarting and refusing.
 *
 * These paths are where the cost of asking for no host permissions shows up:
 * a reload drops everything, and a browser page cannot be audited at all. Both
 * are deliberate, and both have to read as a state the user understands rather
 * than as the tool being broken (PLAN.md section 11).
 */

test('a page the browser withholds is refused up front, with the reason', async ({
  context,
  extensionId,
}) => {
  // Chrome does not hand an extension the URL of its own pages, and activeTab
  // is not granted on them either -- which is exactly the state the popup is in
  // here. The right behaviour is to say so and disable the button, rather than
  // offering an Activate that will fail.
  //
  // Note what this cannot cover: the popup's *successful* path depends on the
  // activeTab grant that comes from clicking the browser action, and Playwright
  // cannot click browser chrome. That path is verified by hand.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(popup.getByText('The browser will not give extensions access to this page.')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Activate on this page' })).toBeDisabled();
  // Stated before the user tries, not as an error afterwards.
  await expect(popup.getByRole('alert')).toHaveCount(0);
});

testWithHostAccess(
  'a reload leaves an honest stopped state, and restarting restores everything',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.getByText('Connected', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    await page.reload();

    // Nothing is injected until asked, so the page is bare again -- and the
    // panel says "Not running" rather than showing a Connected state it does
    // not have.
    await expect(page.locator('thursday-root')).toHaveCount(0);
    await expect(panel.getByText('Not running', { exact: true })).toBeVisible();

    await activate(page);
    await expect(toolbar(page)).toBeVisible();
    await expect(panel.getByText('Connected', { exact: true })).toBeVisible();

    // And it works again, rather than needing the panel reopened.
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await expect(page.locator('thursday-root .pin').first()).toBeVisible();
  },
);

testWithHostAccess(
  'stopping removes everything from the page and the panel agrees',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await expect(page.locator('thursday-root .pin').first()).toBeVisible();

    await panel.getByRole('button', { name: /^Stop/ }).click();

    await expect(page.locator('thursday-root')).toHaveCount(0);
    await expect(panel.getByText('Not running', { exact: true })).toBeVisible();

    // The findings stay in the panel: stopping is about the page, not about
    // throwing away the audit the user just ran.
    await expect(panel.locator('.finding-row').first()).toBeVisible();
  },
);

testWithHostAccess(
  'two audited tabs do not get each other findings',
  async ({ openFixture, activate, extensionId, context }) => {
    // The panel routes to the tab actually running Thursday, not to whichever
    // tab happens to be in front (the Sprint 2 fix). Two live tabs is where
    // that goes wrong if it is going to.
    const first = await openFixture('accessibility.html');
    await activate(first);
    const second = await openFixture('control.html');
    await activate(second);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await second.bringToFront();
    await panel.getByRole('button', { name: 'Full audit' }).click();

    // control.html is clean, so the honest answer is that nothing was found.
    await expect(panel.getByText(/Nothing found in/)).toBeVisible();
    await expect(panel.locator('.finding-row')).toHaveCount(0);
    await expect(first.locator('thursday-root .pin')).toHaveCount(0);
  },
);

testWithHostAccess(
  'activating twice does not stack a second toolbar or a second port',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);
    await activate(page);
    await activate(page);

    expect(await page.locator('thursday-root').count()).toBe(1);
    expect(await page.locator('thursday-root .toolbar').count()).toBe(1);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(panel.getByText('Connected', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    // One audit's worth of findings, not three.
    const ordinals = await page
      .locator('thursday-root .pin')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent));
    expect(new Set(ordinals).size).toBe(ordinals.length);
  },
);
