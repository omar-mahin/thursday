import { useState } from 'react';
import { PRODUCT_NAME } from '../../shared/constants/product';
import type { AuditSummary } from '../../storage/audits';
import type { LibraryState } from '../state/useLibrary';

const SHOWN = 5;

const when = (at: number): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/**
 * Past audits for the page in front of you.
 *
 * Scoped to the current origin on purpose: a flat list of every audit ever run
 * is a filing cabinet, and the question being asked here is always "what did
 * this page look like last time".
 */
export function HistoryCard({
  library,
  activeAuditId,
  scoped,
  onOpen,
  onDelete,
}: {
  library: LibraryState;
  activeAuditId: string | null;
  /** False when no page is connected, so the list is every stored audit. */
  scoped: boolean;
  onOpen(id: string): void;
  onDelete(id: string): void;
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!library.available) {
    return (
      <section className="card">
        <div className="section-title">History</div>
        <p className="hint" style={{ margin: 0 }}>
          This browser will not let {PRODUCT_NAME} store data, so audits last only as long as this
          panel is open. Saving a file still works.
        </p>
      </section>
    );
  }

  if (library.history.length === 0) {
    if (!library.keepHistory) {
      return (
        <section className="card">
          <div className="section-title">History</div>
          <p className="hint" style={{ margin: 0 }}>
            History is turned off in settings, so audits are not written to this machine. Save a file to
            keep one.
          </p>
        </section>
      );
    }
    return null;
  }

  const rows: AuditSummary[] = expanded ? library.history : library.history.slice(0, SHOWN);

  return (
    <section className="card">
      <div className="spread">
        <div className="section-title" style={{ marginBottom: 0 }}>
          History
        </div>
        {/* Said plainly: with no page connected this is everything stored,
            not everything for the page you are looking at. */}
        <span className="hint">
          {library.history.length} {scoped ? 'for this site' : 'stored'}
        </span>
      </div>
      <ul className="history">
        {rows.map((summary) => (
          <li key={summary.id} className="history-row" data-current={summary.id === activeAuditId}>
            <button
              type="button"
              className="history-open"
              onClick={() => onOpen(summary.id)}
              aria-current={summary.id === activeAuditId}
            >
              <span className="history-when">{when(summary.createdAt)}</span>
              <span className="history-count">
                {summary.findingCount} finding{summary.findingCount === 1 ? '' : 's'}
                {summary.truncated ? ' · partial page' : ''}
              </span>
            </button>
            {confirming === summary.id ? (
              <span className="row">
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setConfirming(null);
                    onDelete(summary.id);
                  }}
                >
                  Delete
                </button>
                <button type="button" className="icon" aria-label="Keep it" onClick={() => setConfirming(null)}>
                  ✕
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="icon"
                aria-label={`Delete the audit from ${when(summary.createdAt)}`}
                onClick={() => setConfirming(summary.id)}
              >
                🗑
              </button>
            )}
          </li>
        ))}
      </ul>
      {library.history.length > SHOWN ? (
        <button type="button" className="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${library.history.length}`}
        </button>
      ) : null}
    </section>
  );
}
