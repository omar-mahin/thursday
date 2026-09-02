import { ALL_CATEGORIES, CATEGORY_LABELS } from '../../audit/engine/registry';
import type { AuditCategory } from '../../shared/types';

/** Starts an audit, for everything or for one category. */
export function AuditLauncher({
  activated,
  running,
  onStart,
}: {
  activated: boolean;
  running: boolean;
  onStart(categories?: AuditCategory[]): void;
}): React.ReactElement {
  const disabled = !activated || running;
  return (
    <section className="card">
      <div className="section-title">Audit</div>
      <button
        type="button"
        className="primary"
        style={{ width: '100%' }}
        disabled={disabled}
        onClick={() => onStart()}
      >
        {running ? 'Scanning…' : 'Full audit'}
      </button>
      <div className="categories">
        {ALL_CATEGORIES.map((category) => (
          <button key={category} type="button" disabled={disabled} onClick={() => onStart([category])}>
            {CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>
      {running ? (
        <div className="progress" role="status" style={{ marginTop: 8 }}>
          <span className="spinner" aria-hidden="true" />
          Reading the page and applying rules
        </div>
      ) : null}
      {!activated ? (
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Activate Thursday on this page to run an audit.
        </p>
      ) : null}
    </section>
  );
}
