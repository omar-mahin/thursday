import { readFileSync } from 'node:fs';
import { expect, testWithHostAccess as test } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Screenshot crops.
 *
 * Off by default, so every test here turns the setting on first -- which is
 * itself part of the claim: a build with the default settings takes no pictures
 * of anybody's page.
 *
 * The panel is a real tab under Playwright rather than a side panel, so
 * focusing it hides the page being audited. Clicks are dispatched instead of
 * performed where the audited tab has to stay in front, because tab capture
 * photographs whichever tab is visible.
 */
async function enableCaptures(context: BrowserContext, extensionId: string): Promise<void> {
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/options.html`);
  await setup.getByRole('checkbox', { name: 'Allow screenshot crops' }).check();
  await expect(setup.getByRole('checkbox', { name: 'Allow screenshot crops' })).toBeChecked();
  await setup.close();
}

const openPanel = async (context: BrowserContext, extensionId: string): Promise<Page> => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
};

test('no screenshot controls appear unless the setting is on', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.detail')).toBeVisible();
  await expect(panel.locator('.detail').getByRole('button', { name: 'Capture' })).toHaveCount(0);
});

test('a finding can be photographed and the crop shown', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  await enableCaptures(context, extensionId);

  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.detail')).toBeVisible();
  await expect(panel.locator('.detail').getByRole('button', { name: 'Capture' })).toBeVisible();

  // The audited tab has to be the visible one for a capture to mean anything.
  await page.bringToFront();
  await panel.locator('.detail').getByRole('button', { name: 'Capture' }).dispatchEvent('click');

  const shot = panel.locator('.shot-figure img');
  await expect(shot).toBeVisible({ timeout: 15_000 });

  // A real image, cropped to something smaller than the whole viewport.
  const size = await shot.evaluate((node: HTMLImageElement) => ({
    width: node.naturalWidth,
    height: node.naturalHeight,
    src: node.src.slice(0, 5),
  }));
  expect(size.src).toBe('blob:');
  expect(size.width).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
  expect(size.width).toBeLessThan(page.viewportSize()!.width * 2);

  // It shows something. A crop cut at the wrong offsets on a mostly-white page
  // comes back as a uniform rectangle, which "an image exists" would not catch.
  const distinct = await panel.locator('.shot-figure img').evaluate(async (node: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.drawImage(node, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    return colours.size;
  });
  expect(distinct).toBeGreaterThan(1);

  // And it can be taken back off again.
  await panel.locator('.detail').getByRole('button', { name: 'Remove' }).dispatchEvent('click');
  await expect(panel.locator('.shot-figure img')).toHaveCount(0);
});

test('a crop is refused for an element that holds a sensitive field', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  // Thursday never reads what is typed into a password or payment field, and a
  // photograph of one would be the same thing by another route.
  //
  // Note where the guard actually has to work. A sensitive field is redacted
  // out of the snapshot during collection, so no rule can produce a finding
  // about one directly -- the reachable case is a finding about a container
  // that happens to hold a secret, which is what this fixture is.
  await enableCaptures(context, extensionId);

  const page = await openFixture('sensitive.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);
  await panel.getByRole('button', { name: 'Full audit' }).click();

  const row = panel.locator('.finding-row', { hasText: 'fields with no grouping' }).first();
  await expect(row).toBeVisible();
  await row.click();

  await page.bringToFront();
  await panel.locator('.detail').getByRole('button', { name: 'Capture' }).dispatchEvent('click');

  await expect(panel.locator('.detail').getByRole('alert')).toContainText('will not photograph it');
  await expect(panel.locator('.shot-figure img')).toHaveCount(0);
});

test('the same finding is photographable once the secret is gone', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  // A controlled pair: the same rule, the same container, the same audit path.
  // The only thing that changes is whether a password field is inside it. A
  // guard that refused everything would pass the test above and be worthless.
  await enableCaptures(context, extensionId);

  const page = await openFixture('sensitive.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await panel.locator('.finding-row', { hasText: 'fields with no grouping' }).first().click();

  await page.bringToFront();
  await panel.locator('.detail').getByRole('button', { name: 'Capture' }).dispatchEvent('click');
  await expect(panel.locator('.detail').getByRole('alert')).toContainText('will not photograph it');

  // Take the password field out and ask for exactly the same crop again.
  await page.evaluate(() => document.querySelector('#newPassword')?.closest('.field')?.remove());
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await panel.locator('.finding-row', { hasText: 'fields with no grouping' }).first().click();

  await page.bringToFront();
  await panel.locator('.detail').getByRole('button', { name: 'Capture' }).dispatchEvent('click');
  await expect(panel.locator('.shot-figure img')).toBeVisible({ timeout: 15_000 });
});

test('a saved audit file carries its crops inline', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  await enableCaptures(context, extensionId);

  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);
  await panel.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
  await panel.reload();

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.detail')).toBeVisible();
  await page.bringToFront();
  await panel.locator('.detail').getByRole('button', { name: 'Capture' }).dispatchEvent('click');
  await expect(panel.locator('.shot-figure img')).toBeVisible({ timeout: 15_000 });

  const download = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save audit' }).dispatchEvent('click'),
  ]).then(([event]) => event);

  const text = readFileSync(await download.path(), 'utf8');
  const parsed = JSON.parse(text) as { screenshots?: Record<string, string> };
  const crops = Object.values(parsed.screenshots ?? {});
  expect(crops).toHaveLength(1);
  // Inline, so the file stays one file and the report stays offline.
  expect(crops[0]).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
});
