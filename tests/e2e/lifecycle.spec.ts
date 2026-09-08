import { expect, panelOf, panelReady, test, testWithHostAccess, toolbar } from './fixtures';

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
  async ({ openFixture, activate }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    // The panel says which page it is on. There is no "Connected" badge any
    // more: the panel is mounted on the page, so its being there is the badge.
    await expect(panelOf(page).locator('.head-origin')).toContainText('fixture.thursday.test');
    await panelOf(page).getByRole('button', { name: 'Full audit' }).click();
    await expect(panelOf(page).locator('.finding-row').first()).toBeVisible();

    await page.reload();

    /*
     * Nothing is injected until asked, so the page is bare again -- and the
     * panel goes with it, because the panel is part of what was injected.
     * That is a change worth stating: a reload used to leave a panel behind
     * saying "Not running", and now there is nothing to say it.
     */
    await expect(page.locator('thursday-root')).toHaveCount(0);

    await activate(page);
    await expect(toolbar(page)).toBeVisible();
    await panelReady(page);
    await expect(panelOf(page).locator('.head-origin')).toContainText('fixture.thursday.test');

    // And it works again, rather than needing anything reopened.
    await panelOf(page).getByRole('button', { name: 'Full audit' }).click();
    await expect(panelOf(page).locator('.finding-row').first()).toBeVisible();
    await expect(page.locator('thursday-root .pin').first()).toBeVisible();
  },
);

testWithHostAccess(
  'stopping removes everything from the page and the panel agrees',
  async ({ openFixture, activate }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);
    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await expect(page.locator('thursday-root .pin').first()).toBeVisible();

    await panel.getByRole('button', { name: /^Stop/ }).click();

    /*
     * Everything goes, the panel included.
     *
     * Stopping used to leave a side panel behind still showing the findings --
     * "stopping is about the page, not about the audit". The panel lives on the
     * page now, so stopping takes it too, and the audit survives in storage
     * rather than on screen. Reactivating and reopening it from history is the
     * path back, which persistence.spec covers.
     */
    await expect(page.locator('thursday-root')).toHaveCount(0);
  },
);

testWithHostAccess(
  'two audited tabs do not get each other findings',
  async ({ openFixture, activate }) => {
    // The panel routes to the tab actually running Thursday, not to whichever
    // tab happens to be in front (the Sprint 2 fix). Two live tabs is where
    // that goes wrong if it is going to.
    const first = await openFixture('accessibility.html');
    await activate(first);
    const second = await openFixture('control.html');
    await activate(second);

    /*
     * The panel on the second tab, which is the one being audited.
     *
     * Each activated tab has its own panel now, and each hears only about its
     * own tab -- so "which tab does the panel route to" is answered by which
     * panel you are looking at. Auditing from the second tab's panel must not
     * touch the first.
     */
    await panelReady(second);
    const panel = panelOf(second);
    await panel.getByRole('button', { name: 'Full audit' }).click();

    // control.html is clean, so the honest answer is that nothing was found.
    await expect(panel.getByText(/Nothing found in/)).toBeVisible();
    await expect(panel.locator('.finding-row')).toHaveCount(0);
    await expect(first.locator('thursday-root .pin')).toHaveCount(0);
  },
);

testWithHostAccess(
  'activating twice does not stack a second toolbar or a second port',
  async ({ openFixture, activate }) => {
    const page = await openFixture('accessibility.html');
    await activate(page);
    await activate(page);
    await activate(page);

    expect(await page.locator('thursday-root').count()).toBe(1);
    expect(await page.locator('thursday-root .toolbar').count()).toBe(1);

    await panelReady(page);
    const panel = panelOf(page);
    await expect(panel.locator('.head-origin')).toContainText('fixture.thursday.test');
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    // One audit's worth of findings, not three.
    const ordinals = await page
      .locator('thursday-root .pin')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent));
    expect(new Set(ordinals).size).toBe(ordinals.length);
  },
);
