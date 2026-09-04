import { expect, testWithCapture as test } from './fixtures';
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
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
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
