import { expect, injectContentScript, test, testWithHostAccess, toolbar } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * The ruler: what Select shows about whatever is under the pointer.
 *
 * Read out of the shadow root rather than by screenshot, because what is being
 * checked is the numbers. The one thing only a picture can tell you -- whether
 * the chips end up underneath Thursday's own toolbar -- has a test of its own
 * below, done in geometry.
 */

type Hud = {
  visible: boolean;
  chips: string[];
  grades: { text: string; state: string | null }[];
  gaps: string[];
  guides: number;
  outline: { x: number; y: number; width: number; height: number } | null;
  box: { x: number; y: number; width: number; height: number } | null;
};

const readHud = (page: Page): Promise<Hud> =>
  page.evaluate(() => {
    const root = document.querySelector('thursday-root')?.shadowRoot;
    const hud = root?.querySelector('.rl-hud');
    const shown = (node: Element | null | undefined): boolean =>
      node instanceof HTMLElement && node.dataset['on'] === 'true';
    const rect = (node: Element | null | undefined): Hud['outline'] => {
      if (!(node instanceof HTMLElement) || !shown(node)) return null;
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    return {
      visible: shown(hud),
      chips: [...(hud?.querySelectorAll('.rl-chip') ?? [])]
        .filter((chip) => chip instanceof HTMLElement && chip.dataset['on'] !== 'false')
        .map((chip) => chip.textContent?.trim() ?? ''),
      grades: [...(root?.querySelectorAll('.rl-grade') ?? [])]
        .filter((chip) => chip instanceof HTMLElement && chip.dataset['on'] !== 'false')
        .map((chip) => ({
          text: chip.textContent?.trim() ?? '',
          state: chip.getAttribute('data-state'),
        })),
      gaps: [...(root?.querySelectorAll('.rl-gap') ?? [])]
        .filter(shown)
        .map((pill) => pill.textContent?.trim() ?? ''),
      guides: [...(root?.querySelectorAll('.rl-guide') ?? [])].filter(shown).length,
      outline: rect(root?.querySelector('.rl-outline')),
      box: rect(hud),
    };
  });

/**
 * Puts the pointer over an element and lets the ruler's frame tick.
 *
 * Scrolled into view first: boundingBox is viewport-relative, so for anything
 * below the fold the coordinates point somewhere the pointer cannot go and the
 * ruler never sees it.
 */
async function hover(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + Math.min(30, box.width / 2), box.y + Math.min(8, box.height / 2));
  await expect
    .poll(async () => (await readHud(page)).visible, { timeout: 4000 })
    .toBe(true);
}

const startSelect = async (page: Page): Promise<void> => {
  await toolbar(page).getByRole('button', { name: 'Select' }).click();
};

test('the ruler measures whatever is under the pointer', async ({ openFixture }) => {
  const page = await openFixture('accessibility.html');
  await page.setViewportSize({ width: 1000, height: 700 });
  await injectContentScript(page);
  await startSelect(page);
  await hover(page, 'p.faint');

  const hud = await readHud(page);
  const chips = hud.chips.join(' | ');

  // The fixture sets 16px system-ui at the default weight on a white page.
  expect(chips).toContain('16px');
  expect(chips).toContain('Regular');
  expect(chips).toContain('0px LS');
  // line-height is `normal` here, and `normal` is not a number to report.
  expect(chips).toContain('normal LH');
  // #a0a0a0, in hex rather than as an rgb() triple.
  expect(chips).toMatch(/#a0a0a0/i);

  // The dashed outline is on the element it measured.
  const target = (await page.locator('p.faint').boundingBox())!;
  expect(hud.outline).not.toBeNull();
  expect(Math.abs(hud.outline!.y - target.y)).toBeLessThan(3);
  expect(Math.abs(hud.outline!.width - target.width)).toBeLessThan(3);

  // Four guides: the element's own edges, extended.
  expect(hud.guides).toBe(4);
});

test('the ruler grades contrast, and refuses to when it cannot measure it', async ({ openFixture }) => {
  const page = await openFixture('accessibility.html');
  await page.setViewportSize({ width: 1000, height: 700 });
  await injectContentScript(page);
  await startSelect(page);

  // #a0a0a0 on white is 2.85:1 -- under both thresholds.
  await hover(page, 'p.faint');
  const faint = await readHud(page);
  expect(faint.grades.map((grade) => grade.state)).toEqual(['fail', 'fail']);
  expect(faint.grades[0]!.text).toContain('AA');

  // Black on white at 32px bold passes both.
  await hover(page, 'h1');
  const heading = await readHud(page);
  expect(heading.grades.map((grade) => grade.state)).toEqual(['pass', 'pass']);

  /*
   * And an element with no text of its own gets no verdict at all.
   *
   * A form wrapper inherits a colour and a font size, so those chips are still
   * true of it -- but a contrast ratio for text that is not there is a number
   * about nothing, and a green tick on it would be a claim Thursday cannot
   * support.
   */
  await hover(page, 'form');
  expect((await readHud(page)).grades).toEqual([]);
});

testWithHostAccess(
  'the ruler and the audit never disagree about the same element',
  async ({ openFixture, activate, extensionId, context }) => {
    /*
     * The reason the ruler resolves backgrounds through the audit's own
     * resolver rather than its own copy.
     *
     * Two implementations of "what colour is behind this text" would be two
     * chances to differ, and the difference would be user-visible: hovering a
     * paragraph and reading AA passes while the findings list reports a
     * contrast failure on that same paragraph, with no way to tell which half
     * is lying.
     */
    const page = await openFixture('accessibility.html');
    await page.setViewportSize({ width: 1000, height: 700 });
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    await page.bringToFront();
    await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
    await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
      timeout: 60_000,
    });

    // The audit's own view: a contrast finding, with the ratio in its title.
    const row = panel.locator('.finding-row', { hasText: 'Text contrast' }).first();
    await expect(row).toBeVisible();
    const auditText = (await row.textContent()) ?? '';
    const auditRatio = Number(auditText.match(/(\d+\.\d+):1/)?.[1]);
    expect(auditRatio, `no ratio in "${auditText}"`).toBeGreaterThan(0);

    // The ruler's view of the element that finding is about.
    await page.bringToFront();
    await startSelect(page);
    await hover(page, 'p.faint');
    const hud = await readHud(page);
    const title = await page.evaluate(
      () =>
        document
          .querySelector('thursday-root')
          ?.shadowRoot?.querySelector('.rl-grade')
          ?.getAttribute('title') ?? '',
    );
    /*
     * The measured value, not the first ratio in the string.
     *
     * The tooltip reads "AA needs 4.5:1 -- measured 2.61:1", so a plain
     * ratio match picks up the *threshold* and reports a 1.89 disagreement
     * between two things that agree exactly. Worth the anchored match.
     */
    const rulerRatio = Number(title.match(/measured\s+(\d+\.\d+):1/)?.[1]);

    expect(rulerRatio, `no measured ratio in "${title}"`).toBeGreaterThan(0);
    // Same colours, same resolver, so the same number to within rounding.
    expect(Math.abs(rulerRatio - auditRatio)).toBeLessThan(0.02);
    // And the same conclusion.
    expect(hud.grades[0]!.state).toBe('fail');
  },
);

testWithHostAccess(
  'they agree where guessing the background would not',
  async ({ openFixture, activate, extensionId, context }) => {
    /*
     * The case that makes the test above mean something.
     *
     * On a white page, a resolver that simply assumed white would agree with
     * one that composites -- so the check passing there proves very little.
     * long.html has text on two 50% black veils over a tinted section: the
     * composited background is a mid grey, and the same text that passes on
     * white fails on it. Guessing white gets a different answer, so this pair
     * of numbers can only match if both sides really walk the same layers.
     */
    const page = await openFixture('long.html');
    await page.setViewportSize({ width: 1000, height: 700 });
    await activate(page);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    await page.bringToFront();
    await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
    await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
      timeout: 60_000,
    });

    /*
     * Expanded first. Two findings from one rule are grouped and collapsed, so
     * the individual ratios are not in the DOM until the group is opened --
     * which is how the first version of this read an empty list and reported
     * that the audit had found nothing.
     */
    await panel.locator('.finding-head', { hasText: 'contrast ratio' }).first().dispatchEvent('click');
    await expect(panel.locator('.finding-row', { hasText: 'Text contrast' }).first()).toBeVisible();

    const ratios = await panel.evaluate(() =>
      [...document.querySelectorAll('.finding-row')]
        .map((row) => row.textContent ?? '')
        .filter((text) => text.includes('contrast'))
        .map((text) => Number(text.match(/(\d+\.\d+):1/)?.[1]))
        .filter((value) => Number.isFinite(value)),
    );

    await page.bringToFront();
    await startSelect(page);
    await hover(page, 'p.stacked');
    const title = await page.evaluate(
      () =>
        document
          .querySelector('thursday-root')
          ?.shadowRoot?.querySelector('.rl-grade')
          ?.getAttribute('title') ?? '',
    );
    const measured = Number(title.match(/measured\s+(\d+\.\d+):1/)?.[1]);
    expect(measured, `no measured ratio in "${title}"`).toBeGreaterThan(0);

    /*
     * On white, #767676 is 4.54:1 and passes AA. Composited over the veils it
     * is well under that. Both halves of the assertion matter: the first says
     * the ruler is not guessing white, the second says the audit reached the
     * same number about the same element.
     */
    expect(measured).toBeLessThan(4);
    expect(ratios, `audit ratios: ${ratios.join(', ')}`).toContain(
      Number(measured.toFixed(2)),
    );
  },
);

test('the ruler shows the gap to a neighbour', async ({ openFixture }) => {
  const page = await openFixture('long.html');
  await page.setViewportSize({ width: 1000, height: 700 });
  await injectContentScript(page);
  await startSelect(page);
  await hover(page, 'p.faint');

  const gaps = (await readHud(page)).gaps;
  // At least one pill, and it reads as a length rather than as a bare number.
  expect(gaps.length).toBeGreaterThan(0);
  for (const gap of gaps) expect(gap).toMatch(/^\d+(\.\d)?px$/);
});

test('the chips do not end up underneath the toolbar', async ({ openFixture }) => {
  /*
   * Both want the same place: the toolbar sits at the top of the page and the
   * chips go above whatever is being measured, so measuring a heading puts them
   * on top of each other. Found by looking at a screenshot of exactly that.
   */
  const page = await openFixture('accessibility.html');
  await page.setViewportSize({ width: 1000, height: 700 });
  await injectContentScript(page);
  await startSelect(page);
  await hover(page, 'h1');

  const hud = await readHud(page);
  const bar = await page.evaluate(() => {
    const node = document.querySelector('thursday-root')?.shadowRoot?.querySelector('.toolbar');
    if (!(node instanceof HTMLElement)) return null;
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });

  expect(hud.box).not.toBeNull();
  expect(bar).not.toBeNull();
  const overlaps =
    hud.box!.x < bar!.x + bar!.width &&
    bar!.x < hud.box!.x + hud.box!.width &&
    hud.box!.y < bar!.y + bar!.height &&
    bar!.y < hud.box!.y + hud.box!.height;
  expect(overlaps, 'the measurement chips are under the toolbar').toBe(false);
  // On screen, not pushed off it to avoid the collision.
  expect(hud.box!.y).toBeGreaterThanOrEqual(0);
  expect(hud.box!.y + hud.box!.height).toBeLessThanOrEqual(700);
});

testWithHostAccess('Comment mode picks an element without measuring it', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  /*
   * Two tools, two questions. Choosing where to leave a comment is "which
   * element", and a bar of type metrics over it is noise.
   *
   * Needs a real audit rather than a bare injection: Comment is greyed out
   * until there is an audit to attach a comment to, because a comment is
   * stored against one.
   */
  const page = await openFixture('accessibility.html');
  await page.setViewportSize({ width: 1000, height: 700 });
  await activate(page);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  await page.bringToFront();
  await toolbar(page).getByRole('button', { name: 'Comment' }).click();

  const box = (await page.locator('p.faint').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 8);
  await page.waitForTimeout(300);

  const hud = await readHud(page);
  expect(hud.visible).toBe(false);
  // The plain highlight still marks what is under the pointer.
  const highlighted = await page.evaluate(
    () =>
      (document.querySelector('thursday-root')?.shadowRoot?.querySelector('.hl-box') as HTMLElement | null)
        ?.style.display,
  );
  expect(highlighted).toBe('block');
});
