import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { contrastRatio, contrastTarget, parseColor } from '../../src/audit/measure/color';
import { runAudit } from '../../src/audit/engine/run';
import { ALL_CATEGORIES } from '../../src/audit/engine/registry';
import { DEFAULT_AUDIT_SETTINGS } from '../../src/audit/types';
import { renderReport } from '../../src/report/render';
import type { Finding, PageSnapshot, Severity } from '../../src/shared/types';
import { expect, exchange, FIXTURE_ORIGIN, testWithHostAccess as test } from './fixtures';

/**
 * Thursday, audited by Thursday.
 *
 * Not a contrast spot-check: the real markup and the real stylesheet of each
 * surface are served as a page, and the whole thirty-rule engine is run over
 * it exactly as it runs over anyone else's site. An accessibility tool that
 * fails its own rules cannot ship, and the only way to know is to point it at
 * itself.
 *
 * It works. The first run found eighteen defects in the panel, three in the
 * popup and three in settings: severity labels at 3.3:1, five targets under the
 * WCAG 24px floor, 11px metadata. It also found two defects in the rules --
 * UX-001 treating every button as a call to action, and A11Y-004 measuring a
 * checkbox rather than the label that activates it. Both would have fired on
 * most real websites.
 */

/** What each surface is allowed to still report, and why. */
type Accepted = { ruleId: string; severity: Severity; because: string };

const ACCEPTED: Record<string, Accepted[]> = {
  sidepanel: [
    {
      ruleId: 'A11Y-004',
      severity: 'low',
      because:
        'The close and delete buttons are 24px: the WCAG floor, under the 44px touch recommendation. ' +
        'The panel is a dense pointer surface, and 44px icon buttons would push the findings list off screen. ' +
        'The rule is right to raise it and right to call it low.',
    },
  ],
  popup: [],
  options: [
    {
      ruleId: 'UI-002',
      severity: 'low',
      because:
        '96% of measured gaps sit on the 8px scale and one 4px gap does not. ' +
        'That is the rule reporting a real outlier at the right severity on a page that is otherwise consistent.',
    },
  ],
  report: [],
};

/** No surface may ship a finding at these severities. */
const UNACCEPTABLE: Severity[] = ['critical', 'high', 'medium'];

/** Every stylesheet the build emits, inlined so a mirrored page renders. */
function inlineStyles(markup: string): string {
  const css = readdirSync('dist/assets')
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(join('dist/assets', name), 'utf8'))
    .join('\n');
  return markup
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, '')
    .replace('</head>', `<style>${css}</style></head>`);
}

/**
 * Serves a page's own HTML at the fixture origin and audits it.
 *
 * The mirror is needed because an extension page cannot have a content script
 * injected into it, and building an audit hook into the product to work around
 * that would be a test backdoor in shipped code. What is mirrored is the real
 * rendered markup and the real compiled CSS, in a real browser at the width
 * the surface is actually used at -- only React's runtime is absent, and a
 * static audit does not consult it.
 */
async function auditMirrored(
  context: import('@playwright/test').BrowserContext,
  activate: (page: Page) => Promise<void>,
  extensionId: string,
  name: string,
  html: string,
  width: number,
): Promise<{ snapshot: PageSnapshot; findings: Finding[] }> {
  const mirror = await context.newPage();
  await mirror.setViewportSize({ width, height: 900 });
  const url = `${FIXTURE_ORIGIN}/self-${name}.html`;
  await mirror.route(url, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await mirror.goto(url);
  await activate(mirror);

  const driver = await context.newPage();
  await driver.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await mirror.bringToFront();

  const snapshot = (
    await exchange<{ payload: PageSnapshot }>(
      driver,
      { type: 'REQUEST_SNAPSHOT', payload: { includeOffscreen: true } },
      'SNAPSHOT_READY',
    )
  ).payload;

  const result = runAudit(snapshot, {
    categories: [...ALL_CATEGORIES],
    settings: DEFAULT_AUDIT_SETTINGS,
  });
  await driver.close();
  await mirror.close();
  return { snapshot, findings: result.findings };
}

function assertClean(surface: string, findings: readonly Finding[]): void {
  const describe = (finding: Finding): string =>
    `${finding.severity} ${finding.ruleId}: ${finding.title} — ${finding.evidence.join(' ')}`;

  const serious = findings.filter((finding) => UNACCEPTABLE.includes(finding.severity));
  expect(serious.map(describe), `${surface} has findings it must not ship with`).toEqual([]);

  const allowed = ACCEPTED[surface] ?? [];
  const unexpected = findings.filter(
    (finding) =>
      !allowed.some((entry) => entry.ruleId === finding.ruleId && entry.severity === finding.severity),
  );
  expect(
    unexpected.map(describe),
    `${surface} reports something not on its accepted list; either fix it or record why it is acceptable`,
  ).toEqual([]);
}

test('the side panel passes its own thirty rules', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  const seed = await openFixture('accessibility.html');
  await activate(seed);

  // Audited in the state it is actually read in: findings listed, one open,
  // history and files present, and a comment written with an image attached.
  //
  // The comment matters. A panel audited before anything is in it never
  // renders the comment rows, the lettered marker or the attachment thumbnail
  // and its remove control -- which is to say the newest UI, and the most
  // likely to have a defect, would be the only part not covered.
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  await panel.locator('.finding-row').first().click();
  await expect(panel.locator('.detail')).toBeVisible();

  /*
   * Written in the card on the page, which is where the composer is now.
   *
   * Given a priority on purpose: the panel's priority chip is part of the
   * newest UI and would otherwise be the one piece of it never audited. It is
   * the panel that gets audited here, not the card -- the card lives in a
   * shadow root on somebody else's page and is covered by comments.spec.
   */
  await expect(panel.locator('.progress', { hasText: 'Photographing' })).toHaveCount(0, {
    timeout: 60_000,
  });
  await panel.getByRole('button', { name: 'Comment on the page' }).dispatchEvent('click');
  await seed.bringToFront();
  await expect(seed.locator('thursday-root .cm-card')).toBeVisible();
  await seed.locator('thursday-root .cm-priority[data-level="high"]').click();
  await seed.locator('thursday-root .cm-body').fill('The label sits too close to the field.');
  await seed
    .locator('thursday-root input[type="file"]')
    .setInputFiles(resolve('tests/fixtures/annotation-image.png'));
  await seed.locator('thursday-root .cm-add').click();
  await expect(seed.locator('thursday-root .cm-card')).toBeHidden({ timeout: 15_000 });
  await panel.bringToFront();
  await expect(panel.locator('.attach-grid img')).toHaveCount(1);
  await expect(panel.locator('.comment-priority')).toHaveText('High');

  const html = inlineStyles(await panel.content());
  await panel.close();

  const { snapshot, findings } = await auditMirrored(
    context,
    activate,
    extensionId,
    'sidepanel',
    html,
    400,
  );
  // A clean result from an empty page would prove nothing.
  expect(snapshot.elements.length).toBeGreaterThan(100);
  assertClean('sidepanel', findings);
});

for (const surface of [
  { name: 'popup', width: 340 },
  { name: 'options', width: 800 },
] as const) {
  test(`the ${surface.name} passes its own thirty rules`, async ({
    openFixture,
    activate,
    extensionId,
    context,
  }) => {
    const seed = await openFixture('accessibility.html');
    await activate(seed);

    const source = await context.newPage();
    await source.setViewportSize({ width: surface.width, height: 900 });
    await source.goto(`chrome-extension://${extensionId}/${surface.name}.html`);
    // Both pages read storage before they finish rendering.
    await expect(source.locator('.card').first()).toBeVisible();
    const html = inlineStyles(await source.content());
    await source.close();

    const { snapshot, findings } = await auditMirrored(
      context,
      activate,
      extensionId,
      surface.name,
      html,
      surface.width,
    );
    expect(snapshot.elements.length).toBeGreaterThan(10);
    assertClean(surface.name, findings);
  });
}

test('the exported report passes the rules it reports on', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  // The report is the artifact other people read, and it is the one surface
  // Thursday hands to someone who never installed it.
  const seed = await openFixture('accessibility.html');
  await activate(seed);
  const driver = await context.newPage();
  await driver.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await driver.getByRole('button', { name: 'Full audit' }).click();
  await expect(driver.locator('.finding-row').first()).toBeVisible();

  const snapshot = (
    await exchange<{ payload: PageSnapshot }>(
      driver,
      { type: 'REQUEST_SNAPSHOT', payload: { includeOffscreen: true } },
      'SNAPSHOT_READY',
    )
  ).payload;
  const source = runAudit(snapshot, {
    categories: [...ALL_CATEGORIES],
    settings: DEFAULT_AUDIT_SETTINGS,
  });
  await driver.close();

  // Rendered with a comment and an attached image in it, because the comments
  // section has its own colours, its own markers and a figure with a caption
  // -- none of which a report without comments would put on the page.
  const html = renderReport({
    audit: source.audit,
    findings: source.findings,
    digest: source.digest,
    annotations: [
      {
        id: 'self-audit-comment',
        auditId: source.audit.id,
        body: 'The two fields ask for the same thing, and the second one is not labelled.',
        attachments: [
          {
            id: 'self-audit-image',
            annotationId: 'self-audit-comment',
            auditId: source.audit.id,
            mime: 'image/png',
            bytes: 116,
            width: 48,
            height: 32,
            caption: 'The duplicated field pair',
            source: 'file',
            createdAt: Date.now(),
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    attachments: {
      'self-audit-image': `data:image/png;base64,${readFileSync(
        resolve('tests/fixtures/annotation-image.png'),
      ).toString('base64')}`,
    },
    productVersion: '0.2.0',
    generatedAt: Date.now(),
  });

  const { findings } = await auditMirrored(context, activate, extensionId, 'report', html, 900);
  assertClean('report', findings);
});

/* -- the older, narrower checks, kept because they fail faster -------------- */

const SELECTORS = [
  '.brandmark',
  '.panel-foot span',
  '.section-title',
  '.finding-title',
  '.finding-sev',
  '.sev-chip',
  '.row-pin',
  '.detail-summary',
  '.finding-block p',
  '.hint',
  '.history-when',
  '.history-count',
  '.notice',
  '.dropzone',
  'button.link',
  '.diff-totals li[data-kind="fixed"]',
  '.diff-totals li[data-kind="new"]',
  '.diff-totals li[data-kind="unchanged"]',
  '.tabs button[aria-selected="true"]',
];

type Sample = {
  selector: string;
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
};

async function sample(panel: Page, selectors: string[]): Promise<Sample[]> {
  return panel.evaluate((wanted) => {
    /** The nearest ancestor that actually paints, which is what text sits on. */
    const resolveBackground = (start: Element): string => {
      let node: Element | null = start;
      while (node) {
        const colour = getComputedStyle(node).backgroundColor;
        if (colour && colour !== 'transparent' && !colour.startsWith('rgba(0, 0, 0, 0)')) return colour;
        node = node.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const out: Sample[] = [];
    for (const selector of wanted) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const styles = getComputedStyle(element);
      out.push({
        selector,
        color: styles.color,
        background: resolveBackground(element),
        fontSize: Number.parseFloat(styles.fontSize),
        fontWeight: Number.parseFloat(styles.fontWeight) || 400,
      });
    }
    return out;
  }, selectors) as Promise<Sample[]>;
}

function assertReadable(samples: Sample[]): void {
  for (const item of samples) {
    const foreground = parseColor(item.color);
    const background = parseColor(item.background);
    expect(foreground, item.selector).not.toBeNull();
    expect(background, item.selector).not.toBeNull();
    const ratio = contrastRatio(foreground!, background!);
    const target = contrastTarget(item.fontSize, item.fontWeight);
    expect(
      ratio,
      `${item.selector}: ${ratio.toFixed(2)}:1 at ${item.fontSize}px needs ${target.ratio}:1`,
    ).toBeGreaterThanOrEqual(target.ratio);
  }
}

test('every coloured label in the panel clears the contrast rule', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  // Severity is the panel's most meaningful text and was its least readable:
  // the first version measured 3.33:1 at 11px. These selectors exist so a
  // colour change fails here, with the ratio in the message, rather than in a
  // whole-page audit that says only that something is wrong somewhere.
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.compare')).toBeVisible();
  await expect(panel.locator('.history-row').first()).toBeVisible();

  const samples = await sample(panel, SELECTORS);
  expect(samples.length).toBeGreaterThanOrEqual(10);
  assertReadable(samples);

  await panel.getByLabel('Open a saved audit file').setInputFiles(resolve('tests/fixtures/sample.thursday.json'));
  await expect(panel.locator('.notice')).toContainText('Opened from a file');
  assertReadable(await sample(panel, ['.notice', '.history-when', '.dropzone']));
});

test('the panel says what state it is in without relying on colour alone', async ({
  openFixture,
  activate,
  extensionId,
  context,
}) => {
  const page = await openFixture('accessibility.html');
  await activate(page);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.getByRole('button', { name: 'Full audit' }).click();
  await expect(panel.locator('.finding-row').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Full audit' }).click();

  await expect(panel.locator('.diff-totals li[data-kind="fixed"]')).toContainText('fixed');
  await expect(panel.locator('.diff-totals li[data-kind="new"]')).toContainText('new');
  await expect(panel.locator('.diff-totals li[data-kind="unchanged"]')).toContainText('still open');

  await panel.locator('.history-open').first().click();
  await expect(panel.locator('.notice')).toContainText('Reopened from history');
});
