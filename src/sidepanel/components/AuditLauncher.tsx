import { FLAGS } from '../../shared/constants/flags';

const CATEGORIES = ['UX', 'UI', 'A11Y', 'Content', 'CRO', 'Responsive'] as const;

/** The launcher is deliberately inert until Sprint 3 ships the rule engine.
 *  Disabled controls that explain themselves beat controls that lie. */
export function AuditLauncher({ activated }: { activated: boolean }): React.ReactElement {
  const ready = activated && FLAGS.auditEngine;
  return (
    <section className="card">
      <div className="section-title">Audit</div>
      <button type="button" className="primary" style={{ width: '100%' }} disabled={!ready}>
        Full audit
      </button>
      <div className="categories">
        {CATEGORIES.map((category) => (
          <button key={category} type="button" disabled={!ready}>
            {category}
          </button>
        ))}
      </div>
      {!FLAGS.auditEngine ? <p className="hint" style={{ margin: '8px 0 0' }}>Rule engine arrives in Sprint 3.</p> : null}
    </section>
  );
}
