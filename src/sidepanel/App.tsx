import { PRODUCT_NAME } from '../shared/constants/product';
import { FLAGS } from '../shared/constants/flags';
import { displayOrigin } from '../shared/utils/url';
import { usePageConnection } from './state/usePageConnection';
import { PageCard } from './components/PageCard';
import { AuditLauncher } from './components/AuditLauncher';
import { FindingsPlaceholder } from './components/FindingsPlaceholder';
import { MessageLog } from './components/MessageLog';

export function App(): React.ReactElement {
  const { page, log, send } = usePageConnection();

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

      <div className="panel-body">
        <PageCard page={page} onStop={() => send({ type: 'DEACTIVATE' })} />
        <AuditLauncher activated={page.activated} />
        <FindingsPlaceholder />
        {FLAGS.messageLog ? <MessageLog entries={log} /> : null}
      </div>

      <footer className="panel-foot">
        <span>Local only. Nothing leaves this browser.</span>
        <span className="mono">v0.1.0</span>
      </footer>
    </div>
  );
}
