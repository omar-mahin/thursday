import { useEffect, useState } from 'react';
import { PRODUCT_NAME } from '../shared/constants/product';
import { FLAGS } from '../shared/constants/flags';
import { displayOrigin } from '../shared/utils/url';
import { usePageConnection } from './state/usePageConnection';
import { useAudit } from './state/useAudit';
import { PageCard } from './components/PageCard';
import { AuditLauncher } from './components/AuditLauncher';
import { FindingsList } from './components/FindingsList';
import { ElementInspector } from './components/ElementInspector';
import { HoverReadout } from './components/HoverReadout';
import { MessageLog } from './components/MessageLog';

type Tab = 'audit' | 'element';

export function App(): React.ReactElement {
  const { page, log, send } = usePageConnection();
  const audit = useAudit(page.snapshot, send);
  const [tab, setTab] = useState<Tab>('audit');

  // Picking an element is a request to look at it, so follow the user there.
  useEffect(() => {
    if (page.selection) setTab('element');
  }, [page.selection]);

  useEffect(() => {
    if (page.lastToolbarAction === 'inspect') setTab('element');
  }, [page.lastToolbarAction]);

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <h1 className="brandmark">{PRODUCT_NAME}</h1>
          <div className="hint truncate" style={{ maxWidth: 200 }}>
            {page.url ? displayOrigin(page.url) : 'No page connected'}
          </div>
        </div>
        <span className="badge" data-tone={page.error ? 'error' : page.activated ? 'on' : 'off'}>
          <span className="dot" />
          {page.activated ? 'Connected' : 'Not running'}
        </span>
      </header>

      <div className="tabs" role="tablist" aria-label="Panel sections">
        <button
          type="button"
          role="tab"
          id="tab-audit"
          aria-selected={tab === 'audit'}
          aria-controls="panel-audit"
          onClick={() => setTab('audit')}
        >
          Audit
        </button>
        <button
          type="button"
          role="tab"
          id="tab-element"
          aria-selected={tab === 'element'}
          aria-controls="panel-element"
          onClick={() => setTab('element')}
        >
          Element
          {page.selection ? <span className="tab-dot" aria-hidden="true" /> : null}
        </button>
      </div>

      <div className="panel-body">
        {page.selecting ? (
          <HoverReadout hovered={page.hovered} onCancel={() => send({ type: 'CANCEL_SELECTION' })} />
        ) : null}

        {tab === 'audit' ? (
          <div id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" className="stack">
            <PageCard page={page} onStop={() => send({ type: 'DEACTIVATE' })} />
            <SelectAction
              activated={page.activated}
              selecting={page.selecting}
              onStart={() => send({ type: 'START_SELECTION' })}
              onCancel={() => send({ type: 'CANCEL_SELECTION' })}
            />
            <AuditLauncher activated={page.activated} running={audit.running} onStart={audit.start} />
            {audit.error ? (
              <p className="hint" role="alert" style={{ color: 'var(--danger)' }}>
                {audit.error}
              </p>
            ) : null}
            {audit.result ? (
              <FindingsList
                result={audit.result}
                onLocate={(finding) => {
                  if (finding.elementRef) send({ type: 'FOCUS_ELEMENT', payload: { ref: finding.elementRef } });
                }}
              />
            ) : (
              <section>
                <div className="section-title">Findings</div>
                <div className="empty">No audit yet.</div>
              </section>
            )}
            {FLAGS.messageLog ? <MessageLog entries={log} /> : null}
          </div>
        ) : (
          <div id="panel-element" role="tabpanel" aria-labelledby="tab-element">
            <ElementInspector
              selection={page.selection}
              resolution={page.resolution}
              onLocate={() => {
                if (page.selection) send({ type: 'FOCUS_ELEMENT', payload: { ref: page.selection.reference } });
              }}
              onSelectAnother={() => send({ type: 'START_SELECTION' })}
            />
          </div>
        )}
      </div>

      <footer className="panel-foot">
        <span>Local only. Nothing leaves this browser.</span>
        <span className="mono">v0.1.0</span>
      </footer>
    </div>
  );
}

function SelectAction({
  activated,
  selecting,
  onStart,
  onCancel,
}: {
  activated: boolean;
  selecting: boolean;
  onStart: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <section className="card">
      <div className="section-title">Inspect</div>
      <button
        type="button"
        className={selecting ? undefined : 'primary'}
        style={{ width: '100%' }}
        disabled={!activated}
        onClick={selecting ? onCancel : onStart}
        aria-pressed={selecting}
      >
        {selecting ? 'Cancel selection' : 'Select an element'}
      </button>
    </section>
  );
}
