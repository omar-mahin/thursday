import type { Rect } from '../../shared/types';

/**
 * Visibility and interactivity predicates.
 *
 * Deliberately pure and primitive-typed: collection reads the DOM once and then
 * asks these questions about plain data, so they are unit-testable in Node and
 * cannot accidentally force a second layout (PLAN.md section 5).
 */

export type StyleFacts = {
  display: string;
  visibility: string;
  opacity: number;
  contentVisibility?: string;
};

/** How many viewports below the fold we still collect. */
export const OFFSCREEN_VIEWPORT_FACTOR = 3;

export const isHiddenByStyle = (style: StyleFacts): boolean =>
  style.display === 'none' ||
  style.visibility === 'hidden' ||
  style.visibility === 'collapse' ||
  style.opacity === 0 ||
  style.contentVisibility === 'hidden';

export const isZeroArea = (rect: Rect): boolean => rect.width < 1 || rect.height < 1;

export const isFarOffscreen = (rect: Rect, viewportHeight: number, viewportWidth: number): boolean => {
  const limit = viewportHeight * OFFSCREEN_VIEWPORT_FACTOR;
  if (rect.y > limit) return true;
  if (rect.y + rect.height < -limit) return true;
  // Horizontal: a common way to hide things is to park them far to the side.
  if (rect.x > viewportWidth * 2) return true;
  if (rect.x + rect.width < -viewportWidth) return true;
  return false;
};

export const isInViewport = (rect: Rect, viewportWidth: number, viewportHeight: number): boolean =>
  rect.y < viewportHeight && rect.y + rect.height > 0 && rect.x < viewportWidth && rect.x + rect.width > 0;

/** The clip-path/1px trick: visually hidden but available to screen readers. */
export const isScreenReaderOnly = (rect: Rect): boolean => rect.width <= 1 && rect.height <= 1;

const INTERACTIVE_TAGS = new Set(['button', 'select', 'textarea', 'summary', 'details']);

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'combobox',
  'textbox',
  'searchbox',
]);

export type InteractivityFacts = {
  tagName: string;
  role?: string;
  hasHref: boolean;
  hasClickAttribute: boolean;
  tabIndex: number;
  inputType?: string;
};

export function isInteractive(facts: InteractivityFacts): boolean {
  if (INTERACTIVE_TAGS.has(facts.tagName)) return true;
  if (facts.tagName === 'a' || facts.tagName === 'area') return facts.hasHref;
  if (facts.tagName === 'input') return facts.inputType !== 'hidden';
  if (facts.tagName === 'label') return true;
  if (facts.role && INTERACTIVE_ROLES.has(facts.role)) return true;
  if (facts.hasClickAttribute) return true;
  return facts.tabIndex >= 0;
}

export function isFocusable(facts: InteractivityFacts & { disabled: boolean }): boolean {
  if (facts.disabled) return false;
  if (facts.tabIndex >= 0) return true;
  if (facts.tagName === 'a' || facts.tagName === 'area') return facts.hasHref;
  if (facts.tagName === 'input') return facts.inputType !== 'hidden';
  return INTERACTIVE_TAGS.has(facts.tagName);
}
