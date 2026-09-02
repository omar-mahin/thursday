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
  crossOriginFrames: number;
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
  measurements?: Record<string, number | string | boolean>;
  status: FindingStatus;
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
};

export type Pin = {
  findingId: string;
  ordinal: number;
  severity: Severity;
  rect: Rect;
  approximate: boolean;
};

export type { ElementReference };
