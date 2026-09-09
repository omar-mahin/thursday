import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { FIXTURE_ORIGIN, expect, openMore, panelOf, panelReady, test, testWithHostAccess, withoutPicker } from './fixtures';

/**
 * Files on disk, which is how an audit leaves this machine when the user says
 * so and never otherwise.
 *
 * The save path uses `showSaveFilePicker` when it exists, which opens a native
 * dialog that no test can drive. So these tests remove it first and exercise
 * the anchor fallback -- the same Blob, the same file name, the same bytes. The
 * picker itself is verified by hand.
 */

const openPanel = async (context: import('@playwright/test').BrowserContext, extensionId: string) => {
  const panel = await context.newPage();
  await withoutPicker(context);
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  return panel;
};

test('opening a saved audit file shows its findings, notes and statuses', async ({
  extensionId,
  context,
}) => {
  const panel = await openPanel(context, extensionId);

  await panel
    .getByLabel('Open a saved audit file')
    .setInputFiles(resolve('tests/fixtures/sample.thursday.json'));

  await expect(panel.locator('.finding-row').first()).toBeVisible();
  await expect(
    panel.locator('.finding-title', { hasText: 'Imported: image has no alternative text' }),
  ).toBeVisible();

  // It says what it is looking at, rather than passing a file off as the page.
  await expect(panel.locator('.notice')).toContainText('Opened from a file');

  // The status and note travelled with the finding.
  await panel.locator('.finding-row', { hasText: 'no clear primary action' }).first().click();
  await expect(panel.locator('.detail-note textarea')).toHaveValue('Raised with the content team');
  await expect(panel.locator('.detail').getByRole('button', { name: 'In report' })).toBeVisible();

  // And so did the comments, with the image inside one of them. The fixture is
  // hand-written rather than exported by Thursday, so this is the reading path
  // for a file the product did not produce.
  await expect(panel.locator('.comment-row')).toHaveCount(2);
  await expect(panel.locator('.comment-body').first()).toContainText(
    'the two calls to action look identical',
  );
  await expect(panel.locator('.comment-marker').nth(1)).toHaveText('B');
  await expect(panel.locator('.comment-head').nth(1)).toContainText('Whole page');
  const attached = panel.locator('.attach-grid img');
  await expect(attached).toHaveCount(1);
  await expect(attached).toHaveAttribute('alt', 'The two buttons, side by side');
  expect(await attached.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(48);
});

test('a file from a newer format is refused, not half-read', async ({ extensionId, context }) => {
  const panel = await openPanel(context, extensionId);
  await panel
    .getByLabel('Open a saved audit file')
    .setInputFiles(resolve('tests/fixtures/broken.thursday.json'));

  await expect(panel.getByRole('alert')).toContainText('newer');
  // Nothing was loaded from it.
  await expect(panel.locator('.finding-row')).toHaveCount(0);
});

test('a file that is not an audit is refused with a plain explanation', async ({
  extensionId,
  context,
}) => {
  const panel = await openPanel(context, extensionId);
  await panel.getByLabel('Open a saved audit file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"shopping":["milk"]}'),
  });
  await expect(panel.getByRole('alert')).toContainText('not a Thursday audit file');
});

testWithHostAccess(
  'a saved audit file reopens with everything the panel had',
  async ({ openFixture, activate, context, extensionId }) => {
    await withoutPicker(context);
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    const titles = await panel.locator('.finding-row .finding-title').allInnerTexts();

    await panel.locator('.detail-note textarea').fill('Look at this one first');
    await panel.locator('.detail-title').click();

    await openMore(page);
    const download = await Promise.all([
      // The panel is a frame of the page, so the download lands on the page.
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save audit' }).click(),
    ]).then(([event]) => event);

    expect(download.suggestedFilename()).toMatch(/^thursday-fixture\.thursday\.test-.*\.thursday\.json$/);
    const path = await download.path();
    const text = readFileSync(path, 'utf8');
    const parsed = JSON.parse(text) as { format: string; findings: Array<{ note?: string }> };
    expect(parsed.format).toBe('thursday.audit');
    expect(parsed.findings.some((finding) => finding.note === 'Look at this one first')).toBe(true);

    // Reopen it in a panel that has never run an audit.
    const fresh = await openPanel(context, extensionId);
    await fresh.getByLabel('Open a saved audit file').setInputFiles({
      name: 'reopened.thursday.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(fresh.locator('.finding-row').first()).toBeVisible();
    expect(await fresh.locator('.finding-row .finding-title').allInnerTexts()).toEqual(titles);
  },
);

testWithHostAccess(
  'the exported HTML report opens with no network access at all',
  async ({ openFixture, activate, context, requests }) => {
    await withoutPicker(context);
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    await openMore(page);
    const download = await Promise.all([
      // The panel is a frame of the page, so the download lands on the page.
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save report' }).click(),
    ]).then(([event]) => event);

    expect(download.suggestedFilename()).toMatch(/\.html$/);
    const html = readFileSync(await download.path(), 'utf8');

    // Serve it from a fresh origin with every other request refused, so
    // anything the report tried to load would fail visibly.
    const reader = await context.newPage();
    const reportUrl = `${FIXTURE_ORIGIN}/report.html`;
    await reader.route('**/*', async (route) => {
      if (route.request().url() === reportUrl) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
        return;
      }
      await route.abort();
    });

    const before = requests.length;
    await reader.goto(reportUrl);
    await expect(reader.locator('article.finding').first()).toBeVisible();
    await reader.waitForLoadState('networkidle');

    // The document itself, and nothing else.
    const made = requests.slice(before).filter((url) => url !== reportUrl);
    expect(made).toEqual([]);

    // It renders as a document, not as a blank page with an error.
    await expect(reader.locator('h1')).toBeVisible();
    const findings = await reader.locator('article.finding').count();
    expect(findings).toBeGreaterThan(0);
    await expect(reader.getByText('no scripts and loads nothing from the network')).toBeVisible();

    // The stylesheet arrived inline: a report with no styling would be a
    // self-contained file that still fails at being a deliverable.
    const styled = await reader.evaluate(() => {
      const heading = document.querySelector('h1');
      return heading ? getComputedStyle(heading).fontSize : '';
    });
    expect(styled).toBe('22px');
  },
);

testWithHostAccess(
  'the report contains only the findings the user chose',
  async ({ openFixture, activate, context }) => {
    await withoutPicker(context);
    const page = await openFixture('accessibility.html');
    await activate(page);

    await panelReady(page);
    const panel = panelOf(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.detail').first()).toBeVisible();

    const chosen = await panel.locator('.detail-title').innerText();
    await panel.locator('.detail').getByRole('button', { name: 'Add to report' }).click();
    await expect(panel.locator('.detail').getByRole('button', { name: 'In report' })).toBeVisible();

    await openMore(page);
    const download = await Promise.all([
      // The panel is a frame of the page, so the download lands on the page.
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save report' }).click(),
    ]).then(([event]) => event);

    const html = readFileSync(await download.path(), 'utf8');
    expect(html).toContain(chosen.replace(/&/g, '&amp;'));
    // And it says how many it left out, rather than implying that was everything.
    expect(html).toMatch(/further finding/);
  },
);
