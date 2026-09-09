import { useState } from 'react';
import { SEVERITY_LABELS } from '../../audit/engine/severity';
import { ruleById } from '../../audit/engine/registry';
import type { Annotation, FindingStatus, Severity } from '../../shared/types';
import { annotationStatus, issueRows, type FindingGroup, type FindingView } from '../state/findings';
import { CommentRow } from './CommentRow';
import type { useAnnotations } from '../state/useAnnotations';

const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * One list of everything there is to do.
 *
 * Findings and the user's own comments share it, because they are the same kind
 * of work even though they are different kinds of claim: one measured, one an
 * opinion. Two lists meant triaging twice and two answers to "how much is
 * left", so they are merged, ordered together, closed together -- and kept
 * visually distinct, so nothing the user wrote can be mistaken for something
 * Thursday measured.
 *
 * Repeats of one rule are still grouped, because eight separate "target too
 * small" rows push the unlabelled control off the screen.
 */
export function IssuesList({
  views,
  annotations,
  comments,
  counts,
  severities,
  showClosed,
  closedCount,
  selectedId,
  openComment,
  ordinals,
  onSelect,
  onSelectComment,
  onLocateComment,
  onCommentStatus,
  onToggleSeverity,
  onShowClosed,
}: {
  views: FindingView[];
  annotations: readonly Annotation[];
  comments: ReturnType<typeof useAnnotations>;
  counts: Record<Severity, number>;
  severities: Severity[];
  showClosed: boolean;
  closedCount: number;
  selectedId: string | null;
  openComment: string | null;
  ordinals: Map<string, number>;
  onSelect(id: string): void;
  onSelectComment(id: string | null): void;
  onLocateComment(annotation: Annotation): void;
  onCommentStatus(id: string, status: FindingStatus): void;
  onToggleSeverity(severity: Severity): void;
  onShowClosed(value: boolean): void;
}): React.ReactElement {
  const rows = issueRows(views, annotations, showClosed);

  const openComments = annotations.filter((annotation) => annotationStatus(annotation) === 'open').length;

  return (
    <section aria-label="Issues">
      {/*
        What the count in the header is made of.
 
        A breakdown rather than a second total, because two totals on one screen
        is how you end up with two of them disagreeing. This says which half is
        measured and which half is the user's, which is the distinction that
        makes a shared list safe.
      */}
      <div className="issues-head">
        <span className="section-title" style={{ marginBottom: 0 }}>
          Issues
        </span>
        <span className="hint">
          {views.length} finding{views.length === 1 ? '' : 's'}
          {annotations.length > 0 ? ` · ${annotations.length} from you` : ''}
          {openComments !== annotations.length ? ` (${openComments} open)` : ''}
        </span>
      </div>

      <div className="filters" role="group" aria-label="Filter by severity">
        {ORDER.filter((severity) => counts[severity] > 0).map((severity) => {
          const active = severities.length === 0 || severities.includes(severity);
          return (
            <button
              key={severity}
              type="button"
              className="sev-chip"
              data-severity={severity}
              data-off={String(!active)}
              aria-pressed={severities.includes(severity)}
              onClick={() => onToggleSeverity(severity)}
            >
              <span className="dot" />
              {counts[severity]} {SEVERITY_LABELS[severity]}
            </button>
          );
        })}
      </div>

      {closedCount > 0 ? (
        <label className="closed-toggle">
          <input type="checkbox" checked={showClosed} onChange={(event) => onShowClosed(event.currentTarget.checked)} />
          Show {closedCount} dismissed or resolved
        </label>
      ) : null}

      {rows.length === 0 ? (
        <div className="empty">Nothing matches the current filter.</div>
      ) : (
        <ul className="issues">
          {rows.map((row) =>
            row.kind === 'findings' ? (
              <Group
                key={row.key}
                group={row.group}
                selectedId={selectedId}
                ordinals={ordinals}
                onSelect={onSelect}
              />
            ) : (
              <CommentRow
                key={row.key}
                annotation={row.annotation}
                index={row.index}
                status={row.status}
                comments={comments}
                current={row.annotation.id === openComment}
                onSelect={onSelectComment}
                onLocate={onLocateComment}
                onStatus={(status) => onCommentStatus(row.annotation.id, status)}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function Group({
  group,
  selectedId,
  ordinals,
  onSelect,
}: {
  group: FindingGroup;
  selectedId: string | null;
  ordinals: Map<string, number>;
  onSelect(id: string): void;
}): React.ReactElement {
  const single = group.views.length === 1;
  const containsSelection = group.views.some((view) => view.finding.id === selectedId);
  const [expanded, setExpanded] = useState(false);
  const open = expanded || containsSelection;

  if (single) {
    const view = group.views[0]!;
    return <li>{row(view, selectedId, ordinals, onSelect)}</li>;
  }

  const description = ruleById(group.ruleId)?.description ?? group.ruleId;
  return (
    <li className="finding group" data-severity={group.severity}>
      <button
        type="button"
        className="finding-head"
        aria-expanded={open}
        onClick={() => setExpanded(!open)}
      >
        <span className="finding-sev" data-severity={group.severity}>
          {SEVERITY_LABELS[group.severity]}
        </span>
        <span className="finding-title">
          {group.views.length} × {description}
        </span>
        <span className="dim mono">{group.ruleId}</span>
      </button>
      {open ? (
        <ul className="group-items">
          {group.views.map((view) => (
            <li key={view.finding.id}>{row(view, selectedId, ordinals, onSelect)}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function row(
  view: FindingView,
  selectedId: string | null,
  ordinals: Map<string, number>,
  onSelect: (id: string) => void,
): React.ReactElement {
  const ordinal = ordinals.get(view.finding.id);
  const selected = view.finding.id === selectedId;
  return (
    <button
      type="button"
      className="finding-row"
      data-severity={view.finding.severity}
      data-selected={String(selected)}
      data-status={view.status}
      data-finding-id={view.finding.id}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(view.finding.id)}
    >
      <span className="row-pin" data-severity={view.finding.severity}>
        {ordinal ?? '·'}
      </span>
      <span className="finding-title">{view.finding.title}</span>
      {view.inReport ? <span className="row-flag" title="In report">★</span> : null}
      {view.status !== 'open' ? <span className="row-status">{view.status}</span> : null}
    </button>
  );
}
