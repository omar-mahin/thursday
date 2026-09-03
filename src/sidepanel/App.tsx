import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { PRODUCT_VERSION } from '../../manifest.config';
import { PRODUCT_NAME } from '../shared/constants/product';
import { FLAGS } from '../shared/constants/flags';
import { displayOrigin } from '../shared/utils/url';
import { countBySeverity } from '../audit/engine/run';
import { carryAnnotations, compareAudits, type AuditDiff } from '../audit/engine/compare';
import { renderReport, reportFileName } from '../report/render';
import { auditFileName, buildAuditFile, serializeAuditFile } from '../storage/file';
import { saveFile } from '../storage/download';
import type { Audit, Finding, Severity } from '../shared/types';
import { usePageConnection } from './state/usePageConnection';
import { useAudit } from './state/useAudit';
import { useLibrary, type ActiveAudit } from './state/useLibrary';
import { useScreenshots } from './state/useScreenshots';
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
import { CompareCard } from './components/CompareCard';
import { HistoryCard } from './components/HistoryCard';
import { FilesCard } from './components/FilesCard';
import { ElementInspector } from './components/ElementInspector';
import { HoverReadout } from './components/HoverReadout';
import { MessageLog } from './components/MessageLog';

type Tab = 'audit' | 'element';

const EMPTY_COUNTS: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

type Baseline = { audit: Audit; findings: Finding[] };

export function App(): React.ReactElement {
  const { page, log, send } = usePageConnection();
  const audit = useAudit(page.snapshot, send);
  const [findings, dispatch] = useReducer(reduce, EMPTY_STATE);
  const [tab, setTab] = useState<Tab>('audit');
  const [active, setActive] = useState<ActiveAudit | null>(null);
  const [diff, setDiff] = useState<{ diff: AuditDiff; baselineAt: number } | null>(null);
  /** A file is being written. The picker gives no feedback of its own. */
  const [saving, setSaving] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const origin = useMemo(() => {
    if (!page.url) return null;
    try {
      return new URL(page.url).origin;
    } catch {
      return null;
    }
  }, [page.url]);

  const library = useLibrary(origin);
  const shots = useScreenshots(active?.audit.id ?? null, send, page.elementRect);

  /**
   * What the panel is showing, as of the last committed render.
   *
   * A fresh audit is compared against this, so the comparison sees the user's
   * dismissals and notes rather than the audit as it was first produced. The
   * effect that maintains it is declared after the one that consumes it, which
   * is what makes "the previous audit" available while the new one is adopted.
   */
  const shown = useRef<Baseline | null>(null);

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

  /**
   * A finished audit becomes the active one.
   *
   * If something was already open for the same origin, the new run inherits
   * the user's statuses and notes and produces a diff. Re-running an audit
   * should not resurrect everything the user already dismissed, and it should
   * say what actually changed.
   */
  useEffect(() => {
    const result = audit.result;
    if (!result) return;
    const previous = shown.current;
    const comparable =
      previous && previous.audit.origin === result.audit.origin && previous.audit.id !== result.audit.id
        ? previous
        : null;
    const findings = comparable ? carryAnnotations(comparable.findings, result.findings) : result.findings;

    const next: ActiveAudit = {
      source: 'live',
      audit: result.audit,
      digest: result.digest,
      findings,
      suppressed: result.suppressed,
      failedRules: result.failedRules,
      persisted: false,
      openedAt: Date.now(),
    };
    setActive(next);
    setDiff(
      comparable ? { diff: compareAudits(comparable.findings, findings), baselineAt: comparable.audit.createdAt } : null,
    );
    void library.persist(next).then((persisted) => {
      if (persisted) setActive((current) => (current?.audit.id === next.audit.id ? { ...current, persisted } : current));
    });
    // library.persist is stable; depending on it would re-run this on refresh.
  }, [audit.result]);

  // Whatever is active drives the list. Keyed on when it was opened, not on
  // the object: marking an audit as saved must not reload it and throw away
  // whatever the user had selected.
  const loadedAt = useRef<number | null>(null);
  useEffect(() => {
    const opened = active?.openedAt ?? null;
    if (loadedAt.current === opened) return;
    loadedAt.current = opened;
    dispatch({ type: 'load', findings: active?.findings ?? [] });
  }, [active]);

  const visible = useMemo(() => filterViews(findings), [findings]);
  const pins = useMemo(() => pinsFor(visible, active?.digest ?? null), [visible, active?.digest]);
  const ordinals = useMemo(() => ordinalsOf(pins), [pins]);
  const counts = useMemo(
    () => (findings.views.length === 0 ? EMPTY_COUNTS : countBySeverity(findings.views.map((view) => view.finding))),
    [findings.views],
  );
  const statusCounts = useMemo(() => countByStatus(findings.views), [findings.views]);
  const closedCount = statusCounts.dismissed + statusCounts.resolved;
  const selected = visible.find((view) => view.finding.id === findings.selectedId) ?? null;
  const inReport = findings.views.filter((view) => view.inReport);

  /**
   * The findings with the user's edits folded back in.
   *
   * The reducer owns status, note and report membership while the panel is
   * open; `active.findings` stays the audit as it was produced. Merging here
   * means an export, a comparison and a saved file all see the same thing the
   * screen does, without the reducer having to write back on every keystroke.
   */
  const merged = useMemo<Finding[]>(
    () =>
      findings.views.map((view) => {
        const finding: Finding = { ...view.finding, status: view.status };
        if (view.note) finding.note = view.note;
        else delete finding.note;
        if (view.inReport) finding.inReport = true;
        else delete finding.inReport;
        return finding;
      }),
    [findings.views],
  );

  useEffect(() => {
    shown.current = active ? { audit: active.audit, findings: merged } : null;
  }, [active, merged]);

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

  /**
   * One place where an annotation is both shown and stored.
   *
   * The reducer stays pure -- it only knows about the panel -- so the write
   * happens here, and only for an audit that is actually in history. Editing a
   * finding from an imported file changes the panel and the next export, not
   * somebody else's stored audit.
   */
  const annotate = useCallback(
    (id: string, patch: { status?: Finding['status']; note?: string; inReport?: boolean }) => {
      if (active?.persisted) library.annotate(id, patch);
    },
    [active?.persisted, library],
  );

  const setStatus = useCallback(
    (id: string, status: Finding['status']) => {
      dispatch({ type: 'status', id, status });
      annotate(id, { status });
    },
    [annotate],
  );

  const setNote = useCallback(
    (id: string, note: string) => {
      dispatch({ type: 'note', id, note });
      annotate(id, { note });
    },
    [annotate],
  );

  const setInReport = useCallback(
    (id: string, value: boolean) => {
      dispatch({ type: 'report', id, inReport: value });
      annotate(id, { inReport: value });
    },
    [annotate],
  );

  const adopt = useCallback(
    (next: ActiveAudit | null) => {
      if (!next) return;
      audit.clear();
      setDiff(null);
      setActive(next);
      setTab('audit');
    },
    [audit],
  );

  const saveAuditFile = useCallback(() => {
    if (!active || saving) return;
    setSaving(true);
    void (async () => {
      try {
        const screenshots = await shots.dataUrls();
        const file = buildAuditFile({
          audit: active.audit,
          findings: merged,
          digest: active.digest,
          productVersion: PRODUCT_VERSION,
          screenshots,
        });
        const outcome = await saveFile(
          auditFileName(active.audit),
          'application/json',
          ['.json'],
          serializeAuditFile(file),
        );
        if (outcome.saved) library.note('Audit saved.');
        else if (!outcome.cancelled) library.note(outcome.reason);
      } finally {
        setSaving(false);
      }
    })();
  }, [active, library, merged, saving, shots]);

  const saveReportFile = useCallback(() => {
    if (!active || saving) return;
    setSaving(true);
    void (async () => {
      try {
        // What the user picked, or everything if they picked nothing. A report
        // with no findings in it would be a strange thing to hand someone.
        const chosen =
          inReport.length > 0
            ? merged.filter((finding) => inReport.some((view) => view.finding.id === finding.id))
            : merged;
        const screenshots = await shots.dataUrls();
        const html = renderReport({
          audit: active.audit,
          findings: chosen,
          digest: active.digest,
          screenshots,
          productVersion: PRODUCT_VERSION,
          generatedAt: Date.now(),
          omitted: merged.length - chosen.length,
        });
        const outcome = await saveFile(reportFileName(active.audit), 'text/html', ['.html'], html);
        if (outcome.saved) {
          library.note(`Report saved with ${chosen.length} finding${chosen.length === 1 ? '' : 's'}.`);
        } else if (!outcome.cancelled) {
          library.note(outcome.reason);
        }
      } finally {
        setSaving(false);
      }
    })();
  }, [active, inReport, library, merged, saving, shots]);

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

            {active && active.source !== 'live' ? <ReopenedBanner active={active} /> : null}

            {diff ? (
              <CompareCard
                diff={diff.diff}
                baselineAt={diff.baselineAt}
                onOpenFinding={openFinding}
                onDismiss={() => setDiff(null)}
              />
            ) : null}

            {active && findings.views.length === 0 ? (
              <div className="empty">
                Nothing found in {active.audit.categories.length} categor
                {active.audit.categories.length === 1 ? 'y' : 'ies'} across {active.audit.elementsScanned}{' '}
                elements.
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
                      shot={{
                        enabled: shots.enabled,
                        url: shots.urls[selected.finding.id],
                        capturing: shots.pending === selected.finding.id,
                        error: shots.pending === null ? shots.error : null,
                        onCapture: () => shots.capture(selected.finding),
                        onDiscard: () => shots.discard(selected.finding.id),
                      }}
                      onStatus={(status) => setStatus(selected.finding.id, status)}
                      onNote={(note) => setNote(selected.finding.id, note)}
                      onReport={(value) => setInReport(selected.finding.id, value)}
                      onLocate={() => locate(selected.finding.id)}
                      onClose={() => dispatch({ type: 'select', id: null })}
                    />
                  ) : null}
                </div>
                {active ? <AuditFooter active={active} inReport={inReport.length} /> : null}
              </>
            ) : null}

            <HistoryCard
              library={library.state}
              activeAuditId={active?.audit.id ?? null}
              scoped={origin !== null}
              onOpen={(id) => void library.open(id).then(adopt)}
              onDelete={(id) => void library.remove(id)}
            />

            <FilesCard
              canExport={active !== null}
              reportCount={inReport.length}
              totalCount={findings.views.length}
              busy={library.state.busy || saving}
              saving={saving}
              onSaveAudit={saveAuditFile}
              onSaveReport={saveReportFile}
              onOpenText={(text) => void library.importText(text).then(adopt)}
            />

            <LibraryMessages library={library} />

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
        <span className="mono">v{PRODUCT_VERSION}</span>
      </footer>
    </div>
  );
}

/**
 * Says plainly that what is on screen is not this page as it is now.
 *
 * Without this the panel looks identical whether the findings came from the
 * live page or from a file someone emailed, and every pin would be trusted as
 * a measurement of the page in front of you.
 */
function ReopenedBanner({ active }: { active: ActiveAudit }): React.ReactElement {
  const at = new Date(active.audit.createdAt).toLocaleString();
  return (
    <p className="notice" role="status">
      {active.source === 'file' ? 'Opened from a file' : 'Reopened from history'} — audited {at}. Pins are
      placed by searching the live page, so they may be approximate. Run an audit to compare.
    </p>
  );
}

function LibraryMessages({ library }: { library: ReturnType<typeof useLibrary> }): React.ReactElement | null {
  const { status, error, warnings } = library.state;
  if (!status && !error && warnings.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {error ? (
        <p className="hint" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      {warnings.map((warning) => (
        <p key={warning} className="hint" style={{ margin: 0 }}>
          {warning}
        </p>
      ))}
      {status ? (
        <p className="hint" role="status" style={{ margin: 0 }}>
          {status}{' '}
          <button type="button" className="link" onClick={library.dismissMessages}>
            Dismiss
          </button>
        </p>
      ) : null}
    </div>
  );
}

function AuditFooter({ active, inReport }: { active: ActiveAudit; inReport: number }): React.ReactElement {
  return (
    <p className="hint">
      Scanned {active.audit.elementsScanned} elements, {active.audit.categories.length} categor
      {active.audit.categories.length === 1 ? 'y' : 'ies'}.
      {inReport > 0 ? ` ${inReport} in report.` : ''}
      {active.suppressed > 0 ? ` ${active.suppressed} lower-ranked findings not shown.` : ''}
      {active.audit.truncated ? ' The page exceeded the element budget, so some elements were not scanned.' : ''}
      {framesNote(active.audit)}
      {active.failedRules.length > 0 ? ` Rules that could not run: ${active.failedRules.join(', ')}.` : ''}
      {active.source === 'live' && !active.persisted ? ' Not saved to history.' : ''}
    </p>
  );
}

/**
 * What the audit could not see.
 *
 * Frames are enumerated and never entered, so a page built out of iframes gets
 * a thin audit. Saying nothing would let that read as a clean page.
 */
export function framesNote(audit: Audit): string {
  const { crossOrigin, sameOrigin } = audit.framesNotInspected;
  const total = crossOrigin + sameOrigin;
  if (total === 0) return '';
  const frames = `${total} embedded frame${total === 1 ? '' : 's'}`;
  const detail = crossOrigin > 0 && sameOrigin > 0 ? ` (${crossOrigin} from another origin)` : '';
  return ` ${frames}${detail} ${total === 1 ? 'was' : 'were'} not looked inside, so anything in ${
    total === 1 ? 'it' : 'them'
  } is not covered.`;
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
