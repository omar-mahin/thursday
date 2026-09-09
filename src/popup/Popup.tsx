import { useCallback, useEffect, useState } from 'react';
import { ACTIVATE_SHORTCUT, PRODUCT_NAME } from '../shared/constants/product';
import { sendCommand } from '../shared/messaging/port';
import type { Result } from '../shared/result';
import { USER_MESSAGES } from '../shared/result';
import { checkUrl, displayOrigin, restrictionMessage } from '../shared/utils/url';

type TabInfo = { tabId: number | undefined; url: string | undefined };

/**
 * Activation has to start here. Clicking the action is what grants activeTab;
 * a button inside our own side panel does not (PLAN.md section 2.1), so the
 * popup is the only place that can legally inject.
 */
export function Popup(): React.ReactElement {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [activated, setActivated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      setTab({ tabId: active?.id, url: active?.url });
      const status = await sendCommand<Result<{ activated: boolean }>>({ type: 'GET_PAGE_STATUS' });
      if (status.ok) setActivated(status.value.activated);
    })();
  }, []);

  const verdict = checkUrl(tab?.url);
  const canActivate = verdict.auditable && tab?.tabId !== undefined;

  /**
   * Opens the docked panel.
   *
   * `chrome.sidePanel.open` needs a user gesture, and a gesture window closes
   * the moment anything is awaited before it -- so this is called first, from
   * inside the click handler, and the activation that follows is awaited after.
   */
  const openPanel = useCallback(async (tabId: number) => {
    try {
      await chrome.sidePanel.open({ tabId });
    } catch {
      setError('Could not open the side panel.');
    }
  }, []);

  const activate = useCallback(() => {
    if (tab?.tabId === undefined) return;
    setBusy(true);
    setError(null);
    // Before the await, while the click's gesture still counts.
    const panel = openPanel(tab.tabId);
    void (async () => {
      const result = await sendCommand<Result<void>>({ type: 'ACTIVATE_PAGE' });
      await panel;
      setBusy(false);
      if (!result.ok) {
        setError(USER_MESSAGES[result.error.code]);
        return;
      }
      setActivated(true);
      window.close();
    })();
  }, [tab, openPanel]);

  const deactivate = useCallback(() => {
    setBusy(true);
    void (async () => {
      await sendCommand<Result<void>>({ type: 'DEACTIVATE' });
      setBusy(false);
      setActivated(false);
    })();
  }, []);

  return (
    <>
      <div className="popup-head">
        <h1 className="brandmark">{PRODUCT_NAME}</h1>
        <span className="badge" data-tone={activated ? 'on' : 'off'}>
          <span className="dot" />
          {activated ? 'Running' : 'Idle'}
        </span>
      </div>

      <div className="card">
        <div className="popup-origin truncate mono">{displayOrigin(tab?.url) || 'No page'}</div>
        {!verdict.auditable && tab !== null ? (
          <p className="hint" style={{ margin: '6px 0 0' }}>
            {restrictionMessage(verdict.reason)}
          </p>
        ) : null}
      </div>

      <div className="popup-actions">
        {activated ? (
          <>
            <button
              type="button"
              className="primary"
              disabled={tab?.tabId === undefined}
              onClick={() => {
                if (tab?.tabId !== undefined) void openPanel(tab.tabId);
                window.close();
              }}
            >
              Open audit panel
            </button>
            <button type="button" onClick={deactivate} disabled={busy}>
              Stop on this page
            </button>
          </>
        ) : (
          <button type="button" className="primary" onClick={activate} disabled={!canActivate || busy}>
            {busy ? 'Starting…' : 'Activate on this page'}
          </button>
        )}
      </div>

      {error ? (
        <p className="hint" role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      <div className="popup-foot">
        <div>
          Runs locally. No account, no network.
          {/* Worth saying here: a reload drops the content script, and this
              turns restarting into one keystroke. */}
          <div className="hint" style={{ marginTop: 2 }}>
            Shortcut: <span className="mono">{ACTIVATE_SHORTCUT}</span>
          </div>
        </div>
        <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
          Settings
        </button>
      </div>
    </>
  );
}
