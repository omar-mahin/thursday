import type { Rect } from './geometry';

/** How confidently a stored element was found again (PLAN.md section 2.5). */
export type ResolutionLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type ElementReference = {
  tagName: string;
  role?: string;
  accessibleName?: string;
  textSnippet?: string;
  stableAttribute?: { name: string; value: string };
  structuralPath: string;
  ancestry: string[];
  rect: Rect;
  /** Set when re-resolved against a live page; null means not found. */
  resolvedAt?: ResolutionLevel | null;
};

/** Cheap payload for hover feedback. Must stay small: it is sent at frame rate. */
export type ElementPreview = {
  tagName: string;
  id?: string;
  classNames: string[];
  role?: string;
  textSnippet?: string;
  rect: Rect;
};

/**
 * Grown in Sprint 2 with the full field set from spec section 10. The index is
 * the identity used inside a snapshot: relationships are indices, never object
 * references, so a snapshot stays structuredClone- and JSON-safe.
 */
export type ElementSnapshot = {
  index: number;
  tagName: string;
  rect: Rect;
  parent: number | null;
  /** True when the element was skipped for privacy (PLAN.md section 7). */
  redacted?: boolean;
};
