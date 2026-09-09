import type {
  Annotation,
  AnnotationPriority,
  Finding,
  FindingStatus,
  PageSnapshotDigest,
  Pin,
  Severity,
} from '../../shared/types';
import { severityRank } from '../../audit/engine/severity';
import { locationIndex } from '../../audit/engine/digest';

/**
 * Findings state as a pure reducer.
 *
 * Filtering, grouping, status transitions and the pins the page should draw are
 * all derivable from this, which keeps them unit-testable and keeps the React
 * components to rendering.
 *
 * Status, note and report membership are read from the finding and written back
 * to it, so they survive a restart, a saved file and a re-audit of the same
 * page. The reducer stays pure: App does the persisting.
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
        inReport: finding.inReport ?? false,
        note: finding.note ?? '',
      }));
      const visible = filterViews({ ...state, views, selectedId: null });
      return { ...state, views, selectedId: visible[0]?.finding.id ?? null };
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
 * Built from the digest rather than a live snapshot, so a reopened audit pins
 * exactly as a fresh one does -- the panel does not need to be holding the
 * snapshot the audit came from. Only findings that point at an element get a
 * pin: a pin with nothing behind it would be a lie about where the problem is.
 */
export function pinsFor(views: readonly FindingView[], digest: PageSnapshotDigest | null): Pin[] {
  if (!digest) return [];
  const locations = locationIndex(digest);
  const pins: Pin[] = [];
  for (const view of views) {
    const { finding } = view;
    if (finding.elementIndex === undefined || !finding.elementRef) continue;
    const location = locations.get(finding.elementIndex);
    pins.push({
      targetId: finding.id,
      kind: 'finding',
      snapshotId: digest.snapshotId,
      ordinal: pins.length + 1,
      severity: finding.severity,
      elementIndex: finding.elementIndex,
      // With no recorded position, the page has to find the element itself.
      // The stored viewport rect plus the scroll offset it was taken at is the
      // best starting guess, and the pin is drawn approximate either way.
      documentRect:
        location?.documentRect ?? {
          x: finding.elementRef.rect.x + digest.viewport.scrollX,
          y: finding.elementRef.rect.y + digest.viewport.scrollY,
          width: finding.elementRef.rect.width,
          height: finding.elementRef.rect.height,
        },
      ref: finding.elementRef,
    });
  }
  return pins;
}

/**
 * The pins for the user's comments, numbered in their own series.
 *
 * A separate series, and a separate function, because the two must not share
 * numbering: "3" meaning the third finding on one pin and the third comment on
 * another is the sort of ambiguity that only shows up when somebody is reading
 * the report out loud on a call.
 *
 * A comment with no element anchor gets no pin. That is not a gap: it is a
 * comment about the page, and putting it somewhere arbitrary would claim a
 * location the user never chose.
 */
export function commentPins(
  annotations: readonly Annotation[],
  digest: PageSnapshotDigest | null,
): Pin[] {
  if (!digest) return [];
  const pins: Pin[] = [];
  for (let index = 0; index < annotations.length; index += 1) {
    const annotation = annotations[index];
    const reference = annotation?.elementRef;
    if (!annotation || !reference) continue;
    /*
     * The measured index is offered only when this comment demonstrably came
     * from the snapshot being drawn against. -1 is never a valid array index,
     * so anything else falls to the resolution ladder and is drawn as
     * approximate -- which is the honest answer for a comment out of a file,
     * or one written against a different run of the audit.
     */
    const sameSnapshot = annotation.snapshotId !== undefined && annotation.snapshotId === digest.snapshotId;
    pins.push({
      targetId: annotation.id,
      kind: 'comment',
      snapshotId: digest.snapshotId,
      // Numbered by position in the whole comment list, not among the pinned
      // ones. An unanchored comment still takes its letter, so the marker in
      // the panel, on the pin and in the report is always the same letter.
      ordinal: index + 1,
      elementIndex: sameSnapshot && annotation.elementIndex !== undefined ? annotation.elementIndex : -1,
      documentRect:
        annotation.documentRect ?? {
          x: reference.rect.x + digest.viewport.scrollX,
          y: reference.rect.y + digest.viewport.scrollY,
          width: reference.rect.width,
          height: reference.rect.height,
        },
      ref: reference,
    });
  }
  return pins;
}

/**
 * Ordinal shown next to a finding or comment in the list, matching its pin.
 *
 * Keyed by target id, so one map can be built per series without the two
 * colliding -- which they would if the key were the ordinal.
 */
export function ordinals(pins: readonly Pin[]): Map<string, number> {
  return new Map(pins.map((pin) => [pin.targetId, pin.ordinal]));
}

/**
 * The status a comment is at.
 *
 * Defaults for display without being written back, because a comment out of an
 * older file genuinely has no answer and `open` is the honest reading of that.
 */
export const annotationStatus = (annotation: Annotation): FindingStatus => annotation.status ?? 'open';

/**
 * Where a comment sorts among findings.
 *
 * The list is ordered by severity, and a comment has no severity -- it has a
 * priority, which is the author saying how much they think somebody should
 * care. So the priority is mapped onto the ladder for ordering only, and never
 * rendered as though Thursday had measured it: a high-priority comment sits
 * with the high-severity findings, an ordinary one below the mediums, and the
 * row still says "From you" rather than wearing a severity chip.
 *
 * A comment with no priority sorts as an ordinary one. That is a display
 * default, not a value written into the comment.
 */
const PRIORITY_SORT: Record<AnnotationPriority, Severity> = {
  high: 'high',
  medium: 'medium',
  normal: 'low',
};

/*
 * Not exported, deliberately.
 *
 * A function that hands out a severity for a priority is the conflation this
 * product exists to avoid, and anything that could reach for it would be
 * tempted to render what it returns. It is a sort key for one list and has no
 * business outside this file.
 */
const prioritySeverity = (priority: AnnotationPriority | undefined): Severity =>
  PRIORITY_SORT[priority ?? 'normal'];

/**
 * One row of the issues list: either a group of findings or one comment.
 *
 * Findings and comments are different kinds of claim -- one is measured, one is
 * an opinion -- but they are the same kind of work, so they belong in one list
 * with one count of what is left. Keeping them in separate lists meant triaging
 * twice and two answers to "how much is outstanding", which is the question the
 * list exists to answer.
 */
export type IssueRow =
  | { kind: 'findings'; key: string; rank: number; group: FindingGroup }
  | {
      kind: 'comment';
      key: string;
      rank: number;
      annotation: Annotation;
      status: FindingStatus;
      /** Position in the whole comment list, so the marker matches its pin. */
      index: number;
    };

/**
 * Merges findings and comments into the single ordered list the panel shows.
 *
 * Comments are passed in with their original positions, because the marker on a
 * comment (A, B, C) is its place in the comment series and must not change when
 * a filter hides one -- the same letter has to name the same comment in the
 * panel, on the pin and in the report.
 *
 * The severity filter is deliberately not applied to comments. A comment has no
 * severity, so no severity chip can match it, and dropping the user's own
 * writing out of the list because they filtered for "critical" would be losing
 * their work behind a control that does not mention it.
 */
export function issueRows(
  views: readonly FindingView[],
  annotations: readonly Annotation[],
  showClosed: boolean,
): IssueRow[] {
  const rows: IssueRow[] = groupByRule(views).map((group) => ({
    kind: 'findings' as const,
    key: `f:${group.ruleId}`,
    rank: severityRank(group.severity),
    group,
  }));

  for (let index = 0; index < annotations.length; index += 1) {
    const annotation = annotations[index];
    if (!annotation) continue;
    const status = annotationStatus(annotation);
    if (!showClosed && isClosed(status)) continue;
    rows.push({
      kind: 'comment',
      key: `c:${annotation.id}`,
      rank: severityRank(prioritySeverity(annotation.priority)),
      annotation,
      status,
      index,
    });
  }

  return rows.sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    // Measured before opinion at the same rank, so the ordering never suggests
    // a comment outranks a finding it merely ties with.
    if (a.kind !== b.kind) return a.kind === 'findings' ? -1 : 1;
    if (a.kind === 'comment' && b.kind === 'comment') return a.index - b.index;
    return a.key.localeCompare(b.key);
  });
}

/**
 * How many comments are put away, for the same toggle the findings use.
 *
 * Counted separately from the findings' closed count and added to it by the
 * caller, rather than the toggle quietly speaking for only half the list.
 */
export function closedAnnotations(annotations: readonly Annotation[]): number {
  return annotations.filter((annotation) => isClosed(annotationStatus(annotation))).length;
}

/**
 * What is left to do: one number over both kinds.
 *
 * This is the number the whole merge is for. Accepted counts as outstanding --
 * agreeing that something is a problem is not fixing it.
 */
export function openIssueCount(
  views: readonly FindingView[],
  annotations: readonly Annotation[],
): number {
  const findings = views.filter((view) => !isClosed(view.status)).length;
  const comments = annotations.filter((annotation) => !isClosed(annotationStatus(annotation))).length;
  return findings + comments;
}
