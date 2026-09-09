import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIXTURE_ORIGIN, expect, extensionPage, openMore, panelReady, test, testWithHostAccess, withoutPicker } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Comments the user writes on a page, with images attached to them.
 *
 * Written in the card on the page, which is where the composer lives as of
 * 1.0.1: you click the element and say what you think about it next to it,
 * rather than looking away to a box in the panel. The panel keeps the list, the
 * editing and the attachments of existing comments.
 *
 * These go through the real path in every case: the element is picked by
 * clicking it on the page, the image is chosen through a real file input, the
 * bytes travel to the panel as a data URL over the port, the comment is written
 * to real IndexedDB and read back after the panel has been thrown away. Nothing
 * here reaches into the panel's state.
 */

const IMAGE = resolve('tests/fixtures/annotation-image.png');

/**
 * The panel as it ships: floating on the page being audited.
 *
 * The picker is removed first, before the frame exists -- an init script only
 * reaches frames attached after it is added, and the panel frame is attached by
 * the content script during activation.
 */
const openPanel = (page: Page): Promise<Page> => panelReady(page);

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

const CARD = 'thursday-root .cm-card';

/**
 * Waits for the screenshot sweep an audit starts.
 *
 * An audit photographs its findings, which scrolls the page and takes the
 * overlay off it for a moment. Anything that then clicks on the page has to
 * let that finish, or it is clicking at coordinates that have moved.
 */
const settle = (panel: Page): Promise<void> =>
  expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

/**
 * Writes a comment the way a person does: in the card, on the page.
 *
 * Front-and-back shuffling is not incidental. The panel is a real tab under
 * Playwright rather than a docked side panel, so only one of the two can be
 * interactable at a time -- panel buttons are dispatched while the page holds
 * the front, and the card is driven with the page in front because it takes
 * real clicks.
 *
 * Waiting for the card to close is the round trip: it only closes when the
 * panel has stored the comment and said so.
 */
async function writeOnPage(
  page: Page,
  panel: Page,
  options: { text: string; anchor?: string; files?: Parameters<Page['setInputFiles']>[1]; priority?: string },
): Promise<void> {
  await panel
    .getByRole('button', { name: options.anchor ? 'Comment on an element' : 'Comment on the page' })
    .dispatchEvent('click');
  await page.bringToFront();
  if (options.anchor) await pickOnPage(page, options.anchor);

  const card = page.locator(CARD);
  await expect(card).toBeVisible();
  if (options.priority) {
    await page.locator(`thursday-root .cm-priority[data-level="${options.priority}"]`).click();
  }
  await page.locator('thursday-root .cm-body').fill(options.text);
  if (options.files) {
    // The hidden input, not the button that proxies for it.
    await page.locator('thursday-root input[type="file"]').setInputFiles(options.files);
  }
  await page.locator('thursday-root .cm-add').click();
  await expect(card).toBeHidden({ timeout: 15_000 });
}

test('there is nowhere to write a comment until there is a page to write it on', async ({
  context,
  extensionId,
}) => {
  // The panel with no page under it, which only its own document can be.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await expect(card(panel)).toContainText('Activate Thursday on a page');
  await expect(panel.getByRole('button', { name: 'Comment on an element' })).toHaveCount(0);
});

testWithHostAccess(
  'a note written before any audit is kept, and the audit adopts it',
  async ({
  openFixture,
  activate,
  context,
}) => {
    /*
     * Comments used to require an audit, because a comment is stored against
     * the audit it was written on. That is an implementation detail, and as a
     * product rule it was wrong: you open Thursday on a page, see something,
     * and want to write it down -- being told to run a thirty-rule audit first
     * is a refusal dressed as a workflow.
     *
     * Notes now go to a home of their own per origin, and the next audit of
     * that origin adopts them through the same mechanism a re-audit already
     * uses to carry comments forward.
     */
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);

    // No audit anywhere yet.
    await openMore(page);
    await expect(panel.locator('.history-row')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Full audit' })).toBeEnabled();

    // And Comment is available on the page, not greyed out.
    await expect(page.locator('thursday-root [data-action="comment"]')).toBeEnabled();

    await writeOnPage(page, panel, { text: 'Noticed before auditing anything.', priority: 'high' });
    await expect(panel.locator('.comment-body')).toHaveText('Noticed before auditing anything.');
    await expect(panel.locator('.comment-priority')).toHaveText('High');

    // Now audit. The note is part of it rather than stranded beside it.
    await page.bringToFront();
    await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
    await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
    await settle(panel);

    await expect(panel.locator('.comment-body')).toHaveText('Noticed before auditing anything.');
    await expect(panel.locator('.comment-row')).toHaveCount(1);

    // Including in the file, which is where it has to end up to be any use --
    // and the note's own bucket id must not travel in one.
    // Save lives behind the panel's disclosure now.
    await openMore(page);
    const download = await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save audit' }).click(),
    ]).then(([event]) => event);
    const text = readFileSync(await download.path(), 'utf8');
    const parsed = JSON.parse(text) as {
      audit?: { id?: string };
      annotations?: { auditId?: string; body?: string }[];
    };
    expect(parsed.annotations?.[0]?.body).toBe('Noticed before auditing anything.');
    expect(text).not.toContain('notes:');
  },
);

testWithHostAccess(
  'a comment can be anchored to an element by clicking it on the page',
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    // Ask the page for an anchor, then click something on the page.
    await panel.getByRole('button', { name: 'Comment on an element' }).click();
    await expect(panel.locator('.notice', { hasText: 'Click the element you want' })).toBeVisible();

    await page.bringToFront();
    await pickOnPage(page, 'h1');

    // The card opens on the page, next to what was picked, and the element
    // stays outlined so nobody comments on the wrong thing.
    await expect(page.locator(CARD)).toBeVisible();
    await expect(page.locator('thursday-root .hl-box')).toBeVisible();

    await page.locator('thursday-root .cm-body').fill('This headline says nothing about the product.');
    await page.locator('thursday-root .cm-add').click();
    await expect(page.locator(CARD)).toBeHidden({ timeout: 15_000 });

    await expect(panel.locator('.comment-row')).toHaveCount(1);
    await expect(panel.locator('.comment-body')).toHaveText(
      'This headline says nothing about the product.',
    );
    // Lettered, and the anchor is remembered.
    await expect(panel.locator('.comment-marker')).toHaveText('A');
    await expect(panel.locator('.comment-head')).toContainText('<h1>');

    // The card is closed and its anchor released, so the next comment does not
    // silently inherit this one's element.
    await expect(page.locator(CARD)).toBeHidden();

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
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    // No element: the card opens unanchored. This is a first-class thing to
    // write, not a fallback -- "the flow asks for the email twice" is about no
    // single element -- and it was briefly the one thing the on-page composer
    // could not do.
    await writeOnPage(page, panel, { text: 'The whole flow asks for the email twice.' });

    await expect(panel.locator('.comment-head')).toContainText('Whole page');
    // No anchor means no pin: putting one somewhere arbitrary would claim a
    // place on the page the user never chose.
    await expect(page.locator('thursday-root .pin[data-kind="comment"]')).toHaveCount(0);
  },
);

testWithHostAccess(
  'an image can be attached to a comment and is scaled before it is stored',
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    await panel.getByRole('button', { name: 'Comment on the page' }).dispatchEvent('click');
    await page.bringToFront();
    await expect(page.locator(CARD)).toBeVisible();
    await page.locator('thursday-root .cm-body').fill('Here is what it looks like.');
    await page.locator('thursday-root input[type="file"]').setInputFiles(IMAGE);
    // Queued and named before it is committed, so a wrong file can be removed.
    await expect(page.locator('thursday-root .cm-queue li')).toHaveCount(1);
    await expect(page.locator('thursday-root .cm-queue li')).toContainText('annotation-image.png');

    await page.locator('thursday-root .cm-add').click();
    await expect(page.locator(CARD)).toBeHidden({ timeout: 15_000 });

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
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    await panel.getByRole('button', { name: 'Comment on the page' }).dispatchEvent('click');
    await page.bringToFront();
    await page.locator('thursday-root .cm-body').fill('Text worth keeping.');
    await page.locator('thursday-root input[type="file"]').setInputFiles([
      { name: 'spec.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
      { name: 'annotation-image.png', mimeType: 'image/png', buffer: readFileSync(IMAGE) },
    ]);
    await page.locator('thursday-root .cm-add').click();

    /*
     * Refused on the page, before anything crosses to the panel.
     *
     * The card is where the file was chosen, so the card is where the refusal
     * belongs -- and it stays open holding the words, because losing somebody's
     * writing over one bad attachment would be the wrong trade.
     */
    await expect(page.locator('thursday-root .cm-error')).toContainText('Only PNG, JPEG and WebP');
    await expect(page.locator(CARD)).toBeVisible();
    await expect(page.locator('thursday-root .cm-body')).toHaveValue('Text worth keeping.');
  },
);

testWithHostAccess(
  'comments and their images survive the panel being closed',
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);
    await writeOnPage(page, panel, { text: 'Written before the panel closed.', files: IMAGE });
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);

    /*
     * A brand new page, and so a brand new panel: the panel floats on the page,
     * so this is what closing it amounts to. The comment has to come back out
     * of storage rather than out of the memory of the thing that wrote it.
     */
    await page.close();
    await withoutPicker(context);
    const later = await openFixture('cro.html');
    await activate(later);
    const fresh = await openPanel(later);
    await openMore(later);
    await fresh.locator('.history-open').first().click();
    await expect(fresh.locator('.comment-body')).toHaveText('Written before the panel closed.');
    const image = fresh.locator('.attach-grid img');
    await expect(image).toHaveCount(1);
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(48);
  },
);

testWithHostAccess(
  'deleting an audit takes its comments and their images with it',
  async ({ openFixture, activate, context, extensionId }) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);
    await writeOnPage(page, panel, { text: 'About to be deleted.', files: IMAGE });
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);

    await openMore(page);
    await panel.locator('.history-row button.icon').first().click();
    await panel.locator('.history-row button.danger').click();
    await openMore(page);
    await expect(panel.locator('.history-row')).toHaveCount(0);

    // Orphans would be space the user can neither see nor reclaim.
    const left = await (await extensionPage(context, extensionId)).evaluate(
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
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    await writeOnPage(page, panel, { text: 'First thought.' });
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
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    await writeOnPage(page, panel, { text: 'Pin me.', anchor: 'h1' });
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
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);
    await writeOnPage(page, panel, { text: 'Carried in the file.', files: IMAGE });
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);

    // Save lives behind the panel's disclosure now.
    await openMore(page);
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

    const fresh = await openPanel(page);
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
  async ({ openFixture, activate, context, requests }) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);
    await writeOnPage(page, panel, { text: 'Reported opinion, not a measurement.', files: IMAGE });
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);

    // Save lives behind the panel's disclosure now.
    await openMore(page);
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
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);
    await writeOnPage(page, panel, {
      text: 'Exact when made, approximate after a reload.',
      anchor: 'h1',
    });
    await expect(panel.locator('.comment-row')).toHaveCount(1);

    // Save lives behind the panel's disclosure now.
    await openMore(page);
    const download = await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save audit' }).click(),
    ]).then(([event]) => event);
    const text = readFileSync(await download.path(), 'utf8');

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

    const fresh = await openPanel(page);
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
  async ({ openFixture, activate, context, extensionId }) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);

    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    await panel.getByRole('button', { name: 'Comment on an element' }).click();
    await page.bringToFront();
    await pickOnPage(page, 'h1');
    await writeOnPage(page, panel, { text: 'Still here after the second run.', files: IMAGE });
    await expect(panel.locator('.attach-grid img')).toHaveCount(1);

    // Run it again, the way somebody does after fixing something.
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await openMore(page);
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
    const counts = await (await extensionPage(context, extensionId)).evaluate(
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
    // Save lives behind the panel's disclosure now.
    await openMore(page);
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

testWithHostAccess(
  'a comment carries its author and its priority, and both survive a file',
  async ({ openFixture, activate, context, extensionId }) => {
    /*
     * The two fields the on-page card added.
     *
     * Both are the author's, not Thursday's: the name is what they typed about
     * themselves and the priority is how urgent they think their own opinion
     * is. Neither is a measurement, which is why the priority is kept in
     * different words and a different scale from a finding's severity.
     *
     * Followed all the way through a saved file and back into a panel that
     * never saw the page, because that is the journey that matters -- a report
     * handed to somebody else is most of the point of writing the name down.
     */
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extensionId}/options.html`);
    await settings.getByLabel('Your name').fill('Md Omar Faruque');
    await settings.close();

    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    // The card knows who is writing without being told again.
    await panel.getByRole('button', { name: 'Comment on the page' }).dispatchEvent('click');
    await page.bringToFront();
    await expect(page.locator('thursday-root .cm-who')).toHaveText('Md Omar Faruque');
    await page.locator('thursday-root .cm-priority[data-level="high"]').click();
    await expect(page.locator('thursday-root .cm-priority[data-level="high"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.locator('thursday-root .cm-body').fill('The price is hidden until checkout.');
    await page.locator('thursday-root .cm-add').click();
    await expect(page.locator(CARD)).toBeHidden({ timeout: 15_000 });

    await expect(panel.locator('.comment-priority')).toHaveText('High');
    await expect(panel.locator('.comment-row')).toContainText('Md Omar Faruque');

    // Save lives behind the panel's disclosure now.
    await openMore(page);
    const download = await Promise.all([
      panel.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save audit' }).click(),
    ]).then(([event]) => event);
    const text = readFileSync(await download.path(), 'utf8');
    const parsed = JSON.parse(text) as {
      annotations?: { author?: string; priority?: string }[];
    };
    expect(parsed.annotations?.[0]?.author).toBe('Md Omar Faruque');
    expect(parsed.annotations?.[0]?.priority).toBe('high');

    // And back into a panel that has never seen this page.
    const fresh = await openPanel(page);
    await fresh.getByLabel('Open a saved audit file').setInputFiles({
      name: 'carried.thursday.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text, 'utf8'),
    });
    await expect(fresh.locator('.comment-priority')).toHaveText('High');
    await expect(fresh.locator('.comment-row')).toContainText('Md Omar Faruque');
  },
);

testWithHostAccess(
  'the priority can be changed afterwards, and editing the words does not invent one',
  async ({
  openFixture,
  activate,
  context,
}) => {
    await withoutPicker(context);
    const page = await openFixture('cro.html');
    await activate(page);
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Full audit' }).click();
    await expect(panel.locator('.finding-row').first()).toBeVisible();
    await settle(panel);

    // Written with no priority chosen, so it has none.
    await writeOnPage(page, panel, { text: 'Worth a look.' });
    await expect(panel.locator('.comment-priority')).toHaveCount(0);

    // Raised in the panel afterwards, which is where comments are managed.
    await panel.getByRole('button', { name: 'Edit' }).click();
    await panel.getByRole('radio', { name: 'Medium' }).click();
    await panel.locator('.comment-row').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel.locator('.comment-priority')).toHaveText('Medium');

    // Editing only the words leaves it where the author put it.
    await panel.getByRole('button', { name: 'Edit' }).click();
    await panel.getByLabel('Edit comment A').fill('Worth a proper look.');
    await panel.locator('.comment-row').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel.locator('.comment-body')).toHaveText('Worth a proper look.');
    await expect(panel.locator('.comment-priority')).toHaveText('Medium');
  },
);
