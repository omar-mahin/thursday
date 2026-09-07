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
 * What a pin on the page points at.
 *
 * Findings and comments both get pins, and they are not interchangeable: a
 * finding pin is a measurement Thursday made, a comment pin is something a
 * person wrote. They are numbered in separate series and drawn differently, so
 * nobody reads their own note back as a machine finding.
 */
export type PinKind = 'finding' | 'comment';

/**
 * A pin the page should draw.
 *
 * `elementIndex` is the fast path: right after an audit the content script still
 * holds the live elements it measured, so a pin resolves in O(1). `ref` is the
 * fallback for when that element is gone -- a reload, or an SPA that replaced
 * the view -- and a pin resolved that way is drawn as approximate.
 */
export type Pin = {
  /**
   * The finding or annotation this pin belongs to.
   *
   * Named for what it is rather than `findingId`: once comments have pins too,
   * a field called `findingId` holding an annotation id is the kind of small
   * lie that survives for years and costs an afternoon to unpick.
   */
  targetId: string;
  kind: PinKind;
  /** The snapshot `elementIndex` refers to. See PageSnapshot.id. */
  snapshotId: string;
  ordinal: number;
  /**
   * Findings only.
   *
   * Absent on a comment rather than defaulted to `info`: a placeholder here
   * would be a severity the user never assigned, sitting on the same ladder as
   * measured ones and one careless render away from being shown.
   */
  severity?: Severity;
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

// -- annotations -----------------------------------------------------------

/**
 * An image the user attached to a comment.
 *
 * The bytes live in IndexedDB rather than here, because a comment list has to
 * be drawable without paging every attached screenshot into memory. What stays
 * inline is the metadata a list needs: enough to show a row, a size, and an
 * alt text that says what the picture is of.
 */
export type AnnotationAttachment = {
  id: string;
  annotationId: string;
  auditId: string;
  /** Always an image type this build can decode: PNG, JPEG or WebP. */
  mime: string;
  bytes: number;
  width: number;
  height: number;
  /** The user's own description. Becomes the alt text in the report. */
  caption?: string;
  /** Where the image came from. A file the user chose, or something pasted. */
  source: 'file' | 'paste';
  createdAt: number;
};

/**
 * A comment the user wrote on a page.
 *
 * Deliberately not a Finding. A finding is a claim Thursday can defend with a
 * measurement, and mixing the two would let "this headline feels weak" sit in
 * the same list, under the same severity ladder, as a contrast ratio -- which
 * is exactly the conflation this product exists to avoid. Comments are the
 * user's, carry no severity and no confidence, and are reported separately.
 *
 * `elementRef` is optional: a comment about the page as a whole is a real and
 * common thing to want, and forcing it onto an arbitrary element would be a
 * worse record than admitting it has no anchor.
 */
export type Annotation = {
  id: string;
  auditId: string;
  /** What the user wrote. An annotation with an empty body is not stored. */
  body: string;
  /** The element it is pinned to, when the user picked one. */
  elementRef?: ElementReference;
  /**
   * Index into the snapshot the comment was made against. The fast path for
   * pins in this session only, exactly as on a finding.
   */
  elementIndex?: number;
  /**
   * Which snapshot `elementIndex` belongs to.
   *
   * Carried for the same reason `Pin.snapshotId` is: index 42 of one snapshot
   * is an unrelated element in another, so an index is only a shortcut for the
   * capture it came from. Without this, a comment written against one audit
   * and drawn against another's digest would produce a confident pin on the
   * wrong element -- which is worse than no pin. Absent on a comment from a
   * file written before this field existed, and the pin is then placed by
   * searching the page instead.
   */
  snapshotId?: string;
  /** Where the anchor was when the comment was written. */
  documentRect?: Rect;
  /**
   * How much the user wants somebody to care.
   *
   * Deliberately not a severity. A finding's severity comes from what Thursday
   * measured and sits on a five-rung ladder it can defend; this is the author
   * saying how urgent they think their own opinion is, which is a different
   * kind of claim and is kept in different words and a different scale.
   *
   * Optional because comments written before this existed have no answer, and
   * inventing `normal` for them would put a value the user never chose into
   * their file.
   */
  priority?: AnnotationPriority;
  /**
   * Who wrote it, as they typed it into the composer.
   *
   * Stored so a report handed to somebody else says whose opinion each comment
   * is -- which is most of what makes a comment useful to a third party. It is
   * a name the user entered about themselves, and it never leaves the machine
   * unless they export a file and send it.
   */
  author?: string;
  /** Attachment metadata, in the order the user added them. */
  attachments: AnnotationAttachment[];
  createdAt: number;
  updatedAt: number;
};

export type AnnotationPriority = 'normal' | 'medium' | 'high';
