import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { PRODUCT_VERSION } from '../../manifest.config';
import { PRODUCT_NAME } from '../shared/constants/product';
import { displayOrigin } from '../shared/utils/url';
import { countBySeverity } from '../audit/engine/run';
import { carryAnnotations, compareAudits, type AuditDiff } from '../audit/engine/compare';
import { renderReport, reportFileName } from '../report/render';
import { buildAuditPdf, pdfFileName } from '../pdf/report';
import { auditFileName, buildAuditFile, serializeAuditFile } from '../storage/file';
import { saveFile } from '../storage/download';
import { announceComments, carryComments, notesBucketId, NOTES_AT_KEY } from '../storage/annotations';
import { dataUrlToBlob } from '../shared/utils/base64';
import type { AnnotationTarget } from '../shared/messaging/protocol';
import type { Annotation, Audit, Finding, Severity } from '../shared/types';
import { usePageConnection } from './state/usePageConnection';
import { useAudit } from './state/useAudit';
import { useLibrary, type ActiveAudit } from './state/useLibrary';
import { useScreenshots } from './state/useScreenshots';
import { useAnnotations, type AnnotationSource } from './state/useAnnotations';
import {
  closedAnnotations,
  commentPins,
  countByStatus,
  EMPTY_STATE,
  filterViews,
  openIssueCount,
  ordinals as ordinalsOf,
  pinsFor,
  reduce,
} from './state/findings';
import { AuditLauncher } from './components/AuditLauncher';
import { IssuesList } from './components/IssuesList';
import { FindingDetail } from './components/FindingDetail';
import { CompareCard } from './components/CompareCard';
import { HistoryCard } from './components/HistoryCard';
import { FilesCard } from './components/FilesCard';
import { CommentsCard } from './components/CommentsCard';

const EMPTY_COUNTS: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

type Baseline = { audit: Audit; findings: Finding[] };

export function App(): React.ReactElement {
  const { page, send } = usePageConnection();
  const audit = useAudit(page.snapshot, send);
  const [findings, dispatch] = useReducer(reduce, EMPTY_STATE);
  const [active, setActive] = useState<ActiveAudit | null>(null);
  const [diff, setDiff] = useState<{ diff: AuditDiff; baselineAt: number } | null>(null);
  /** A file is being written. The picker gives no feedback of its own. */
  const [saving, setSaving] = useState(false);
  /** Whether history, files and the comparison are showing. Closed by default. */
  const [showMore, setShowMore] = useState(false);
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
  /*
   * One toggle over the whole list, so it has to count the whole list.
   * "Show 3 dismissed or resolved" that only knew about findings would hide
   * a triaged comment with nothing on screen offering to show it again.
   */
  const closedCount =
    statusCounts.dismissed + statusCounts.resolved + closedAnnotations(comments.annotations);
  /** What is left to do, over findings and comments together. */
  const outstanding = useMemo(
    () => openIssueCount(findings.views, comments.annotations),
    [findings.views, comments.annotations],
  );
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
   * A comment stored by another document, seen without being told.
   *
   * chrome.storage is the one thing every document can watch, so the worker
   * announces there as well as over the port. This is the fast path when the
   * worker lives long enough to write it; `revisited` below is what covers the
   * case where it does not.
   */
  const [announced, setAnnounced] = useState(0);
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>): void => {
      if (NOTES_AT_KEY in changes) setAnnounced((count) => count + 1);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  /**
   * Coming back to the panel is a reason to look for comments.
   *
   * Every push notice can be missed. The port one needs a live port at the
   * instant it fires, and on the path where the worker stored the comment
   * precisely because no panel was listening, that is what was not true. The
   * storage one needs the worker to survive long enough to write it -- and a
   * worker that was force-stopped and woken to handle one message does not
   * always: measured, with the comment on disk and the key never set.
   *
   * So the panel also pulls. Looking again when somebody looks at it is the
   * cheapest possible trigger and the one that matches the question being
   * asked: carryComments moves nothing when there is nothing waiting.
   */
  const [revisited, setRevisited] = useState(0);
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') setRevisited((count) => count + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  /**
   * Notes about this site belong to whatever audit is now open.
   *
   * Covers three ways a note can be waiting: written before any audit ran,
   * written while the panel was closed (the service worker stores those), or
   * left over from a re-audit. Same carryComments in every case, and then a
   * re-read so they appear without the panel being reopened.
   *
   * Runs for reopened audits too, not just fresh ones -- a note is about the
   * site, and the audit on screen is the one it should be attached to. And it
   * runs again after every reconnect, because that is exactly when the worker
   * has been storing comments this panel could not be told about.
   *
   * Cheap to repeat: carryComments moves nothing when the bucket is empty.
   */
  useEffect(() => {
    const auditId = active?.audit.id;
    const site = active?.audit.origin;
    if (!auditId || !site) return;
    void carryComments(notesBucketId(site), auditId)
      .then((moved) => {
        if (moved > 0) comments.reload();
      })
      .catch(() => {
        /* nothing to carry, or no storage */
      });
  }, [
    active?.audit.id,
    active?.audit.origin,
    page.reconnects,
    page.commentsChanged,
    announced,
    revisited,
  ]);

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
          // Keyed by the submission, not by chance: the page resends until it
          // is answered and every panel on the page is offered it, so this is
          // what stops one comment becoming several.
          id: submission.submissionId,
          body: submission.body,
          priority: submission.priority,
          author: submission.author,
          target: submission.target,
          files,
          snapshotId: submission.target?.snapshotId ?? null,
        });
        if (saved) handled.current.add(submission.submissionId);
        if (saved) {
          /*
           * Tell the other panels, because there are other panels.
           *
           * Every activated page carries a framed panel now, and a comment
           * written on the page is offered to all of them. The one that answers
           * is whichever heard first -- often the framed panel, which has no
           * audit open, so it files the comment in the site's notes bucket and
           * the panel that does have the audit open never learns there is
           * anything to collect. It showed an empty list with the comment
           * already on disk.
           *
           * The announcement is the same one the worker makes, and the carry it
           * triggers is what puts the comment where it belongs.
           */
          void announceComments();
        }
        send({
          type: 'ANNOTATION_SAVED',
          payload: saved ? { ok: true } : { ok: false, detail: 'That comment could not be saved.' },
        });
        if (saved) {
          setCommentTarget(null);
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

  /** Opening a finding should show it: the detail card sits below a long list. */
  const openFinding = useCallback((id: string) => {
    setOpenComment(null);
    dispatch({ type: 'select', id });
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, []);

  /*
   * One list, one selection.
   *
   * The two used to be independent, which was fine when they lived in separate
   * cards and is not now: a finding's detail card open below the list while a
   * comment two rows up is also marked current gives two answers to "what am I
   * looking at", and the page draws a highlight for whichever it saw last.
   */
  const openCommentRow = useCallback((id: string | null) => {
    setOpenComment(id);
    if (id) dispatch({ type: 'select', id: null });
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
      {/*
        One line, not a card.
 
        This was a product name, an origin, a connection badge, two tabs and a
        PAGE card listing the URL, the viewport and the document size -- most of
        a 380px-wide panel spent before the first finding. The frame around the
        panel already says what this is, the ruler shows sizes on the page, and
        the only thing here somebody acts on is stopping.
      */}
      <header className="panel-head">
        {/*
          A heading the document needs and the design does not.
 
          The frame around this panel carries the visible title, so repeating it
          here spent a line of a 380px window on something already on screen --
          but removing it left the document with no h1 at all, which Thursday's
          own A11Y-005 caught immediately. Hidden, not absent.
        */}
        <h1 className="sr">{PRODUCT_NAME}</h1>
        <span className="head-origin mono truncate">
          {page.url ? displayOrigin(page.url) : 'No page connected'}
        </span>
        {/*
          The one number the merge is for.
 
          Findings and comments were two lists with two counts, so "how much is
          left on this page" had two answers and neither was it. Here, above the
          filters and outside anything that folds away, so it survives scrolling
          a long list and is not changed by a severity filter -- what is
          outstanding is outstanding whether or not you are looking at it.
        */}
        {outstanding > 0 ? (
          <span className="head-count" title="Findings and comments still open">
            {outstanding} open
          </span>
        ) : null}
        {page.activated ? (
          <button type="button" className="link" onClick={() => send({ type: 'DEACTIVATE' })}>
            Stop
          </button>
        ) : (
          <span className="hint">Not running</span>
        )}
      </header>

      <div className="panel-body">
          <div className="stack">
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

            <CommentsCard
              comments={comments}
              activated={page.activated}
              canComment={origin !== null}
              picking={page.annotating}
              target={commentTarget}
              onPick={() => send({ type: 'START_ANNOTATION', payload: { anchored: true } })}
              onPickPage={() => send({ type: 'START_ANNOTATION', payload: { anchored: false } })}
              onCancelPick={() => send({ type: 'CANCEL_ANNOTATION' })}
              onClearTarget={() => setCommentTarget(null)}
            />

            {active && findings.views.length === 0 && comments.annotations.length === 0 ? (
              <div className="empty">
                Nothing found in {active.audit.categories.length} categor
                {active.audit.categories.length === 1 ? 'y' : 'ies'} across {active.audit.elementsScanned}{' '}
                elements.
              </div>
            ) : null}

            {findings.views.length > 0 || comments.annotations.length > 0 ? (
              <>
                <IssuesList
                  views={visible}
                  annotations={comments.annotations}
                  comments={comments}
                  counts={counts}
                  severities={findings.severities}
                  showClosed={findings.showClosed}
                  closedCount={closedCount}
                  selectedId={findings.selectedId}
                  openComment={openComment}
                  ordinals={ordinals}
                  onSelect={openFinding}
                  onSelectComment={openCommentRow}
                  onLocateComment={locateComment}
                  onCommentStatus={(id, status) => void comments.setStatus(id, status)}
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

            <LibraryMessages library={library} />

            {/*
              Everything you need occasionally, folded away.
 
              History, files and the comparison are the point of the tool but
              not the thing you look at while working through a list, and in a
              380px window they pushed the findings off the bottom. One
              disclosure, closed by default, remembered for the session.
            */}
            {/*
              A button and a region, not a native details/summary.
 
              The native pair was here first and Thursday's own UX-004 flagged
              it: the `details` element reads as keyboard-focusable and
              clickable while carrying no button or link role and no pointer
              cursor, which is exactly the confusion that rule is for. An
              explicit button with aria-expanded says the same thing to a
              screen reader and to the rule.
            */}
            <div className="more" data-open={showMore ? 'true' : 'false'}>
              <button
                type="button"
                className="more-toggle"
                aria-expanded={showMore}
                aria-controls="panel-more"
                onClick={() => setShowMore((open) => !open)}
              >
                History, files and comparison
              </button>
              <div id="panel-more" className="stack" hidden={!showMore}>
                {diff ? (
                  <CompareCard
                    diff={diff.diff}
                    baselineAt={diff.baselineAt}
                    onOpenFinding={openFinding}
                    onDismiss={() => setDiff(null)}
                  />
                ) : null}

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

                <HistoryCard
                  library={library.state}
                  activeAuditId={active?.audit.id ?? null}
                  scoped={origin !== null}
                  onOpen={(id) => void library.open(id).then(adopt)}
                  onDelete={(id) => void library.remove(id)}
                />

                <p className="hint" style={{ margin: 0 }}>
                  {PRODUCT_NAME} v{PRODUCT_VERSION} — local only, nothing leaves this browser.
                </p>
              </div>
            </div>
          </div>
      </div>
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

