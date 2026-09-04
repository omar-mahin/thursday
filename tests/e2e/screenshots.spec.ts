import { readFileSync } from 'node:fs';
import { expect, testWithCapture as test } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Photographing findings.
 *
 * On by default as of 1.0.1: an audit sweeps the page and every finding comes
 * back with a picture of itself. Before that the feature existed, was off, and
 * needed one click per finding -- which meant reports went out with no pictures
 * in them and nobody knew there was a setting.
 *
 * The panel is a real tab under Playwright rather than a side panel, so
 * focusing it hides the page being audited. The audited tab is brought to the
 * front and clicks are dispatched rather than performed wherever it has to stay
 * there, because tab capture photographs whichever tab is visible.
 *
 * These use `testWithCapture`, which runs with Playwright's viewport emulation
 * off. That is load-bearing rather than tidy: emulation leaves the page's idea
 * of its viewport and the window `captureVisibleTab` photographs at different
 * sizes, so page coordinates and capture pixels genuinely do not line up and
 * no amount of product code can make them. With emulation off they line up
 * exactly, which is the situation every real user is in. The fixture says more.
 */

async function setCaptures(context: BrowserContext, extensionId: string, on: boolean): Promise<void> {
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/options.html`);
  const toggle = setup.getByRole('checkbox', { name: 'Photograph findings' });
  if (on) await toggle.check();
  else await toggle.uncheck();
  await expect(toggle).toBeChecked({ checked: on });
  await setup.close();
}

const openPanel = async (context: BrowserContext, extensionId: string): Promise<Page> => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
};

/** Reads the pixels of a rendered <img> back out of the page. */
async function pixels(
  locator: ReturnType<Page['locator']>,
): Promise<{ width: number; height: number; colours: number; data: Uint8Array }> {
  const result = await locator.evaluate(async (node: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(node, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      colours: colours.size,
      data: [...data],
    };
  });
  return { ...result, data: Uint8Array.from(result.data) };
}

test('an audit photographs its findings with no further asking', async ({
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

  // No Capture click anywhere in this test. That is the whole point of it.
  const shot = panel.locator('.shot-figure img');
  await expect(shot).toBeVisible({ timeout: 30_000 });

  const image = await pixels(shot);
  expect(image.width).toBeGreaterThan(0);
  // A crop cut at the wrong offsets on a mostly-white page comes back a
  // uniform rectangle, which "an image exists" would not catch.
  expect(image.colours).toBeGreaterThan(4);

  /*
   * Wider than tall, and wider than the crop alone would be: the picture is two
   * panels, a crop and a locator thumbnail beside it. Asserted on the shape
   * rather than on exact pixels, because the crop's size depends on the element
   * and the whole point is that the second panel is there.
   */
  expect(image.width).toBeGreaterThan(image.height);
  expect(image.width).toBeGreaterThan(320 + 168);
});

test('a finding below the fold is photographed where it actually is', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  /*
   * The reason the sweep exists, and the assertion it needs.
   *
   * A single capture only ever sees one screenful, so before this the findings
   * further down a page got nothing -- and a long page is where most findings
   * are.
   *
   * Counting how many rows ended up with a picture does not test that. The
   * first screenful of any page has several findings on it, so "more than one
   * row has a picture" passes with the sweep disabled entirely -- measured, by
   * disabling it. What has to be checked is *what the picture is of*, so the
   * fixture gives each section its own background colour and this looks for the
   * fifth section's colour in the picture belonging to the fifth section's
   * finding.
   */
  const page = await openFixture('long.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);

  const geometry = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    lastSectionTop: document.querySelector('#s5')!.getBoundingClientRect().top + window.scrollY,
  }));
  expect(geometry.documentHeight).toBeGreaterThan(geometry.viewportHeight * 3);
  // The thing being photographed really is off the first screenful.
  expect(geometry.lastSectionTop).toBeGreaterThan(geometry.viewportHeight);

  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  // The empty button in the fifth section, 4,000-odd pixels down the page.
  const row = panel.locator('.finding-row', { hasText: 'no accessible name' }).first();
  await expect(row).toBeVisible();
  await row.dispatchEvent('click');
  const shot = panel.locator('.shot-figure img');
  await expect(shot).toBeVisible();

  const image = await pixels(shot);
  let onSection5 = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    // #faf2ff, exactly. The crop is drawn from a lossless capture at 1:1, so
    // an exact match is the right test rather than a tolerance.
    if (image.data[i] === 250 && image.data[i + 1] === 242 && image.data[i + 2] === 255) onSection5 += 1;
  }
  expect(onSection5, 'the picture is not of the section the finding is in').toBeGreaterThan(500);

  // And the page is back where it started, not left wherever the sweep ended.
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);
});

test('Thursday is not in its own screenshots', async ({ openFixture, activate, extensionId, context }) => {
  /*
   * The toolbar floats over the page and pins sit directly on the elements
   * being photographed, so without hiding them a picture meant to show a client
   * their own button shows Thursday's marker covering it. Found by looking at
   * one, not by an assertion -- so here is the assertion.
   *
   * Checked on the toolbar's own background colour, read from the toolbar at
   * runtime rather than hard-coded, with the toolbar forced dark.
   *
   * The dark part is not decoration. The toolbar follows the system theme, and
   * in light mode its background is near-white -- so the first version of this
   * counted 233,983 matching pixels, every one of them the fixture's own white
   * page. Forcing dark makes the colour unique to the toolbar. The fixture's own
   * CSS does not respond to color-scheme, so nothing else about the page or its
   * findings changes.
   */
  const page = await openFixture('long.html');
  await page.emulateMedia({ colorScheme: 'dark' });
  await activate(page);
  const panel = await openPanel(context, extensionId);

  const chrome = await page.evaluate(() => {
    const root = document.querySelector('thursday-root')?.shadowRoot;
    const bar = root?.querySelector('.toolbar');
    if (!(bar instanceof HTMLElement)) return null;
    const box = bar.getBoundingClientRect();
    const rgb = getComputedStyle(bar).backgroundColor.match(/\d+/g)?.map(Number) ?? [];
    return { top: box.top, colour: rgb.slice(0, 3) };
  });
  expect(chrome, 'no toolbar to hide').not.toBeNull();
  expect(chrome!.colour).toHaveLength(3);

  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  // A finding in the first section, whose crop covers the top of the page.
  const row = panel.locator('.finding-row', { hasText: 'contrast' }).first();
  await expect(row).toBeVisible();
  await row.dispatchEvent('click');
  const shot = panel.locator('.shot-figure img');
  await expect(shot).toBeVisible();

  const image = await pixels(shot);
  const [r, g, b] = chrome!.colour as [number, number, number];
  let toolbarPixels = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i] === r && image.data[i + 1] === g && image.data[i + 2] === b) toolbarPixels += 1;
  }
  expect(toolbarPixels, "Thursday's own toolbar is in the screenshot").toBe(0);

  // And it came back. An extension that hides itself to take a picture and
  // forgets to reappear is a much worse bug than a pin in a screenshot.
  const visible = await page.evaluate(() => {
    const root = document.querySelector('thursday-root')?.shadowRoot;
    const bar = root?.querySelector('.toolbar');
    return bar instanceof HTMLElement ? getComputedStyle(bar).visibility : 'gone';
  });
  expect(visible).toBe('visible');
});

test('the setting still turns it off, and off means no pictures at all', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  await setCaptures(context, extensionId, false);

  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);

  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.detail')).toBeVisible({ timeout: 30_000 });

  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0);
  await expect(panel.locator('.shot-figure img')).toHaveCount(0);
  await expect(panel.locator('.detail').getByRole('button', { name: 'Capture' })).toHaveCount(0);
});

test('a sensitive field is painted out of a picture taken for something else', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  /*
   * The reason on-by-default is defensible at all.
   *
   * A tab capture is of the whole screenful, so a crop taken for one finding
   * can contain a password or card field belonging to a different one -- or to
   * no finding at all. Refusing to photograph the sensitive element itself does
   * nothing about that; every sensitive rect on screen has to be painted over
   * in every picture.
   *
   * The check is on the pixels where the field is. The fixture's password input
   * has a distinctive background, and the mask is near-black with hatching, so
   * "is the field's own colour still there" is a real question with a real
   * answer.
   */
  const page = await openFixture('sensitive.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);

  await page.bringToFront();
  // Paint the password field a colour nothing else on the page uses, so its
  // survival in a screenshot is unambiguous.
  await page.evaluate(() => {
    const field = document.querySelector('#newPassword');
    if (field instanceof HTMLElement) {
      field.style.background = 'rgb(0, 255, 0)';
      field.style.height = '40px';
    }
  });

  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  const rows = panel.locator('.finding-row');
  const total = await rows.count();
  let checked = 0;
  for (let index = 0; index < total; index += 1) {
    await rows.nth(index).dispatchEvent('click');
    const shot = panel.locator('.shot-figure img');
    if ((await shot.count()) === 0) continue;
    const image = await pixels(shot);
    let bright = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      // The exact green, allowing for PNG being lossless but the browser
      // compositing at a device ratio.
      if (image.data[i]! < 90 && image.data[i + 1]! > 200 && image.data[i + 2]! < 90) bright += 1;
    }
    // Zero, not "few". A mask that leaves a ring of the field's own pixels
    // round the edge is what the first version of this did, and 321 surviving
    // pixels is a leak however small the number looks.
    expect(bright, 'the password field survived into a screenshot').toBe(0);
    checked += 1;
  }
  // A pass with nothing examined would be worthless.
  expect(checked, 'no pictures were taken, so nothing was actually checked').toBeGreaterThan(0);
});

test('the PDF carries a picture for each finding it has one for', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);
  await panel.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
  await panel.reload();

  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.shot-figure img')).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  const download = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save PDF' }).dispatchEvent('click'),
  ]).then(([event]) => event);
  const bytes = readFileSync(await download.path());
  const text = bytes.toString('latin1');

  // Images reach a PDF through DCTDecode, one XObject each. More than one, so
  // this is the sweep rather than a single lucky capture.
  const images = [...text.matchAll(/\/Filter \/DCTDecode/g)].length;
  expect(images).toBeGreaterThan(1);
  expect(bytes.subarray(-6).toString('latin1')).toBe('%%EOF\n');
});

test('a saved audit file carries every crop inline', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await openPanel(context, extensionId);
  await panel.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
  await panel.reload();

  await page.bringToFront();
  await panel.getByRole('button', { name: 'Full audit' }).dispatchEvent('click');
  await expect(panel.locator('.shot-figure img')).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });

  const download = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save audit' }).dispatchEvent('click'),
  ]).then(([event]) => event);

  const parsed = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
    screenshots?: Record<string, string>;
  };
  const crops = Object.values(parsed.screenshots ?? {});
  expect(crops.length).toBeGreaterThan(1);
  // Inline, so the file stays one file and the report stays offline.
  for (const crop of crops) expect(crop).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
});
