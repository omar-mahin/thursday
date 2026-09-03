import type { ElementReference, ElementSnapshot } from './element';
import type { Rect, Viewport } from './geometry';

export type AuditCategory = 'a11y' | 'ui' | 'ux' | 'content' | 'cro' | 'responsive';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Kept from spec sections 20-21 even though this build only ever emits 'rule'
 * and 'heuristic'. Phase 2 adds findings to this schema instead of migrating it.
 */
export type FindingType = 'rule' | 'heuristic' | 'inference' | 'recommendation';

export type FindingStatus = 'open' | 'accepted' | 'dismissed' | 'resolved';

export type AuditStage = 'snapshot' | 'structure' | 'accessibility' | 'visual' | 'content' | 'done';

/**
 * Page-level facts that need the CSSOM rather than a single element. Cross-origin
 * stylesheets throw on access, so what could not be read is counted rather than
 * guessed at (PLAN.md section 2.3 applies to focus styles too).
 */
export type StyleSheetFacts = {
  readableSheets: number;
  unreadableSheets: number;
  /** Rules that remove the focus ring, e.g. `:focus { outline: none }`. */
  focusOutlineResets: number;
  /** Rules that put a visible indicator back. */
  focusIndicatorRules: number;
};

export type PageSnapshot = {
  /**
   * Identifies this capture. Pins carry it so the page can tell whether the
   * elements it measured are the ones a pin was computed against: after a
   * second audit, or after restoring a saved one, an element index from
   * another snapshot points at an arbitrary element.
   */
  id: string;
  capturedAt: number;
  /** How long collection took. Surfaced in the report, and budgeted in tests. */
  durationMs: number;
  url: string;
  origin: string;
  title: string;
  viewport: Viewport;
  elements: ElementSnapshot[];
  /** True when the element cap was hit. Surfaced in the report, not hidden. */
  truncated: boolean;
  /** Frames enumerated but not entered. Both counts are reported to the user. */
  crossOriginFrames: number;
  sameOriginFrames: number;
  lang: string | null;
  styleSheets: StyleSheetFacts;
};

/**
 * What a rule emits. The engine, not the rule, assigns ids, computes severity
 * and attaches the element reference -- so a rule stays a pure statement about
 * evidence (PLAN.md section 6).
 */
export type RawFinding = {
  ruleId: string;
  category: AuditCategory;
  type: FindingType;
  title: string;
  summary: string;
  /** Observable facts. A finding with no evidence is not a finding. */
  evidence: string[];
  impact: string;
  recommendation: string;
  /** Index into PageSnapshot.elements. */
  elementIndex?: number;
  /** Other elements the finding is about, e.g. the buttons being compared. */
  relatedIndexes?: number[];
  /** Set only when a rule has evidence that changes the default severity. */
  severity?: Severity;
  /** Machine-readable measurements, kept for the report and for exports. */
  measurements?: Record<string, number | string | boolean>;
};

export type Finding = {
  id: string;
  auditId: string;
  ruleId: string;
  category: AuditCategory;
  type: FindingType;
  title: string;
  severity: Severity;
  confidence: number;
  summary: string;
  evidence: string[];
  impact: string;
  recommendation: string;
  elementRef?: ElementReference;
  /**
   * Index into the snapshot this finding came from. Valid for that snapshot
   * only -- it is the fast path for pins in the current session, never an
   * identity that survives a reload. `elementRef` is what persists.
   */
  elementIndex?: number;
  measurements?: Record<string, number | string | boolean>;
  status: FindingStatus;
  /** The user's own words, kept with the finding and shown in the report. */
  note?: string;
  /** Whether the user picked this finding for the report. */
  inReport?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AuditOptions = {
  categories: AuditCategory[];
  /** Thresholds the user can change (options page). */
  settings: AuditSettings;
};

export type AuditSettings = {
  minTouchTarget: number;
  vaguePhrases: string[];
};

export type Audit = {
  id: string;
  url: string;
  origin: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  viewportWidth: number;
  viewportHeight: number;
  categories: AuditCategory[];
  status: 'active' | 'completed' | 'archived';
  findingIds: string[];
  /** Honest reporting when the element cap was hit (PLAN.md section 5). */
  truncated: boolean;
  elementsScanned: number;
  /**
   * What the audit could not look at.
   *
   * PLAN.md section 5 originally called for one `info` finding per frame. That
   * was wrong: a finding is a claim about the page, and "we could not look in
   * here" is a claim about the audit. Mixing them puts items in the findings
   * list that nobody can act on, and makes them compete for slots with real
   * defects under the per-audit cap. So coverage is reported as coverage.
   */
  framesNotInspected: { crossOrigin: number; sameOrigin: number };
};

/**
 * A pin the page should draw.
 *
 * `elementIndex` is the fast path: right after an audit the content script still
 * holds the live elements it measured, so a pin resolves in O(1). `ref` is the
 * fallback for when that element is gone -- a reload, or an SPA that replaced
 * the view -- and a pin resolved that way is drawn as approximate.
 */
export type Pin = {
  findingId: string;
  /** The snapshot `elementIndex` refers to. See PageSnapshot.id. */
  snapshotId: string;
  ordinal: number;
  severity: Severity;
  elementIndex: number;
  /** Document-relative, so it survives scrolling. */
  documentRect: Rect;
  ref: ElementReference;
};

/** Where one element sat in the document when the audit ran. */
export type ElementLocation = {
  index: number;
  documentRect: Rect;
};

/**
 * What survives an audit once the snapshot is gone.
 *
 * Storing 1500 fully-measured elements to reopen one audit would cost megabytes
 * for facts nothing reads back. The digest keeps only what a reopened audit
 * actually needs: the page it described, and where the pinned elements were.
 * Re-finding those elements on a live page is the resolution ladder's job, and
 * `Finding.elementRef` already carries what it needs.
 */
export type PageSnapshotDigest = {
  snapshotId: string;
  capturedAt: number;
  url: string;
  origin: string;
  title: string;
  viewport: Viewport;
  /** Elements in the original snapshot, so a reopened audit can say how much it saw. */
  elementCount: number;
  truncated: boolean;
  /** Only the elements a finding points at. */
  locations: ElementLocation[];
};

/** An audit as stored: the record plus the digest that makes it reopenable. */
export type AuditRecord = Audit & { digest: PageSnapshotDigest };

export type { ElementReference };
