import { performance } from 'node:perf_hooks';
import type { Page } from '@playwright/test';
import { expect, exchange, testWithHostAccess as test } from './fixtures';
import type { PageSnapshot } from '../../src/shared/types';
import { runAudit } from '../../src/audit/engine/run';
import { ALL_CATEGORIES } from '../../src/audit/engine/registry';
import { DEFAULT_AUDIT_SETTINGS } from '../../src/audit/types';

/**
 * The budgets from PLAN.md section 5, plus the ones the later sprints made
 * possible to measure.
 *
 * Written as budgets rather than benchmarks: each one is a number a user would
 * notice crossing, checked with enough headroom that CI noise does not fail it,
 * and every failure message says what it actually measured. A test that only
 * fails when a machine is busy teaches people to rerun it.
 */
const SNAPSHOT_BUDGET_MS = 400;
/**
 * Comfortably above the ~9ms this actually takes, and comfortably below the
 * ~156ms it took while dedupe was quadratic -- so a return to that shape fails
 * here rather than being noticed by a user on a big page.
 */
const AUDIT_BUDGET_MS = 100;
const END_TO_END_BUDGET_MS = 3000;
const PIN_FRAME_BUDGET_MS = 16 * 4;

async function panelFor(page: Page, extensionId: string): Promise<Page> {
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();
  return panel;
}

async function snapshotOf(panel: Page, includeOffscreen = true): Promise<PageSnapshot> {
  const message = await exchange<{ payload: PageSnapshot }>(
    panel,
    { type: 'REQUEST_SNAPSHOT', payload: { includeOffscreen } },
    'SNAPSHOT_READY',
  );
  return message.payload;
}

test('the rule engine judges a capped page well inside its budget', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  // Measured where the rules actually run: pure, over a real snapshot from a
  // real browser. Thirty rules across 1500 elements is the worst realistic case.
  const page = await openFixture('heavy.html');
  await activate(page);
  const panel = await panelFor(page, extensionId);
  const snapshot = await snapshotOf(panel);
  expect(snapshot.elements.length).toBeGreaterThan(1000);

  // One warm run first: the first pass pays for module init, not for the rules.
  runAudit(snapshot, { categories: [...ALL_CATEGORIES], settings: DEFAULT_AUDIT_SETTINGS });

  const started = performance.now();
  const result = runAudit(snapshot, {
    categories: [...ALL_CATEGORIES],
    settings: DEFAULT_AUDIT_SETTINGS,
  });
  const elapsed = performance.now() - started;

  expect(
    elapsed,
    `${result.findings.length} findings from ${snapshot.elements.length} elements took ${elapsed.toFixed(0)}ms`,
  ).toBeLessThan(AUDIT_BUDGET_MS);
  // A budget met by doing nothing is not met.
  expect(result.findings.length).toBeGreaterThan(0);
  expect(result.failedRules).toEqual([]);
});

test('no single rule dominates the audit', async ({ openFixture, activate, extensionId }) => {
  // A rule that costs more than the other twenty-nine put together is the one
  // that will make a real site feel slow, and an aggregate budget hides it.
  //
  // Measured on `rule.run` alone, deliberately. Timing each rule through the
  // whole engine instead charges it for dedupe, and that misattribution is
  // exactly what let a quadratic dedupe pass look like a slow rule.
  const page = await openFixture('heavy.html');
  await activate(page);
  const panel = await panelFor(page, extensionId);
  const snapshot = await snapshotOf(panel);

  const { ALL_RULES } = await import('../../src/audit/engine/registry');
  const { isAuditable } = await import('../../src/audit/types');
  const context = {
    snapshot,
    settings: DEFAULT_AUDIT_SETTINGS,
    candidates: snapshot.elements.filter(isAuditable),
  };

  const timings = ALL_RULES.map((rule) => {
    rule.run(context);
    const started = performance.now();
    const produced = rule.run(context);
    return { id: rule.id, ms: performance.now() - started, count: produced.length };
  }).sort((a, b) => b.ms - a.ms);

  const worst = timings[0]!;
  const total = timings.reduce((sum, item) => sum + item.ms, 0);
  expect(
    worst.ms,
    `slowest rule ${worst.id} took ${worst.ms.toFixed(1)}ms (${worst.count} findings) of ${total.toFixed(1)}ms across all rules`,
  ).toBeLessThan(AUDIT_BUDGET_MS / 2);

  // Every rule ran; a rule that returns nothing because it threw is not fast.
  expect(timings).toHaveLength(ALL_RULES.length);
});

test('the engine pipeline does not cost more than the rules it runs', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  // Dedupe, ranking and capping sit between the rules and the user. They were
  // once 95% of the audit, and no rule budget would have shown it.
  const page = await openFixture('heavy.html');
  await activate(page);
  const panel = await panelFor(page, extensionId);
  const snapshot = await snapshotOf(panel);

  const { ALL_RULES } = await import('../../src/audit/engine/registry');
  const { isAuditable } = await import('../../src/audit/types');
  const context = {
    snapshot,
    settings: DEFAULT_AUDIT_SETTINGS,
    candidates: snapshot.elements.filter(isAuditable),
  };
  const options = { categories: [...ALL_CATEGORIES], settings: DEFAULT_AUDIT_SETTINGS };

  runAudit(snapshot, options);
  for (const rule of ALL_RULES) rule.run(context);

  const rulesStarted = performance.now();
  let produced = 0;
  for (const rule of ALL_RULES) produced += rule.run(context).length;
  const rulesMs = performance.now() - rulesStarted;

  const wholeStarted = performance.now();
  runAudit(snapshot, options);
  const wholeMs = performance.now() - wholeStarted;

  const overhead = wholeMs - rulesMs;
  // This page produces ~1000 raw findings and keeps a handful, so the
  // machinery does have real work to do -- just not more than the rules.
  expect(
    overhead,
    `rules ${rulesMs.toFixed(1)}ms produced ${produced} raw findings; whole audit ${wholeMs.toFixed(1)}ms`,
  ).toBeLessThan(Math.max(rulesMs * 3, 40));
  expect(produced).toBeGreaterThan(500);
});

test('a heavy page goes from click to findings inside the end-to-end budget', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  // What the user actually waits for: snapshot, transfer over the port, thirty
  // rules, dedupe, render, and pins drawn on the page.
  const page = await openFixture('heavy.html');
  await activate(page);
  const panel = await panelFor(page, extensionId);
  await panel.bringToFront();

  const started = Date.now();
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: END_TO_END_BUDGET_MS });
  const elapsed = Date.now() - started;

  expect(elapsed, `click to first finding took ${elapsed}ms`).toBeLessThan(END_TO_END_BUDGET_MS);
});

test('pins stay cheap to reposition while the page scrolls', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const page = await openFixture('heavy.html');
  await activate(page);
  const panel = await panelFor(page, extensionId);
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();

  await page.bringToFront();
  await expect(page.locator('thursday-root .pin').first()).toBeVisible();
  const pins = await page.locator('thursday-root .pin').count();
  expect(pins).toBeGreaterThan(5);

  // Ten scrolls, measuring how long the page takes to settle each time. The
  // work is a rAF recompute, so this is the cost of a frame under load.
  const worst = await page.evaluate(async () => {
    const settle = (): Promise<number> =>
      new Promise((resolve) => {
        const started = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)));
      });
    let peak = 0;
    for (let i = 0; i < 10; i += 1) {
      window.scrollBy(0, 400);
      peak = Math.max(peak, await settle());
    }
    return peak;
  });

  expect(worst, `slowest scroll settle was ${worst.toFixed(0)}ms with ${pins} pins`).toBeLessThan(
    PIN_FRAME_BUDGET_MS,
  );
});

test('a second audit of the same page is not slower than the first', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  // Guards against the kind of leak that only shows up in use: listeners,
  // pins or observers accumulating across runs.
  const page = await openFixture('ui.html');
  await activate(page);
  const panel = await panelFor(page, extensionId);
  await panel.bringToFront();

  const time = async (): Promise<number> => {
    const started = Date.now();
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    return Date.now() - started;
  };

  const first = await time();
  let last = first;
  for (let run = 0; run < 4; run += 1) last = await time();

  // Generous multiple: this is looking for growth, not for jitter.
  expect(last, `first run ${first}ms, fifth run ${last}ms`).toBeLessThan(Math.max(first * 3, 1500));

  // And the page is not accumulating either: one pin layer, one host.
  const hosts = await page.locator('thursday-root').count();
  const layers = await page.evaluate(
    () => document.querySelector('thursday-root')?.shadowRoot?.querySelectorAll('.pin-layer').length ?? 0,
  );
  expect(hosts).toBe(1);
  expect(layers).toBe(1);
});

test('the snapshot budget holds when the page is a single deep tree', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  // The heavy fixture is wide. Depth is the other shape that goes wrong,
  // because parent, landmark and heading lookups all walk upwards.
  const page = await openFixture('control.html');
  await activate(page);
  const panel = await panelFor(page, extensionId);

  await page.evaluate(() => {
    let node = document.body;
    for (let depth = 0; depth < 250; depth += 1) {
      const wrapper = document.createElement('section');
      const heading = document.createElement('h2');
      heading.textContent = `Level ${depth}`;
      const link = document.createElement('a');
      link.href = '/somewhere';
      link.textContent = 'A descriptive link label';
      wrapper.append(heading, link);
      node.append(wrapper);
      node = wrapper;
    }
  });

  const snapshot = await snapshotOf(panel);
  expect(snapshot.elements.length).toBeGreaterThan(300);
  expect(
    snapshot.durationMs,
    `deep-tree snapshot took ${snapshot.durationMs}ms for ${snapshot.elements.length} elements`,
  ).toBeLessThan(SNAPSHOT_BUDGET_MS);
});
