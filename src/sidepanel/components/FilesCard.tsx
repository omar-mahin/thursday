import { useRef, useState } from 'react';
import { AUDIT_FILE_EXTENSION, PRODUCT_NAME } from '../../shared/constants/product';

/**
 * Saving an audit to disk and opening one back up.
 *
 * Three formats, for three different readers. The JSON file is Thursday's own:
 * it reopens with every finding, comment, note and status intact and re-pins
 * on a live page. The HTML report is for everyone else -- one self-contained
 * file that opens offline in any browser. The PDF is for the ticket, the
 * print-out and the client who will not open an HTML attachment.
 */
export function FilesCard({
  canExport,
  reportCount,
  totalCount,
  commentCount,
  busy,
  saving,
  onSaveAudit,
  onSaveReport,
  onSavePdf,
  onOpenText,
}: {
  canExport: boolean;
  reportCount: number;
  totalCount: number;
  commentCount: number;
  busy: boolean;
  /** Writing a file. The save dialog gives no feedback of its own. */
  saving: boolean;
  onSaveAudit(): void;
  onSaveReport(): void;
  onSavePdf(): void;
  onOpenText(text: string, name: string): void;
}): React.ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const take = (file: File | undefined): void => {
    if (!file) return;
    setReadError(null);
    void file
      .text()
      .then((text) => onOpenText(text, file.name))
      .catch(() => setReadError('That file could not be read.'));
  };

  return (
    <section className="card">
      <div className="section-title">Files</div>
      <div className="detail-actions">
        <button type="button" disabled={!canExport || busy} onClick={onSaveAudit}>
          {saving ? 'Saving…' : 'Save audit'}
        </button>
        <button type="button" disabled={!canExport || busy} onClick={onSaveReport}>
          Save report
        </button>
        <button type="button" disabled={!canExport || busy} onClick={onSavePdf}>
          Save PDF
        </button>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          Open audit
        </button>
      </div>
      <p className="hint" style={{ margin: '6px 0 0' }}>
        {canExport
          ? `Audit keeps everything and reopens in ${PRODUCT_NAME}. Report and PDF both carry ${
              reportCount > 0
                ? `the ${reportCount} finding${reportCount === 1 ? '' : 's'} you added`
                : `all ${totalCount} finding${totalCount === 1 ? '' : 's'}`
            }${commentCount > 0 ? ` and ${commentCount} comment${commentCount === 1 ? '' : 's'}` : ''}.`
          : `Run or open an audit first. ${PRODUCT_NAME} writes files only when you ask it to.`}
      </p>
      {canExport ? (
        /* Said once, here, because it is the only place the choice is made.
           The PDF's built-in fonts cover Latin-1 and no more, and the report
           itself repeats the count if any characters were actually dropped. */
        <p className="hint" style={{ margin: '8px 0 0' }}>
          The HTML report keeps every character exactly; the PDF replaces any it cannot draw with its
          built-in fonts.
        </p>
      ) : null}

      <div
        className="dropzone"
        data-dragging={dragging}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer?.files?.[0]);
        }}
      >
        Drop a <span className="mono">{AUDIT_FILE_EXTENSION}</span> file here
      </div>
      {readError ? (
        <p className="hint" role="alert" style={{ color: 'var(--danger)', margin: '6px 0 0' }}>
          {readError}
        </p>
      ) : null}

      <input
        ref={input}
        type="file"
        accept={`${AUDIT_FILE_EXTENSION},application/json`}
        className="sr"
        aria-label="Open a saved audit file"
        onChange={(event) => {
          take(event.currentTarget.files?.[0]);
          // Cleared so choosing the same file twice fires a change both times.
          event.currentTarget.value = '';
        }}
      />
    </section>
  );
}
