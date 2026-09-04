import { useEffect, useRef, useState } from 'react';
import type { AnnotationTarget } from '../../shared/messaging/protocol';
import type { Annotation } from '../../shared/types';
import { commentLabel } from '../../shared/utils/labels';
import { ACCEPTED_IMAGE_TYPES } from '../annotate/image';
import type { useAnnotations } from '../state/useAnnotations';

const when = (at: number): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

const kilobytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

/** What was picked, in the words the inspector would use. */
function describe(target: AnnotationTarget): string {
  const { reference } = target;
  const parts = [`<${reference.tagName}>`];
  if (reference.accessibleName) parts.push(`"${reference.accessibleName}"`);
  else if (reference.textSnippet) parts.push(`"${reference.textSnippet}"`);
  else if (reference.role) parts.push(reference.role);
  return parts.join(' ');
}

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
  snapshotId,
  activeId,
  onPick,
  onCancelPick,
  onClearTarget,
  onSelect,
  onLocate,
}: {
  comments: ReturnType<typeof useAnnotations>;
  activated: boolean;
  /** False until there is an audit for the comment to belong to. */
  canComment: boolean;
  /** True while the page is waiting for the user to click an element. */
  picking: boolean;
  target: AnnotationTarget | null;
  /** The snapshot the target's element index belongs to. */
  snapshotId: string | null;
  activeId: string | null;
  onPick(): void;
  onCancelPick(): void;
  onClearTarget(): void;
  onSelect(id: string | null): void;
  onLocate(annotation: Annotation): void;
}): React.ReactElement {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  // An element was just picked: put the cursor where the user has to type next.
  useEffect(() => {
    if (target) composer.current?.focus();
  }, [target]);

  /**
   * Copies the chosen files out of the FileList before queueing them.
   *
   * The list has to be read here and not inside the state updater: the input
   * is cleared immediately after this returns -- so that choosing the same
   * file twice fires a change both times -- and React may not have run the
   * updater yet, at which point the FileList is empty and the attachment is
   * silently lost.
   */
  const addFiles = (chosen: FileList | null | undefined): void => {
    const picked = Array.from(chosen ?? []);
    if (picked.length === 0) return;
    setFiles((current) => [...current, ...picked]);
  };

  const submit = (): void => {
    if (!body.trim()) return;
    void comments.add({ body, target, files, snapshotId }).then((saved) => {
      if (!saved) return;
      setBody('');
      setFiles([]);
      onClearTarget();
    });
  };

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
          Run or open an audit first — a comment is kept with the audit it was written on.
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
            {target ? (
              <button type="button" className="link" onClick={onClearTarget}>
                Clear anchor
              </button>
            ) : null}
          </div>

          {picking ? (
            <p className="notice" role="status" style={{ margin: '6px 0 0' }}>
              Click the element you want to comment on. Escape cancels.
            </p>
          ) : null}

          <div className="comment-compose">
            <p className="hint" style={{ margin: '0 0 8px' }}>
              {target ? (
                <>
                  Anchored to <span className="mono">{describe(target)}</span>
                </>
              ) : (
                'No anchor — this comment will be about the page as a whole.'
              )}
            </p>
            <textarea
              ref={composer}
              rows={3}
              value={body}
              placeholder="What did you notice?"
              aria-label="Comment"
              onChange={(event) => setBody(event.currentTarget.value)}
              /* Pasting a screenshot straight in is how people actually attach
                 one; making them save it to disk first would be a step nobody
                 needs. */
              onPaste={(event) => {
                const pasted = Array.from(event.clipboardData?.files ?? []);
                if (pasted.length === 0) return;
                event.preventDefault();
                setFiles((current) => [...current, ...pasted]);
              }}
            />
            {files.length > 0 ? (
              <ul className="attach-queue">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <span className="truncate">{file.name || 'Pasted image'}</span>
                    <span className="hint">{kilobytes(file.size)}</span>
                    <button
                      type="button"
                      className="icon"
                      aria-label={`Remove ${file.name || 'pasted image'}`}
                      onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="detail-actions">
              <button type="button" onClick={() => chooser.current?.click()}>
                Attach image
              </button>
              <button
                type="button"
                className="primary"
                disabled={!body.trim() || comments.busy}
                onClick={submit}
              >
                {comments.busy ? 'Saving…' : 'Add comment'}
              </button>
            </div>
            <input
              ref={chooser}
              type="file"
              accept={ACCEPT}
              multiple
              className="sr"
              aria-label="Attach images to this comment"
              onChange={(event) => {
                addFiles(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />
          </div>
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
                  <span className="hint">{when(annotation.createdAt)}</span>
                </div>

                {open ? (
                  <>
                    <textarea
                      rows={3}
                      value={draft}
                      aria-label={`Edit comment ${marker}`}
                      onChange={(event) => setDraft(event.currentTarget.value)}
                    />
                    <div className="detail-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={!draft.trim()}
                        onClick={() => {
                          void comments.edit(annotation.id, draft);
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
