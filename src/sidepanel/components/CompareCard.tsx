import { SEVERITY_LABELS } from '../../audit/engine/severity';
import { diffCounts, type AuditDiff } from '../../audit/engine/compare';
import type { Finding } from '../../shared/types';

const when = (at: number): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/**
 * What changed between the audit that was open and the one just run.
 *
 * The value of this is entirely in the "fixed" column: everything else the
 * panel already shows. Knowing that six of eight small targets are now large
 * enough is the difference between a tool that describes a page and one that
 * tells you whether your work landed.
 */
export function CompareCard({
  diff,
  baselineAt,
  onOpenFinding,
  onDismiss,
}: {
  diff: AuditDiff;
  baselineAt: number;
  onOpenFinding(id: string): void;
  onDismiss(): void;
}): React.ReactElement {
  const counts = diffCounts(diff);
  const verdict =
    counts.net < 0
      ? `${counts.fixed} fixed, ${counts.introduced} new — the page improved.`
      : counts.net > 0
        ? `${counts.fixed} fixed, ${counts.introduced} new — there is more to look at than last time.`
        : counts.fixed === 0 && counts.introduced === 0
          ? 'Nothing changed.'
          : `${counts.fixed} fixed, ${counts.introduced} new — even overall.`;

  return (
    <section className="card compare">
      <div className="spread">
        <div className="section-title" style={{ marginBottom: 0 }}>
          Compared with {when(baselineAt)}
        </div>
        <button type="button" className="icon" aria-label="Hide the comparison" onClick={onDismiss}>
          ✕
        </button>
      </div>
      <p style={{ margin: '6px 0 0' }}>{verdict}</p>
      <ul className="diff-totals">
        <li data-kind="fixed">{counts.fixed} fixed</li>
        <li data-kind="unchanged">{counts.unchanged} still open</li>
        <li data-kind="new">{counts.introduced} new</li>
      </ul>
      <DiffList
        label="Fixed"
        findings={diff.fixed}
        kind="fixed"
        onOpenFinding={undefined}
      />
      <DiffList
        label="New"
        findings={diff.introduced}
        kind="new"
        onOpenFinding={onOpenFinding}
      />
    </section>
  );
}

function DiffList({
  label,
  findings,
  kind,
  onOpenFinding,
}: {
  label: string;
  findings: readonly Finding[];
  kind: 'fixed' | 'new';
  onOpenFinding: ((id: string) => void) | undefined;
}): React.ReactElement | null {
  if (findings.length === 0) return null;
  return (
    <div className="diff-block">
      <div className="section-title" style={{ margin: '10px 0 4px' }}>
        {label}
      </div>
      <ul className="diff-list">
        {findings.slice(0, 8).map((finding) => (
          <li key={finding.id} data-kind={kind}>
            <span className="finding-sev" data-severity={finding.severity}>
              {SEVERITY_LABELS[finding.severity]}
            </span>
            {onOpenFinding ? (
              <button type="button" className="link" onClick={() => onOpenFinding(finding.id)}>
                {finding.title}
              </button>
            ) : (
              // A fixed finding no longer exists in the current audit, so there
              // is nothing to open and nothing to pin. Saying so beats a dead link.
              <span>{finding.title}</span>
            )}
          </li>
        ))}
        {findings.length > 8 ? <li className="hint">and {findings.length - 8} more</li> : null}
      </ul>
    </div>
  );
}
