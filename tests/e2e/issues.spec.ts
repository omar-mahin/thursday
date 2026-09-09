import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  expect,
  openMore,
  panelReady,
  testWithHostAccess,
  withoutPicker,
} from './fixtures';

/**
 * One list, one count.
 *
 * Findings and the user's own comments used to be two lists in two cards with
 * two counts, which meant working through a page twice and two answers to "how
 * much is left" -- neither of them the answer. They share a list now, share the
 * status ladder, and are still told apart on sight.
 *
 * These are the claims that only hold end to end: that a comment written on the
 * page lands in the same list as the findings, that triaging it behaves exactly
 * as triaging a finding does, and that the number in the header counts both.
 */
const openPanel = (page: Page): Promise<Page> => panelReady(page);

const CARD = 'thursday-root .cm-card';

const settle = (panel: Page): Promise<void> =>
  expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, { timeout: 60_000 });

/** Writes a comment about the page, which needs no picking. */
async function writeOnPage(
  page: Page,
  panel: Page,
  text: string,
  priority?: string,
): Promise<void> {
  await panel.getByRole('button', { name: 'Comment on the page' }).dispatchEvent('click');
  await page.bringToFront();
  const card = page.locator(CARD);
  await expect(card).toBeVisible();
  if (priority) await page.locator(`thursday-root .cm-priority[data-level="${priority}"]`).click();
  await page.locator('thursday-root .cm-body').fill(text);
  await page.locator('thursday-root .cm-add').click();
  await expect(card).toBeHidden({ timeout: 15_000 });
}

testWithHostAccess(
  'a comment sits in the findings list, marked as the user own and not measured',
  async ({ openFixture, activate, context }) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);

    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    await writeOnPage(page, panel, 'The pricing table buries the plan you want.', 'high');

    // In the issues list itself -- not a second list below it.
    const list = panel.locator('ul.issues');
    await expect(list.locator('.comment-row')).toHaveCount(1);
    await expect(panel.locator('.comment-list')).toHaveCount(0);

    /*
     * Ordered by what it says about itself. A high-priority comment sits with
     * the high-severity findings rather than at the bottom of the page, which
     * is the whole reason for putting the two in one list.
     */
    const rows = list.locator('> li');
    const positions = await rows.evaluateAll((items) =>
      items.map((item) => (item.classList.contains('comment-row') ? 'comment' : 'finding')),
    );
    expect(positions).toContain('comment');
    expect(positions.indexOf('comment')).toBeLessThan(positions.length - 1);

    // And told apart on sight: the user's claim is labelled as theirs and wears
    // a letter rather than a severity chip.
    const row = list.locator('.comment-row');
    await expect(row.locator('.from-you')).toHaveText('From you');
    await expect(row.locator('.comment-marker')).toHaveText('A');
    await expect(row.locator('.finding-sev')).toHaveCount(0);
    await expect(row).toContainText('High');
  },
);

testWithHostAccess(
  'a comment is triaged exactly as a finding is, and the count covers both',
  async ({ openFixture, activate, context }) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);

    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    const before = Number.parseInt((await panel.locator('.head-count').innerText()).split(' ')[0]!, 10);
    expect(before).toBeGreaterThan(0);

    await writeOnPage(page, panel, 'Nobody reads the second paragraph.');

    // One number over both kinds: a comment is a thing to do, so it counts.
    await expect(panel.locator('.head-count')).toHaveText(`${before + 1} open`);

    const row = panel.locator('.comment-row');
    await expect(row).toHaveAttribute('data-status', 'open');

    // The same three answers, in the same words the finding next to it uses.
    await row.getByRole('button', { name: 'Accept' }).click();
    await expect(row).toHaveAttribute('data-status', 'accepted');
    // Accepted is still outstanding: agreeing it is a problem is not fixing it.
    await expect(panel.locator('.head-count')).toHaveText(`${before + 1} open`);

    await row.getByRole('button', { name: 'Resolve' }).click();
    // Resolved gets out of the way, exactly as a resolved finding does, and is
    // off the count.
    await expect(panel.locator('.comment-row')).toHaveCount(0);
    await expect(panel.locator('.head-count')).toHaveText(`${before} open`);

    // One toggle for the whole list, counting the whole list.
    const toggle = panel.locator('.closed-toggle');
    await expect(toggle).toContainText('dismissed or resolved');
    await toggle.locator('input').check();
    await expect(panel.locator('.comment-row')).toHaveAttribute('data-status', 'resolved');
  },
);

testWithHostAccess(
  'a comment stays dismissed through a re-audit and a saved file',
  async ({ openFixture, activate, context }) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);

    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);
    await writeOnPage(page, panel, 'Decided against changing this.');

    await panel.locator('.comment-row').getByRole('button', { name: 'Dismiss' }).click();
    await expect(panel.locator('.comment-row')).toHaveCount(0);

    /*
     * Re-audited, the way somebody does after fixing something.
     *
     * Triage that evaporates on the next run is worse than no triage: the
     * comment comes back looking outstanding, and the count goes back up with
     * nothing to explain why. A dismissed finding already survives this --
     * a dismissed comment has to as well, or the shared status ladder is a
     * shared appearance only.
     */
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await settle(panel);
    await expect(panel.locator('.comment-row')).toHaveCount(0);
    await panel.locator('.closed-toggle input').check();
    await expect(panel.locator('.comment-row')).toHaveAttribute('data-status', 'dismissed');

    // And in the file, so a report handed on does not overstate the work left.
    await openMore(page);
    const download = await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save audit' }).click(),
    ]).then(([event]) => event);
    const parsed = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
      annotations?: Array<{ body: string; status?: string }>;
    };
    expect(parsed.annotations?.[0]?.status).toBe('dismissed');
  },
);

testWithHostAccess(
  'the severity filter does not throw away what the user wrote',
  async ({ openFixture, activate, context }) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);

    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);
    await writeOnPage(page, panel, 'Keep me visible.');

    /*
     * A comment has no severity, so no severity chip can match it. Filtering it
     * out of the list would lose the user's own writing behind a control that
     * does not mention it -- and they would have no way to know it had gone.
     */
    const chip = panel.locator('.sev-chip').first();
    const label = await chip.innerText();
    await chip.click();
    await expect(panel.locator('.sev-chip').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.comment-body'), `filtering to "${label}" hid the comment`).toHaveText(
      'Keep me visible.',
    );
  },
);
