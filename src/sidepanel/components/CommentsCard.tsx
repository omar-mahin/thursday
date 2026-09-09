import { PRODUCT_NAME } from '../../shared/constants/product';
import type { AnnotationTarget } from '../../shared/messaging/protocol';
import type { useAnnotations } from '../state/useAnnotations';

/**
 * Starting a comment. The comments themselves live in the issues list.
 *
 * This was a card that also held every comment, in its own list under the
 * findings -- which meant working through a page twice and two answers to "what
 * is left". The comments moved into the one list; what stays here is the two
 * ways to begin one, and whatever needs saying about storing them.
 *
 * The whole point of anchoring a comment to an element is that the reader of
 * the report does not have to guess which button you meant, so both options are
 * offered plainly. A comment about the page as a whole is a first-class choice
 * rather than a fallback: "the checkout flow asks for the same thing twice" is
 * not about any one element.
 */
export function CommentsCard({
  comments,
  activated,
  canComment,
  picking,
  target,
  onPick,
  onPickPage,
  onCancelPick,
  onClearTarget,
}: {
  comments: ReturnType<typeof useAnnotations>;
  activated: boolean;
  /** False until there is a page to comment on. */
  canComment: boolean;
  /** True while the page is waiting for the user to click an element. */
  picking: boolean;
  target: AnnotationTarget | null;
  onPick(): void;
  /** Opens the card with no element behind it. */
  onPickPage(): void;
  onCancelPick(): void;
  onClearTarget(): void;
}): React.ReactElement {
  return (
    <section className="card">
      {/*
        No count here any more: the issues list says "2 from you" a few pixels
        below, and two numbers for the same thing on one screen is how they end
        up disagreeing.
      */}
      <div className="section-title" style={{ marginBottom: 6 }}>
        Comments
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
    </section>
  );
}
