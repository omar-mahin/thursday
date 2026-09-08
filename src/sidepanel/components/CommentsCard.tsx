import { useRef, useState } from 'react';
import { PRODUCT_NAME } from '../../shared/constants/product';
import type { AnnotationTarget } from '../../shared/messaging/protocol';
import type { Annotation } from '../../shared/types';
import { commentLabel } from '../../shared/utils/labels';
import { ACCEPTED_IMAGE_TYPES } from '../../shared/media/image';
import { ANNOTATION_PRIORITIES, PRIORITY_LABELS } from '../../shared/constants/priority';
import type { AnnotationPriority } from '../../shared/types';
import type { useAnnotations } from '../state/useAnnotations';

const when = (at: number): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

const kilobytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

/** What was picked, in the words the inspector would use. */

const ACCEPT = ACCEPTED_IMAGE_TYPES.join(',');

/**
 * Writing comments on the page.
 *
 * The whole point of anchoring a comment to an element is that the reader of
 * the report does not have to guess which button you meant, so the compose box
 * leads with the anchor and says plainly when there isn't one. A comment about
 * the page as a whole is a first-class option rather than a fallback: "the
 * checkout flow asks for the same thing twice" is not about any one element.
 */
export function CommentsCard({
  comments,
  activated,
  canComment,
  picking,
  target,
  activeId,
  onPick,
  onPickPage,
  onCancelPick,
  onClearTarget,
  onSelect,
  onLocate,
}: {
  comments: ReturnType<typeof useAnnotations>;
  activated: boolean;
  /** False until there is a page to comment on. */
  canComment: boolean;
  /** True while the page is waiting for the user to click an element. */
  picking: boolean;
  target: AnnotationTarget | null;
  activeId: string | null;
  onPick(): void;
  /** Opens the card with no element behind it. */
  onPickPage(): void;
  onCancelPick(): void;
  onClearTarget(): void;
  onSelect(id: string | null): void;
  onLocate(annotation: Annotation): void;
}): React.ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftPriority, setDraftPriority] = useState<AnnotationPriority>('normal');
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <section className="card">
      <div className="spread">
        <div className="section-title" style={{ marginBottom: 0 }}>
          Comments
        </div>
        <span className="hint">{comments.annotations.length || ''}</span>
      </div>

      {!canComment ? (
        <p className="hint" style={{ margin: 0 }}>
          Activate {PRODUCT_NAME} on a page to comment on it.
        </p>
      ) : (
        <>
          <div className="detail-actions">
            <button
              type="button"
              disabled={!activated}
              aria-pressed={picking}
              onClick={picking ? onCancelPick : onPick}
            >
              {picking ? 'Cancel' : 'Comment on an element'}
            </button>
            <button type="button" disabled={!activated || picking} onClick={onPickPage}>
              Comment on the page
            </button>
            {target ? (
              <button type="button" className="link" onClick={onClearTarget}>
                Clear anchor
              </button>
            ) : null}
          </div>

          {picking ? (
            <p className="notice" role="status" style={{ margin: '6px 0 0' }}>
              Click the element you want to comment on. The card opens on the page. Escape cancels.
            </p>
          ) : null}

        </>
      )}

      {comments.error ? (
        <p className="hint" role="alert" style={{ color: 'var(--danger)', margin: '6px 0 0' }}>
          {comments.error}{' '}
          <button type="button" className="link" onClick={comments.dismissError}>
            Dismiss
          </button>
        </p>
      ) : null}

      {comments.memoryOnly ? (
        <p className="hint" style={{ margin: '6px 0 0' }}>
          These comments are in this panel only — the audit they belong to is not in history. Save an
          audit file to keep them.
        </p>
      ) : null}

      {comments.annotations.length > 0 ? (
        <ul className="comment-list">
          {comments.annotations.map((annotation, index) => {
            const marker = commentLabel(index + 1);
            const open = editing === annotation.id;
            return (
              <li
                key={annotation.id}
                className="comment-row"
                data-current={annotation.id === activeId}
              >
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
                  <span className="hint truncate">
                    {annotation.elementRef
                      ? `<${annotation.elementRef.tagName}>${
                          annotation.elementRef.accessibleName
                            ? ` "${annotation.elementRef.accessibleName}"`
                            : ''
                        }`
                      : 'Whole page'}
                  </span>
                  {annotation.priority && annotation.priority !== 'normal' ? (
                    // Only when it says something. A badge on every comment
                    // reading "Normal" is noise that makes the two that matter
                    // harder to spot.
                    <span className="comment-priority" data-level={annotation.priority}>
                      {PRIORITY_LABELS[annotation.priority]}
                    </span>
                  ) : null}
                  <span className="hint">{when(annotation.createdAt)}</span>
                </div>
                {annotation.author ? <div className="hint">{annotation.author}</div> : null}

                {open ? (
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
                          setEditing(null);
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="link" onClick={() => setEditing(null)}>
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
                  {!open ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setEditing(annotation.id);
                        setDraft(annotation.body);
                        // Starts from what the comment already says, so opening
                        // the editor and saving cannot silently change it.
                        setDraftPriority(annotation.priority ?? 'normal');
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                  <AttachMore annotationId={annotation.id} marker={marker} comments={comments} />
                  {confirming === annotation.id ? (
                    <>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setConfirming(null);
                          void comments.remove(annotation.id);
                        }}
                      >
                        Delete
                      </button>
                      <button type="button" className="link" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="link"
                      onClick={() => setConfirming(annotation.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
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
