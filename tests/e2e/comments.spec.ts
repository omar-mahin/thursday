import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, testWithHostAccess, FIXTURE_ORIGIN } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Comments the user writes on a page, with images attached to them.
 *
 * These go through the real path in every case: the element is picked by
 * clicking it on the page, the image is chosen through a real file input, the
 * comment is written to real IndexedDB and read back after the panel has been
 * thrown away. Nothing here reaches into the panel's state.
 */

const IMAGE = resolve('tests/fixtures/annotation-image.png');

async function withoutPicker(panel: Page): Promise<void> {
  await panel.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
}

const openPanel = async (context: BrowserContext, extensionId: string): Promise<Page> => {
  const panel = await context.newPage();
  await withoutPicker(panel);
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
};

const card = (panel: Page) =>
  panel.locator('.card', { has: panel.locator('.section-title', { hasText: 'Comments' }) });

/**
 * Picks an element the way a person does.
 *
 * The move and the click are separate steps on purpose: hover feedback is
 * evaluated on a rAF tick, and the picker only knows what is under the pointer
 * once that tick has run. A single `locator.click()` outruns it.
 */
async function pickOnPage(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} is not on the page`);
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.click(box.x + 5, box.y + 5);
}

test('there is nowhere to write a comment until there is an audit to attach it to', async ({
  extensionId,
  context,
}) => {
  const panel = await openPanel(context, extensionId);
  await expect(card(panel)).toContainText('Run or open an audit first');
  await expect(panel.getByRole('button', { name: 'Comment on an element' })).toHaveCount(0);
});

testWithHostAccess(
  'a comment can be anchored to an element by clicking it on the page',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    // Ask the page for an anchor, then click something on the page.
    await panel.getByRole('button', { name: 'Comment on an element' }).click();
    await expect(panel.locator('.notice', { hasText: 'Click the element you want' })).toBeVisible();

    await page.bringToFront();
    await pickOnPage(page, 'h1');

    await panel.bringToFront();
    // The panel names what was picked, so nobody comments on the wrong thing.
    await expect(card(panel)).toContainText('Anchored to');
    await expect(card(panel).locator('.mono')).toContainText('<h1>');

    await panel.getByLabel('Comment', { exact: true }).fill('This headline says nothing about the product.');
    await panel.getByRole('button', { name: 'Add comment' }).click();

    await expect(panel.locator('.comment-row')).toHaveCount(1);
    await expect(panel.locator('.comment-body')).toHaveText(
      'This headline says nothing about the product.',
    );
    // Lettered, and the anchor is remembered.
    await expect(panel.locator('.comment-marker')).toHaveText('A');
    await expect(panel.locator('.comment-head')).toContainText('<h1>');

    // The compose box is empty again and the anchor released, so the next
    // comment does not silently inherit this one's element.
    await expect(panel.getByLabel('Comment', { exact: true })).toHaveValue('');
    await expect(card(panel)).toContainText('No anchor');

    // And the page draws a comment pin, distinct from the finding pins.
    const pin = page.locator('thursday-root .pin[data-kind="comment"]');
    await expect(pin).toHaveCount(1);
    await expect(pin).toHaveText('A');
    await expect(pin).toHaveAttribute('aria-label', 'Comment A');
    // Exact, not approximate: this comment was made against the snapshot the
    // page is still holding, so the element was found without searching.
    await expect(pin).toHaveAttribute('data-approximate', 'false');
    expect(await page.locator('thursday-root .pin[data-kind="finding"]').count()).toBeGreaterThan(0);
  },
);

testWithHostAccess(
  'a comment about the page as a whole needs no element and gets no pin',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    await panel.getByLabel('Comment', { exact: true }).fill('The whole flow asks for the email twice.');
    await panel.getByRole('button', { name: 'Add comment' }).click();

    await expect(panel.locator('.comment-head')).toContainText('Whole page');
    // No anchor means no pin: putting one somewhere arbitrary would claim a
    // place on the page the user never chose.
    await expect(page.locator('thursday-root .pin[data-kind="comment"]')).toHaveCount(0);
  },
);

testWithHostAccess(
  'an image can be attached to a comment and is scaled before it is stored',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    await panel.getByLabel('Comment', { exact: true }).fill('Here is what it looks like.');
    await panel.getByLabel('Attach images to this comment').setInputFiles(IMAGE);
    // Queued and named before it is committed, so a wrong file can be removed.
    await expect(panel.locator('.attach-queue li')).toHaveCount(1);
    await expect(panel.locator('.attach-queue li')).toContainText('annotation-image.png');

    await panel.getByRole('button', { name: 'Add comment' }).click();

    const image = panel.locator('.attach-grid img');
    await expect(image).toHaveCount(1);
    // The stored copy keeps its real dimensions: this one is already under the
    // ceiling, so it is passed through rather than re-encoded.
    await expect(image).toHaveAttribute('width', '48');
    await expect(image).toHaveAttribute('height', '32');
    await expect(image).toHaveAttribute('alt', /Image attached to comment A/);
    // It really decoded, rather than rendering as a broken image.
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(48);
  },
);

testWithHostAccess(
  'a file that is not an image is refused by name, and the comment still saves',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    await panel.getByLabel('Comment', { exact: true }).fill('Text worth keeping.');
    await panel.getByLabel('Attach images to this comment').setInputFiles([
      { name: 'spec.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
      { name: 'annotation-image.png', mimeType: 'image/png', buffer: readFileSync(IMAGE) },
    ]);
    await panel.getByRole('button', { name: 'Add comment' }).click();

    await expect(panel.getByRole('alert')).toContainText('spec.pdf');
    await expect(panel.getByRole('alert')).toContainText('Only PNG, JPEG and WebP');
    // Losing the words over one bad attachment would be the wrong trade, and
    // the image that was fine went through.
    await expect(panel.locator('.comment-body')).toHaveText('Text worth keeping.');
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);
  },
);

testWithHostAccess(
  'comments and their images survive the panel being closed',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await panel.getByLabel('Comment', { exact: true }).fill('Written before the panel closed.');
    await panel.getByLabel('Attach images to this comment').setInputFiles(IMAGE);
    await panel.getByRole('button', { name: 'Add comment' }).click();
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);
    await panel.close();

    // A brand new panel, reopening the audit from history.
    const fresh = await openPanel(context, extensionId);
    await fresh.locator('.history-open').first().click();
    await expect(fresh.locator('.comment-body')).toHaveText('Written before the panel closed.');
    const image = fresh.locator('.attach-grid img');
    await expect(image).toHaveCount(1);
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(48);
  },
);

testWithHostAccess(
  'deleting an audit takes its comments and their images with it',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await panel.getByLabel('Comment', { exact: true }).fill('About to be deleted.');
    await panel.getByLabel('Attach images to this comment').setInputFiles(IMAGE);
    await panel.getByRole('button', { name: 'Add comment' }).click();
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);

    await panel.locator('.history-row button.icon').first().click();
    await panel.locator('.history-row button.danger').click();
    await expect(panel.locator('.history-row')).toHaveCount(0);

    // Orphans would be space the user can neither see nor reclaim.
    const left = await panel.evaluate(
      () =>
        new Promise<{ annotations: number; attachments: number }>((done, fail) => {
          const request = indexedDB.open('thursday');
          request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction(['annotations', 'attachments'], 'readonly');
            const annotations = read.objectStore('annotations').count();
            const attachments = read.objectStore('attachments').count();
            read.oncomplete = () =>
              done({ annotations: annotations.result, attachments: attachments.result });
            read.onerror = () => fail(read.error);
          };
          request.onerror = () => fail(request.error);
        }),
    );
    expect(left).toEqual({ annotations: 0, attachments: 0 });
  },
);

testWithHostAccess(
  'a comment can be edited and deleted',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    await panel.getByLabel('Comment', { exact: true }).fill('First thought.');
    await panel.getByRole('button', { name: 'Add comment' }).click();
    await expect(panel.locator('.comment-body')).toHaveText('First thought.');

    await panel.getByRole('button', { name: 'Edit' }).click();
    await panel.getByLabel('Edit comment A').fill('Second, better thought.');
    await panel.locator('.comment-row').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel.locator('.comment-body')).toHaveText('Second, better thought.');

    // Deletion asks first: a comment is somebody's writing, not a checkbox.
    await panel.locator('.comment-row').getByRole('button', { name: 'Delete' }).click();
    await expect(panel.getByRole('button', { name: 'Keep' })).toBeVisible();
    await panel.locator('.comment-row button.danger').click();
    await expect(panel.locator('.comment-row')).toHaveCount(0);
  },
);

testWithHostAccess(
  'clicking a comment pin on the page opens that comment in the panel',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    await panel.getByRole('button', { name: 'Comment on an element' }).click();
    await page.bringToFront();
    await pickOnPage(page, 'h1');
    await panel.bringToFront();
    await panel.getByLabel('Comment', { exact: true }).fill('Pin me.');
    await panel.getByRole('button', { name: 'Add comment' }).click();
    await expect(panel.locator('.comment-row')).toHaveCount(1);

    // Dispatched rather than clicked: focusing the page would hide the panel.
    await page.locator('thursday-root .pin[data-kind="comment"]').dispatchEvent('click');
    await expect(panel.locator('.comment-row[data-current="true"]')).toHaveCount(1);
    await expect(page.locator('thursday-root .pin[data-kind="comment"]')).toHaveAttribute(
      'data-active',
      'true',
    );
  },
);

testWithHostAccess(
  'comments travel in a saved audit file and reopen in a panel that never saw the page',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await panel.getByLabel('Comment', { exact: true }).fill('Carried in the file.');
    await panel.getByLabel('Attach images to this comment').setInputFiles(IMAGE);
    await panel.getByRole('button', { name: 'Add comment' }).click();
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);

    const download = await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save audit' }).click(),
    ]).then(([event]) => event);
    const text = readFileSync(await download.path(), 'utf8');
    const parsed = JSON.parse(text) as {
      version: number;
      annotations?: Array<{ body: string; attachments: Array<{ id: string }> }>;
      attachments?: Record<string, string>;
    };
    expect(parsed.version).toBe(2);
    expect(parsed.annotations?.[0]?.body).toBe('Carried in the file.');
    const attachmentId = parsed.annotations?.[0]?.attachments[0]?.id ?? '';
    expect(parsed.attachments?.[attachmentId]).toMatch(/^data:image\/png;base64,/);

    const fresh = await openPanel(context, extensionId);
    await fresh.getByLabel('Open a saved audit file').setInputFiles({
      name: 'reopened.thursday.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(fresh.locator('.comment-body')).toHaveText('Carried in the file.');
    const image = fresh.locator('.attach-grid img');
    await expect(image).toHaveCount(1);
    // The data URL really became an image again, not a broken one.
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(48);
  },
);

testWithHostAccess(
  'the HTML report carries comments in their own section and loads nothing',
  async ({ openFixture, activate, extensionId, context, requests }) => {
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await panel.getByLabel('Comment', { exact: true }).fill('Reported opinion, not a measurement.');
    await panel.getByLabel('Attach images to this comment').setInputFiles(IMAGE);
    await panel.getByRole('button', { name: 'Add comment' }).click();
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);

    const download = await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save report' }).click(),
    ]).then(([event]) => event);
    const html = readFileSync(await download.path(), 'utf8');

    // Serve it from a fresh origin with every other request refused, so
    // anything the report tried to load would fail visibly.
    const reader = await context.newPage();
    const reportUrl = `${FIXTURE_ORIGIN}/comments-report.html`;
    await reader.route('**/*', async (route) => {
      if (route.request().url() === reportUrl) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
        return;
      }
      await route.abort();
    });
    const before = requests.length;
    await reader.goto(reportUrl);

    await expect(reader.locator('h2', { hasText: 'Comments' })).toBeVisible();
    await expect(reader.locator('.finding.comment .body')).toHaveText(
      'Reported opinion, not a measurement.',
    );
    await expect(reader.locator('.comments')).toContainText('observations and opinions');
    const embedded = reader.locator('.finding.comment img');
    await expect(embedded).toHaveCount(1);
    expect(await embedded.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(48);

    // One request: the report itself.
    expect(requests.slice(before)).toEqual([reportUrl]);
  },
);

testWithHostAccess(
  'a comment reopened after a reload is pinned by searching the page, and says so',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await panel.getByRole('button', { name: 'Comment on an element' }).click();
    await page.bringToFront();
    await pickOnPage(page, 'h1');
    await panel.bringToFront();
    await panel
      .getByLabel('Comment', { exact: true })
      .fill('Exact when made, approximate after a reload.');
    await panel.getByRole('button', { name: 'Add comment' }).click();
    await expect(panel.locator('.comment-row')).toHaveCount(1);

    const download = await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save audit' }).click(),
    ]).then(([event]) => event);
    const text = readFileSync(await download.path(), 'utf8');
    await panel.close();

    /*
     * The page has to be reloaded, not just the panel reopened.
     *
     * Opening the file in the same page session legitimately keeps the exact
     * fast path: the file carries the digest of the audit that is still loaded,
     * so the recorded index really does refer to the elements the content
     * script is still holding. Only a reload throws those away -- and the same
     * wrong premise cost time on the stored-audit test in Sprint 5.
     */
    await page.reload();
    await activate(page);

    const fresh = await openPanel(context, extensionId);
    await fresh.getByLabel('Open a saved audit file').setInputFiles({
      name: 'reopened.thursday.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(fresh.locator('.comment-body')).toHaveText(
      'Exact when made, approximate after a reload.',
    );

    // Found by searching the live page, and drawn dashed to say so. Trusting
    // the recorded index would put a confident pin on whatever element landed
    // at that position in a capture this session never took.
    const pin = page.locator('thursday-root .pin[data-kind="comment"]');
    await expect(pin).toHaveCount(1);
    await expect(pin).toHaveAttribute('data-approximate', 'true');
    await expect(pin).toHaveAttribute('aria-label', 'Comment A, position approximate');
  },
);

testWithHostAccess(
  'comments survive a re-audit of the same page',
  async ({ openFixture, activate, extensionId, context }) => {
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(context, extensionId);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();

    await panel.getByRole('button', { name: 'Comment on an element' }).click();
    await page.bringToFront();
    await pickOnPage(page, 'h1');
    await panel.bringToFront();
    await panel.getByLabel('Comment', { exact: true }).fill('Still here after the second run.');
    await panel.getByLabel('Attach images to this comment').setInputFiles(IMAGE);
    await panel.getByRole('button', { name: 'Add comment' }).click();
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);

    // Run it again, the way somebody does after fixing something.
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.compare')).toBeVisible();

    /*
     * The comment is about the page, not about one run over it. Losing it here
     * would be data loss with no warning: write a review, re-run to check a
     * fix, review gone.
     */
    await expect(panel.locator('.comment-body')).toHaveText('Still here after the second run.');
    const image = panel.locator('.attach-grid img');
    await expect(image).toHaveCount(1);
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(48);

    // Still exactly one copy on disk, not one per run.
    const counts = await panel.evaluate(
      () =>
        new Promise<{ annotations: number; attachments: number }>((done, fail) => {
          const request = indexedDB.open('thursday');
          request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction(['annotations', 'attachments'], 'readonly');
            const annotations = read.objectStore('annotations').count();
            const attachments = read.objectStore('attachments').count();
            read.oncomplete = () =>
              done({ annotations: annotations.result, attachments: attachments.result });
            read.onerror = () => fail(read.error);
          };
          request.onerror = () => fail(request.error);
        }),
    );
    expect(counts).toEqual({ annotations: 1, attachments: 1 });

    // And it is still in the file the second audit exports.
    const download = await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save audit' }).click(),
    ]).then(([event]) => event);
    const parsed = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
      audit: { id: string };
      annotations?: Array<{ auditId: string; body: string }>;
    };
    expect(parsed.annotations?.[0]?.body).toBe('Still here after the second run.');
    expect(parsed.annotations?.[0]?.auditId).toBe(parsed.audit.id);
  },
);
