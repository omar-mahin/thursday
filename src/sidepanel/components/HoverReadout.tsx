import type { ElementPreview } from '../../shared/types';

/** Live feedback while selection mode is on, so the panel is not dead weight
 *  while the user's attention is on the page. */
export function HoverReadout({
  hovered,
  onCancel,
}: {
  hovered: ElementPreview | null;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="card stack" data-selecting="true">
      <div className="spread">
        <div className="section-title" style={{ margin: 0 }}>
          Selecting
        </div>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Click an element on the page. Escape or right-click cancels.
      </p>
      {hovered ? (
        <dl className="kv">
          <dt>Element</dt>
          <dd className="mono truncate">
            {hovered.id ? `${hovered.tagName}#${hovered.id}` : hovered.classNames[0] ? `${hovered.tagName}.${hovered.classNames[0]}` : hovered.tagName}
          </dd>
          <dt>Size</dt>
          <dd className="mono">
            {Math.round(hovered.rect.width)} × {Math.round(hovered.rect.height)}
          </dd>
          {hovered.role ? (
            <>
              <dt>Role</dt>
              <dd className="mono">{hovered.role}</dd>
            </>
          ) : null}
          {hovered.accessibleName ? (
            <>
              <dt>Name</dt>
              <dd className="truncate">{hovered.accessibleName}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <div className="hint">Move the pointer over the page.</div>
      )}
    </div>
  );
}
