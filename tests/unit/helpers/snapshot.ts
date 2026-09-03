import type {
  ElementSnapshot,
  PageSnapshot,
  StyleSnapshot,
  AuditSettings,
} from '../../../src/shared/types';
import { DEFAULT_AUDIT_SETTINGS } from '../../../src/audit/types';

/**
 * Fixture factory for snapshots.
 *
 * Rules are pure functions over a PageSnapshot, so a rule test is just data in
 * and findings out -- no browser, no layout, no jsdom (PLAN.md section 2.2).
 */
export const styles = (overrides: Partial<StyleSnapshot> = {}): StyleSnapshot => ({
  display: 'block',
  position: 'static',
  visibility: 'visible',
  overflowX: 'visible',
  overflowY: 'visible',
  zIndex: 'auto',
  cursor: 'auto',
  opacity: 1,
  color: 'rgb(17, 17, 17)',
  backgroundColor: 'rgb(255, 255, 255)',
  hasBackgroundImage: false,
  hasBackdropFilter: false,
  mixBlendMode: 'normal',
  borderColor: 'rgb(0, 0, 0)',
  borderRadius: '0px',
  borderWidths: [0, 0, 0, 0],
  hasBoxShadow: false,
  fontFamily: 'Inter, sans-serif',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: '24px',
  letterSpacing: 'normal',
  textTransform: 'none',
  textAlign: 'start',
  textDecorationLine: 'none',
  margin: [0, 0, 0, 0],
  padding: [0, 0, 0, 0],
  boxSizing: 'border-box',
  ...overrides,
});

let nextIndex = 0;

export const resetIndexes = (): void => {
  nextIndex = 0;
};

export type ElementOverrides = Partial<Omit<ElementSnapshot, 'styles'>> & {
  styles?: Partial<StyleSnapshot>;
};

export function element(overrides: ElementOverrides = {}): ElementSnapshot {
  const index = overrides.index ?? nextIndex;
  nextIndex = Math.max(nextIndex, index) + 1;
  const rect = overrides.rect ?? { x: 0, y: 0, width: 100, height: 40 };
  const base: ElementSnapshot = {
    index,
    parent: null,
    landmark: null,
    precedingHeading: null,
    tagName: 'div',
    classNames: [],
    accessibleName: { name: '', source: 'none', weak: false },
    aria: {},
    textLength: 0,
    wordCount: 0,
    rect,
    documentRect: overrides.documentRect ?? rect,
    inViewport: true,
    interactive: false,
    focusable: false,
    tabIndex: -1,
    disabled: false,
    ariaHidden: false,
    styles: styles(overrides.styles),
    structuralPath: `${overrides.tagName ?? 'div'}:nth-of-type(1)`,
    redacted: false,
  };
  const merged = { ...base, ...overrides, styles: styles(overrides.styles) } as ElementSnapshot;
  if (overrides.text !== undefined && overrides.textLength === undefined) {
    merged.textLength = overrides.text.length;
  }
  if (overrides.text !== undefined && overrides.wordCount === undefined) {
    merged.wordCount = overrides.text.split(/\s+/).filter(Boolean).length;
  }
  if (overrides.documentRect === undefined) merged.documentRect = merged.rect;
  return merged;
}

/** A named element: the common case of "a button that says X". */
export const named = (name: string, overrides: ElementOverrides = {}): ElementSnapshot =>
  element({
    accessibleName: { name, source: 'text', weak: false },
    text: name,
    ...overrides,
  });

export function snapshot(elements: ElementSnapshot[], overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: 'snap-test',
    capturedAt: 1_700_000_000_000,
    durationMs: 12,
    url: 'https://example.test/page',
    origin: 'https://example.test',
    title: 'Example page',
    viewport: {
      width: 1280,
      height: 800,
      devicePixelRatio: 2,
      scrollX: 0,
      scrollY: 0,
      documentWidth: 1280,
      documentHeight: 2400,
    },
    elements: elements.map((item, position) => ({ ...item, index: position })),
    truncated: false,
    crossOriginFrames: 0,
    sameOriginFrames: 0,
    lang: 'en',
    styleSheets: {
      readableSheets: 1,
      unreadableSheets: 0,
      focusOutlineResets: 0,
      focusIndicatorRules: 0,
    },
    ...overrides,
  };
}

export const SETTINGS: AuditSettings = DEFAULT_AUDIT_SETTINGS;

/** Runs one rule and returns its raw findings. */
export function run(
  rule: { run(context: { snapshot: PageSnapshot; settings: AuditSettings; candidates: ElementSnapshot[] }): unknown },
  page: PageSnapshot,
  settings: AuditSettings = SETTINGS,
) {
  return rule.run({
    snapshot: page,
    settings,
    candidates: page.elements.filter((item) => !item.ariaHidden && !item.redacted),
  }) as import('../../../src/shared/types').RawFinding[];
}
