import { beforeEach, describe, expect, it } from 'vitest';
import type { Annotation, Finding } from '../../src/shared/types';
import {
  annotationStatus,
  closedAnnotations,
  countByStatus,
  EMPTY_STATE,
  filterViews,
  groupByRule,
  isClosed,
  issueRows,
  openIssueCount,
  ordinals,
  pinsFor,
  reduce,
  type FindingsState,
} from '../../src/sidepanel/state/findings';
import { placePin, PIN_SIZE } from '../../src/content/pins/pins';
import { digestFor } from '../../src/audit/engine/digest';
import { element, resetIndexes, snapshot } from './helpers/snapshot';

beforeEach(resetIndexes);

let counter = 0;
const finding = (overrides: Partial<Finding> = {}): Finding => {
  counter += 1;
  return {
    id: `f${counter}`,
    auditId: 'a1',
    ruleId: 'A11Y-004',
    category: 'a11y',
    type: 'rule',
    title: `Finding ${counter}`,
    severity: 'medium',
    confidence: 1,
    summary: 'summary',
    evidence: ['evidence'],
    impact: 'impact',
    recommendation: 'recommendation',
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
};

const load = (findings: Finding[]): FindingsState => reduce(EMPTY_STATE, { type: 'load', findings });

describe('loading findings', () => {
  it('opens the first finding so the panel is never a dead list', () => {
    const state = load([finding(), finding()]);
    expect(state.views).toHaveLength(2);
    expect(state.selectedId).toBe(state.views[0]?.finding.id);
  });

  it('starts every finding open, out of the report, with no note', () => {
    const state = load([finding()]);
    expect(state.views[0]).toMatchObject({ status: 'open', inReport: false, note: '' });
  });

  it('keeps filters across a new audit, because the user set them deliberately', () => {
    let state = load([finding({ severity: 'high' })]);
    state = reduce(state, { type: 'toggleSeverity', severity: 'high' });
    state = reduce(state, { type: 'clear' });
    expect(state.severities).toEqual(['high']);
    expect(state.views).toEqual([]);
  });
});

describe('status transitions', () => {
  it('records accept, dismiss and resolve', () => {
    let state = load([finding()]);
    const id = state.views[0]!.finding.id;
    for (const status of ['accepted', 'dismissed', 'resolved'] as const) {
      state = reduce(state, { type: 'status', id, status });
      expect(state.views[0]?.status).toBe(status);
    }
  });

  it('toggles a status off, back to open', () => {
    let state = load([finding()]);
    const id = state.views[0]!.finding.id;
    state = reduce(state, { type: 'status', id, status: 'accepted' });
    state = reduce(state, { type: 'status', id, status: 'open' });
    expect(state.views[0]?.status).toBe('open');
  });

  it('moves the selection on when the open finding is closed', () => {
    // Leaving a dismissed finding open in the detail panel would pretend it
    // still needs attention.
    let state = load([finding(), finding()]);
    const [first, second] = state.views;
    state = reduce(state, { type: 'status', id: first!.finding.id, status: 'dismissed' });
    expect(state.selectedId).toBe(second!.finding.id);
  });

  it('keeps the selection when closed findings are being shown', () => {
    let state = load([finding(), finding()]);
    state = reduce(state, { type: 'showClosed', value: true });
    const id = state.views[0]!.finding.id;
    state = reduce(state, { type: 'status', id, status: 'resolved' });
    expect(state.selectedId).toBe(id);
  });

  it('knows which statuses are closed', () => {
    expect(isClosed('dismissed')).toBe(true);
    expect(isClosed('resolved')).toBe(true);
    expect(isClosed('open')).toBe(false);
    expect(isClosed('accepted')).toBe(false);
  });

  it('counts by status', () => {
    let state = load([finding(), finding(), finding()]);
    state = reduce(state, { type: 'status', id: state.views[0]!.finding.id, status: 'dismissed' });
    expect(countByStatus(state.views)).toEqual({ open: 2, accepted: 0, dismissed: 1, resolved: 0 });
  });
});

describe('notes and report membership', () => {
  it('stores a note against one finding only', () => {
    let state = load([finding(), finding()]);
    state = reduce(state, { type: 'note', id: state.views[0]!.finding.id, note: 'ask design' });
    expect(state.views[0]?.note).toBe('ask design');
    expect(state.views[1]?.note).toBe('');
  });

  it('adds and removes a finding from the report', () => {
    let state = load([finding()]);
    const id = state.views[0]!.finding.id;
    state = reduce(state, { type: 'report', id, inReport: true });
    expect(state.views[0]?.inReport).toBe(true);
    state = reduce(state, { type: 'report', id, inReport: false });
    expect(state.views[0]?.inReport).toBe(false);
  });
});

describe('filtering', () => {
  const mixed = (): FindingsState =>
    load([
      finding({ severity: 'critical' }),
      finding({ severity: 'high' }),
      finding({ severity: 'low' }),
    ]);

  it('shows everything when no severity is selected', () => {
    expect(filterViews(mixed())).toHaveLength(3);
  });

  it('narrows to the selected severities', () => {
    let state = mixed();
    state = reduce(state, { type: 'toggleSeverity', severity: 'critical' });
    expect(filterViews(state).map((view) => view.finding.severity)).toEqual(['critical']);
    state = reduce(state, { type: 'toggleSeverity', severity: 'low' });
    expect(filterViews(state)).toHaveLength(2);
  });

  it('deselecting the last severity shows everything again', () => {
    let state = mixed();
    state = reduce(state, { type: 'toggleSeverity', severity: 'critical' });
    state = reduce(state, { type: 'toggleSeverity', severity: 'critical' });
    expect(filterViews(state)).toHaveLength(3);
  });

  it('hides dismissed and resolved findings until asked', () => {
    let state = mixed();
    state = reduce(state, { type: 'status', id: state.views[0]!.finding.id, status: 'dismissed' });
    expect(filterViews(state)).toHaveLength(2);
    state = reduce(state, { type: 'showClosed', value: true });
    expect(filterViews(state)).toHaveLength(3);
  });

  it('keeps accepted findings visible: accepting is agreement, not closure', () => {
    let state = mixed();
    state = reduce(state, { type: 'status', id: state.views[0]!.finding.id, status: 'accepted' });
    expect(filterViews(state)).toHaveLength(3);
  });
});

describe('grouping', () => {
  it('groups repeats of one rule and orders groups by worst severity', () => {
    const views = load([
      finding({ ruleId: 'A11Y-004', severity: 'low' }),
      finding({ ruleId: 'A11Y-004', severity: 'high' }),
      finding({ ruleId: 'CNT-001', severity: 'medium' }),
    ]).views;

    const groups = groupByRule(views);
    expect(groups.map((group) => [group.ruleId, group.views.length, group.severity])).toEqual([
      ['A11Y-004', 2, 'high'],
      ['CNT-001', 1, 'medium'],
    ]);
  });

  it('leaves a lone finding in a group of one', () => {
    const groups = groupByRule(load([finding()]).views);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.views).toHaveLength(1);
  });

  it('handles an empty list', () => {
    expect(groupByRule([])).toEqual([]);
  });
});

describe('pins', () => {
  const page = snapshot([
    element({ tagName: 'button', documentRect: { x: 10, y: 900, width: 100, height: 40 } }),
    element({ tagName: 'img', documentRect: { x: 20, y: 100, width: 200, height: 150 } }),
  ]);

  const reference = (tagName: string, rect = { x: 0, y: 0, width: 0, height: 0 }) => ({
    tagName,
    structuralPath: '',
    ancestry: [],
    rect,
    centroid: { x: 0, y: 0 },
  });

  /** The digest for a set of findings, exactly as the engine would build it. */
  const digestOf = (findings: Finding[]) => digestFor(page, findings);

  it('numbers pins in list order so the page and the panel agree', () => {
    const findings = [
      finding({ elementIndex: 1, elementRef: reference('img') }),
      finding({ elementIndex: 0, elementRef: reference('button') }),
    ];
    const views = load(findings).views;

    const pins = pinsFor(views, digestOf(findings));
    expect(pins.map((pin) => pin.ordinal)).toEqual([1, 2]);
    expect(pins[0]?.elementIndex).toBe(1);
    expect(pins[0]?.documentRect).toEqual({ x: 20, y: 100, width: 200, height: 150 });
    expect(ordinals(pins).get(pins[1]!.targetId)).toBe(2);
  });

  it('stamps every pin with the snapshot its index belongs to', () => {
    // Without this the page cannot tell a live index from a restored one, and
    // index 42 of one snapshot is an unrelated element in another.
    const findings = [finding({ elementIndex: 0, elementRef: reference('button') })];
    const pins = pinsFor(load(findings).views, digestOf(findings));
    expect(pins[0]?.snapshotId).toBe(page.id);
  });

  it('gives no pin to a page-level finding', () => {
    // A pin with nothing behind it would be a lie about where the problem is.
    const findings = [finding()];
    expect(pinsFor(load(findings).views, digestOf(findings))).toEqual([]);
  });

  it('still pins a finding whose position was not recorded', () => {
    // An imported file may carry no positions at all. The finding still points
    // at a real element, so the page is asked to find it; the fallback rect is
    // where it was, which is the best guess available.
    const findings = [
      finding({ elementIndex: 4, elementRef: reference('div', { x: 5, y: 6, width: 30, height: 40 }) }),
    ];
    const bare = { ...digestOf(findings), locations: [], viewport: { ...page.viewport, scrollY: 200 } };
    const pins = pinsFor(load(findings).views, bare);
    expect(pins).toHaveLength(1);
    expect(pins[0]?.documentRect).toEqual({ x: 5, y: 206, width: 30, height: 40 });
  });

  it('produces nothing without a digest', () => {
    expect(pinsFor(load([finding()]).views, null)).toEqual([]);
  });
});

describe('placePin', () => {
  const viewport = { width: 1000, height: 800 };

  it('sits just outside the top-left corner of the element', () => {
    const placement = placePin({ x: 200, y: 300, width: 100, height: 40 }, viewport);
    expect(placement).toEqual({ x: 200 - PIN_SIZE / 2, y: 300 - PIN_SIZE / 2, visible: true });
  });

  it('stays inside the viewport for an element at the very edge', () => {
    const topLeft = placePin({ x: 0, y: 0, width: 50, height: 20 }, viewport);
    expect(topLeft.x).toBeGreaterThanOrEqual(2);
    expect(topLeft.y).toBeGreaterThanOrEqual(2);

    const bottomRight = placePin({ x: 995, y: 795, width: 50, height: 20 }, viewport);
    expect(bottomRight.x + PIN_SIZE).toBeLessThanOrEqual(viewport.width);
    expect(bottomRight.y + PIN_SIZE).toBeLessThanOrEqual(viewport.height);
  });

  it('hides pins for elements scrolled out of view', () => {
    expect(placePin({ x: 100, y: -500, width: 100, height: 40 }, viewport).visible).toBe(false);
    expect(placePin({ x: 100, y: 1200, width: 100, height: 40 }, viewport).visible).toBe(false);
    expect(placePin({ x: -400, y: 100, width: 100, height: 40 }, viewport).visible).toBe(false);
  });

  it('keeps a pin for an element only partly in view', () => {
    expect(placePin({ x: 100, y: -20, width: 100, height: 40 }, viewport).visible).toBe(true);
    expect(placePin({ x: 100, y: 790, width: 100, height: 40 }, viewport).visible).toBe(true);
  });
});

describe('selection', () => {
  it('clears the selection, which is how Escape closes the detail card', () => {
    let state = load([finding()]);
    state = reduce(state, { type: 'select', id: null });
    expect(state.selectedId).toBeNull();
  });

  it('selects a finding by id', () => {
    let state = load([finding(), finding()]);
    const target = state.views[1]!.finding.id;
    state = reduce(state, { type: 'select', id: target });
    expect(state.selectedId).toBe(target);
  });
});

/**
 * The one list.
 *
 * Findings and the user's comments share it. What these check is the part that
 * could quietly go wrong: that a comment sorts where its priority says without
 * ever being given a severity, that closing one takes it out of the list the
 * same way closing a finding does, and that "what is left" is a single number
 * over both.
 */
let commentCounter = 0;
const comment = (overrides: Partial<Annotation> = {}): Annotation => {
  commentCounter += 1;
  return {
    id: `c${commentCounter}`,
    auditId: 'a1',
    body: `Comment ${commentCounter}`,
    attachments: [],
    createdAt: commentCounter,
    updatedAt: commentCounter,
    ...overrides,
  };
};

describe('the merged issues list', () => {
  /*
   * Every rung, against the whole ladder.
   *
   * One case per priority against a partial ladder was not enough: a mapping
   * that was wrong by one rung still produced the expected order, because the
   * neighbouring severity was missing from the fixture. Findings at all five
   * severities pin each priority to exactly one gap.
   */
  it.each([
    { priority: 'high' as const, after: 'R-HIGH', before: 'R-MED' },
    { priority: 'medium' as const, after: 'R-MED', before: 'R-LOW' },
    { priority: undefined, after: 'R-LOW', before: 'R-INFO' },
  ])('sorts a $priority-priority comment between $after and $before', ({ priority, after, before }) => {
    const state = load([
      finding({ severity: 'critical', ruleId: 'R-CRIT' }),
      finding({ severity: 'high', ruleId: 'R-HIGH' }),
      finding({ severity: 'medium', ruleId: 'R-MED' }),
      finding({ severity: 'low', ruleId: 'R-LOW' }),
      finding({ severity: 'info', ruleId: 'R-INFO' }),
    ]);
    const rows = issueRows(state.views, [comment(priority ? { priority } : {})], false);
    const order = rows.map((row) => (row.kind === 'comment' ? 'comment' : row.group.ruleId));

    expect(order[order.indexOf('comment') - 1]).toBe(after);
    expect(order[order.indexOf('comment') + 1]).toBe(before);
  });

  it('puts a measured finding before a comment it merely ties with', () => {
    const state = load([finding({ severity: 'high', ruleId: 'R-HIGH' })]);
    const rows = issueRows(state.views, [comment({ priority: 'high' })], false);
    expect(rows[0]?.kind).toBe('findings');
    expect(rows[1]?.kind).toBe('comment');
  });

  it('never gives a comment a severity', () => {
    const rows = issueRows([], [comment({ priority: 'high' })], false);
    const row = rows[0];
    // The row carries a sort rank and nothing a renderer could mistake for a
    // measurement: no `severity` field to reach for.
    expect(row).not.toHaveProperty('severity');
    expect(row?.kind).toBe('comment');
  });

  it('hides a resolved or dismissed comment until asked for it', () => {
    const annotations = [
      comment({ status: 'resolved' }),
      comment({ status: 'dismissed' }),
      comment({ status: 'accepted' }),
      comment(),
    ];
    expect(issueRows([], annotations, false)).toHaveLength(2);
    expect(issueRows([], annotations, true)).toHaveLength(4);
    expect(closedAnnotations(annotations)).toBe(2);
  });

  it('keeps a comment marker on its own position when one above it is hidden', () => {
    // The letter is the comment's place in the whole series. If hiding a
    // resolved comment renumbered the rest, the B on a pin and the B in the
    // report would stop being the same comment.
    const annotations = [comment({ status: 'resolved' }), comment(), comment()];
    const rows = issueRows([], annotations, false);
    expect(rows.map((row) => (row.kind === 'comment' ? row.index : -1))).toEqual([1, 2]);
  });

  it('defaults a comment with no status to open without writing one', () => {
    const bare = comment();
    expect(annotationStatus(bare)).toBe('open');
    expect(bare.status).toBeUndefined();
  });

  it('counts what is left over both kinds at once', () => {
    const state = load([
      finding({ status: 'open' }),
      finding({ status: 'accepted' }),
      finding({ status: 'resolved' }),
      finding({ status: 'dismissed' }),
    ]);
    const annotations = [comment(), comment({ status: 'accepted' }), comment({ status: 'resolved' })];
    // Two findings and two comments are outstanding. Accepted is outstanding:
    // agreeing something is a problem is not fixing it.
    expect(openIssueCount(state.views, annotations)).toBe(4);
  });

  it('does not let the severity filter drop the user own writing', () => {
    // A comment has no severity, so no severity chip can match it. Filtering it
    // out would lose the user's work behind a control that does not mention it.
    const state = load([finding({ severity: 'critical' })]);
    const filtered = filterViews({ ...state, severities: ['info'] });
    expect(filtered).toHaveLength(0);
    expect(issueRows(filtered, [comment()], false)).toHaveLength(1);
  });
});
