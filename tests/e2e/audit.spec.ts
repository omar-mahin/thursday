import type { Page } from '@playwright/test';
import type { AuditOptions, PageSnapshot } from '../../src/shared/types';
import { runAudit } from '../../src/audit/engine/run';
import { ALL_CATEGORIES } from '../../src/audit/engine/registry';
import { DEFAULT_AUDIT_SETTINGS } from '../../src/audit/types';
import { exchange, expect, testWithHostAccess as test } from './fixtures';

/**
 * The strongest test in the suite: real snapshots, captured from real Chromium
 * over the production message path, then fed to the pure rule engine in Node.
 *
 * That split is the whole point of the snapshot architecture (PLAN.md 2.2) --
 * the browser measures, the engine judges, and each half can be tested for what
 * it actually does.
 */
const OPTIONS: AuditOptions = { categories: [...ALL_CATEGORIES], settings: DEFAULT_AUDIT_SETTINGS };

async function auditFixture(
  openFixture: (name: string) => Promise<Page>,
  activate: (page: Page) => Promise<void>,
  extensionId: string,
  fixture: string,
  viewport?: { width: number; height: number },
) {
  const page = await openFixture(fixture);
  if (viewport) await page.setViewportSize(viewport);
  await activate(page);
  const panel = await page.context().newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.bringToFront();
  const message = await exchange<{ payload: PageSnapshot }>(
    panel,
    { type: 'REQUEST_SNAPSHOT', payload: { includeOffscreen: true } },
    'SNAPSHOT_READY',
  );
  return { snapshot: message.payload, result: runAudit(message.payload, OPTIONS), page };
}

const ids = (result: { findings: { ruleId: string }[] }): string[] => [
  ...new Set(result.findings.map((finding) => finding.ruleId)),
];

test('a clean page produces zero findings', async ({ openFixture, activate, extensionId }) => {
  // The false-positive gate. Every rule has to stay quiet on a well-built page,
  // or none of the other findings can be trusted.
  const { result } = await auditFixture(openFixture, activate, extensionId, 'control.html');

  expect(
    result.findings.map((finding) => `${finding.ruleId}: ${finding.title}`),
    'the control page must produce no findings',
  ).toEqual([]);
  expect(result.failedRules).toEqual([]);
});

test('planted accessibility defects are all found', async ({ openFixture, activate, extensionId }) => {
  const { result } = await auditFixture(openFixture, activate, extensionId, 'accessibility.html');
  const found = ids(result);

  for (const rule of [
    'A11Y-001', // image with no alt
    'A11Y-002', // unlabelled field, and a placeholder-only one
    'A11Y-003', // grey on white
    'A11Y-004', // 18px and 32px targets
    'A11Y-005', // h1 -> h4
    'A11Y-006', // outline removed with no replacement
    'A11Y-007', // empty button
    'A11Y-008', // duplicate id
    'A11Y-009', // no lang attribute
    'A11Y-010', // positive tabindex
  ]) {
    expect(found, `expected ${rule}`).toContain(rule);
  }

  const contrast = result.findings.find((finding) => finding.ruleId === 'A11Y-003');
  expect(Number(contrast?.measurements?.['ratio'])).toBeLessThan(4.5);
  expect(contrast?.evidence.join(' ')).toMatch(/rgb\(/);

  // The two label problems are graded differently, not lumped together.
  const labels = result.findings.filter((finding) => finding.ruleId === 'A11Y-002');
  expect(labels.map((finding) => finding.severity).sort()).toEqual(['high', 'medium']);

  // Both target bands appear, and only the sub-24px one is stated as a rule.
  const targets = result.findings.filter((finding) => finding.ruleId === 'A11Y-004');
  expect(targets.some((finding) => finding.type === 'rule')).toBe(true);
  expect(targets.some((finding) => finding.type === 'heuristic')).toBe(true);
});

test('planted content defects are all found', async ({ openFixture, activate, extensionId }) => {
  const { result } = await auditFixture(openFixture, activate, extensionId, 'content.html');
  const found = ids(result);

  for (const rule of ['CNT-001', 'CNT-002', 'CNT-003', 'CNT-004', 'CNT-005']) {
    expect(found, `expected ${rule}`).toContain(rule);
  }

  const vague = result.findings.filter((finding) => finding.ruleId === 'CNT-001');
  expect(vague.map((finding) => finding.measurements?.['label']).sort()).toEqual(['Click here', 'Learn more']);

  const grade = result.findings.find((finding) => finding.ruleId === 'CNT-004');
  expect(grade?.severity).toBe('info');
  expect(Number(grade?.measurements?.['grade'])).toBeGreaterThan(12);
});

test('planted UI defects are all found', async ({ openFixture, activate, extensionId }) => {
  const { result } = await auditFixture(openFixture, activate, extensionId, 'ui.html');
  const found = ids(result);

  for (const rule of ['UI-001', 'UI-002', 'UI-005', 'UI-006']) {
    expect(found, `expected ${rule}`).toContain(rule);
  }

  const spacing = result.findings.find((finding) => finding.ruleId === 'UI-002');
  expect(spacing?.measurements?.['gap']).toBe(19);

  const alignment = result.findings.find((finding) => finding.ruleId === 'UI-005');
  expect(alignment?.measurements?.['offset']).toBe(3);

  const colors = result.findings.find((finding) => finding.ruleId === 'UI-006');
  expect(colors?.evidence.join(' ')).toMatch(/visually identical/);
});

test('a page that hides its actions below the fold is flagged', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const { result } = await auditFixture(openFixture, activate, extensionId, 'cro.html');
  const found = ids(result);
  expect(found).toContain('CRO-001');
  expect(found).toContain('UX-001');

  const cro = result.findings.find((finding) => finding.ruleId === 'CRO-001');
  expect(Number(cro?.measurements?.['screens'])).toBeGreaterThan(1);
});

test('responsive defects are found, and the mobile-only rule respects the viewport', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  const desktop = await auditFixture(openFixture, activate, extensionId, 'responsive.html');
  expect(ids(desktop.result)).toContain('RESP-001');
  expect(ids(desktop.result)).toContain('RESP-002');
  // 9px text is not reported at desktop width: the rule is about small screens.
  expect(ids(desktop.result)).not.toContain('RESP-003');

  const overflow = desktop.result.findings.find((finding) => finding.ruleId === 'RESP-001');
  expect(overflow?.summary).toMatch(/too-wide/);

  const phone = await auditFixture(openFixture, activate, extensionId, 'responsive.html', {
    width: 390,
    height: 844,
  });
  expect(ids(phone.result)).toContain('RESP-003');
});

test('every finding is actionable and carries its evidence', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  // Principle 4 from the spec: a finding has to answer what, why, and what now.
  const pages = ['accessibility.html', 'content.html', 'ui.html'];
  for (const fixture of pages) {
    const { result, snapshot } = await auditFixture(openFixture, activate, extensionId, fixture);
    expect(result.findings.length, fixture).toBeGreaterThan(0);

    for (const finding of result.findings) {
      const where = `${fixture} ${finding.ruleId}`;
      expect(finding.evidence.length, where).toBeGreaterThan(0);
      expect(finding.evidence.every((line) => line.trim().length > 0), where).toBe(true);
      expect(finding.summary.length, where).toBeGreaterThan(20);
      expect(finding.impact.length, where).toBeGreaterThan(20);
      expect(finding.recommendation.length, where).toBeGreaterThan(15);
      expect(['rule', 'heuristic', 'inference', 'recommendation'], where).toContain(finding.type);
      expect(finding.confidence, where).toBeGreaterThan(0);

      // A heuristic may never claim critical or high.
      if (finding.type !== 'rule') {
        expect(['medium', 'low', 'info'], where).toContain(finding.severity);
      }
      // An element-scoped finding must point somewhere real.
      if (finding.elementRef) {
        expect(finding.elementRef.tagName, where).not.toBe('');
        expect(snapshot.elements.some((element) => element.tagName === finding.elementRef!.tagName), where).toBe(true);
      }
    }
  }
});

test('a login page audit leaks no field values into findings', async ({
  openFixture,
  activate,
  extensionId,
}) => {
  // Findings quote page content as evidence, so redaction has to hold all the
  // way through the engine, not just in the snapshot.
  const { result } = await auditFixture(openFixture, activate, extensionId, 'login.html');
  const serialized = JSON.stringify(result);
  for (const secret of ['hunter2-secret', '4111111111111111', 'csrf-token-abcdef123456', 'ada@example.com']) {
    expect(serialized, `leaked ${secret}`).not.toContain(secret);
  }
  expect(result.findings.length).toBeGreaterThan(0);
});
