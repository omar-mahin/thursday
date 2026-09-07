import { useCallback, useEffect, useState } from 'react';
import { REQUIRED_PERMISSIONS } from '../../manifest.config';
import { ACTIVATE_SHORTCUT, PRODUCT_NAME } from '../shared/constants/product';
import { DEFAULT_SETTINGS, getSetting, setSetting, type Settings } from '../storage/settings';
import { clearAll, deleteByOrigin, usage, type StorageUsage } from '../storage/audits';

const PERMISSION_REASONS: Record<(typeof REQUIRED_PERMISSIONS)[number], string> = {
  storage: 'Remembers your settings and audits on this machine.',
  activeTab: 'Reads the page you explicitly activate, and only that page.',
  scripting: 'Injects the toolbar when you click Activate.',
  sidePanel: 'Shows the audit panel beside the page.',
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function Options(): React.ReactElement {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [cleared, setCleared] = useState(false);
  const [stored, setStored] = useState<StorageUsage | null>(null);
  const [copied, setCopied] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  const loadUsage = useCallback(() => {
    void usage()
      .then((next) => {
        setStored(next);
        setStorageError(null);
      })
      .catch(() => setStorageError(`This browser will not let ${PRODUCT_NAME} open its local database.`));
  }, []);

  useEffect(() => {
    void (async () => {
      const [authorName, theme, minTouchTarget, toolbarPosition, keepHistory, captureScreenshots] =
        await Promise.all([
          getSetting('authorName'),
          getSetting('theme'),
          getSetting('minTouchTarget'),
          getSetting('toolbarPosition'),
          getSetting('keepHistory'),
          getSetting('captureScreenshots'),
        ]);
      setSettings({ authorName, theme, minTouchTarget, toolbarPosition, keepHistory, captureScreenshots });
    })();
  }, []);

  useEffect(loadUsage, [loadUsage]);

  const update = <K extends keyof Settings>(name: K, value: Settings[K]): void => {
    setSettings((current) => ({ ...current, [name]: value }));
    void setSetting(name, value);
  };

  return (
    <div className="wrap">
      <header className="opt-head">
        <h1>{PRODUCT_NAME} settings</h1>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Everything here is stored on this machine only.
        </p>
      </header>

      <section className="card">
        {/* First, because it is the only setting here that is about the person
            rather than about the audit. */}
        <div className="section-title">You</div>
        <div className="field">
          <div>
            <div className="field-label">Your name</div>
            <div className="hint">
              Goes on the comments you write, so a report says whose opinion each one is. Stored on this
              machine. {PRODUCT_NAME} has no accounts and never sends it anywhere.
            </div>
          </div>
          <input
            type="text"
            aria-label="Your name"
            placeholder="Nobody yet"
            value={settings.authorName}
            onChange={(event) => update('authorName', event.currentTarget.value)}
            style={{ width: 180 }}
          />
        </div>
      </section>

      <section className="card">
        <div className="section-title">Audit thresholds</div>
        <div className="field">
          <div>
            <div className="field-label">Minimum touch target</div>
            <div className="hint">
              Used by rule A11Y-004. WCAG 2.5.8 requires 24px; 44px is the usability recommendation.
            </div>
          </div>
          <input
            type="number"
            min={16}
            max={96}
            step={1}
            value={settings.minTouchTarget}
            aria-label="Minimum touch target in CSS pixels"
            onChange={(event) => update('minTouchTarget', Number(event.currentTarget.valueAsNumber || 0))}
            style={{ width: 78 }}
          />
        </div>
      </section>

      <section className="card">
        <div className="section-title">Appearance</div>
        <div className="field">
          <div>
            <div className="field-label">Theme</div>
            <div className="hint">Applies to the panel and the on-page toolbar.</div>
          </div>
          <select
            value={settings.theme}
            aria-label="Theme"
            onChange={(event) => update('theme', event.currentTarget.value as Settings['theme'])}
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="field">
          <div>
            <div className="field-label">Keyboard shortcut</div>
            <div className="hint">
              <span className="mono">{ACTIVATE_SHORTCUT}</span> activates {PRODUCT_NAME} on the current page and
              opens the panel. Change it in Chrome under Extensions → Keyboard shortcuts.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              // chrome://extensions/shortcuts cannot be opened by an extension,
              // so this is the closest honest thing: show where it lives.
              void navigator.clipboard
                ?.writeText('chrome://extensions/shortcuts')
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? 'Address copied' : 'Copy address'}
          </button>
        </div>
        <div className="field">
          <div>
            <div className="field-label">Toolbar position</div>
            <div className="hint">
              {settings.toolbarPosition
                ? `Remembered at ${Math.round(settings.toolbarPosition.x)}, ${Math.round(settings.toolbarPosition.y)}.`
                : 'Not set yet.'}
            </div>
          </div>
          <button type="button" onClick={() => update('toolbarPosition', null)} disabled={!settings.toolbarPosition}>
            Reset
          </button>
        </div>
      </section>

      <section className="card privacy">
        <div className="section-title">Privacy</div>
        <p style={{ margin: '0 0 8px' }}>
          {PRODUCT_NAME} has no account, no server and no network access. It cannot send your page
          anywhere, and the build is tested for it.
        </p>
        <ul>
          {REQUIRED_PERMISSIONS.map((permission) => (
            <li key={permission}>
              <span className="mono">{permission}</span> — {PERMISSION_REASONS[permission]}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="section-title">Stored data</div>
        <div className="field">
          <div>
            <div className="field-label">Keep audit history</div>
            <div className="hint">
              Stores finished audits on this machine so they survive a restart. Turning it off means an
              audit lasts until you close the panel, unless you save it as a file.
            </div>
          </div>
          <label className="switch">
            {/* Named by what it controls. Without this the accessible name is
                "On", which says the state and not the subject. */}
            <input
              type="checkbox"
              aria-label="Keep audit history"
              checked={settings.keepHistory}
              onChange={(event) => update('keepHistory', event.currentTarget.checked)}
            />
            <span aria-hidden="true">{settings.keepHistory ? 'On' : 'Off'}</span>
          </label>
        </div>
        <div className="field">
          <div>
            <div className="field-label">Photograph findings</div>
            <div className="hint">
              Every audit takes a picture of each finding: a crop of the problem, and a thumbnail showing
              where on the page it sits. {PRODUCT_NAME} scrolls the page to reach findings below the fold
              and puts it back afterwards. Password and payment fields are painted out of every picture,
              including pictures taken for something else nearby.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              aria-label="Photograph findings"
              checked={settings.captureScreenshots}
              onChange={(event) => update('captureScreenshots', event.currentTarget.checked)}
            />
            <span aria-hidden="true">{settings.captureScreenshots ? 'On' : 'Off'}</span>
          </label>
        </div>

        {storageError ? (
          <p className="hint" role="alert" style={{ color: 'var(--danger)' }}>
            {storageError}
          </p>
        ) : (
          <p className="hint" style={{ margin: '10px 0 0' }}>
            {stored ? describeStorage(stored) : 'Reading local storage…'}
          </p>
        )}

        {stored && stored.origins.length > 0 ? (
          <ul className="origins">
            {stored.origins.map((entry) => (
              <li key={entry.origin}>
                <span className="truncate mono">{entry.origin}</span>
                <span className="hint">
                  {entry.audits} audit{entry.audits === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void deleteByOrigin(entry.origin).then(loadUsage);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="field">
          <div>
            <div className="field-label">Clear everything</div>
            <div className="hint">
              Deletes every stored audit, finding and screenshot, and resets settings. This cannot be
              undone, and files you saved yourself are not touched.
            </div>
          </div>
          <button
            type="button"
            className="danger"
            onClick={() => {
              void (async () => {
                await clearAll().catch(() => undefined);
                await chrome.storage.local.clear();
                setSettings(DEFAULT_SETTINGS);
                setCleared(true);
                loadUsage();
              })();
            }}
          >
            Clear
          </button>
        </div>
        {cleared ? (
          <p className="hint" role="status" style={{ margin: '8px 0 0' }}>
            Cleared.
          </p>
        ) : null}
      </section>

    </div>
  );
}

/**
 * What is on disk, in a sentence.
 *
 * Every kind is named separately -- comments and the images inside them are
 * the user's own contributions and the things they are most likely to want
 * accounted for, so folding them into "3 screenshots" would hide exactly the
 * rows somebody came here to look for. Zero counts are left out rather than
 * printed, so the line stays readable on a fresh install.
 */
function describeStorage(stored: StorageUsage): string {
  const plural = (count: number, noun: string, plural = `${noun}s`): string =>
    `${count} ${count === 1 ? noun : plural}`;
  const parts = [plural(stored.audits, 'audit'), plural(stored.findings, 'finding')];
  if (stored.screenshots > 0) parts.push(plural(stored.screenshots, 'screenshot'));
  if (stored.comments > 0) parts.push(plural(stored.comments, 'comment'));
  if (stored.attachments > 0) parts.push(plural(stored.attachments, 'attached image'));
  const size = stored.bytes === null ? '' : ` — about ${formatBytes(stored.bytes)} of browser storage`;
  return `${parts.join(', ')}${size}.`;
}
