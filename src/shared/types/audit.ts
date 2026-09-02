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
};

export type Pin = {
  findingId: string;
  ordinal: number;
  severity: Severity;
  rect: Rect;
  approximate: boolean;
};

export type { ElementReference };
