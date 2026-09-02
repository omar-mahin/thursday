import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const DIST = resolve('dist');

/** A fake https origin, served from memory so no test ever touches the network. */
export const FIXTURE_ORIGIN = 'https://fixture.thursday.test';

export type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  /** Requests the browser made, for the zero-network assertion. */
  requests: string[];
  openFixture(name: string): Promise<Page>;
};

export const test = base.extend<Fixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'thursday-')), {
      channel: 'chromium',
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
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
});

/**
 * Sprint 1 limitation, stated plainly: Playwright cannot click a browser-chrome
 * extension action, and activeTab is only granted by that click. So these tests
 * inject the built content script directly to exercise its DOM behaviour. It
 * lands in the main world, where chrome.runtime is absent -- which also proves
 * the script degrades instead of throwing when messaging is unavailable.
 * Sprint 2 adds a keyboard-command activation path that E2E can drive properly.
 */
export async function injectContentScript(page: Page): Promise<void> {
  await page.addScriptTag({ path: join(DIST, 'content.js') });
  await page.waitForSelector('thursday-root', { state: 'attached' });
}

export const toolbar = (page: Page) => page.locator('thursday-root .toolbar');
export { expect } from '@playwright/test';
