import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, openMore, panelOf, panelReady, testWithHostAccess as test, withoutPicker } from './fixtures';
import type { BrowserContext, FrameLocator, Page } from '@playwright/test';

/**
 * The PDF export, checked against a real PDF reader.
 *
 * The unit tests parse the file Thursday wrote and prove the cross-reference
 * table is internally consistent, which is the failure a hand-written
 * container is most likely to have. What they cannot show is that a reader
 * agrees -- so these open the downloaded file in Chrome's own viewer, which is
 * PDFium and is what most people will open it in.
 *
 * The viewer is an opaque extension frame: no title, no text, no page count
 * can be read out of it. What can be read is the pixels, so that is what is
 * asserted.
 */

const IMAGE = resolve('tests/fixtures/annotation-image.png');


/**
 * How much of a screenshot is a printed page with text on it.
 *
 * Counts white (the sheet) and dark pixels that have white within forty pixels
 * either side (ink sitting on that sheet, rather than the viewer's own dark
 * chrome). Chrome's "could not load" screen scores an order of magnitude lower
 * on both, which is what makes this a usable check.
 */
async function inkOnPage(context: BrowserContext, shot: Buffer): Promise<{ sheet: number; ink: number }> {
  const helper = await context.newPage();
  try {
    return await helper.evaluate(async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context2d = canvas.getContext('2d');
      if (!context2d) throw new Error('no 2d context');
      context2d.drawImage(bitmap, 0, 0);
      const { data } = context2d.getImageData(0, 0, bitmap.width, bitmap.height);
      const luma = (index: number): number => (data[index]! + data[index + 1]! + data[index + 2]!) / 3;
      let sheet = 0;
      let ink = 0;
      for (let y = 0; y < bitmap.height; y += 1) {
        for (let x = 0; x < bitmap.width; x += 1) {
          const index = (y * bitmap.width + x) * 4;
          const value = luma(index);
          if (value > 235) {
            sheet += 1;
            continue;
          }
          if (value >= 120) continue;
          for (let dx = -40; dx <= 40; dx += 8) {
            const near = (y * bitmap.width + Math.min(bitmap.width - 1, Math.max(0, x + dx))) * 4;
            if (luma(near) > 235) {
              ink += 1;
              break;
            }
          }
        }
      }
      return { sheet, ink };
    }, shot.toString('base64'));
  } finally {
    await helper.close();
  }
}


/**
 * Writes a comment in the card on the page, which is where the composer lives.
 *
 * The panel is a real tab here rather than a docked side panel, so only one of
 * the two can take real clicks at a time -- hence the shuffling.
 */
async function comment(
  page: Page,
  panel: FrameLocator,
  text: string,
  files?: string,
  priority?: 'medium' | 'high',
): Promise<void> {
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });
  await panel.getByRole('button', { name: 'Comment on the page' }).click();
  const card = page.locator('thursday-root .cm-card');
  await expect(card).toBeVisible();
  if (priority) await page.locator(`thursday-root .cm-priority[data-level="${priority}"]`).click();
  await page.locator('thursday-root .cm-body').fill(text);
  if (files) await page.locator('thursday-root input[type="file"]').setInputFiles(files);
  await page.locator('thursday-root .cm-add').click();
  await expect(card).toBeHidden({ timeout: 15_000 });
}

test('the PDF export is a file a real reader renders', async ({
  openFixture,
  activate,
  context,
}) => {
  await withoutPicker(context);
  const page = await openFixture('accessibility.html');
  await activate(page);

  await panelReady(page);
  const panel = panelOf(page);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();

  // Save lives behind the panel's disclosure now.
  await openMore(page);
  const download = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save PDF' }).click(),
  ]).then(([event]) => event);

  expect(download.suggestedFilename()).toMatch(/^thursday-report-fixture\.thursday\.test-.*\.pdf$/);
  const path = await download.path();
  const bytes = readFileSync(path);

  // The envelope, before anything tries to render it.
  expect(bytes.subarray(0, 9).toString('latin1')).toBe('%PDF-1.7\n');
  expect(bytes.subarray(-6).toString('latin1')).toBe('%%EOF\n');
  expect(bytes.length).toBeGreaterThan(2000);

  /*
   * And now a real reader. The viewer is an opaque extension frame -- its
   * title and page count cannot be read back -- so what is asserted is the
   * pixels: a white sheet with a page of text on it.
   *
   * Worth being clear about what this does and does not prove. PDFium
   * reconstructs a damaged cross-reference table by scanning for objects, so a
   * file with every offset wrong still renders here identically. Structural
   * correctness is the unit tests' job (tests/unit/pdf.test.ts parses the xref
   * and checks every offset). This proves the document reaches a reader and
   * comes out looking like a report, which those cannot.
   */
  const reader = await context.newPage();
  await reader.setViewportSize({ width: 900, height: 1000 });
  const failures: string[] = [];
  reader.on('pageerror', (error) => failures.push(String(error)));
  await reader.goto(`file://${path}#zoom=100`);
  await reader.waitForTimeout(2500);
  const { sheet, ink } = await inkOnPage(context, await reader.screenshot());
  expect(failures).toEqual([]);
  // Chrome's failure screen measures around 69,000 and 14,000 respectively.
  expect(sheet).toBeGreaterThan(300_000);
  expect(ink).toBeGreaterThan(40_000);
});

test('the PDF carries the findings, the notes and the comments', async ({
  openFixture,
  activate,
  context,
}) => {
  await withoutPicker(context);
  const page = await openFixture('accessibility.html');
  await activate(page);

  await panelReady(page);
  const panel = panelOf(page);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();

  await panel.locator('.detail-note textarea').fill('Raised with the design team');
  await panel.locator('.detail-title').click();

  await comment(page, panel, 'The form asks for the same thing twice.', IMAGE, 'high');
  await expect(panel.locator('.attach-grid img')).toHaveCount(1);

  // Save lives behind the panel's disclosure now.
  await openMore(page);
  const download = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save PDF' }).click(),
  ]).then(([event]) => event);
  const bytes = readFileSync(await download.path()).toString('latin1');

  // Content streams are uncompressed on purpose, so what the reader will draw
  // can be read straight out of the file. See pdf/layout.ts.
  const drawn = [...bytes.matchAll(/\((?:\\.|[^()\\])*\) Tj/g)]
    .map((match) => match[0].slice(1, -4).replace(/\\([()\\])/g, '$1'))
    .join(' ');

  expect(drawn).toContain('fixture.thursday.test');
  expect(drawn).toContain('Raised with the design team');
  expect(drawn).toContain('The form asks for the same thing twice.');
  expect(drawn).toContain('COMMENTS');
  expect(drawn).toContain('observations and opinions, not measurements');
  // The author's own priority, in the author's own words, kept off the
  // severity ladder that findings sit on.
  expect(drawn).toContain('High priority');

  // The attached image is embedded as JPEG through DCTDecode, and there is
  // nothing in the file that points anywhere else.
  expect(bytes).toContain('/Filter /DCTDecode');
  expect(bytes).not.toContain('/URI (http://');
  expect(bytes).toMatch(/\/URI \(https:\/\/fixture\.thursday\.test/);
});

test('the PDF names the characters it could not draw instead of mangling them', async ({
  openFixture,
  activate,
  context,
}) => {
  await withoutPicker(context);
  const page = await openFixture('accessibility.html');
  await activate(page);

  await panelReady(page);
  const panel = panelOf(page);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();

  // A comment in a script the base-14 fonts have no glyphs for.
  await comment(page, panel, '価格表が読めない');
  await expect(panel.locator('.comment-row')).toHaveCount(1);

  // Save lives behind the panel's disclosure now.
  await openMore(page);
  const download = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save PDF' }).click(),
  ]).then(([event]) => event);
  const bytes = readFileSync(await download.path()).toString('latin1');
  const drawn = [...bytes.matchAll(/\((?:\\.|[^()\\])*\) Tj/g)]
    .map((match) => match[0].slice(1, -4).replace(/\\([()\\])/g, '$1'))
    .join(' ');

  expect(drawn).toContain('????????');
  expect(drawn).toContain('8 characters in this audit could not be drawn');
  expect(drawn).toContain('The HTML report keeps them exactly as they appear on the page.');
});
