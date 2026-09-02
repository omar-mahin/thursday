import { LANDMARK_TAGS } from '../../audit/accessibility/roles';
import type { ElementSnapshot, PageSnapshot, StyleSheetFacts } from '../../shared/types';
import { measureAll, type Measured } from './measure';
import { buildElementSnapshot } from './element';
import { TEXT_BUDGET_PER_SNAPSHOT } from './redact';
import { isFarOffscreen, isHiddenByStyle, isZeroArea } from './visibility';

/** Hard cap from PLAN.md section 5. Past this, low-priority elements are cut. */
export const ELEMENT_CAP = 1500;

/**
 * Safety valve on how many elements we are willing to measure. The cap above
 * applies to *visible* elements, which means culling has to happen first -- so
 * this bounds the measurement cost on a pathological page.
 */
export const CANDIDATE_CEILING = 6000;

/** Always collected: interactive, semantic, structural, or text-bearing. */
const PRIMARY = [
  'a', 'button', 'input', 'select', 'textarea', 'label', 'form', 'fieldset', 'legend',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'dt', 'dd', 'th', 'td', 'caption',
  'header', 'nav', 'main', 'aside', 'footer', 'section', 'article',
  'img', 'picture', 'svg', 'video', 'audio', 'iframe', 'canvas',
  'table', 'dialog', 'details', 'summary', 'ul', 'ol', 'dl',
  '[role]', '[tabindex]', '[onclick]', '[aria-label]', '[aria-labelledby]',
].join(',');

/** Collected when there is budget left: generic containers the layout rules care about. */
const SECONDARY = ['div', 'span', 'figure', 'figcaption', 'blockquote', 'pre', 'hgroup', 'time'].join(',');

type Priority = 1 | 2 | 3;

const HIGH_PRIORITY_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'label',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'nav', 'main', 'aside', 'footer',
]);

function priorityOf(element: Element): Priority {
  const tag = element.tagName.toLowerCase();
  if (HIGH_PRIORITY_TAGS.has(tag) || element.hasAttribute('role')) return 1;
  if (element.matches(PRIMARY)) return 2;
  return 3;
}

/** One DOM pass, document order preserved. */
function gatherCandidates(): { elements: Element[]; truncated: boolean } {
  const root = document.body ?? document.documentElement;
  const all = [...root.querySelectorAll(`${PRIMARY},${SECONDARY}`)];
  if (all.length <= CANDIDATE_CEILING) return { elements: all, truncated: false };
  return { elements: all.slice(0, CANDIDATE_CEILING), truncated: true };
}

/**
 * Applies the element cap to what survived culling, so a visible element is
 * never dropped in favour of a hidden one. Interactive and structural elements
 * outrank generic containers; document order is preserved either way.
 */
function applyCap<T extends { element: Element }>(items: T[]): { items: T[]; truncated: boolean } {
  if (items.length <= ELEMENT_CAP) return { items, truncated: false };
  const important: T[] = [];
  const generic: T[] = [];
  for (const item of items) {
    if (priorityOf(item.element) === 3) generic.push(item);
    else important.push(item);
  }
  if (important.length >= ELEMENT_CAP) return { items: important.slice(0, ELEMENT_CAP), truncated: true };
  const allowed = new Set<T>([...important, ...generic.slice(0, ELEMENT_CAP - important.length)]);
  return { items: items.filter((item) => allowed.has(item)), truncated: true };
}

function countCrossOriginFrames(): number {
  let count = 0;
  for (const frame of document.querySelectorAll('iframe')) {
    const src = frame.getAttribute('src');
    if (!src) continue;
    try {
      if (new URL(src, location.href).origin !== location.origin) count += 1;
    } catch {
      count += 1;
    }
  }
  return count;
}

/**
 * Focus-style facts, read from the CSSOM. Cross-origin sheets throw on access,
 * so they are counted as unreadable and rule A11Y-006 stays quiet rather than
 * inventing a violation it cannot see.
 */
function collectStyleSheetFacts(): StyleSheetFacts {
  const facts: StyleSheetFacts = {
    readableSheets: 0,
    unreadableSheets: 0,
    focusOutlineResets: 0,
    focusIndicatorRules: 0,
  };

  const visit = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const selector = rule.selectorText;
        if (!selector.includes(':focus')) continue;
        const outline = rule.style.getPropertyValue('outline');
        const outlineWidth = rule.style.getPropertyValue('outline-width');
        const removesOutline =
          /^(none|0)/.test(outline.trim()) || /^0/.test(outlineWidth.trim());
        if (removesOutline) {
          facts.focusOutlineResets += 1;
          continue;
        }
        // Anything that draws a visible difference counts as an indicator.
        for (const property of ['outline', 'outline-color', 'box-shadow', 'border', 'background-color', 'text-decoration']) {
          if (rule.style.getPropertyValue(property).trim()) {
            facts.focusIndicatorRules += 1;
            break;
          }
        }
      } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
        visit(rule.cssRules);
      }
    }
  };

  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules;
      facts.readableSheets += 1;
      visit(rules);
    } catch {
      facts.unreadableSheets += 1;
    }
  }
  return facts;
}

export type CollectOptions = {
  /** Include elements more than three viewports away from the fold. */
  includeOffscreen: boolean;
};

/**
 * Builds the page snapshot: one read pass, then pure transformation. The result
 * is plain JSON (relationships are array indices, never object references) so it
 * survives structuredClone across a port and serializes into a saved audit.
 */
export function collectSnapshot(options: CollectOptions): PageSnapshot {
  const started = Date.now();
  const { elements: candidates, truncated: ceilingHit } = gatherCandidates();
  const measured = measureAll(candidates);

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Cull invisible elements before doing any per-element work.
  const survivors: Measured[] = [];
  for (const item of measured) {
    const style = item.style;
    if (
      isHiddenByStyle({
        display: style.display,
        visibility: style.visibility,
        opacity: Number.parseFloat(style.opacity) || 0,
        contentVisibility: style.contentVisibility,
      })
    ) {
      continue;
    }
    if (isZeroArea(item.rect)) continue;
    if (!options.includeOffscreen && isFarOffscreen(item.rect, viewportHeight, viewportWidth)) continue;
    survivors.push(item);
  }

  const { items: visible, truncated: capHit } = applyCap(survivors);

  const indexOf = new Map<Element, number>();
  visible.forEach((item, index) => indexOf.set(item.element, index));

  const nearestCollectedAncestor = (element: Element): number | null => {
    let parent = element.parentElement;
    while (parent) {
      const index = indexOf.get(parent);
      if (index !== undefined) return index;
      parent = parent.parentElement;
    }
    return null;
  };

  const nearestLandmark = (element: Element): number | null => {
    let parent = element.parentElement;
    while (parent) {
      if (LANDMARK_TAGS.has(parent.tagName.toLowerCase())) {
        const index = indexOf.get(parent);
        if (index !== undefined) return index;
      }
      parent = parent.parentElement;
    }
    return null;
  };

  const scrollX = Math.round(window.scrollX);
  const scrollY = Math.round(window.scrollY);

  let textBudget = TEXT_BUDGET_PER_SNAPSHOT;
  let lastHeading: number | null = null;

  const snapshots: ElementSnapshot[] = visible.map((item, index) => {
    const snapshot = buildElementSnapshot(item, {
      index,
      parent: nearestCollectedAncestor(item.element),
      landmark: nearestLandmark(item.element),
      precedingHeading: lastHeading,
      scrollX,
      scrollY,
      viewportWidth,
      viewportHeight,
      allowText: textBudget > 0,
    });
    if (snapshot.text) textBudget -= snapshot.text.length;
    if (snapshot.headingLevel !== undefined) lastHeading = index;
    return snapshot;
  });

  return {
    capturedAt: started,
    durationMs: Date.now() - started,
    url: location.href,
    origin: location.origin,
    title: document.title,
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollX,
      scrollY,
      documentWidth: Math.max(document.documentElement.scrollWidth, viewportWidth),
      documentHeight: Math.max(document.documentElement.scrollHeight, viewportHeight),
    },
    elements: snapshots,
    truncated: ceilingHit || capHit,
    crossOriginFrames: countCrossOriginFrames(),
    lang: document.documentElement.getAttribute('lang'),
    styleSheets: collectStyleSheetFacts(),
  };
}
