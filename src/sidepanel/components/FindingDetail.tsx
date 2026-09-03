import { CATEGORY_LABELS } from '../../audit/engine/registry';
import { SEVERITY_LABELS } from '../../audit/engine/severity';
import type { Finding, FindingStatus } from '../../shared/types';
import type { FindingView } from '../state/findings';

const TYPE_NOTE: Record<Finding['type'], { label: string; explanation: string }> = {
  rule: { label: 'Measured', explanation: 'Taken directly from the page.' },
  heuristic: { label: 'Heuristic', explanation: 'An expert-style reading of observable evidence.' },
  inference: { label: 'Inference', explanation: 'A less certain interpretation.' },
  recommendation: { label: 'Suggestion', explanation: 'Not a defect; a possible improvement.' },
};

const STATUS_ACTIONS: Array<{ status: FindingStatus; label: string; hint: string }> = [
  { status: 'accepted', label: 'Accept', hint: 'Agree this is a problem worth fixing' },
  { status: 'resolved', label: 'Resolve', hint: 'Mark as fixed' },
  { status: 'dismissed', label: 'Dismiss', hint: 'Not a problem here' },
];

export type ShotControls = {
  /** Off unless the user turned screenshots on in settings. */
  enabled: boolean;
  /** Object URL of the crop for this finding, if there is one. */
  url: string | undefined;
  capturing: boolean;
  error: string | null;
  onCapture(): void;
  onDiscard(): void;
};

/** The finding card from spec section 24, with the states the MVP needs. */
export function FindingDetail({
  view,
  ordinal,
  shot,
  onStatus,
  onNote,
  onReport,
  onLocate,
  onClose,
}: {
  view: FindingView;
  ordinal: number | undefined;
  shot: ShotControls;
  onStatus(status: FindingStatus): void;
  onNote(note: string): void;
  onReport(inReport: boolean): void;
  onLocate(): void;
  onClose(): void;
}): React.ReactElement {
  const { finding } = view;
  const type = TYPE_NOTE[finding.type];

  return (
    <div className="detail" role="group" aria-label={`Finding: ${finding.title}`}>
      <div className="detail-head">
        <span className="finding-sev" data-severity={finding.severity}>
          {SEVERITY_LABELS[finding.severity]}
        </span>
        {ordinal !== undefined ? <span className="detail-pin">{ordinal}</span> : null}
        <h2 className="detail-title">{finding.title}</h2>
        <button type="button" className="icon" aria-label="Close finding" onClick={onClose}>
          ✕
        </button>
      </div>

      <p className="detail-summary">{finding.summary}</p>

      <div className="finding-meta">
        <span className="badge">{CATEGORY_LABELS[finding.category]}</span>
        <span className="badge" title={type.explanation}>
          {type.label}
        </span>
        <span className="badge mono">{finding.ruleId}</span>
        {view.status !== 'open' ? (
          <span className="badge" data-tone="on">
            {view.status}
          </span>
        ) : null}
      </div>

      <div className="finding-block">
        <h3>Evidence</h3>
        <ul>
          {finding.evidence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="finding-block">
        <h3>Impact</h3>
        <p>{finding.impact}</p>
      </div>

      <div className="finding-block">
        <h3>Recommendation</h3>
        <p>{finding.recommendation}</p>
      </div>

      {finding.type !== 'rule' ? (
        <p className="hint" style={{ margin: 0 }}>
          {type.explanation} Confidence {Math.round(finding.confidence * 100)}%.
        </p>
      ) : null}

      <div className="detail-actions">
        {finding.elementRef ? (
          <button type="button" onClick={onLocate}>
            Show on page
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={view.inReport}
          className={view.inReport ? 'primary' : undefined}
          onClick={() => onReport(!view.inReport)}
        >
          {view.inReport ? 'In report' : 'Add to report'}
        </button>
      </div>

      <div className="detail-actions">
        {STATUS_ACTIONS.map((action) => (
          <button
            key={action.status}
            type="button"
            title={action.hint}
            aria-pressed={view.status === action.status}
            onClick={() => onStatus(view.status === action.status ? 'open' : action.status)}
          >
            {action.label}
          </button>
        ))}
      </div>

      <ScreenshotBlock finding={finding} shot={shot} />

      <label className="detail-note">
        <span className="section-title">Note</span>
        <textarea
          rows={2}
          value={view.note}
          placeholder="Context for whoever reads the report"
          onChange={(event) => onNote(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

/**
 * The screenshot crop, when there is one to show.
 *
 * Nothing appears here unless the user has turned screenshots on, and the
 * button is only offered for findings that point at an element -- there is
 * nothing to photograph for a page-level finding.
 */
function ScreenshotBlock({
  finding,
  shot,
}: {
  finding: Finding;
  shot: ShotControls;
}): React.ReactElement | null {
  if (!shot.enabled || !finding.elementRef) return null;
  return (
    <div className="finding-block">
      <h3>Screenshot</h3>
      {shot.url ? (
        <figure className="shot-figure">
          <img src={shot.url} alt={`Screenshot of ${finding.title}`} />
        </figure>
      ) : null}
      <div className="detail-actions">
        <button type="button" disabled={shot.capturing} onClick={shot.onCapture}>
          {shot.capturing ? 'Capturing…' : shot.url ? 'Retake' : 'Capture'}
        </button>
        {shot.url ? (
          <button type="button" onClick={shot.onDiscard}>
            Remove
          </button>
        ) : null}
      </div>
      {shot.error ? (
        <p className="hint" role="alert" style={{ color: 'var(--danger)', margin: '6px 0 0' }}>
          {shot.error}
        </p>
      ) : (
        <p className="hint" style={{ margin: '6px 0 0' }}>
          Crops the visible tab to this element. Password and payment fields are refused.
        </p>
      )}
    </div>
  );
}
