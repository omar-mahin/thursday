import {
  test as base,
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
  type Worker,
} from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** A fake https origin, served from memory so no test ever touches the network. */
export const FIXTURE_ORIGIN = 'https://fixture.thursday.test';

/**
 * The panel, as the tests can reach it.
 *
 * Chrome's side panel cannot be driven by Playwright -- there is no target for
 * it -- so every spec opens the same document, panel.html, in a tab of its own
 * and drives that. It is the real panel: same React, same port to the worker,
 * same IndexedDB. What it is not is docked, and nothing here depends on where
 * the browser draws it.
 *
 * Keyed to the audited page rather than global, because a spec can have two
 * audited pages and each needs its own panel -- and because `panelOf` has to
 * hand back the same panel every time it is asked, not open another one. A
 * second panel document is a second panel: it would audit too.
 */
const panels = new WeakMap<Page, Page>();

/**
 * Opens the panel for a page and waits until it can be driven.
 *
 * "Activate returned" is not "the panel is ready": the panel has to boot React
 * and open a port to the worker first. Every test that drives the panel starts
 * here.
 */
export async function panelReady(page: Page): Promise<Page> {
  const existing = panels.get(page);
  if (existing) return existing;
  const context = page.context();
  const extensionId = await extensionIdOf(context);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('button', { name: 'Full audit' }).waitFor({ timeout: 15_000 });
  panels.set(page, panel);
  return panel;
}

/**
 * The panel belonging to a page. `panelReady` must have been awaited first.
 *
 * Synchronous on purpose: it is called inline in a hundred assertions, and
 * making it async would put an `await` in front of every one of them for no
 * gain. The throw says which of the two calls is missing.
 */
export function panelOf(page: Page): Page {
  const panel = panels.get(page);
  if (!panel) throw new Error('await panelReady(page) before panelOf(page)');
  return panel;
}

/**
 * The panel's document, for the few things a locator cannot do.
 *
 * The same Page, and this exists only so the specs that need to `evaluate`
 * inside the panel say why they are reaching for it.
 */
export function panelDoc(page: Page): Page {
  return panelOf(page);
}

/**
 * The extension's id, read from the service worker that is already running.
 *
 * Every spec has it as a fixture, but `panelReady` takes only a page -- so it
 * is recovered from the worker's URL rather than threaded through a hundred
 * call sites.
 */
async function extensionIdOf(context: BrowserContext): Promise<string> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return new URL(worker.url()).host;
}

/**
 * Takes the save-file picker away, before anything that might use it exists.
 *
 * The native dialog cannot be driven, so the panel's anchor fallback is what
 * the tests exercise -- it writes the same bytes (see files.spec.ts).
 */
export async function withoutPicker(context: BrowserContext): Promise<void> {
  /*
   * On the context, not the page.
   *
   * The panel is a document of its own, so a script installed on the audited
   * page never reaches it -- and it is the panel that saves files. A
   * context-level script reaches every page in the context, including one
   * opened later, which is what makes the ordering forgiving here.
   */
  await context.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
}

/**
 * A page on the extension's own origin, for reading storage.
 *
 * The panel could serve for this -- it is a document on the extension's origin
 * and can evaluate. The options page is used instead so that reading the
 * database never depends on a panel being open, and never perturbs one that
 * is: an audit in flight is exactly when a test most wants to look.
 */
export async function extensionPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  return page;
}

/**
 * Opens the panel's History / files / comparison disclosure.
 *
 * Those moved behind one closed-by-default control: in a 380px panel they
 * pushed the findings off the bottom, and they are not what you look at while
 * working through a list. Anything asserting on them has to open it.
 */
export async function openMore(page: Page): Promise<void> {
  await openMoreIn(panelOf(page));
}

/** The same, given the panel directly. */
export async function openMoreIn(panel: Page): Promise<void> {
  await openDisclosure(panel.locator('.more-toggle'), panel.locator(".more[data-open='true']"));
}

/**
 * Opens a `details` and checks that it opened.
 *
 * Verified rather than fired-and-forgotten: under load the click can land
 * while the panel is still re-rendering around an audit, and a disclosure that
 * silently stayed shut fails later as "the history row is hidden", which points
 * at the wrong thing entirely. Cost an hour of looking at the wrong code.
 */
async function openDisclosure(summary: Locator, opened: Locator): Promise<void> {
  await summary.waitFor({ timeout: 10_000 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await opened.count()) > 0) return;
    await summary.click();
    try {
      await opened.first().waitFor({ timeout: 2000 });
      return;
    } catch {
      /* try again: the panel was mid-render */
    }
  }
  throw new Error('the panel disclosure would not open');
}

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
/**
 * `realWindow` turns Playwright's viewport emulation off.
 *
 * It matters for exactly one thing, and that thing is subtle enough to be
 * worth the extra fixture. Playwright normally emulates a viewport --
 * 1280x720 by default -- while the browser window it is emulating inside has a
 * content area about ninety pixels shorter and, once emulation narrows it, a
 * different width as well. `chrome.tabs.captureVisibleTab` photographs the
 * *window*, not the emulated viewport, so the two disagree: a capture comes
 * back 1280 pixels wide of which only 1100 are the page, and every mapping
 * from a page coordinate into that image is wrong by the difference.
 *
 * No product code can fix that, because nothing in the page can see it. In a
 * real browser they agree exactly. So the screenshot tests run with emulation
 * off, where `innerWidth` and `innerHeight` are the window's own content area
 * and a capture corresponds to the page pixel for pixel -- which is the
 * situation every actual user is in.
 */
function makeTest(distDir: string, realWindow = false) {
  const dist = resolve(distDir);
  return base.extend<Fixtures>({
    context: async ({}, use) => {
      /*
       * A persistent profile per test, removed after it.
       *
       * The removal is not tidiness. Every test needs its own profile -- an
       * extension has to be loaded at launch and IndexedDB has to start empty
       * -- and without the cleanup each run leaves one directory of tens of
       * megabytes behind. Found at 3,368 of them and 28GB of temp space, which
       * is the sort of thing that is invisible until a machine runs out of
       * disk in the middle of something else.
       */
      const profile = mkdtempSync(join(tmpdir(), 'thursday-'));
      const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        ...(realWindow ? { viewport: null } : {}),
        args: [
          `--disable-extensions-except=${dist}`,
          `--load-extension=${dist}`,
          ...(realWindow ? ['--window-size=1200,900'] : []),
        ],
      });
      try {
        await use(context);
      } finally {
        await context.close();
        rmSync(profile, { recursive: true, force: true });
      }
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
 * Host access, and the window's own viewport rather than an emulated one.
 *
 * For anything that compares a tab capture against page coordinates. See the
 * note on `realWindow` above -- with emulation on, the two are measurably
 * different things and the comparison tests Playwright rather than Thursday.
 */
export const testWithCapture = makeTest('dist-test', true);

/**
 * Loads the built content script into the page's main world, where
 * chrome.runtime does not exist. Used to prove the UI still works when
 * messaging is unavailable; the real path is `activate`.
 */
export async function injectContentScript(page: Page): Promise<void> {
  await page.addScriptTag({ path: resolve('dist/content.js') });
  await page.waitForSelector('thursday-root', { state: 'attached' });
}

/**
 * Every value sitting in a field on `login.html`, none of which may ever reach
 * a snapshot, a finding or an export.
 *
 * Shared by the two specs that check it -- the snapshot and the audit -- so
 * the two lists cannot drift and each new sensitive field only has to be added
 * once.
 *
 * Each one is long and distinctive, and that is load-bearing. The CVC used to
 * be "737" and the one-time code "123456"; a three-character secret cannot be
 * told apart from noise, because a snapshot's own UUID contains "737" about
 * 2.4% of the time (measured: twelve hits in five hundred snapshots, every one
 * inside an id like "d737781e-4a32-..."). So the assertion failed about one
 * run in forty with nothing leaked, and a real leak of a card's CVC would have
 * looked exactly the same. Nothing is lost by using sentinels: Thursday
 * redacts on a field's name, type and autocomplete, never on its contents.
 *
 * `assertUsableSecrets` keeps the next addition honest.
 */
export const LOGIN_SECRETS = [
  'hunter2-secret',
  '4111111111111111',
  'cvv-sentinel-QK47XZ',
  'otp-sentinel-PM91TR',
  'csrf-token-abcdef123456',
  'ada@example.com',
] as const;

/** Twelve characters puts a sentinel past every id, timestamp and measurement
 *  a snapshot contains; mutual distinctness means a failure names one field. */
export function assertUsableSecrets(check: (label: string, value: unknown) => void): void {
  for (const secret of LOGIN_SECRETS) {
    check(`"${secret}" is too short to tell apart from noise`, secret.length >= 12);
    const overlapping = LOGIN_SECRETS.filter((other) => other !== secret && other.includes(secret));
    check(`"${secret}" is contained in ${overlapping.join(', ')}`, overlapping.length === 0);
  }
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
