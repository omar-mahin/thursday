import type { Page } from '@playwright/test';
import { contrastRatio, contrastTarget, parseColor } from '../../src/audit/measure/color';
import { expect, testWithHostAccess as test } from './fixtures';

async function audited(
  openFixture: (name: string) => Promise<Page>,
  activate: (page: Page) => Promise<void>,
  extensionId: string,
  fixture = 'accessibility.html',
) {
  const page = await openFixture(fixture);
  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  return { page, panel };
}

test('repeats of one rule collapse into a group that expands', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const { panel } = await audited(openFixture, activate, extensionId);

  // accessibility.html trips the touch-target rule more than once.
  const group = panel.locator('.finding.group').first();
  await expect(group).toBeVisible();
  await expect(group.locator('.finding-title')).toContainText('×');

  const collapsed = await panel.locator('.finding-row').count();
  await group.locator('.finding-head').click();
  const expanded = await panel.locator('.finding-row').count();
  expect(expanded).toBeGreaterThan(collapsed);
});

test('severity filters narrow the list and survive being switched off', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const { panel } = await audited(openFixture, activate, extensionId);
  const all = await panel.locator('.finding-row').count();

  const medium = panel.locator('.filters .sev-chip[data-severity="medium"]');
  await medium.click();
  await expect(medium).toHaveAttribute('aria-pressed', 'true');

  const severities = await panel.locator('.finding-row').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-severity')),
  );
  expect(severities.length).toBeGreaterThan(0);
  expect(new Set(severities)).toEqual(new Set(['medium']));

  await medium.click();
  await expect(panel.locator('.finding-row')).toHaveCount(all);
});

test('a finding can be dismissed, hidden, and brought back', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const { panel } = await audited(openFixture, activate, extensionId);
  // Count rows by title rather than in total: closing one finding can expand a
  // group around the next, so the visible row count is not a clean signal.
  const title = await panel.locator('.finding-row').first().locator('.finding-title').innerText();
  const row = panel.locator('.finding-row', { hasText: title });
  await expect(row).toHaveCount(1);

  await panel.getByRole('button', { name: 'Dismiss' }).click();
  await expect(row).toHaveCount(0);

  // Dismissing moves on to the next finding rather than leaving a closed one open.
  await expect(panel.locator('.detail-title')).not.toHaveText(title);

  await panel.getByLabel(/Show 1 dismissed or resolved/).check();
  await expect(row).toHaveCount(1);
  await expect(panel.locator('.finding-row[data-status="dismissed"]')).toHaveCount(1);
});

test('accepting a finding keeps it in the list, because agreement is not closure', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const { panel } = await audited(openFixture, activate, extensionId);
  const before = await panel.locator('.finding-row').count();

  await panel.getByRole('button', { name: 'Accept' }).click();
  await expect(panel.locator('.finding-row')).toHaveCount(before);
  await expect(panel.locator('.finding-row[data-status="accepted"]')).toHaveCount(1);
});

test('a finding can be added to the report with a note', async ({ openFixture, activate, extensionId }) => {
  const { panel } = await audited(openFixture, activate, extensionId);

  await panel.getByRole('button', { name: 'Add to report' }).click();
  await expect(panel.getByRole('button', { name: 'In report' })).toBeVisible();
  await expect(panel.locator('.finding-row[data-selected="true"] .row-flag')).toBeVisible();

  await panel.getByPlaceholder('Context for whoever reads the report').fill('Design agreed to fix');
  await expect(panel.getByPlaceholder('Context for whoever reads the report')).toHaveValue('Design agreed to fix');
  await expect(panel.locator('.hint', { hasText: '1 in report' })).toBeVisible();
});

test('the detail card answers what, why and what now, and admits what it is', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const { panel } = await audited(openFixture, activate, extensionId);
  const detail = panel.locator('.detail');

  await expect(detail).toContainText('Evidence');
  await expect(detail).toContainText('Impact');
  await expect(detail).toContainText('Recommendation');
  await expect(detail.locator('.badge').first()).toBeVisible();

  // Open a heuristic finding and check it says so, with its confidence.
  await panel.locator('.filters .sev-chip[data-severity="low"]').click();
  const lowRow = panel.locator('.finding-row').first();
  if ((await lowRow.count()) > 0) {
    await lowRow.click();
    await expect(panel.locator('.detail')).toContainText(/Heuristic|Measured/);
  }
});

test('Escape closes the open finding', async ({ openFixture, activate, extensionId }) => {
  const { panel } = await audited(openFixture, activate, extensionId);
  await expect(panel.locator('.detail')).toBeVisible();

  await panel.locator('.finding-row').first().press('Escape');
  await expect(panel.locator('.detail')).toHaveCount(0);
  await expect(panel.locator('.finding-row[data-selected="true"]')).toHaveCount(0);
});

test('the whole panel is reachable by keyboard', async ({ openFixture, activate, extensionId }) => {
  const { panel } = await audited(openFixture, activate, extensionId);

  /*
   * Tab through the panel and confirm the important controls are reachable and
   * that focus is always visible on something.
   *
   * The number of presses is derived from the panel rather than fixed. It was
   * fixed at forty, and adding the comments card pushed the audit button past
   * it -- so the test failed for having grown, which is a test that measures
   * its own constant instead of the panel.
   */
  const focusable = await panel
    .locator(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    .count();
  expect(focusable).toBeGreaterThan(10);

  const reached: string[] = [];
  /*
   * Tab until the audit button comes round, with a hard ceiling.
   *
   * This was `focusable + 2`, which is a guess at how far off the count is
   * from the real tab order -- and the count is always a bit off, because a
   * container with a tabindex, or a control that appears while tabbing, is not
   * in the query. Photographing findings by default added two buttons to every
   * open finding and the guess ran out, so the test failed for the panel having
   * grown again. Twice the count is a ceiling that catches a genuine trap
   * without pretending to know the exact number.
   */
  for (let step = 0; step < focusable * 2; step += 1) {
    if (reached.some((entry) => entry.includes('Full audit'))) break;
    await panel.keyboard.press('Tab');
    const description = await panel.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return '';
      const outline = getComputedStyle(active, ':focus-visible').outlineStyle;
      return `${active.tagName.toLowerCase()}:${
        active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 24) ?? ''
      }:${outline}`;
    });
    if (description) reached.push(description);
  }

  const joined = reached.join(' | ');
  expect(joined).toContain('Full audit');
  expect(joined).toMatch(/finding|Finding/i);
  // Activating a finding row from the keyboard opens it.
  await expect(panel.locator('.detail')).toBeVisible();
});

test('the panel meets its own contrast rule', async ({ openFixture, activate, extensionId }) => {
  // Thursday audits its own UI with the same code it audits pages with. An
  // accessibility tool that fails its own rules is indefensible (spec 38).
  const { panel } = await audited(openFixture, activate, extensionId);

  const samples = await panel.evaluate(() => {
    const selectors = [
      '.brandmark',
      '.panel-foot span',
      '.section-title',
      '.finding-title',
      '.detail-summary',
      '.finding-block p',
      '.hint',
      '.tabs button[aria-selected="true"]',
    ];
    const resolveBackground = (start: Element): string => {
      let node: Element | null = start;
      while (node) {
        const background = getComputedStyle(node).backgroundColor;
        if (background && background !== 'rgba(0, 0, 0, 0)') return background;
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    };
    return selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const styles = getComputedStyle(element);
      return [
        {
          selector,
          color: styles.color,
          background: resolveBackground(element),
          fontSize: Number.parseFloat(styles.fontSize),
          fontWeight: Number.parseInt(styles.fontWeight, 10) || 400,
        },
      ];
    });
  });

  expect(samples.length).toBeGreaterThan(5);
  for (const sample of samples) {
    const foreground = parseColor(sample.color);
    const background = parseColor(sample.background);
    expect(foreground, sample.selector).not.toBeNull();
    expect(background, sample.selector).not.toBeNull();
    const ratio = contrastRatio(foreground!, background!);
    const target = contrastTarget(sample.fontSize, sample.fontWeight);
    expect(
      ratio,
      `${sample.selector}: ${ratio}:1 on ${sample.fontSize}px needs ${target.ratio}:1`,
    ).toBeGreaterThanOrEqual(target.ratio);
  }
});
