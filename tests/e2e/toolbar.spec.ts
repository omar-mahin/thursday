import { expect, injectContentScript, test, testWithHostAccess, toolbar } from './fixtures';

test('the toolbar mounts in a shadow root and survives hostile page CSS', async ({ openFixture }) => {
  const page = await openFixture('hostile.html');
  const layoutBefore = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.getBoundingClientRect().height,
  }));

  await injectContentScript(page);

  // The page sets `button { display: none !important }` and a cursive font.
  // Neither crosses the shadow boundary.
  await expect(toolbar(page)).toBeVisible();
  await expect(toolbar(page).getByRole('button', { name: 'Audit' })).toBeVisible();
  const font = await toolbar(page)
    .getByRole('button', { name: 'Audit' })
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(font).not.toContain('Comic Sans');

  // And the page's own layout is untouched: no reflow, no scrollbars.
  const layoutAfter = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.getBoundingClientRect().height,
  }));
  expect(layoutAfter).toEqual(layoutBefore);
});

test('injecting twice re-attaches instead of stacking a second toolbar', async ({ openFixture }) => {
  const page = await openFixture('hostile.html');
  await injectContentScript(page);
  await injectContentScript(page);
  await expect(page.locator('thursday-root')).toHaveCount(1);
  await expect(toolbar(page)).toHaveCount(1);
});

test('the toolbar is a keyboard-operable toolbar widget', async ({ openFixture }) => {
  const page = await openFixture('hostile.html');
  await injectContentScript(page);

  await expect(toolbar(page)).toHaveAttribute('role', 'toolbar');
  await expect(toolbar(page)).toHaveAttribute('aria-label', 'Thursday');

  // Roving tabindex: exactly one stop, arrows move focus within the widget.
  const tabbable = await toolbar(page).locator('button[tabindex="0"]').count();
  expect(tabbable).toBe(1);

  await toolbar(page).locator('button[tabindex="0"]').focus();
  const first = await page.evaluate(
    () => document.querySelector('thursday-root')?.shadowRoot?.activeElement?.getAttribute('aria-label'),
  );
  await page.keyboard.press('ArrowRight');
  const second = await page.evaluate(
    () => document.querySelector('thursday-root')?.shadowRoot?.activeElement?.getAttribute('aria-label'),
  );
  expect(second).not.toBe(first);
});

test('dragging by the grip moves the toolbar and keeps it in the viewport', async ({ openFixture }) => {
  const page = await openFixture('hostile.html');
  await injectContentScript(page);

  const before = await toolbar(page).boundingBox();
  const grip = toolbar(page).locator('.grip');
  const gripBox = await grip.boundingBox();
  expect(gripBox).not.toBeNull();

  await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox!.x + 160, gripBox!.y + 220, { steps: 8 });
  await page.mouse.up();

  const after = await toolbar(page).boundingBox();
  expect(after!.y).toBeGreaterThan(before!.y + 100);

  // Dragged far off-screen, it clamps back rather than becoming unreachable.
  await page.mouse.move(after!.x + 10, after!.y + 10);
  await page.mouse.down();
  await page.mouse.move(9000, 9000, { steps: 4 });
  await page.mouse.up();
  const clamped = await toolbar(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(clamped!.x + clamped!.width).toBeLessThanOrEqual(viewport.width);
  expect(clamped!.y + clamped!.height).toBeLessThanOrEqual(viewport.height);
});

test('close removes every trace from the page', async ({ openFixture }) => {
  const page = await openFixture('hostile.html');
  await injectContentScript(page);
  await toolbar(page).getByRole('button', { name: 'Close Thursday' }).click();
  await expect(page.locator('thursday-root')).toHaveCount(0);
  const leftovers = await page.evaluate(() =>
    [...document.documentElement.querySelectorAll('*')].filter((element) =>
      element.tagName.toLowerCase().startsWith('thursday'),
    ).length,
  );
  expect(leftovers).toBe(0);
});

test('the toolbar does not leak its events into the page', async ({ openFixture }) => {
  // Events fired inside a shadow root retarget to the host and keep bubbling,
  // so without containment the page sees every click on our own UI -- closing
  // its menus, firing its analytics, stealing its keyboard shortcuts.
  const page = await openFixture('hostile.html');
  await injectContentScript(page);
  await page.evaluate(() => {
    (globalThis as unknown as { seen: string[] }).seen = [];
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown']) {
      document.addEventListener(type, () => {
        (globalThis as unknown as { seen: string[] }).seen.push(type);
      });
    }
  });

  await toolbar(page).locator('.grip').click();
  await toolbar(page).getByRole('button', { name: 'Inspect' }).click();
  await toolbar(page).locator('button[tabindex="0"]').focus();
  await page.keyboard.press('ArrowRight');

  expect(await page.evaluate(() => (globalThis as unknown as { seen: string[] }).seen)).toEqual([]);
});

test('every action is an icon with a name and a hittable target', async ({ openFixture }) => {
  const page = await openFixture('hostile.html');
  await injectContentScript(page);

  const buttons = await page.evaluate(() => {
    const root = document.querySelector('thursday-root');
    return [...(root?.shadowRoot?.querySelectorAll('.tb-btn') ?? [])].map((button) => {
      const box = button.getBoundingClientRect();
      const icon = button.querySelector('svg.tb-icon');
      return {
        name: button.getAttribute('aria-label'),
        width: box.width,
        height: box.height,
        // Icon-only: no text node of its own outside the hidden tooltip.
        visibleText: [...button.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent?.trim() ?? '')
          .join(''),
        shapes: icon?.children.length ?? 0,
        iconHidden: icon?.getAttribute('aria-hidden'),
        pressed: button.getAttribute('aria-pressed'),
      };
    });
  });

  expect(buttons.map((button) => button.name)).toEqual([
    'Audit',
    'Select',
    'Comment',
    'Inspect',
    'Close Thursday',
  ]);

  for (const button of buttons) {
    // Every one has a name, whatever the pointer is doing -- the tooltip is
    // decoration, so the label cannot blink in and out with the hover.
    expect(button.name, JSON.stringify(button)).toBeTruthy();
    expect(button.visibleText, `${button.name} still has a text label`).toBe('');
    // A real icon with real geometry, rather than an empty square.
    expect(button.shapes, `${button.name} has no icon`).toBeGreaterThan(0);
    expect(button.iconHidden).toBe('true');
    // WCAG 2.5.8 asks whether a 24px square fits inside the target.
    expect(button.width, `${button.name} is ${button.width}px wide`).toBeGreaterThanOrEqual(24);
    expect(button.height, `${button.name} is ${button.height}px tall`).toBeGreaterThanOrEqual(24);
  }

  // Only the two modes claim a pressed state. On a button that just does a
  // thing, aria-pressed tells a screen-reader user it toggles when it does not.
  const toggles = buttons.filter((button) => button.pressed !== null).map((button) => button.name);
  expect(toggles).toEqual(['Select', 'Comment']);
});

test('no icon is used for two different actions', async ({ openFixture }) => {
  /*
   * What this catches, and what it does not.
   *
   * It catches an icon copied onto a second action -- the shapes being
   * literally the same -- which is a mistake that looks fine in a diff and
   * gives the user two buttons that are one button.
   *
   * It cannot catch two *different* icons that happen to look alike, and that
   * is the failure this toolbar actually had: Audit was a corner-bracketed
   * frame and Select a dashed frame, different geometry and indistinguishable
   * at eighteen pixels. No assertion found that. Looking at a screenshot did,
   * and nothing here replaces doing so.
   */
  const page = await openFixture('hostile.html');
  await injectContentScript(page);

  const drawn = await page.evaluate(() => {
    const root = document.querySelector('thursday-root');
    return [...(root?.shadowRoot?.querySelectorAll('.tb-btn') ?? [])].map((button) => ({
      name: button.getAttribute('aria-label'),
      // The geometry itself: two icons built from the same shapes are the
      // same icon however they happen to render today.
      shape: [...(button.querySelector('svg')?.children ?? [])]
        .map((node) => `${node.tagName}:${node.getAttribute('d') ?? ''}${node.getAttribute('r') ?? ''}`)
        .join('|'),
    }));
  });

  const seen = new Map<string, string>();
  for (const icon of drawn) {
    const clash = seen.get(icon.shape);
    expect(clash, `${icon.name} draws the same icon as ${clash}`).toBeUndefined();
    seen.set(icon.shape, icon.name ?? '');
  }
  expect(seen.size).toBe(drawn.length);
});

test('the label appears on hover and on keyboard focus', async ({ openFixture }) => {
  /*
   * Both, and that is the whole reason the tooltip is CSS rather than a title
   * attribute: a native tooltip waits about a second, cannot be styled, and
   * never appears at all for somebody arriving by keyboard -- who is exactly
   * the person with no other way to find out what an unlabelled icon does.
   */
  const page = await openFixture('hostile.html');
  await injectContentScript(page);

  const button = toolbar(page).locator('[data-action="inspect"]');
  const tip = button.locator('.tb-tip');
  await expect(tip).toHaveText('Inspect');

  const opacity = () => tip.evaluate((node) => getComputedStyle(node).opacity);
  expect(Number(await opacity())).toBe(0);

  await button.hover();
  await expect(async () => expect(Number(await opacity())).toBe(1)).toPass({ timeout: 2000 });

  // Away from the toolbar, then in by keyboard.
  await page.mouse.move(5, 400);
  await expect(async () => expect(Number(await opacity())).toBe(0)).toPass({ timeout: 2000 });

  await button.evaluate((node: HTMLElement) => node.focus());
  await expect(async () => expect(Number(await opacity())).toBe(1)).toPass({ timeout: 2000 });

  // And it never intercepts the click it is describing.
  expect(await tip.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
});

test('the brandmark carries the product name and its credit', async ({ openFixture }) => {
  const page = await openFixture('hostile.html');
  await injectContentScript(page);

  await expect(toolbar(page).locator('.brand-name')).toHaveText('Thursday');
  await expect(toolbar(page).locator('.brand-credit')).toHaveText('By Omar');

  // Both readable against the toolbar. A credit nobody can read is not a
  // credit, and this is the product that flags exactly that on other people's
  // pages.
  const contrast = await page.evaluate(() => {
    const root = document.querySelector('thursday-root');
    const shadow = root?.shadowRoot;
    const bar = shadow?.querySelector('.toolbar');
    const read = (selector: string): { color: string; size: number; weight: string } => {
      const node = shadow?.querySelector(selector);
      const style = getComputedStyle(node as Element);
      return { color: style.color, size: Number.parseFloat(style.fontSize), weight: style.fontWeight };
    };
    return {
      background: getComputedStyle(bar as Element).backgroundColor,
      name: read('.brand-name'),
      credit: read('.brand-credit'),
    };
  });

  const channel = (value: number): number => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (colour: string): number => {
    const [r = 0, g = 0, b = 0] = [...colour.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a: string, b: string): number => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (high + 0.05) / (low + 0.05);
  };

  // Both are small text, so the 4.5:1 threshold applies to each.
  expect(contrast.credit.size).toBeGreaterThanOrEqual(10);
  expect(ratio(contrast.name.color, contrast.background)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(contrast.credit.color, contrast.background)).toBeGreaterThanOrEqual(4.5);
});

testWithHostAccess(
  'the toolbar mounts on a page that enforces Trusted Types',
  async ({ context, worker }) => {
    /*
     * A large site with `require-trusted-types-for 'script'` is a normal thing
     * to want to audit.
     *
     * Chrome exempts a content script's isolated world from the page's policy,
     * so nothing here is fragile today -- and this test says so rather than
     * pretending otherwise. What it guards is a future change that moves any of
     * this rendering into the page's own world, where the exemption ends and an
     * HTML sink would throw.
     */
    const page = await context.newPage();
    await page.route('https://fixture.thursday.test/**', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-security-policy': "require-trusted-types-for 'script'" },
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html lang="en"><head><title>Strict</title></head><body><h1>Strict page</h1><p>Body copy.</p></body></html>',
      }),
    );
    await page.goto('https://fixture.thursday.test/trusted-types.html');

    // The policy really is in force in the page's own world.
    const inPage = await page.evaluate(() => {
      try {
        document.createElement('div').innerHTML = '<b>x</b>';
        return 'allowed';
      } catch {
        return 'blocked';
      }
    });
    expect(inPage).toBe('blocked');

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
    expect(failure).toBeNull();

    await expect(toolbar(page)).toBeVisible();
    await expect(toolbar(page).locator('svg.tb-icon')).toHaveCount(5);
    await expect(toolbar(page).locator('.brand-credit')).toHaveText('By Omar');
  },
);

/*
 * Every button that is not greyed out does something.
 *
 * The three tests below exist because the toolbar shipped with three buttons
 * that did not. Settings was clickable and inert; Audit and Report were
 * declared disabled and nothing ever enabled them, so they were permanently
 * grey. Nothing caught any of it: the icons had names, geometry and hittable
 * targets, and every assertion about them passed.
 *
 * A user found it by pressing one and asking what it was for.
 */

testWithHostAccess('Audit runs an audit rather than only revealing the tab that does', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  // The panel opens on the audit tab, which is what made "reveal the tab" a
  // button that did nothing at all in the ordinary case.
  await expect(panel.getByRole('button', { name: 'Full audit' })).toBeVisible();
  await expect(panel.locator('.finding-row')).toHaveCount(0);

  await page.bringToFront();
  await toolbar(page).getByRole('button', { name: 'Audit' }).click();

  await expect(panel.locator('.finding-row').first()).toBeVisible({ timeout: 15_000 });

  await expect(panel.locator('.history-row')).toHaveCount(1);
  await expect(panel.locator('.card.compare')).toHaveCount(0);

  /*
   * And a second press re-runs it, which is the whole reason the action is
   * stamped: unstamped, the second press carries the same value the panel
   * already holds, React sees no change and the button works exactly once per
   * page.
   *
   * Asserted on the two things only a second run can produce -- a second
   * history entry, and a diff against the first -- rather than on the findings,
   * which are identical either way and so cannot tell a re-run from a no-op.
   */
  await page.bringToFront();
  await toolbar(page).getByRole('button', { name: 'Audit' }).click();

  await expect(panel.locator('.history-row')).toHaveCount(2, { timeout: 15_000 });
  await expect(panel.locator('.card.compare')).toBeVisible();
});

testWithHostAccess('no button is left permanently greyed out', async ({ openFixture, activate }) => {
  /*
   * A disabled button is a promise that something will enable it later. Audit
   * and Report were both declared disabled and neither promise was ever kept,
   * so the toolbar shipped with two buttons that could not be pressed on any
   * page, in any state. Audit is wired now and Report is gone.
   *
   * If a button ever legitimately needs to stay disabled after activation, it
   * belongs in this list with a reason next to it -- not left grey.
   */
  const page = await openFixture('accessibility.html');
  await activate(page);
  await expect(toolbar(page).getByRole('button', { name: 'Audit' })).toBeEnabled();

  const stuck = await page.evaluate(() => {
    const root = document.querySelector('thursday-root');
    return [...(root?.shadowRoot?.querySelectorAll('.tb-btn') ?? [])]
      .filter((button) => (button as HTMLButtonElement).disabled)
      .map((button) => button.getAttribute('aria-label'));
  });
  expect(stuck).toEqual([]);
});
