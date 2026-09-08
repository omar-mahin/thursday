import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { PRODUCT_VERSION } from '../../manifest.config';
import { PRODUCT_NAME } from '../shared/constants/product';
import { FLAGS } from '../shared/constants/flags';
import { displayOrigin } from '../shared/utils/url';
import { countBySeverity } from '../audit/engine/run';
import { carryAnnotations, compareAudits, type AuditDiff } from '../audit/engine/compare';
import { renderReport, reportFileName } from '../report/render';
import { buildAuditPdf, pdfFileName } from '../pdf/report';
import { auditFileName, buildAuditFile, serializeAuditFile } from '../storage/file';
import { saveFile } from '../storage/download';
import { carryComments, notesBucketId } from '../storage/annotations';
import { dataUrlToBlob } from '../shared/utils/base64';
import type { AnnotationTarget } from '../shared/messaging/protocol';
import type { Annotation, Audit, Finding, Severity } from '../shared/types';
import { usePageConnection } from './state/usePageConnection';
import { useAudit } from './state/useAudit';
import { useLibrary, type ActiveAudit } from './state/useLibrary';
import { useScreenshots } from './state/useScreenshots';
import { useAnnotations, type AnnotationSource } from './state/useAnnotations';
import {
  commentPins,
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
import { CommentsCard } from './components/CommentsCard';
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
  /** The comment whose pin is highlighted, if it is a comment rather than a finding. */
  const [openComment, setOpenComment] = useState<string | null>(null);
  /** The element the user last picked to comment on, until they use it. */
  const [commentTarget, setCommentTarget] = useState<AnnotationTarget | null>(null);
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
  const shots = useScreenshots(active?.audit.id ?? null, send, page.elementRect, page.band);

  /**
   * Where the comments on screen come from.
   *
   * Rebuilt whenever `active` changes, but only `auditId` and `openedAt` are
   * read as the reload key -- so marking an audit as saved does not look like
   * a new audit and discard what somebody just typed.
   */
  const commentSource = useMemo<AnnotationSource | null>(() => {
    if (active) {
      return {
        auditId: active.audit.id,
        openedAt: active.openedAt,
        persisted: active.persisted,
        imported: active.annotations
          ? { annotations: active.annotations, attachments: active.attachments ?? {} }
          : null,
      };
    }
    /*
     * No audit open, so notes go to this origin's own bucket.
     *
     * Requiring an audit before somebody may write down what they noticed was
     * an implementation detail leaking into the product -- and it read as a
     * refusal, twice. The next audit of this origin adopts whatever is in here.
     *
     * `openedAt` is fixed rather than a timestamp: it is the hook's reload key,
     * and a fresh value on every render would throw away what is being typed.
     */
    return origin
      ? { auditId: notesBucketId(origin), openedAt: 0, persisted: true, imported: null }
      : null;
  }, [active, origin]);
  const comments = useAnnotations(commentSource);

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
    if (page.lastToolbarAction?.action === 'inspect') setTab('element');
  }, [page.lastToolbarAction]);
  /*
   * Audit on the toolbar runs the audit, rather than only revealing the tab
   * that holds the button that runs it.
   *
   * Revealing was all it used to do, which made it a button that did nothing
   * whenever the panel was already on that tab -- and the panel opens on that
   * tab. A magnifier labelled "Audit" has to audit.
   */
  useEffect(() => {
    if (page.lastToolbarAction?.action !== 'audit') return;
    setTab('audit');
    if (page.activated && !audit.running) audit.start();
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
    void (async () => {
      /*
       * Comments move to the new audit before it goes on screen.
       *
       * Order matters and is the whole reason this is not two statements: the
       * comments hook reloads when the active audit id changes, so a carry
       * that finished afterwards would be invisible until the panel was
       * reopened, and one that finished during would race the read.
       */
      if (comparable) {
        await carryComments(comparable.audit.id, result.audit.id).catch(() => {
          /* nothing stored, or no storage: the audit still opens */
        });
      }
      // Notes written before this audit existed belong to it now. Same
      // mechanism as carrying comments across a re-audit.
      if (result.audit.origin) {
        await carryComments(notesBucketId(result.audit.origin), result.audit.id).catch(() => {
          /* nothing to carry, or no storage */
        });
      }
      setActive(next);
      setDiff(
        comparable
          ? { diff: compareAudits(comparable.findings, findings), baselineAt: comparable.audit.createdAt }
          : null,
      );
      const persisted = await library.persist(next);
      if (persisted) {
        setActive((current) =>
          current?.audit.id === next.audit.id ? { ...current, persisted } : current,
        );
      }
    })();
    // library.persist is stable; depending on it would re-run this on refresh.
  }, [audit.result]);

  /**
   * Photographs the findings, once, as soon as an audit is on screen.
   *
   * A separate effect rather than the tail of the one above, and the reason is
   * ordering rather than tidiness: the screenshot hook learns which audit to
   * file crops under from a render, so starting the sweep inside that effect
   * would write every picture against the *previous* audit's id. Waiting for
   * the render that follows `setActive` is what makes them land in the right
   * place.
   *
   * Only for a live audit -- one reopened from history has its crops already,
   * and the page in front of the user may be nothing to do with it.
   */
  const swept = useRef<string | null>(null);
  useEffect(() => {
    if (!active || active.source !== 'live' || !shots.enabled) return;
    if (!page.activated || !page.snapshot) return;
    if (swept.current === active.audit.id) return;
    swept.current = active.audit.id;
    void shots.captureAll(active.findings, page.snapshot);
    // shots.captureAll is stable, and re-running on findings changing would
    // re-photograph the page every time somebody dismisses a row.
  }, [active?.audit.id, shots.enabled, page.activated]);

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
  const findingPinList = useMemo(() => pinsFor(visible, active?.digest ?? null), [visible, active?.digest]);
  const commentPinList = useMemo(
    () => commentPins(comments.annotations, active?.digest ?? null),
    [comments.annotations, active?.digest],
  );
  // One draw for both series. The page distinguishes them by `kind`, and their
  // ordinals are independent, so a merge here is only a concatenation.
  const pins = useMemo(() => [...findingPinList, ...commentPinList], [findingPinList, commentPinList]);
  const ordinals = useMemo(() => ordinalsOf(findingPinList), [findingPinList]);
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
  const pinKey = pins.map((pin) => `${pin.kind}:${pin.targetId}:${pin.ordinal}:${pin.severity ?? ''}`).join('|');
  useEffect(() => {
    if (!page.activated) return;
    if (pins.length === 0) send({ type: 'CLEAR_PINS' });
    else send({ type: 'RENDER_PINS', payload: { pins } });
    // pinKey stands in for the pins array: a new array of identical pins should
    // not cost the page a re-render.
  }, [pinKey, page.activated]);

  /**
   * Exactly one pin is highlighted at a time.
   *
   * A comment being open takes precedence because opening one is always the
   * more recent action: selecting a finding clears it. Two highlighted pins
   * would leave the user working out which one the panel is describing.
   */
  const activePin = openComment ?? findings.selectedId;
  useEffect(() => {
    if (!page.activated) return;
    send({ type: 'SET_ACTIVE_PIN', payload: { targetId: activePin } });
  }, [activePin, page.activated]);

  // A pin click on the page opens that finding, or that comment, here.
  useEffect(() => {
    if (!page.pinClicked) return;
    setTab('audit');
    if (page.pinClicked.kind === 'comment') {
      setOpenComment(page.pinClicked.targetId);
      return;
    }
    setOpenComment(null);
    dispatch({ type: 'select', id: page.pinClicked.targetId });
    detailRef.current?.scrollIntoView({ block: 'nearest' });
  }, [page.pinClicked]);

  // The page reports the element the user clicked; hold it for the compose box.
  useEffect(() => {
    if (page.annotationTarget) setCommentTarget(page.annotationTarget);
  }, [page.annotationTarget]);

  /**
   * A comment finished on the page becomes a stored comment here.
   *
   * The page gathers and the panel stores, so there is one implementation of
   * attachments and one of the annotation schema. The page is told the outcome
   * either way: its card stays open with the reason when a save fails, which is
   * the only way the user gets to keep what they typed.
   */
  /**
   * Submissions already dealt with, by their own id.
   *
   * The page resends until it hears back, because either half of the round trip
   * can be down. That makes delivery at-least-once, so this is what keeps
   * at-least-once from meaning two identical comments -- and the acknowledgement
   * is sent again for a repeat, because the thing that went missing may well
   * have been the acknowledgement rather than the submission.
   */
  const handled = useRef(new Set<string>());
  const stored = useRef(0);
  useEffect(() => {
    const submission = page.submitted;
    if (!submission || submission.at === stored.current) return;
    stored.current = submission.at;
    if (handled.current.has(submission.submissionId)) {
      send({ type: 'ANNOTATION_SAVED', payload: { ok: true } });
      return;
    }
    void (async () => {
      try {
        const files = await Promise.all(
          submission.images.map(async (image, index) => {
            const blob = dataUrlToBlob(image.dataUrl);
            if (!blob) throw new Error('An attached image did not survive the trip from the page.');
            return new File([blob], image.name || `pasted-${index + 1}`, { type: image.mime });
          }),
        );
        const saved = await comments.add({
          body: submission.body,
          priority: submission.priority,
          author: submission.author,
          target: submission.target,
          files,
          snapshotId: submission.target?.snapshotId ?? null,
        });
        if (saved) handled.current.add(submission.submissionId);
        send({
          type: 'ANNOTATION_SAVED',
          payload: saved ? { ok: true } : { ok: false, detail: 'That comment could not be saved.' },
        });
        if (saved) {
          setCommentTarget(null);
          setTab('audit');
        }
      } catch (error) {
        send({
          type: 'ANNOTATION_SAVED',
          payload: {
            ok: false,
            detail: error instanceof Error ? error.message : 'That comment could not be saved.',
          },
        });
      }
    })();
  }, [page.submitted]);

  // Pressing Comment on the page toolbar has to bring the panel to the card.
  useEffect(() => {
    if (page.lastToolbarAction?.action === 'comment') setTab('audit');
  }, [page.lastToolbarAction]);

  /** Opening a finding should show it: the detail card sits below a long list. */
  const openFinding = useCallback((id: string) => {
    setOpenComment(null);
    dispatch({ type: 'select', id });
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, []);

  /** Jumps the page to a comment's anchor, when it has one. */
  const locateComment = useCallback(
    (annotation: Annotation) => {
      if (annotation.elementRef) send({ type: 'FOCUS_ELEMENT', payload: { ref: annotation.elementRef } });
    },
    [send],
  );

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
      setOpenComment(null);
      setCommentTarget(null);
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
        const [screenshots, attachments] = await Promise.all([shots.dataUrls(), comments.dataUrls()]);
        const file = buildAuditFile({
          audit: active.audit,
          findings: merged,
          digest: active.digest,
          productVersion: PRODUCT_VERSION,
          screenshots,
          annotations: comments.annotations,
          attachments,
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
  }, [active, comments, library, merged, saving, shots]);

  /**
   * The findings the user chose, or all of them if they chose none.
   *
   * A report with nothing in it would be a strange thing to hand someone, and
   * "select nothing" is far more likely to mean "I have not got to that yet"
   * than "send an empty report".
   */
  const chosenForReport = useCallback(
    (): Finding[] =>
      inReport.length > 0
        ? merged.filter((finding) => inReport.some((view) => view.finding.id === finding.id))
        : merged,
    [inReport, merged],
  );

  const saveReportFile = useCallback(() => {
    if (!active || saving) return;
    setSaving(true);
    void (async () => {
      try {
        const chosen = chosenForReport();
        const [screenshots, attachments] = await Promise.all([shots.dataUrls(), comments.dataUrls()]);
        const html = renderReport({
          audit: active.audit,
          findings: chosen,
          digest: active.digest,
          screenshots,
          annotations: comments.annotations,
          attachments,
          productVersion: PRODUCT_VERSION,
          generatedAt: Date.now(),
          omitted: merged.length - chosen.length,
        });
        const outcome = await saveFile(reportFileName(active.audit), 'text/html', ['.html'], html);
        if (outcome.saved) library.note(describeSaved('Report', chosen.length, comments.annotations.length));
        else if (!outcome.cancelled) library.note(outcome.reason);
      } finally {
        setSaving(false);
      }
    })();
  }, [active, chosenForReport, comments, library, merged, saving, shots]);

  /**
   * The same report as a PDF.
   *
   * Both are offered rather than one, because they are good at different
   * things. The HTML file carries any alphabet and reads well on a screen; the
   * PDF is what gets attached to a ticket or printed for a review, and its
   * built-in fonts cannot draw every script -- which the PDF says on itself
   * when it happens rather than leaving the reader to wonder.
   */
  const savePdfReport = useCallback(() => {
    if (!active || saving) return;
    setSaving(true);
    void (async () => {
      try {
        const chosen = chosenForReport();
        const [screenshots, attachments] = await Promise.all([shots.pdfImages(), comments.pdfImages()]);
        const bytes = buildAuditPdf({
          audit: active.audit,
          findings: chosen,
          digest: active.digest,
          annotations: comments.annotations,
          screenshots,
          attachments,
          productVersion: PRODUCT_VERSION,
          generatedAt: Date.now(),
          omitted: merged.length - chosen.length,
        });
        const outcome = await saveFile(pdfFileName(active.audit), 'application/pdf', ['.pdf'], bytes);
        if (outcome.saved) library.note(describeSaved('PDF', chosen.length, comments.annotations.length));
        else if (!outcome.cancelled) library.note(outcome.reason);
      } catch (error) {
        library.note(error instanceof Error ? error.message : 'The PDF could not be written.');
      } finally {
        setSaving(false);
      }
    })();
  }, [active, chosenForReport, comments, library, merged, saving, shots]);

  // Escape closes the open finding, per spec section 38.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (page.selecting) {
        send({ type: 'CANCEL_SELECTION' });
        return;
      }
      if (page.annotating) {
        send({ type: 'CANCEL_ANNOTATION' });
        return;
      }
      if (openComment) {
        setOpenComment(null);
        return;
      }
      if (findings.selectedId) dispatch({ type: 'select', id: null });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [findings.selectedId, openComment, page.annotating, page.selecting, send]);

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

            {shots.sweep ? (
              /*
               * Said out loud, because the page is visibly scrolling on its own
               * while this runs. Unexplained movement in somebody's browser
               * reads as a bug however good the reason is.
               */
              <div className="progress" role="status">
                <span className="spinner" aria-hidden="true" />
                Photographing findings — screenful {shots.sweep.done} of {shots.sweep.total}
              </div>
            ) : null}

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

            <CommentsCard
              comments={comments}
              activated={page.activated}
              canComment={origin !== null}
              picking={page.annotating}
              target={commentTarget}
              activeId={openComment}
              onPick={() => send({ type: 'START_ANNOTATION', payload: { anchored: true } })}
              onPickPage={() => send({ type: 'START_ANNOTATION', payload: { anchored: false } })}
              onCancelPick={() => send({ type: 'CANCEL_ANNOTATION' })}
              onClearTarget={() => setCommentTarget(null)}
              onSelect={setOpenComment}
              onLocate={locateComment}
            />

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
              commentCount={comments.annotations.length}
              busy={library.state.busy || saving}
              saving={saving}
              onSaveAudit={saveAuditFile}
              onSaveReport={saveReportFile}
              onSavePdf={savePdfReport}
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

/** "Report saved with 12 findings and 3 comments." */
function describeSaved(what: string, findings: number, comments: number): string {
  const parts = [`${findings} finding${findings === 1 ? '' : 's'}`];
  if (comments > 0) parts.push(`${comments} comment${comments === 1 ? '' : 's'}`);
  return `${what} saved with ${parts.join(' and ')}.`;
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
