import { beforeEach, describe, expect, it } from 'vitest';
import type { Finding } from '../../src/shared/types';
import {
  countByStatus,
  EMPTY_STATE,
  filterViews,
  groupByRule,
  isClosed,
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
    expect(ordinals(pins).get(pins[1]!.findingId)).toBe(2);
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
