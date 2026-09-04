import { PRODUCT_NAME } from '../../shared/constants/product';
import type { PageState } from '../state/usePageConnection';

export function PageCard({ page, onStop }: { page: PageState; onStop: () => void }): React.ReactElement {
  if (!page.activated) {
    return (
      <div className="card stack">
        <div>
          <div className="section-title">Not running here</div>
          <p className="hint" style={{ margin: 0 }}>
            Click the {PRODUCT_NAME} icon in the browser toolbar, then <strong>Activate on this page</strong>.
            {' '}
            {PRODUCT_NAME} only touches a page after you ask it to — that is why it has to be started per page.
          </p>
        </div>
        {page.error ? (
          <p className="hint" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
            {page.error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card stack">
      <div className="spread">
        <div className="section-title" style={{ margin: 0 }}>
          Page
        </div>
        <button type="button" onClick={onStop}>
          Stop
        </button>
      </div>
      <div className="truncate" title={page.title ?? ''}>
        {page.title || 'Untitled page'}
      </div>
      <dl className="kv">
        <dt>URL</dt>
        <dd className="mono truncate" title={page.url ?? ''}>
          {page.url}
        </dd>
        {page.viewport ? (
          <>
            <dt>Viewport</dt>
            <dd className="mono">
              {page.viewport.width} × {page.viewport.height} @{page.viewport.devicePixelRatio}x
            </dd>
            <dt>Document</dt>
            <dd className="mono">
              {page.viewport.documentWidth} × {page.viewport.documentHeight}
            </dd>
          </>
        ) : null}
      </dl>
      {page.lastToolbarAction ? (
        <div className="hint">
          Last toolbar action: <span className="mono">{page.lastToolbarAction.action}</span>
        </div>
      ) : null}
      {page.error ? (
        <p className="hint" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
          {page.error}
        </p>
      ) : null}
    </div>
  );
}
