import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { contrastRatio, contrastTarget, parseColor } from '../../src/audit/measure/color';
import { expect, testWithHostAccess as test } from './fixtures';

/**
 * Thursday's own new surfaces, measured by Thursday's own contrast rule.
 *
 * Sprint 4 established this for the findings UI; Sprint 5 adds history, files,
 * the comparison and the reopened-audit notice, each with its own colours. An
 * accessibility tool that fails its own rules cannot ship, and "we checked the
 * old parts" is not the same claim.
 */
const SELECTORS = [
  '.history-when',
  '.history-count',
  '.notice',
  '.dropzone',
  'button.link',
  '.diff-totals li[data-kind="fixed"]',
  '.diff-totals li[data-kind="new"]',
  '.diff-totals li[data-kind="unchanged"]',
  '.diff-list li span:last-child',
  '.compare .section-title',
];

type Sample = {
  selector: string;
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
};

async function sample(panel: Page, selectors: string[]): Promise<Sample[]> {
  return panel.evaluate((wanted) => {
    /** The nearest ancestor that actually paints, which is what text sits on. */
    const resolveBackground = (start: Element): string => {
      let node: Element | null = start;
      while (node) {
        const colour = getComputedStyle(node).backgroundColor;
        if (colour && colour !== 'transparent' && !colour.startsWith('rgba(0, 0, 0, 0)')) return colour;
        node = node.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const out: Sample[] = [];
    for (const selector of wanted) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const styles = getComputedStyle(element);
      out.push({
        selector,
        color: styles.color,
        background: resolveBackground(element),
        fontSize: Number.parseFloat(styles.fontSize),
        fontWeight: Number.parseFloat(styles.fontWeight) || 400,
      });
    }
    return out;
  }, selectors) as Promise<Sample[]>;
}

function assertReadable(samples: Sample[]): void {
  for (const item of samples) {
    const foreground = parseColor(item.color);
    const background = parseColor(item.background);
    expect(foreground, item.selector).not.toBeNull();
    expect(background, item.selector).not.toBeNull();
    const ratio = contrastRatio(foreground!, background!);
    const target = contrastTarget(item.fontSize, item.fontWeight);
    expect(
      ratio,
      `${item.selector}: ${ratio.toFixed(2)}:1 at ${item.fontSize}px needs ${target.ratio}:1`,
    ).toBeGreaterThanOrEqual(target.ratio);
  }
}

test('history, files and the comparison pass the contrast rule they enforce', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Two audits, so the comparison is on screen with all three of its counters.
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.compare')).toBeVisible();
  await expect(panel.locator('.history-row').first()).toBeVisible();

  const withCompare = await sample(panel, SELECTORS);
  // Enough of the new surface to be worth calling a check.
  expect(withCompare.length).toBeGreaterThanOrEqual(6);
  assertReadable(withCompare);

  // Then the reopened-audit notice, which replaces the comparison.
  await panel.locator('input[type=file]').setInputFiles(resolve('tests/fixtures/sample.thursday.json'));
  await expect(panel.locator('.notice')).toContainText('Opened from a file');
  assertReadable(await sample(panel, ['.notice', '.history-when', '.dropzone']));
});

test('the panel says what state it is in without relying on colour alone', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  // Spec section 38: colour is never the only carrier. Each of these states is
  // stated in words as well.
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Full audit' }).click();

  await expect(panel.locator('.diff-totals li[data-kind="fixed"]')).toContainText('fixed');
  await expect(panel.locator('.diff-totals li[data-kind="new"]')).toContainText('new');
  await expect(panel.locator('.diff-totals li[data-kind="unchanged"]')).toContainText('still open');

  await panel.locator('.history-open').first().click();
  await expect(panel.locator('.notice')).toContainText('Reopened from history');
});
