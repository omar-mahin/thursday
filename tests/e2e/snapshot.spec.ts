import type { PageSnapshot } from '../../src/shared/types';
import {
  assertUsableSecrets,
  exchange,
  expect,
  LOGIN_SECRETS,
  testWithHostAccess as test,
} from './fixtures';

/** Asks the page for a snapshot over the real port plumbing, as the panel does. */
async function snapshot(
  context: { openFixture(name: string): Promise<import('@playwright/test').Page> },
  activate: (page: import('@playwright/test').Page) => Promise<void>,
  extensionId: string,
  fixture: string,
): Promise<PageSnapshot> {
  const page = await context.openFixture(fixture);
  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();
  const message = await exchange<{ payload: PageSnapshot }>(
    panel,
    { type: 'REQUEST_SNAPSHOT', payload: { includeOffscreen: false } },
    'SNAPSHOT_READY',
  );
  return message.payload;
}

test('a snapshot of a login page contains no field values at all', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const result = await snapshot({ openFixture }, activate, extensionId, 'login.html');
  const serialized = JSON.stringify(result);

  // Nothing in a field reaches the snapshot. The list and the reason it is
  // shaped the way it is live in fixtures.ts.
  assertUsableSecrets((label, ok) => expect(ok, label).toBe(true));
  for (const secret of LOGIN_SECRETS) {
    expect(serialized, `leaked ${secret}`).not.toContain(secret);
  }

  // Personal data inside ordinary page copy is redacted too.
  expect(serialized).toContain('[email]');
  expect(serialized).toContain('[phone]');

  const password = result.elements.find((element) => element.form?.type === 'password');
  expect(password, 'the password field should still be described').toBeDefined();
  expect(password?.redacted).toBe(true);
  expect(password?.classNames).toEqual([]);
  expect(password?.accessibleName.name).toBe('');
  // Only descriptors of the field's declared purpose survive. Nothing about
  // its contents exists in the shape -- not even whether it is filled.
  expect(Object.keys(password?.form ?? {}).sort()).toEqual(
    ['autocomplete', 'labelledBy', 'required', 'type'].sort(),
  );
  for (const forbidden of ['value', 'hasValue', 'valueLength', 'checked', 'length']) {
    expect(Object.keys(password?.form ?? {}), forbidden).not.toContain(forbidden);
  }

  // A non-sensitive field keeps its label, because rules need it.
  const notes = result.elements.find((element) => element.form?.type === 'textarea');
  expect(notes?.redacted).toBe(false);
  expect(notes?.accessibleName.name).toBe('Notes');
});

test('a snapshot records the structure and measurements rules need', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const result = await snapshot({ openFixture }, activate, extensionId, 'inspect.html');

  expect(result.title).toBe('Inspect fixture');
  expect(result.origin).toBe('https://fixture.thursday.test');
  expect(result.truncated).toBe(false);
  expect(result.crossOriginFrames).toBe(1);

  const cta = result.elements.find((element) => element.id === 'start-trial');
  expect(cta).toBeDefined();
  expect(cta?.tagName).toBe('button');
  expect(cta?.role).toBe('button');
  expect(cta?.accessibleName).toMatchObject({ name: 'Start free trial', source: 'text' });
  expect(cta?.interactive).toBe(true);
  expect(cta?.focusable).toBe(true);
  expect(cta?.rect.width).toBeGreaterThan(100);
  expect(cta?.styles.fontWeight).toBe(700);
  expect(cta?.styles.backgroundColor).toBe('rgb(37, 99, 235)');
  expect(cta?.styles.borderWidths).toEqual([2, 2, 2, 2]);
  expect(cta?.styles.cursor).toBe('pointer');

  // Structure: the nav links know which landmark they live in.
  const featureLink = result.elements.find((element) => element.href?.endsWith('/features'));
  const landmarkIndex = featureLink?.landmark;
  expect(landmarkIndex).not.toBeNull();
  expect(result.elements[landmarkIndex!]?.tagName).toBe('nav');

  // Headings are indexed so hierarchy rules can run in Sprint 3.
  const headings = result.elements.filter((element) => element.headingLevel !== undefined);
  expect(headings.map((heading) => heading.headingLevel)).toEqual([1, 4]);

  // An element after the h1 points back at it.
  const paragraph = result.elements.find((element) => element.text?.startsWith('Body copy'));
  expect(result.elements[paragraph!.precedingHeading!]?.headingLevel).toBe(4);

  // The empty button is collected, with no name, ready for rule A11Y-007.
  const empty = result.elements.find(
    (element) => element.tagName === 'button' && element.accessibleName.source === 'none' && !element.id,
  );
  expect(empty).toBeDefined();

  // Hidden and far-offscreen elements are culled.
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain('never collected');
  expect(serialized).not.toContain('parked far away');
});

test('a 3000-node page stays inside the element cap and the time budget', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const page = await openFixture('heavy.html');
  const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  expect(nodes).toBeGreaterThan(3000);

  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();

  // includeOffscreen exercises the full cap path rather than the culled one.
  const message = await exchange<{ payload: PageSnapshot }>(
    panel,
    { type: 'REQUEST_SNAPSHOT', payload: { includeOffscreen: true } },
    'SNAPSHOT_READY',
  );
  const result = message.payload;

  // Budgets from PLAN.md section 5.
  expect(result.elements.length).toBeLessThanOrEqual(1500);
  expect(result.durationMs, `snapshot took ${result.durationMs}ms`).toBeLessThan(400);
  expect(result.truncated).toBe(true);
  // Interactive elements survive the cut; generic containers are what get dropped.
  expect(result.elements.filter((element) => element.interactive).length).toBeGreaterThan(600);
});

test('offscreen culling keeps a long page cheap to scan', async ({ openFixture, activate, extensionId }) => {
  const page = await openFixture('heavy.html');
  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();

  const message = await exchange<{ payload: PageSnapshot }>(
    panel,
    { type: 'REQUEST_SNAPSHOT', payload: { includeOffscreen: false } },
    'SNAPSHOT_READY',
  );
  // Only what is within three viewports of the fold, so a 3000-node page costs
  // a fraction of the full scan.
  expect(message.payload.elements.length).toBeLessThan(600);
  expect(message.payload.durationMs).toBeLessThan(100);
  expect(message.payload.truncated).toBe(false);
});

test('hover feedback lands within 100ms on a heavy page', async ({ openFixture, activate }) => {
  const page = await openFixture('heavy.html');
  await activate(page);

  await page.locator('thursday-root .toolbar').getByRole('button', { name: 'Select' }).click();
  const target = (await page.getByRole('link', { name: 'Open' }).nth(4).boundingBox())!;

  const start = Date.now();
  await page.mouse.move(target.x + 4, target.y + 4);
  /*
   * The ruler's outline, not the plain highlight box.
   *
   * Select shows the ruler now, and this is the harder version of the same
   * claim: the frame that draws this also reads computed styles, resolves the
   * background through the ancestor chain and grades contrast. If any of that
   * were done per pointer move rather than per element, this is the test that
   * would notice.
   */
  await page.waitForFunction(
    (expected) => {
      const box = document
        .querySelector('thursday-root')
        ?.shadowRoot?.querySelector('.rl-outline') as HTMLElement | null;
      if (!box || box.dataset['on'] !== 'true') return false;
      const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(box.style.transform);
      return match !== null && Math.abs(Number(match[2]) - expected) < 2;
    },
    target.y,
    { timeout: 100, polling: 'raf' },
  );
  expect(Date.now() - start).toBeLessThan(100);
});
