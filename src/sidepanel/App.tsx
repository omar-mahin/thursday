import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { PRODUCT_NAME } from '../shared/constants/product';
import { FLAGS } from '../shared/constants/flags';
import { displayOrigin } from '../shared/utils/url';
import { countBySeverity } from '../audit/engine/run';
import type { Severity } from '../shared/types';
import { usePageConnection } from './state/usePageConnection';
import { useAudit } from './state/useAudit';
import {
  countByStatus,
  EMPTY_STATE,
  filterViews,
  ordinals as ordinalsOf,
  pinsFor,
  reduce,
} from './state/findings';
import { PageCard } from './components/PageCard';
import { AuditLauncher } from './components/AuditLauncher';
import { FindingsList } from './components/FindingsList';
import { FindingDetail } from './components/FindingDetail';
import { ElementInspector } from './components/ElementInspector';
import { HoverReadout } from './components/HoverReadout';
import { MessageLog } from './components/MessageLog';

type Tab = 'audit' | 'element';

const EMPTY_COUNTS: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

export function App(): React.ReactElement {
  const { page, log, send } = usePageConnection();
  const audit = useAudit(page.snapshot, send);
  const [findings, dispatch] = useReducer(reduce, EMPTY_STATE);
  const [tab, setTab] = useState<Tab>('audit');
  const detailRef = useRef<HTMLDivElement>(null);

  // Follow the user to whatever they just asked to look at.
  useEffect(() => {
    if (page.selection) setTab('element');
  }, [page.selection]);
  useEffect(() => {
    if (page.lastToolbarAction === 'inspect') setTab('element');
  }, [page.lastToolbarAction]);
  useEffect(() => {
    if (page.lastToolbarAction === 'audit') setTab('audit');
  }, [page.lastToolbarAction]);

  // A completed audit replaces the findings.
  useEffect(() => {
    if (audit.result) dispatch({ type: 'load', findings: audit.result.findings });
  }, [audit.result]);

  const visible = useMemo(() => filterViews(findings), [findings]);
  const pins = useMemo(() => pinsFor(visible, page.snapshot), [visible, page.snapshot]);
  const ordinals = useMemo(() => ordinalsOf(pins), [pins]);
  const counts = useMemo(
    () => (findings.views.length === 0 ? EMPTY_COUNTS : countBySeverity(findings.views.map((view) => view.finding))),
    [findings.views],
  );
  const statusCounts = useMemo(() => countByStatus(findings.views), [findings.views]);
  const closedCount = statusCounts.dismissed + statusCounts.resolved;
  const selected = visible.find((view) => view.finding.id === findings.selectedId) ?? null;

  // Keep the page's pins in step with what the panel is showing.
  const pinKey = pins.map((pin) => `${pin.findingId}:${pin.ordinal}:${pin.severity}`).join('|');
  useEffect(() => {
    if (!page.activated) return;
    if (pins.length === 0) send({ type: 'CLEAR_PINS' });
    else send({ type: 'RENDER_PINS', payload: { pins } });
    // pinKey stands in for the pins array: a new array of identical pins should
    // not cost the page a re-render.
  }, [pinKey, page.activated]);

  useEffect(() => {
    if (!page.activated) return;
    send({ type: 'SET_ACTIVE_FINDING', payload: { findingId: findings.selectedId } });
  }, [findings.selectedId, page.activated]);

  // A pin click on the page opens that finding here.
  useEffect(() => {
    if (!page.pinClicked) return;
    setTab('audit');
    dispatch({ type: 'select', id: page.pinClicked.findingId });
    detailRef.current?.scrollIntoView({ block: 'nearest' });
  }, [page.pinClicked]);

  /** Opening a finding should show it: the detail card sits below a long list. */
  const openFinding = useCallback((id: string) => {
    dispatch({ type: 'select', id });
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, []);

  const locate = useCallback(
    (id: string) => {
      const view = findings.views.find((item) => item.finding.id === id);
      if (view?.finding.elementRef) {
        send({ type: 'FOCUS_ELEMENT', payload: { ref: view.finding.elementRef } });
      }
    },
    [findings.views, send],
  );

  // Escape closes the open finding, per spec section 38.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (page.selecting) {
        send({ type: 'CANCEL_SELECTION' });
        return;
      }
      if (findings.selectedId) dispatch({ type: 'select', id: null });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [findings.selectedId, page.selecting, send]);

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
          {findings.views.length > 0 ? <span className="tab-count">{findings.views.length}</span> : null}
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

            {audit.result && findings.views.length === 0 ? (
              <div className="empty">
                Nothing found in {audit.result.audit.categories.length} categor
                {audit.result.audit.categories.length === 1 ? 'y' : 'ies'} across{' '}
                {audit.result.audit.elementsScanned} elements.
              </div>
            ) : null}

            {findings.views.length > 0 ? (
              <>
                <FindingsList
                  views={visible}
                  counts={counts}
                  severities={findings.severities}
                  showClosed={findings.showClosed}
                  closedCount={closedCount}
                  selectedId={findings.selectedId}
                  ordinals={ordinals}
                  onSelect={openFinding}
                  onToggleSeverity={(severity) => dispatch({ type: 'toggleSeverity', severity })}
                  onShowClosed={(value) => dispatch({ type: 'showClosed', value })}
                />
                <div ref={detailRef}>
                  {selected ? (
                    <FindingDetail
                      view={selected}
                      ordinal={ordinals.get(selected.finding.id)}
                      onStatus={(status) => dispatch({ type: 'status', id: selected.finding.id, status })}
                      onNote={(note) => dispatch({ type: 'note', id: selected.finding.id, note })}
                      onReport={(inReport) => dispatch({ type: 'report', id: selected.finding.id, inReport })}
                      onLocate={() => locate(selected.finding.id)}
                      onClose={() => dispatch({ type: 'select', id: null })}
                    />
                  ) : null}
                </div>
                {audit.result ? <AuditFooter result={audit.result} inReport={findings.views.filter((view) => view.inReport).length} /> : null}
              </>
            ) : null}

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

function AuditFooter({
  result,
  inReport,
}: {
  result: NonNullable<ReturnType<typeof useAudit>['result']>;
  inReport: number;
}): React.ReactElement {
  return (
    <p className="hint">
      Scanned {result.audit.elementsScanned} elements, {result.audit.categories.length} categor
      {result.audit.categories.length === 1 ? 'y' : 'ies'}.
      {inReport > 0 ? ` ${inReport} in report.` : ''}
      {result.suppressed > 0 ? ` ${result.suppressed} lower-ranked findings not shown.` : ''}
      {result.audit.truncated ? ' The page exceeded the element budget, so some elements were not scanned.' : ''}
      {result.failedRules.length > 0 ? ` Rules that could not run: ${result.failedRules.join(', ')}.` : ''}
    </p>
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
