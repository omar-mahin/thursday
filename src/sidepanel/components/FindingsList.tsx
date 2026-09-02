import { useState } from 'react';
import type { AuditResult } from '../../audit/engine/run';
import { countBySeverity } from '../../audit/engine/run';
import { CATEGORY_LABELS } from '../../audit/engine/registry';
import { SEVERITY_LABELS } from '../../audit/engine/severity';
import type { Finding, Severity } from '../../shared/types';

const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const TYPE_NOTE: Record<Finding['type'], string> = {
  rule: 'Measured',
  heuristic: 'Heuristic',
  inference: 'Inference',
  recommendation: 'Suggestion',
};

/**
 * Sprint 3's findings view: enough to read and act on a finding. The rich card,
 * page pins and status transitions arrive in Sprint 4.
 */
export function FindingsList({
  result,
  onLocate,
}: {
  result: AuditResult;
  onLocate(finding: Finding): void;
}): React.ReactElement {
  const counts = countBySeverity(result.findings);
  const [open, setOpen] = useState<string | null>(result.findings[0]?.id ?? null);

  if (result.findings.length === 0) {
    return (
      <section>
        <div className="section-title">Findings</div>
        <div className="empty">
          Nothing found in {result.audit.categories.length} categor
          {result.audit.categories.length === 1 ? 'y' : 'ies'} across {result.audit.elementsScanned} elements.
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="spread">
        <div className="section-title" style={{ margin: 0 }}>
          Findings
        </div>
        <span className="dim mono">{result.findings.length}</span>
      </div>

      <div className="sev-row">
        {ORDER.filter((severity) => counts[severity] > 0).map((severity) => (
          <span key={severity} className="sev-chip" data-severity={severity}>
            <span className="dot" />
            {counts[severity]} {SEVERITY_LABELS[severity]}
          </span>
        ))}
      </div>

      <ul className="findings">
        {result.findings.map((finding) => (
          <li key={finding.id} className="finding" data-severity={finding.severity}>
            <button
              type="button"
              className="finding-head"
              aria-expanded={open === finding.id}
              onClick={() => setOpen(open === finding.id ? null : finding.id)}
            >
              <span className="finding-sev" data-severity={finding.severity}>
                {SEVERITY_LABELS[finding.severity]}
              </span>
              <span className="finding-title">{finding.title}</span>
            </button>

            {open === finding.id ? (
              <div className="finding-body">
                <p className="finding-summary">{finding.summary}</p>

                <div className="finding-meta">
                  <span className="badge">{CATEGORY_LABELS[finding.category]}</span>
                  <span className="badge">{TYPE_NOTE[finding.type]}</span>
                  <span className="badge mono">{finding.ruleId}</span>
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

                {finding.elementRef ? (
                  <button type="button" onClick={() => onLocate(finding)}>
                    Show on page
                  </button>
                ) : (
                  <p className="hint" style={{ margin: 0 }}>
                    This finding is about the page as a whole.
                  </p>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {result.suppressed > 0 ? (
        <p className="hint">{result.suppressed} lower-ranked findings were not shown.</p>
      ) : null}
      {result.audit.truncated ? (
        <p className="hint">
          The page was larger than the element budget, so some elements were not scanned.
        </p>
      ) : null}
      {result.failedRules.length > 0 ? (
        <p className="hint">Rules that could not run: {result.failedRules.join(', ')}.</p>
      ) : null}
    </section>
  );
}
