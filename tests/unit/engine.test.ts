import { beforeEach, describe, expect, it } from 'vitest';
import type { RawFinding } from '../../src/shared/types';
import {
  applyCaps,
  dedupe,
  MAX_PER_AUDIT,
  MAX_PER_ELEMENT,
  MAX_PER_RULE,
  titleSimilarity,
} from '../../src/audit/engine/dedupe';
import { compareSeverity, resolveConfidence, resolveSeverity, severityRank } from '../../src/audit/engine/severity';
import { ALL_CATEGORIES, ALL_RULES, ruleById, rulesFor } from '../../src/audit/engine/registry';
import { countBySeverity, runAudit } from '../../src/audit/engine/run';
import { DEFAULT_AUDIT_SETTINGS, type Rule } from '../../src/audit/types';
import { imageMissingAlt } from '../../src/audit/rules/a11y/images';
import { element, named, resetIndexes, snapshot } from './helpers/snapshot';

beforeEach(resetIndexes);

const raw = (overrides: Partial<RawFinding> = {}): RawFinding => ({
  ruleId: 'A11Y-001',
  category: 'a11y',
  type: 'rule',
  title: 'Image has no alt attribute',
  summary: 'summary',
  evidence: ['evidence'],
  impact: 'impact',
  recommendation: 'recommendation',
  ...overrides,
});

describe('registry', () => {
  it('exposes every rule with a unique id', () => {
    const ids = ALL_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(30);
  });

  it('covers all six categories', () => {
    for (const category of ALL_CATEGORIES) {
      expect(rulesFor([category]).length, category).toBeGreaterThan(0);
    }
  });

  it('gives every rule a description and a declared kind', () => {
    for (const rule of ALL_RULES) {
      expect(rule.description.length, rule.id).toBeGreaterThan(10);
      expect(['rule', 'heuristic'], rule.id).toContain(rule.kind);
      expect(['page', 'element'], rule.id).toContain(rule.scope);
    }
  });

  it('finds a rule by id', () => {
    expect(ruleById('A11Y-003')?.category).toBe('a11y');
    expect(ruleById('NOPE-999')).toBeUndefined();
  });

  it('filters to the requested categories only', () => {
    const selected = rulesFor(['content']);
    expect(selected.every((rule) => rule.category === 'content')).toBe(true);
  });
});

describe('severity', () => {
  it('uses the rule default when a rule proposes nothing', () => {
    expect(resolveSeverity(raw({ ruleId: 'A11Y-007' }))).toBe('high');
    expect(resolveSeverity(raw({ ruleId: 'UI-002', type: 'heuristic' }))).toBe('low');
  });

  it('lets a rule escalate on its own evidence', () => {
    expect(resolveSeverity(raw({ ruleId: 'A11Y-003', severity: 'critical' }))).toBe('critical');
  });

  it('caps heuristics at medium, however loudly they ask', () => {
    // Without a measurement behind it, a finding has not earned high.
    expect(resolveSeverity(raw({ type: 'heuristic', severity: 'critical' }))).toBe('medium');
    expect(resolveSeverity(raw({ type: 'inference', severity: 'high' }))).toBe('medium');
  });

  it('never derives severity from confidence', () => {
    const low = raw({ type: 'rule', severity: 'high' });
    expect(resolveConfidence(low)).toBe(1);
    expect(resolveSeverity({ ...low, type: 'rule' })).toBe('high');
    // Same severity request, different type: only the type ceiling applies.
    expect(resolveSeverity({ ...low, type: 'heuristic' })).toBe('medium');
  });

  it('assigns confidence by how the finding was derived', () => {
    expect(resolveConfidence(raw({ type: 'rule' }))).toBe(1);
    expect(resolveConfidence(raw({ type: 'heuristic' }))).toBe(0.8);
    expect(resolveConfidence(raw({ type: 'inference' }))).toBe(0.6);
  });

  it('orders severities from info to critical', () => {
    expect(severityRank('critical')).toBeGreaterThan(severityRank('high'));
    expect(severityRank('info')).toBe(0);
    expect(compareSeverity('critical', 'low')).toBeLessThan(0);
  });
});

describe('titleSimilarity', () => {
  it('scores two phrasings of one statement highly', () => {
    expect(titleSimilarity('Image has no alt attribute', 'Image has no alt')).toBeGreaterThan(0.6);
  });

  it('scores unrelated statements low', () => {
    expect(titleSimilarity('Image has no alt attribute', 'Page scrolls horizontally')).toBeLessThan(0.2);
  });

  it('handles empty input without dividing by zero', () => {
    expect(titleSimilarity('', 'anything')).toBe(0);
  });
});

describe('dedupe', () => {
  const page = snapshot([
    element({ tagName: 'section' }),
    element({ tagName: 'div', parent: 0 }),
    element({ tagName: 'button', parent: 1 }),
  ]);

  it('keeps the innermost element when one rule fires up a chain', () => {
    // "This button has low contrast" is more useful than "something in this
    // section has low contrast".
    const findings = dedupe(
      [raw({ ruleId: 'A11Y-003', elementIndex: 0 }), raw({ ruleId: 'A11Y-003', elementIndex: 2 })],
      page,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.elementIndex).toBe(2);
  });

  it('does not collapse different rules on related elements', () => {
    const findings = dedupe(
      [raw({ ruleId: 'A11Y-003', elementIndex: 0 }), raw({ ruleId: 'A11Y-004', elementIndex: 2 })],
      page,
    );
    expect(findings).toHaveLength(2);
  });

  it('merges the same statement about the same element, keeping extra evidence', () => {
    const findings = dedupe(
      [
        raw({ elementIndex: 2, evidence: ['first'] }),
        raw({ elementIndex: 2, title: 'Image has no alt', evidence: ['second'] }),
      ],
      page,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toEqual(['first', 'second']);
  });

  it('keeps genuinely different findings on the same element', () => {
    const findings = dedupe(
      [
        raw({ elementIndex: 2, title: 'Image has no alt attribute' }),
        raw({ elementIndex: 2, ruleId: 'A11Y-004', title: 'Target is too small' }),
      ],
      page,
    );
    expect(findings).toHaveLength(2);
  });

  it('keeps page-level findings separate from element ones', () => {
    const findings = dedupe([raw({}), raw({ elementIndex: 2 })], page);
    expect(findings).toHaveLength(2);
  });
});

describe('caps', () => {
  it('limits findings per element', () => {
    const many = Array.from({ length: MAX_PER_ELEMENT + 4 }, (_, index) =>
      raw({ ruleId: `R-${index}`, elementIndex: 1 }),
    );
    const { findings, suppressed } = applyCaps(many);
    expect(findings).toHaveLength(MAX_PER_ELEMENT);
    expect(suppressed).toBe(4);
  });

  it('limits findings per audit', () => {
    const many = Array.from({ length: MAX_PER_AUDIT + 10 }, (_, index) =>
      raw({ ruleId: `R-${index}`, elementIndex: index }),
    );
    const { findings, suppressed } = applyCaps(many);
    expect(findings).toHaveLength(MAX_PER_AUDIT);
    expect(suppressed).toBe(10);
  });

  it('stops one noisy rule from burying the page', () => {
    // An unstyled form can put a dozen inputs under the target minimum, and
    // twelve near-identical findings hide the unlabelled control below them.
    const many = Array.from({ length: MAX_PER_RULE + 3 }, (_, index) =>
      raw({ ruleId: 'A11Y-004', elementIndex: index }),
    );
    const { findings, suppressed } = applyCaps(many);
    expect(findings).toHaveLength(MAX_PER_RULE);
    expect(suppressed).toBe(3);
  });

  it('caps each rule independently', () => {
    const mixed = [
      ...Array.from({ length: MAX_PER_RULE + 2 }, (_, index) => raw({ ruleId: 'A11Y-004', elementIndex: index })),
      ...Array.from({ length: 3 }, (_, index) => raw({ ruleId: 'A11Y-002', elementIndex: 100 + index })),
    ];
    const { findings } = applyCaps(mixed);
    expect(findings.filter((finding) => finding.ruleId === 'A11Y-004')).toHaveLength(MAX_PER_RULE);
    expect(findings.filter((finding) => finding.ruleId === 'A11Y-002')).toHaveLength(3);
  });

  it('never caps page-level findings by element', () => {
    const many = Array.from({ length: 12 }, (_, index) => raw({ ruleId: `R-${index}` }));
    expect(applyCaps(many).findings).toHaveLength(12);
  });
});

describe('runAudit', () => {
  const options = { categories: [...ALL_CATEGORIES], settings: DEFAULT_AUDIT_SETTINGS };

  it('produces findings with a complete, actionable shape', () => {
    const page = snapshot([element({ tagName: 'img', rect: { x: 0, y: 0, width: 300, height: 200 } })]);
    const { findings } = runAudit(page, options);
    const finding = findings.find((item) => item.ruleId === 'A11Y-001');

    expect(finding).toBeDefined();
    expect(finding!.id).not.toBe('');
    expect(finding!.auditId).not.toBe('');
    expect(finding!.severity).toBe('high');
    expect(finding!.confidence).toBe(1);
    expect(finding!.evidence.length).toBeGreaterThan(0);
    expect(finding!.impact.length).toBeGreaterThan(10);
    expect(finding!.recommendation.length).toBeGreaterThan(10);
    expect(finding!.status).toBe('open');
    expect(finding!.elementRef?.tagName).toBe('img');
  });

  it('attaches a reference that could find the element again', () => {
    const page = snapshot([
      element({ tagName: 'main' }),
      named('Start', {
        tagName: 'button',
        parent: 0,
        interactive: true,
        rect: { x: 10, y: 20, width: 10, height: 10 },
        stableAttribute: { name: 'data-testid', value: 'cta' },
      }),
    ]);
    const { findings } = runAudit(page, options);
    const reference = findings.find((item) => item.ruleId === 'A11Y-004')?.elementRef;
    expect(reference).toMatchObject({
      tagName: 'button',
      accessibleName: 'Start',
      stableAttribute: { name: 'data-testid', value: 'cta' },
      ancestry: ['main'],
    });
    expect(reference?.centroid).toEqual({ x: 15, y: 25 });
  });

  it('ranks by severity, then puts measured findings above interpreted ones', () => {
    const page = snapshot([
      element({ tagName: 'img', rect: { x: 0, y: 0, width: 300, height: 200 } }),
      element({ tagName: 'div', interactive: true, styles: { cursor: 'auto' } }),
    ]);
    const { findings } = runAudit(page, options);
    const severities = findings.map((finding) => finding.severity);
    const ranks = severities.map((severity) => severityRank(severity));
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it('runs only the requested categories', () => {
    const page = snapshot([element({ tagName: 'img' })], { lang: null });
    const { findings } = runAudit(page, { ...options, categories: ['content'] });
    expect(findings.every((finding) => finding.category === 'content')).toBe(true);
  });

  it('reports what it scanned, including truncation', () => {
    const page = snapshot([element({}), element({})], { truncated: true });
    const { audit } = runAudit(page, options);
    expect(audit).toMatchObject({
      url: 'https://example.test/page',
      origin: 'https://example.test',
      truncated: true,
      elementsScanned: 2,
      status: 'completed',
    });
    expect(audit.findingIds).toHaveLength(runAudit(page, options).findings.length);
  });

  it('skips elements hidden from assistive tech or redacted', () => {
    const page = snapshot([
      element({ tagName: 'img', ariaHidden: true }),
      element({ tagName: 'input', redacted: true, form: { type: 'password', required: false, labelledBy: 'none' } }),
    ]);
    const { findings } = runAudit(page, options);
    expect(findings.filter((finding) => finding.ruleId === 'A11Y-001')).toHaveLength(0);
    expect(findings.filter((finding) => finding.ruleId === 'A11Y-002')).toHaveLength(0);
  });

  it('survives a rule that throws, keeps the rest, and names the failure', () => {
    // One broken rule must not cost the user every other finding.
    const exploding: Rule = {
      id: 'BOOM-001',
      category: 'ui',
      kind: 'rule',
      scope: 'page',
      description: 'always throws, for testing error handling',
      run(): never {
        throw new Error('boom');
      },
    };
    const page = snapshot([element({ tagName: 'img', rect: { x: 0, y: 0, width: 300, height: 200 } })]);
    const result = runAudit(page, options, [exploding, imageMissingAlt]);

    expect(result.failedRules).toEqual(['BOOM-001']);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(['A11Y-001']);
  });

  it('counts findings by severity', () => {
    const page = snapshot([element({ tagName: 'img', rect: { x: 0, y: 0, width: 300, height: 200 } })]);
    const { findings } = runAudit(page, options);
    const counts = countBySeverity(findings);
    expect(counts.high).toBeGreaterThanOrEqual(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(findings.length);
  });

  it('finds nothing on an empty page beyond document basics', () => {
    const { findings } = runAudit(snapshot([]), options);
    expect(findings).toEqual([]);
  });
});

/**
 * Dedupe's cost, which is not obviously part of a rule's cost.
 *
 * A page can put a thousand controls under the touch-target minimum, and the
 * first version of the ancestor-collapse pass compared every finding with every
 * other one, rebuilding an ancestor chain each time. It took longer than the
 * other twenty-nine rules put together, and almost all of that work was on
 * findings the per-rule cap discarded immediately afterwards.
 */
describe('dedupe at scale', () => {
  /** A flat page of `count` siblings, plus the findings a rule fires on each. */
  const noisyPage = (count: number) => {
    resetIndexes();
    const root = element({ tagName: 'main' });
    const children = Array.from({ length: count }, () =>
      element({ tagName: 'button', parent: root.index, interactive: true }),
    );
    const page = snapshot([root, ...children]);
    const findings = children.map((child) =>
      raw({ ruleId: 'A11Y-004', elementIndex: child.index, title: `Target ${child.index} is too small` }),
    );
    return { page, findings };
  };

  it('collapses an ancestor firing of the same rule, keeping the inner one', () => {
    resetIndexes();
    const outer = element({ tagName: 'section' });
    const inner = element({ tagName: 'button', parent: outer.index });
    const page = snapshot([outer, inner]);
    const outerFinding = raw({ ruleId: 'A11Y-003', elementIndex: outer.index, title: 'Contrast is low' });
    const innerFinding = raw({ ruleId: 'A11Y-003', elementIndex: inner.index, title: 'Contrast is low' });

    const kept = dedupe([outerFinding, innerFinding], page);
    expect(kept).toEqual([innerFinding]);
  });

  it('collapses through several generations, not just a direct parent', () => {
    resetIndexes();
    const a = element({ tagName: 'main' });
    const b = element({ tagName: 'section', parent: a.index });
    const c = element({ tagName: 'div', parent: b.index });
    const d = element({ tagName: 'button', parent: c.index });
    const page = snapshot([a, b, c, d]);
    const findings = [a, d].map((item) =>
      raw({ ruleId: 'UI-001', elementIndex: item.index, title: 'Buttons are inconsistent' }),
    );

    expect(dedupe(findings, page).map((finding) => finding.elementIndex)).toEqual([d.index]);
  });

  it('leaves siblings alone: neither is inside the other', () => {
    const { page, findings } = noisyPage(4);
    expect(dedupe(findings, page)).toHaveLength(4);
  });

  it('stays linear as the number of findings grows', () => {
    // Ten times the findings should cost roughly ten times as much, not a
    // hundred. The multiple is loose because this runs on shared CI hardware;
    // it is checking the shape of the curve, not a wall-clock number.
    const time = (count: number): number => {
      const { page, findings } = noisyPage(count);
      dedupe(findings, page);
      const started = performance.now();
      dedupe(findings, page);
      return performance.now() - started;
    };

    const small = Math.max(time(200), 0.05);
    const large = time(2000);
    expect(large / small, `200 findings took ${small.toFixed(2)}ms, 2000 took ${large.toFixed(2)}ms`).toBeLessThan(
      30,
    );
  });
});
