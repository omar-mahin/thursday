import { expect, openMoreIn, testWithCapture as test } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * The panel after its service worker has been collected.
 *
 * MV3 workers are meant to die. A connected port keeps one alive while
 * messages flow and for a while after, but leave the panel open and read a
 * report for a few minutes and the worker goes -- which disconnects the panel's
 * port to it.
 *
 * The content script always reconnected. The panel did not: it set its port to
 * null and left it, so every later message was dropped silently. Nothing looked
 * broken, because the findings were still on screen -- but every control that
 * talks to the page had stopped working, and a request that expects an answer
 * waited for one that could never arrive. That was a Capture button reading
 * "Capturing..." for five minutes with no error next to it.
 *
 * The worker is stopped here through the DevTools protocol rather than by
 * waiting for Chrome to collect it, which would make this a five-minute test.
 * Note that `worker.evaluate` hangs rather than throwing once it is gone, so
 * nothing below touches the worker fixture after the kill.
 */

const openPanel = async (context: BrowserContext, extensionId: string): Promise<Page> => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  return panel;
};

async function killWorker(context: BrowserContext, page: Page): Promise<void> {
  const session = await context.newCDPSession(page);
  await session.send('ServiceWorker.enable');
  await session.send('ServiceWorker.stopAllWorkers');
  await session.detach();
}

test('the panel keeps working after the service worker is collected', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);

  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.detail')).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  await killWorker(context, panel);

  /*
   * Everything from here is a round trip the panel can only make over a port it
   * has re-established for itself. Retake is the one the bug was reported
   * against; it also proves the page is still answering, since the picture can
   * only come from a live content script.
   */
  await panel.locator('.detail').getByRole('button', { name: 'Remove' }).dispatchEvent('click');
  await expect(panel.locator('.shot-figure img')).toHaveCount(0);

  await page.bringToFront();
  await panel.locator('.detail').getByRole('button', { name: 'Capture' }).dispatchEvent('click');
  await expect(panel.locator('.shot-figure img')).toBeVisible({ timeout: 20_000 });

  // And the button is not still telling the user it is working.
  await expect(panel.locator('.detail').getByRole('button', { name: 'Capturing' })).toHaveCount(0);
});

test('a capture that gets no answer gives up and says why', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  /*
   * The other half. Reconnecting fixes the common case, but a round trip can
   * still fail -- the page navigated, Thursday was stopped on that tab -- and
   * the button used to sit at "Capturing..." indefinitely with nothing to read
   * and nothing to retry. A deadline turns that into a sentence.
   */
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);

  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.detail')).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  // Take the page away, so nothing can answer.
  await panel.getByRole('button', { name: 'Stop' }).dispatchEvent('click');
  await expect(panel.getByRole('button', { name: 'Full audit' })).toBeDisabled();

  await panel.locator('.detail').getByRole('button', { name: /Capture|Retake/ }).dispatchEvent('click');
  await expect(panel.locator('.detail').getByRole('alert')).toContainText('did not answer', {
    timeout: 20_000,
  });
  await expect(panel.locator('.detail').getByRole('button', { name: 'Capturing' })).toHaveCount(0);
});

test('a comment written after the worker is collected still lands', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  /*
   * The other direction of the same bug.
   *
   * The panel's port was fixed first; the content script's was not, and its
   * `post` swallowed the failure with a comment claiming the reconnect handled
   * it -- true of the port, false of the message. So the first thing sent after
   * a worker was collected vanished, and for a comment that meant a card stuck
   * at "Adding..." with somebody's words trapped behind a disabled button.
   */
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);

  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  /*
   * Order matters, and getting it wrong made this test worthless once already.
   *
   * The card is opened and filled *first*, and the worker killed last, so that
   * pressing Add is the very next thing to happen. Killing it before all that
   * setup left the reconnect (250ms) plenty of time to complete before the
   * submission went out, so nothing was ever in flight over a dead port and
   * the test passed with the outbox torn out -- verified by tearing it out.
   *
   * This is also the realistic sequence: the card is open while somebody types,
   * which is exactly when an idle worker gets collected.
   */
  await panel.getByRole('button', { name: 'Comment on the page' }).dispatchEvent('click');
  await page.bringToFront();
  const card = page.locator('thursday-root .cm-card');
  await expect(card).toBeVisible();
  await page.locator('thursday-root .cm-body').fill('Written after the worker died.');

  await killWorker(context, page);
  await page.locator('thursday-root .cm-add').click();

  // Closes only when the panel has stored it and said so.
  await expect(card).toBeHidden({ timeout: 20_000 });
  await panel.bringToFront();
  /*
   * Generous, because the claim is that it lands rather than that it lands
   * quickly. Getting here can involve a port reconnect, the worker storing the
   * note itself, a panel reconnect and then the note being carried into the
   * open audit -- and under a full-suite load that chain took longer than the
   * default five seconds often enough to fail about one run in three.
   */
  await expect(panel.locator('.comment-body')).toHaveText('Written after the worker died.', {
    timeout: 25_000,
  });
  // Once, not twice. The page resends until it is acknowledged, so this is the
  // assertion that the resending cannot produce a second comment.
  await expect(panel.locator('.comment-row')).toHaveCount(1);
});

test('a comment written with the side panel closed is still kept', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  /*
   * The panel owning the database quietly made "the panel is open" a
   * requirement for writing a comment, which is a strange thing to be true of
   * a tool whose composer is on the page. Closing the panel and writing a note
   * lost the note, and the card could do no better than say so -- there was a
   * test here asserting exactly that failure message, written as though it
   * were acceptable.
   *
   * The service worker stores it now, into the site's own notes bucket, and
   * whatever audit opens next adopts it.
   */
  const page = await openFixture('accessibility.html');
  await activate(page);

  const panel = await openPanel(context, extensionId);
  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  // The only thing that could have stored it, gone.
  await panel.close();

  await page.bringToFront();
  await page.locator('thursday-root [data-action="comment"]').click();
  /*
   * Aimed at the middle of the paragraph, not its corner.
   *
   * A finding's pin sits on the top-left corner of the element it marks, and a
   * pin is one of Thursday's own controls -- so a pick there hits the pin and
   * the picker rightly refuses to select its own UI. Cost me an hour: the test
   * failed and the flow it was testing was fine.
   */
  const target = (await page.locator('p.faint').boundingBox())!;
  const at = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);

  const card = page.locator('thursday-root .cm-card');
  await expect(card).toBeVisible();
  await page.locator('thursday-root .cm-body').fill('Written with the panel shut.');
  await page.locator('thursday-root .cm-add').click();

  // Accepted, not refused. Nothing to read, nothing to retry, nothing lost.
  await expect(card).toBeHidden({ timeout: 20_000 });

  // And a panel opened afterwards has it, without a re-audit.
  const later = await openPanel(context, extensionId);
  await openMoreIn(later);
  await later.locator('.history-open').first().click();
  await expect(later.locator('.comment-body')).toHaveText('Written with the panel shut.');
});

test('a comment gives up rather than waiting forever when the extension goes away', async ({
  openFixture,
  activate,
  extensionId,
  context,
  worker,
}) => {
  /*
   * The safety net behind all of it.
   *
   * The panel stores when it is open and the worker stores when it is not, so
   * "nobody is listening" is hard to reach on purpose. What is still reachable
   * is the extension itself going away under an open card -- an update or a
   * reload orphans the content script, and its messaging throws from then on.
   * The card has to stop claiming to work, say so, and still be holding the
   * words.
   *
   * Nothing touches the worker fixture after the reload: evaluating on a
   * replaced worker hangs rather than throwing.
   */
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);
  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  await panel.getByRole('button', { name: 'Comment on the page' }).dispatchEvent('click');
  await page.bringToFront();
  await expect(page.locator('thursday-root .cm-card')).toBeVisible();
  await page.locator('thursday-root .cm-body').fill('Typed as the extension reloaded.');

  // The extension, replaced under the open card.
  await worker.evaluate(() => chrome.runtime.reload());
  await page.locator('thursday-root .cm-add').click();

  await expect(page.locator('thursday-root .cm-error')).toContainText('No answer from the panel', {
    timeout: 25_000,
  });
  // Not still claiming to be working, and the words are still there.
  await expect(page.locator('thursday-root .cm-add')).toHaveText('Add');
  await expect(page.locator('thursday-root .cm-add')).toBeEnabled();
  await expect(page.locator('thursday-root .cm-body')).toHaveValue('Typed as the extension reloaded.');
});
