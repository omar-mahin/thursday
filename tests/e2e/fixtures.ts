import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** A fake https origin, served from memory so no test ever touches the network. */
export const FIXTURE_ORIGIN = 'https://fixture.thursday.test';

export type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  /** Requests the browser made, for the zero-network assertion. */
  requests: string[];
  openFixture(name: string): Promise<Page>;
  /** Injects the content script the way the popup does, via the service worker. */
  activate(page: Page): Promise<void>;
};

/**
 * Two extension builds, on purpose:
 *
 *  - `test` loads `dist/` exactly as it ships. Nothing can grant it activeTab
 *    (Playwright cannot click a browser-chrome action), so it verifies the
 *    surfaces that need no page access -- including the zero-network claim
 *    against the real artifact.
 *  - `testWithHostAccess` loads `dist-test/`, a copy whose only difference is
 *    host access to the fake fixture origin. That makes the production
 *    injection and messaging path drivable, with no test hooks in the product.
 */
function makeTest(distDir: string) {
  const dist = resolve(distDir);
  return base.extend<Fixtures>({
    context: async ({}, use) => {
      const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'thursday-')), {
        channel: 'chromium',
        args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
      });
      await use(context);
      await context.close();
    },

    worker: async ({ context }, use) => {
      let [worker] = context.serviceWorkers();
      if (!worker) worker = await context.waitForEvent('serviceworker');
      await use(worker);
    },

    extensionId: async ({ worker }, use) => {
      await use(new URL(worker.url()).host);
    },

    requests: async ({ context }, use) => {
      const seen: string[] = [];
      context.on('request', (request) => seen.push(request.url()));
      await use(seen);
    },

    openFixture: async ({ context }, use) => {
      await use(async (name: string) => {
        const page = await context.newPage();
        // Fulfilled locally: the fixture origin never resolves over the network.
        await page.route(`${FIXTURE_ORIGIN}/**`, async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: readFileSync(resolve('tests/fixtures', name), 'utf8'),
          });
        });
        await page.goto(`${FIXTURE_ORIGIN}/${name}`);
        return page;
      });
    },

    activate: async ({ worker }, use) => {
      await use(async (page: Page) => {
        await page.bringToFront();
        const failure = await worker.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab?.id === undefined) return 'no active tab';
          try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
            return null;
          } catch (error) {
            return error instanceof Error ? error.message : 'injection failed';
          }
        });
        if (failure) throw new Error(`activation failed: ${failure}`);
        await page.waitForSelector('thursday-root .toolbar');
      });
    },
  });
}

export const test = makeTest('dist');
export const testWithHostAccess = makeTest('dist-test');

/**
 * Loads the built content script into the page's main world, where
 * chrome.runtime does not exist. Used to prove the UI still works when
 * messaging is unavailable; the real path is `activate`.
 */
export async function injectContentScript(page: Page): Promise<void> {
  await page.addScriptTag({ path: resolve('dist/content.js') });
  await page.waitForSelector('thursday-root', { state: 'attached' });
}

export const toolbar = (page: Page) => page.locator('thursday-root .toolbar');
export const highlightBox = (page: Page) => page.locator('thursday-root .hl-box');
export const highlightLabel = (page: Page) => page.locator('thursday-root .hl-label');

/**
 * Acts as the side panel: connects a real port to the service worker, sends a
 * message and waits for a specific reply. Runs inside an extension page so the
 * whole exchange goes through production plumbing.
 */
export async function exchange<T>(
  panel: Page,
  send: unknown,
  expectType: string,
  timeoutMs = 15_000,
): Promise<T> {
  return (await panel.evaluate(
    ([outgoing, wanted, timeout]) =>
      new Promise<unknown>((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'sidepanel' });
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${String(wanted)}`)), Number(timeout));
        port.onMessage.addListener((envelope: { message?: { type?: string } }) => {
          if (envelope?.message?.type !== wanted) return;
          clearTimeout(timer);
          resolve(envelope.message);
        });
        port.postMessage({ from: 'sidepanel', message: outgoing });
      }),
    [send, expectType, timeoutMs] as const,
  )) as T;
}

export { expect } from '@playwright/test';
/** Re-exported so a test that launches its own browser does not import twice. */
export { chromium } from '@playwright/test';
