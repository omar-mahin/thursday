import type {
  Finding,
  FindingStatus,
  PageSnapshot,
  Pin,
  Severity,
} from '../../shared/types';
import { severityRank } from '../../audit/engine/severity';

/**
 * Findings state as a pure reducer.
 *
 * Filtering, grouping, status transitions and the pins the page should draw are
 * all derivable from this, which keeps them unit-testable and keeps the React
 * components to rendering.
 *
 * Status and notes live in memory for now; Sprint 5 persists them to IndexedDB.
 */
export type FindingView = {
  finding: Finding;
  status: FindingStatus;
  inReport: boolean;
  note: string;
};

export type FindingsState = {
  views: FindingView[];
  /** Empty means "every severity". */
  severities: Severity[];
  /** Dismissed and resolved findings are out of the way unless asked for. */
  showClosed: boolean;
  selectedId: string | null;
};

export type FindingsAction =
  | { type: 'load'; findings: Finding[] }
  | { type: 'clear' }
  | { type: 'select'; id: string | null }
  | { type: 'status'; id: string; status: FindingStatus }
  | { type: 'note'; id: string; note: string }
  | { type: 'report'; id: string; inReport: boolean }
  | { type: 'toggleSeverity'; severity: Severity }
  | { type: 'showClosed'; value: boolean };

export const EMPTY_STATE: FindingsState = {
  views: [],
  severities: [],
  showClosed: false,
  selectedId: null,
};

const CLOSED: ReadonlySet<FindingStatus> = new Set<FindingStatus>(['dismissed', 'resolved']);

export const isClosed = (status: FindingStatus): boolean => CLOSED.has(status);

export function reduce(state: FindingsState, action: FindingsAction): FindingsState {
  switch (action.type) {
    case 'load': {
      const views = action.findings.map((finding) => ({
        finding,
        status: finding.status,
        inReport: false,
        note: '',
      }));
      return { ...state, views, selectedId: views[0]?.finding.id ?? null };
    }
    case 'clear':
      return { ...EMPTY_STATE, severities: state.severities, showClosed: state.showClosed };
    case 'select':
      return { ...state, selectedId: action.id };
    case 'status': {
      const views = state.views.map((view) =>
        view.finding.id === action.id ? { ...view, status: action.status } : view,
      );
      // Closing a finding should get it out of the way, not leave it open in
      // the detail panel pretending to still need attention.
      const stillVisible = !isClosed(action.status) || state.showClosed;
      return {
        ...state,
        views,
        selectedId: stillVisible ? state.selectedId : nextSelection(views, state, action.id),
      };
    }
    case 'note':
      return {
        ...state,
        views: state.views.map((view) =>
          view.finding.id === action.id ? { ...view, note: action.note } : view,
        ),
      };
    case 'report':
      return {
        ...state,
        views: state.views.map((view) =>
          view.finding.id === action.id ? { ...view, inReport: action.inReport } : view,
        ),
      };
    case 'toggleSeverity': {
      const severities = state.severities.includes(action.severity)
        ? state.severities.filter((severity) => severity !== action.severity)
        : [...state.severities, action.severity];
      return { ...state, severities };
    }
    case 'showClosed':
      return { ...state, showClosed: action.value };
  }
}

/** The finding to open after the current one is closed: the next one still shown. */
function nextSelection(views: FindingView[], state: FindingsState, closedId: string): string | null {
  const visible = filterViews({ ...state, views });
  if (visible.some((view) => view.finding.id === state.selectedId && state.selectedId !== closedId)) {
    return state.selectedId;
  }
  return visible[0]?.finding.id ?? null;
}

export function filterViews(state: FindingsState): FindingView[] {
  return state.views.filter((view) => {
    if (!state.showClosed && isClosed(view.status)) return false;
    if (state.severities.length > 0 && !state.severities.includes(view.finding.severity)) return false;
    return true;
  });
}

export type FindingGroup = {
  ruleId: string;
  /** Highest severity in the group; groups are ordered by it. */
  severity: Severity;
  views: FindingView[];
};

/**
 * Groups repeats of one rule together.
 *
 * Eight separate "target too small" rows push the unlabelled control off the
 * screen. One row that says "8 targets are too small", expandable, does not.
 */
export function groupByRule(views: readonly FindingView[]): FindingGroup[] {
  const groups = new Map<string, FindingView[]>();
  for (const view of views) {
    const bucket = groups.get(view.finding.ruleId);
    if (bucket) bucket.push(view);
    else groups.set(view.finding.ruleId, [view]);
  }
  return [...groups.entries()]
    .map(([ruleId, items]) => ({
      ruleId,
      severity: items.reduce<Severity>(
        (worst, view) => (severityRank(view.finding.severity) > severityRank(worst) ? view.finding.severity : worst),
        'info',
      ),
      views: items,
    }))
    .sort((a, b) => {
      const bySeverity = severityRank(b.severity) - severityRank(a.severity);
      return bySeverity !== 0 ? bySeverity : a.ruleId.localeCompare(b.ruleId);
    });
}

export function countByStatus(views: readonly FindingView[]): Record<FindingStatus, number> {
  const counts: Record<FindingStatus, number> = { open: 0, accepted: 0, dismissed: 0, resolved: 0 };
  for (const view of views) counts[view.status] += 1;
  return counts;
}

/**
 * The pins the page should draw, numbered to match the list.
 *
 * Only findings that point at an element get a pin, and only when the snapshot
 * still has that element -- a pin with nothing behind it would be a lie about
 * where the problem is.
 */
export function pinsFor(views: readonly FindingView[], snapshot: PageSnapshot | null): Pin[] {
  if (!snapshot) return [];
  const pins: Pin[] = [];
  for (const view of views) {
    const { finding } = view;
    if (finding.elementIndex === undefined || !finding.elementRef) continue;
    const element = snapshot.elements[finding.elementIndex];
    if (!element) continue;
    pins.push({
      findingId: finding.id,
      ordinal: pins.length + 1,
      severity: finding.severity,
      elementIndex: finding.elementIndex,
      documentRect: element.documentRect,
      ref: finding.elementRef,
    });
  }
  return pins;
}

/** Ordinal shown next to a finding in the list, matching its pin. */
export function ordinals(pins: readonly Pin[]): Map<string, number> {
  return new Map(pins.map((pin) => [pin.findingId, pin.ordinal]));
}
