import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, openMore, panelReady, testWithHostAccess as test, toolbar, withoutPicker } from './fixtures';
import { parseAuditFile } from '../../src/storage/file';

/**
 * The two flows from PLAN.md section 10, run as written.
 *
 * Every other E2E file tests a mechanism. These two test the product: a person
 * sitting down with a page and getting something out of it. If a refactor ever
 * breaks the shape of the work rather than a particular function, it breaks
 * here first.
 */
/**
 * The panel, as the user has it: floating on the page being audited.
 *
 * No test can drive a native save dialog, so the picker is taken away first
 * and the anchor fallback writes the same bytes (see files.spec.ts), which is
 * what withoutPicker handles.
 */
const panelFor = (page: Page): Promise<Page> => panelReady(page);

test('flow 1: activate, audit, read a finding, jump to it, resolve it, save the file', async ({
  openFixture,
  activate,
  context,
}) => {
  // --- activate -----------------------------------------------------------
  await withoutPicker(context);
  const page = await openFixture('accessibility.html');
  await activate(page);
  await expect(page.locator('thursday-root .toolbar')).toBeVisible();

  const panel = await panelFor(page);
  await expect(panel.locator('.head-origin')).toContainText('fixture.thursday.test');

  // --- audit --------------------------------------------------------------
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();

  // --- findings -----------------------------------------------------------
  const rows = await panel.locator('.finding-row').count();
  expect(rows).toBeGreaterThan(0);
  await expect(panel.locator('.sev-chip').first()).toBeVisible();

  // --- click a finding ----------------------------------------------------
  const row = panel.locator('.finding-row').first();
  const title = await row.locator('.finding-title').innerText();
  await row.click();
  await expect(panel.locator('.detail-title')).toHaveText(title);

  // --- it jumps to the element -------------------------------------------
  await panel.locator('.detail').getByRole('button', { name: 'Show on page' }).click();
  // Show on page flashes the plain highlight rather than starting the ruler:
  // this is "here it is", not "measure this".
  await expect(page.locator('thursday-root .hl-box')).toBeVisible();

  // --- evidence, impact, recommendation ----------------------------------
  // Uppercased by CSS, so compare on the accessible text rather than the pixels.
  const blocks = (await panel.locator('.finding-block h3').allInnerTexts()).map((text) =>
    text.trim().toLowerCase(),
  );
  expect(blocks).toEqual(expect.arrayContaining(['evidence', 'impact', 'recommendation']));
  for (const heading of ['Evidence', 'Impact', 'Recommendation']) {
    const block = panel.locator('.finding-block', { hasText: heading }).first();
    const body = (await block.innerText()).replace(new RegExp(heading, 'i'), '').trim();
    expect(body.length, `${heading} is empty`).toBeGreaterThan(10);
  }

  // --- resolve ------------------------------------------------------------
  await panel.locator('.detail').getByRole('button', { name: 'Resolve' }).click();
  // Resolved gets out of the way; it is not still asking for attention.
  await expect(panel.locator('.finding-row', { hasText: title })).toHaveCount(0);
  await expect(panel.locator('.closed-toggle')).toContainText('dismissed or resolved');

  // --- save the file ------------------------------------------------------
  // Save lives behind the panel's disclosure now.
  await openMore(page);
  const download = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save audit' }).click(),
  ]).then(([event]) => event);

  const text = readFileSync(await download.path(), 'utf8');
  const parsed = parseAuditFile(text);
  expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
  if (!parsed.ok) return;

  // The file is the work, not a summary of it: the resolution went with it.
  const resolved = parsed.value.file.findings.filter((finding) => finding.status === 'resolved');
  expect(resolved).toHaveLength(1);
  expect(resolved[0]?.title).toBe(title);
  // And every finding in it still carries something to act on.
  expect(parsed.value.file.findings.length).toBeGreaterThan(0);
  for (const finding of parsed.value.file.findings) {
    expect(finding.evidence.length, finding.ruleId).toBeGreaterThan(0);
    expect(finding.recommendation.length, finding.ruleId).toBeGreaterThan(10);
  }
});

test('flow 2: activate, select an element, read its contextual finding, add it to a report, export', async ({
  openFixture,
  activate,
  context,
}) => {
  // --- activate -----------------------------------------------------------
  await withoutPicker(context);
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await panelFor(page);

  // --- select an element --------------------------------------------------
  // Selection starts from the page toolbar now: the panel's own Select card
  // went with the density cut, and the ruler is what Select shows.
  await toolbar(page).getByRole('button', { name: 'Select' }).click();
  await expect(page.locator('thursday-root .hl-box')).toBeHidden();

  // The unlabelled image: something an audit has an opinion about.
  const target = page.locator('img').first();
  await target.hover();
  // Select draws the ruler, whose dashed outline is the mark on the element.
  await expect(page.locator('thursday-root .rl-outline')).toHaveAttribute('data-on', 'true');
  await target.click({ position: { x: 5, y: 5 } });

  /*
   * --- its measured facts appear -----------------------------------------
   *
   * On the page, in the ruler's own bar, rather than in a panel tab. The
   * Element tab and its inspector are gone: once Select grew into a ruler that
   * reads an element on hover, the tab was a second home for what the page
   * already showed.
   */
  await expect(page.locator('thursday-root .rl-hud')).toContainText('px');

  // --- audit, and find the finding about that element ---------------------
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();

  const contextual = panel.locator('.finding-row', { hasText: /alternative text|alt/i }).first();
  await expect(contextual).toBeVisible();
  const title = await contextual.locator('.finding-title').innerText();
  await contextual.click();
  await expect(panel.locator('.detail-title')).toHaveText(title);

  // --- add to report, with a note ----------------------------------------
  await panel.locator('.detail').getByRole('button', { name: 'Add to report' }).click();
  await expect(panel.locator('.detail').getByRole('button', { name: 'In report' })).toBeVisible();
  await panel.locator('.detail-note textarea').fill('Needs copy from the content team');
  await panel.locator('.detail-title').click();

  // --- export HTML --------------------------------------------------------
  // Save lives behind the panel's disclosure now.
  await openMore(page);
  const download = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save report' }).click(),
  ]).then(([event]) => event);

  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const html = readFileSync(await download.path(), 'utf8');

  // It contains exactly the finding the user chose, and the note they wrote.
  expect(html).toContain(title.replace(/&/g, '&amp;'));
  expect(html).toContain('Needs copy from the content team');
  const articles = html.match(/<article class="finding">/g) ?? [];
  expect(articles).toHaveLength(1);
  expect(html).toMatch(/further finding/);

  // And it is a deliverable, not a data dump: no scripts, nothing fetched.
  expect(html).not.toContain('<script');
  expect(html).not.toMatch(/\bsrc\s*=\s*["'](?!data:)/i);
});
