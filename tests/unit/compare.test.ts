import { beforeEach, describe, expect, it } from 'vitest';
import type { ElementReference, Finding } from '../../src/shared/types';
import {
  carryAnnotations,
  compareAudits,
  diffCounts,
  elementKey,
  findingKey,
} from '../../src/audit/engine/compare';

let counter = 0;
beforeEach(() => {
  counter = 0;
});

const reference = (overrides: Partial<ElementReference> = {}): ElementReference => ({
  tagName: 'button',
  structuralPath: 'main>div:nth-of-type(1)>button:nth-of-type(2)',
  ancestry: ['main', 'div'],
  rect: { x: 0, y: 0, width: 100, height: 40 },
  centroid: { x: 50, y: 20 },
  ...overrides,
});

const finding = (overrides: Partial<Finding> = {}): Finding => {
  counter += 1;
  return {
    id: `f${counter}`,
    auditId: 'audit',
    ruleId: 'A11Y-004',
    category: 'a11y',
    type: 'rule',
    title: 'Target too small',
    severity: 'low',
    confidence: 1,
    summary: '',
    evidence: [],
    impact: '',
    recommendation: '',
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
};

describe('elementKey', () => {
  it('prefers a test attribute over everything else', () => {
    const key = elementKey(
      reference({
        stableAttribute: { name: 'data-testid', value: 'Submit' },
        accessibleName: 'Send',
        textSnippet: 'Send',
      }),
    );
    expect(key).toBe('a:data-testid=submit');
  });

  it('uses role and name when there is no test attribute', () => {
    expect(elementKey(reference({ role: 'button', accessibleName: 'Add to cart' }))).toBe(
      'n:button/add to cart',
    );
  });

  it('is insensitive to case and whitespace changes in a name', () => {
    // Reformatting the template must not report every finding as new.
    expect(elementKey(reference({ accessibleName: 'Add   to cart' }))).toBe(
      elementKey(reference({ accessibleName: 'add to cart' })),
    );
  });

  it('falls back to position only when nothing else identifies the element', () => {
    expect(elementKey(reference())).toBe('p:main>div:nth-of-type(1)>button:nth-of-type(2)');
  });

  it('treats a finding with no element as being about the page', () => {
    expect(elementKey(undefined)).toBe('page');
  });

  it('separates two findings from different rules about the same element', () => {
    const shared = reference({ accessibleName: 'Buy' });
    expect(findingKey(finding({ ruleId: 'A11Y-004', elementRef: shared }))).not.toBe(
      findingKey(finding({ ruleId: 'A11Y-002', elementRef: shared })),
    );
  });
});

describe('compareAudits', () => {
  it('reports a finding present before and absent now as fixed', () => {
    const before = [finding({ elementRef: reference({ accessibleName: 'Buy' }) })];
    const diff = compareAudits(before, []);
    expect(diff.fixed).toHaveLength(1);
    expect(diff.introduced).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('reports a finding absent before and present now as new', () => {
    const after = [finding({ elementRef: reference({ accessibleName: 'Buy' }) })];
    expect(diffCounts(compareAudits([], after))).toMatchObject({ introduced: 1, fixed: 0, net: 1 });
  });

  it('pairs repeats one for one rather than as sets', () => {
    // Six small targets becoming two is four fixed, not "unchanged".
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const before = names.map((name) => finding({ elementRef: reference({ accessibleName: name }) }));
    const after = names
      .slice(0, 2)
      .map((name) => finding({ elementRef: reference({ accessibleName: name }) }));
    const diff = compareAudits(before, after);
    expect(diff.fixed).toHaveLength(4);
    expect(diff.unchanged).toHaveLength(2);
    expect(diff.introduced).toHaveLength(0);
  });

  it('does not confuse two identical findings on different elements', () => {
    const before = [
      finding({ elementRef: reference({ accessibleName: 'One' }) }),
      finding({ elementRef: reference({ accessibleName: 'Two' }) }),
    ];
    const after = [finding({ elementRef: reference({ accessibleName: 'Two' }) })];
    const diff = compareAudits(before, after);
    expect(diff.fixed[0]?.elementRef?.accessibleName).toBe('One');
  });

  it('sees a moved but still-named element as the same finding', () => {
    const before = [
      finding({ elementRef: reference({ accessibleName: 'Buy', structuralPath: 'main>a:nth-of-type(1)' }) }),
    ];
    const after = [
      finding({ elementRef: reference({ accessibleName: 'Buy', structuralPath: 'footer>a:nth-of-type(9)' }) }),
    ];
    expect(compareAudits(before, after).unchanged).toHaveLength(1);
  });

  it('orders each column worst-first', () => {
    const before = [
      finding({ ruleId: 'A', severity: 'low', elementRef: reference({ accessibleName: 'l' }) }),
      finding({ ruleId: 'B', severity: 'critical', elementRef: reference({ accessibleName: 'c' }) }),
    ];
    expect(compareAudits(before, []).fixed.map((item) => item.severity)).toEqual(['critical', 'low']);
  });

  it('calls a page with nothing fixed and nothing new unchanged', () => {
    const shared = [finding({ elementRef: reference({ accessibleName: 'Buy' }) })];
    const after = [finding({ elementRef: reference({ accessibleName: 'Buy' }) })];
    expect(diffCounts(compareAudits(shared, after))).toEqual({
      fixed: 0,
      unchanged: 1,
      introduced: 0,
      net: 0,
    });
  });
});

describe('carryAnnotations', () => {
  it('keeps a dismissal across a re-audit', () => {
    // Re-running an audit must not resurrect everything already triaged.
    const before = [
      finding({ status: 'dismissed', note: 'By design', elementRef: reference({ accessibleName: 'Buy' }) }),
    ];
    const after = [finding({ elementRef: reference({ accessibleName: 'Buy' }) })];
    const carried = carryAnnotations(before, after);
    expect(carried[0]?.status).toBe('dismissed');
    expect(carried[0]?.note).toBe('By design');
  });

  it('keeps report membership', () => {
    const before = [finding({ inReport: true, elementRef: reference({ accessibleName: 'Buy' }) })];
    const after = [finding({ elementRef: reference({ accessibleName: 'Buy' }) })];
    expect(carryAnnotations(before, after)[0]?.inReport).toBe(true);
  });

  it('leaves a genuinely new finding open', () => {
    const before = [finding({ status: 'dismissed', elementRef: reference({ accessibleName: 'Buy' }) })];
    const after = [finding({ elementRef: reference({ accessibleName: 'Something else' }) })];
    expect(carryAnnotations(before, after)[0]?.status).toBe('open');
  });

  it('keeps the new findings, not the old ones', () => {
    const before = [finding({ summary: 'old', elementRef: reference({ accessibleName: 'Buy' }) })];
    const after = [finding({ summary: 'new', elementRef: reference({ accessibleName: 'Buy' }) })];
    const carried = carryAnnotations(before, after);
    expect(carried[0]?.summary).toBe('new');
    expect(carried[0]?.id).toBe(after[0]?.id);
  });

  it('carries nothing when there is nothing to carry', () => {
    const after = [finding({ elementRef: reference() })];
    expect(carryAnnotations([], after)).toEqual(after);
  });
});
