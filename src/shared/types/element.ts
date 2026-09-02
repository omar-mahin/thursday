import type { Rect } from './geometry';

/** How confidently a stored element was found again (PLAN.md section 2.5). */
export type ResolutionLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type ElementReference = {
  tagName: string;
  role?: string;
  accessibleName?: string;
  textSnippet?: string;
  stableAttribute?: { name: string; value: string };
  /** nth-of-type chain, capped and anchored at the nearest landmark. */
  structuralPath: string;
  ancestry: string[];
  rect: Rect;
  /** Viewport-relative centroid, for the geometric fallback. */
  centroid: { x: number; y: number };
  /** Set when re-resolved against a live page; null means not found. */
  resolvedAt?: ResolutionLevel | null;
};

/** Cheap payload for hover feedback. Must stay small: it is sent at frame rate. */
export type ElementPreview = {
  tagName: string;
  id?: string;
  classNames: string[];
  role?: string;
  accessibleName?: string;
  textSnippet?: string;
  rect: Rect;
};

export type NameSource =
  | 'aria-labelledby'
  | 'aria-label'
  | 'label-for'
  | 'label-wrapped'
  | 'legend'
  | 'caption'
  | 'alt'
  | 'value'
  | 'text'
  | 'title'
  | 'placeholder'
  | 'none';

/**
 * There is no computed-accessible-name API on the web platform, so this is a
 * documented subset (PLAN.md section 2.4). `weak` marks names that came from a
 * source real assistive tech treats as a last resort -- rules downgrade
 * severity rather than claiming a violation.
 */
export type AccessibleName = {
  name: string;
  source: NameSource;
  weak: boolean;
};

/** Only the computed properties the rules actually consume, named explicitly so
 *  rule code gets types instead of a string bag. */
export type StyleSnapshot = {
  display: string;
  position: string;
  visibility: string;
  overflowX: string;
  overflowY: string;
  zIndex: string;
  cursor: string;
  opacity: number;

  color: string;
  backgroundColor: string;
  /** Present at all? Enough to make contrast indeterminate (section 2.3). */
  hasBackgroundImage: boolean;
  hasBackdropFilter: boolean;
  mixBlendMode: string;
  borderColor: string;
  borderRadius: string;
  borderWidths: [number, number, number, number];
  hasBoxShadow: boolean;

  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  textAlign: string;
  textDecorationLine: string;

  margin: [number, number, number, number];
  padding: [number, number, number, number];
  boxSizing: string;
};

/**
 * Form metadata only.
 *
 * The spec sketched `{ type, hasValue }`. Even that is dropped: no MVP rule
 * consumes it, and any signal about field contents -- including whether a field
 * is filled -- is a privacy surface with no upside. So Thursday cannot tell
 * whether you typed anything, which is a stronger claim than "we redact it".
 */
export type FormFieldSnapshot = {
  type: string;
  required: boolean;
  autocomplete?: string;
  labelledBy: 'label-for' | 'label-wrapped' | 'aria' | 'placeholder' | 'none';
};

export type ElementSnapshot = {
  index: number;
  parent: number | null;
  /** Index of the nearest ancestor landmark (header/nav/main/aside/footer/section). */
  landmark: number | null;
  /** Index of the nearest heading above this element in document order. */
  precedingHeading: number | null;

  tagName: string;
  id?: string;
  classNames: string[];
  role?: string;
  implicitRole?: string;
  headingLevel?: number;
  accessibleName: AccessibleName;
  aria: Record<string, string>;

  text?: string;
  /** Characters of own text, before the 200-character cap. */
  textLength: number;
  /**
   * Words of own text, counted before truncation. The rules need this because
   * extrapolating a word count from a 200-character sample is unreliable: dense
   * openings under-count badly.
   */
  wordCount: number;
  alt?: string;
  placeholder?: string;
  title?: string;
  /** Same-origin path only; query and fragment are dropped. */
  href?: string;

  rect: Rect;
  /** Document-relative, so pins survive scrolling. */
  documentRect: Rect;
  inViewport: boolean;
  interactive: boolean;
  focusable: boolean;
  tabIndex: number;
  disabled: boolean;
  ariaHidden: boolean;

  styles: StyleSnapshot;
  form?: FormFieldSnapshot;

  /** Identity handles captured during collection, so the panel and the rules
   *  can build an ElementReference without touching the DOM. */
  structuralPath: string;
  stableAttribute?: { name: string; value: string };

  /** True when the element was skipped for privacy (PLAN.md section 7). */
  redacted: boolean;
};
