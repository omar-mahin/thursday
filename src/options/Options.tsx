import { useEffect, useState } from 'react';
import { REQUIRED_PERMISSIONS } from '../../manifest.config';
import { PRODUCT_NAME } from '../shared/constants/product';
import { DEFAULT_SETTINGS, getSetting, setSetting, type Settings } from '../storage/settings';

const PERMISSION_REASONS: Record<(typeof REQUIRED_PERMISSIONS)[number], string> = {
  storage: 'Remembers your settings and audits on this machine.',
  activeTab: 'Reads the page you explicitly activate, and only that page.',
  scripting: 'Injects the toolbar when you click Activate.',
  sidePanel: 'Shows the audit panel beside the page.',
};

export function Options(): React.ReactElement {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    void (async () => {
      const [theme, minTouchTarget, toolbarPosition] = await Promise.all([
        getSetting('theme'),
        getSetting('minTouchTarget'),
        getSetting('toolbarPosition'),
      ]);
      setSettings({ theme, minTouchTarget, toolbarPosition });
    })();
  }, []);

  const update = <K extends keyof Settings>(name: K, value: Settings[K]): void => {
    setSettings((current) => ({ ...current, [name]: value }));
    void setSetting(name, value);
  };

  return (
    <div className="wrap">
      <header className="opt-head">
        <h1>{PRODUCT_NAME} settings</h1>
        <p className="hint" style={{ margin: '4px 0 0' }}>
          Everything here is stored on this machine only.
        </p>
      </header>

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
        <p style={{ margin: '0 0 4px' }}>
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
            <div className="field-label">Clear everything</div>
            <div className="hint">Removes settings and saved audits from this browser.</div>
          </div>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await chrome.storage.local.clear();
                setSettings(DEFAULT_SETTINGS);
                setCleared(true);
              })();
            }}
          >
            Clear
          </button>
        </div>
        {cleared ? (
          <p className="hint" role="status" style={{ margin: '6px 0 0' }}>
            Cleared.
          </p>
        ) : null}
      </section>
    </div>
  );
}
