import { useRef, useState } from 'react';
import type { Annotation, AnnotationPriority, FindingStatus } from '../../shared/types';
import { commentLabel } from '../../shared/utils/labels';
import { ACCEPTED_IMAGE_TYPES } from '../../shared/media/image';
import { ANNOTATION_PRIORITIES, PRIORITY_LABELS } from '../../shared/constants/priority';
import type { useAnnotations } from '../state/useAnnotations';

const when = (at: number): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

const kilobytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

const ACCEPT = ACCEPTED_IMAGE_TYPES.join(',');

/**
 * The same three answers a finding offers.
 *
 * Deliberately identical to `STATUS_ACTIONS` in FindingDetail, wording and all.
 * The two sit in one list, and a comment that offered "Done" where the finding
 * next to it offers "Resolve" would read as a different mechanism rather than
 * the same one applied to a different kind of item.
 */
const STATUS_ACTIONS: Array<{ status: FindingStatus; label: string; hint: string }> = [
  { status: 'accepted', label: 'Accept', hint: 'Agree this is worth acting on' },
  { status: 'resolved', label: 'Resolve', hint: 'Mark as done' },
  { status: 'dismissed', label: 'Dismiss', hint: 'Decided against' },
];

/**
 * One comment, in the same list as the findings.
 *
 * It carries the same status ladder and the same triage buttons, and is marked
 * as the user's own rather than measured: a letter instead of a number, a
 * "From you" badge instead of a severity chip, and the priority shown in the
 * author's words. That distinction is the whole reason a comment can share the
 * list safely -- nothing here can be mistaken for something Thursday measured.
 */
export function CommentRow({
  annotation,
  index,
  status,
  comments,
  current,
  onSelect,
  onLocate,
  onStatus,
}: {
  annotation: Annotation;
  /** Position in the whole comment series, so the marker matches its pin. */
  index: number;
  status: FindingStatus;
  comments: ReturnType<typeof useAnnotations>;
  current: boolean;
  onSelect(id: string | null): void;
  onLocate(annotation: Annotation): void;
  onStatus(status: FindingStatus): void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftPriority, setDraftPriority] = useState<AnnotationPriority>('normal');
  const [confirming, setConfirming] = useState(false);
  const marker = commentLabel(index + 1);

  return (
    <li className="comment-row" data-current={current} data-status={status}>
      <div className="comment-head">
        <button
          type="button"
          className="comment-marker"
          aria-label={`Show comment ${marker} on the page`}
          onClick={() => {
            onSelect(annotation.id);
            onLocate(annotation);
          }}
        >
          {marker}
        </button>
        {/*
          Says whose claim this is, in the place a finding puts its severity.
          Without it a comment in this list is one row away from reading as a
          measurement, which is the conflation the whole product avoids.
        */}
        <span className="from-you">From you</span>
        <span className="hint truncate">
          {annotation.elementRef
            ? `<${annotation.elementRef.tagName}>${
                annotation.elementRef.accessibleName ? ` "${annotation.elementRef.accessibleName}"` : ''
              }`
            : 'Whole page'}
        </span>
        {annotation.priority && annotation.priority !== 'normal' ? (
          // Only when it says something. A badge on every comment reading
          // "Normal" is noise that makes the two that matter harder to spot.
          <span className="comment-priority" data-level={annotation.priority}>
            {PRIORITY_LABELS[annotation.priority]}
          </span>
        ) : null}
        {status !== 'open' ? <span className="row-status">{status}</span> : null}
        <span className="hint">{when(annotation.createdAt)}</span>
      </div>
      {annotation.author ? <div className="hint">{annotation.author}</div> : null}

      {editing ? (
        <>
          <textarea
            rows={3}
            value={draft}
            aria-label={`Edit comment ${marker}`}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <div className="priority-row" role="radiogroup" aria-label={`Priority of comment ${marker}`}>
            {ANNOTATION_PRIORITIES.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                className="priority-pill"
                data-level={level}
                aria-checked={draftPriority === level}
                onClick={() => setDraftPriority(level)}
              >
                {PRIORITY_LABELS[level]}
              </button>
            ))}
          </div>
          <div className="detail-actions">
            <button
              type="button"
              className="primary"
              disabled={!draft.trim()}
              onClick={() => {
                void comments.edit(annotation.id, draft, draftPriority);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button type="button" className="link" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <p className="comment-body">{annotation.body}</p>
      )}

      {annotation.attachments.length > 0 ? (
        <ul className="attach-grid">
          {annotation.attachments.map((meta) => (
            <li key={meta.id}>
              {comments.urls[meta.id] ? (
                <img
                  src={comments.urls[meta.id]}
                  alt={meta.caption || `Image attached to comment ${marker}`}
                  width={meta.width}
                  height={meta.height}
                />
              ) : (
                <span className="hint">Image unavailable</span>
              )}
              <button
                type="button"
                className="icon"
                aria-label={`Remove the ${kilobytes(meta.bytes)} image from comment ${marker}`}
                onClick={() => void comments.detach(annotation.id, meta.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="detail-actions">
        {STATUS_ACTIONS.map((action) => (
          <button
            key={action.status}
            type="button"
            title={action.hint}
            aria-pressed={status === action.status}
            // Pressing the status it already has puts it back to open, which is
            // the only way to undo triage without a fourth button for it.
            onClick={() => onStatus(status === action.status ? 'open' : action.status)}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="detail-actions">
        {!editing ? (
          <button
            type="button"
            className="link"
            onClick={() => {
              setEditing(true);
              setDraft(annotation.body);
              // Starts from what the comment already says, so opening the
              // editor and saving cannot silently change it.
              setDraftPriority(annotation.priority ?? 'normal');
            }}
          >
            Edit
          </button>
        ) : null}
        <AttachMore annotationId={annotation.id} marker={marker} comments={comments} />
        {confirming ? (
          <>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setConfirming(false);
                void comments.remove(annotation.id);
              }}
            >
              Delete
            </button>
            <button type="button" className="link" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="link" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

/** Adding an image to a comment that already exists. */
function AttachMore({
  annotationId,
  marker,
  comments,
}: {
  annotationId: string;
  marker: string;
  comments: ReturnType<typeof useAnnotations>;
}): React.ReactElement {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="link" onClick={() => input.current?.click()}>
        Add image
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr"
        aria-label={`Attach images to comment ${marker}`}
        onChange={(event) => {
          const chosen = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (chosen.length > 0) void comments.attach(annotationId, chosen);
        }}
      />
    </>
  );
}
