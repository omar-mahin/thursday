import { useState } from 'react';
import { SEVERITY_LABELS } from '../../audit/engine/severity';
import { ruleById } from '../../audit/engine/registry';
import type { Severity } from '../../shared/types';
import { groupByRule, type FindingGroup, type FindingView } from '../state/findings';

const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/**
 * The findings list: repeats of one rule are grouped, because eight separate
 * "target too small" rows push the unlabelled control off the screen.
 */
export function FindingsList({
  views,
  counts,
  severities,
  showClosed,
  closedCount,
  selectedId,
  ordinals,
  onSelect,
  onToggleSeverity,
  onShowClosed,
}: {
  views: FindingView[];
  counts: Record<Severity, number>;
  severities: Severity[];
  showClosed: boolean;
  closedCount: number;
  selectedId: string | null;
  ordinals: Map<string, number>;
  onSelect(id: string): void;
  onToggleSeverity(severity: Severity): void;
  onShowClosed(value: boolean): void;
}): React.ReactElement {
  const groups = groupByRule(views);

  return (
    <section aria-label="Findings">
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

      {views.length === 0 ? (
        <div className="empty">Nothing matches the current filter.</div>
      ) : (
        <ul className="findings">
          {groups.map((group) => (
            <Group
              key={group.ruleId}
              group={group}
              selectedId={selectedId}
              ordinals={ordinals}
              onSelect={onSelect}
            />
          ))}
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
