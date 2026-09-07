import { composite, contrastRatio, parseColor, type Rgb } from '../../audit/measure/color';
import {
  INDETERMINATE_EXPLANATION,
  resolveBackgroundLayers,
  type BackgroundLayer,
} from '../../audit/measure/background';
import type { Rect } from '../../shared/types';
import { toRect } from '../snapshot/measure';

/**
 * What the ruler reads off an element under the pointer.
 *
 * Everything here is a *measurement*, never a judgement -- the same line the
 * rest of Thursday draws. The one place that comes close is the contrast pair,
 * and those are thresholds from WCAG rather than opinions, reported as pass or
 * fail against a stated target and refused outright when the background cannot
 * be known.
 *
 * The background is resolved by the same code the audit's contrast rule uses
 * (audit/measure/background.ts). That is deliberate: the ruler saying "AA
 * passes" on an element the audit reports as failing would be a contradiction
 * with no way to tell which half was wrong.
 */

export type ContrastReading =
  | { kind: 'measured'; ratio: number; aa: boolean; aaa: boolean; large: boolean }
  | { kind: 'indeterminate'; because: string };

export type Measurement = {
  rect: Rect;
  /** `button.primary`, for the identity chip. */
  selector: string;
  fontFamily: string;
  fontSizePx: number;
  weight: { numeric: number; label: string };
  /** Null when line-height is `normal`: there is no number to report. */
  lineHeightPx: number | null;
  letterSpacingPx: number;
  /** The text colour, as a hex string. */
  color: string;
  /**
   * Null when the element has no text of its own.
   *
   * A wrapper div inherits a colour and a font size, so those chips are still
   * true of it -- but a contrast ratio for text that is not there is a number
   * about nothing, and putting a green tick on it would be worse than leaving
   * it out.
   */
  contrast: ContrastReading | null;
  /** Gaps to the nearest laid-out neighbour above and below. */
  spacing: { above: number | null; below: number | null };
};

/** Weights that have a name people use. Everything else shows its number. */
const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

export function weightLabel(weight: number): string {
  return WEIGHT_NAMES[weight] ?? String(weight);
}

/**
 * The first family in a font stack, unquoted.
 *
 * The stack is what the page asked for; the first entry is what it almost
 * always got, and the whole stack would not fit in a chip. Not a claim about
 * which font actually rendered -- the platform decides that and CSS will not
 * say.
 */
export function primaryFamily(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? '';
  return first.replace(/^["']|["']$/g, '') || 'unknown';
}

/** A length as it goes in a chip: whole numbers plain, otherwise one decimal. */
export function formatPx(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}px`;
}

/**
 * Whether text of this size and weight counts as large for contrast purposes.
 *
 * WCAG 1.4.3: 18pt, or 14pt bold. In CSS pixels at the usual 96dpi that is 24px
 * and 18.66px, and the fractional one is why this is a function rather than a
 * pair of constants somebody would round wrong.
 */
export function isLargeText(fontSizePx: number, weight: number): boolean {
  return fontSizePx >= 24 || (weight >= 700 && fontSizePx >= 18.66);
}

/** The pass/fail pair for a measured ratio. */
export function contrastVerdict(ratio: number, fontSizePx: number, weight: number): ContrastReading {
  const large = isLargeText(fontSizePx, weight);
  return {
    kind: 'measured',
    ratio,
    aa: ratio >= (large ? 3 : 4.5),
    aaa: ratio >= (large ? 4.5 : 7),
    large,
  };
}

/**
 * A colour as a hex string.
 *
 * Hex because that is what a designer will paste back into a stylesheet or a
 * Figma field, and `rgb(160, 160, 160)` is three times as wide in a chip.
 * Eight digits when the colour is translucent rather than dropping the alpha:
 * a chip reading #a0a0a0 for something half transparent is a wrong answer, not
 * a shorter one.
 */
export function hexColor(color: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  const base = `#${part(color.r)}${part(color.g)}${part(color.b)}`;
  return color.a >= 0.999 ? base : `${base}${part(color.a * 255)}`;
}

/** A ratio as people write it: `4.51:1`. */
export const formatRatio = (ratio: number): string => `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;

const layerOf = (style: CSSStyleDeclaration): BackgroundLayer => ({
  backgroundColor: style.backgroundColor,
  hasBackgroundImage: style.backgroundImage !== '' && style.backgroundImage !== 'none',
  mixBlendMode: style.mixBlendMode,
  hasBackdropFilter: style.backdropFilter !== '' && style.backdropFilter !== 'none',
});

/** The live ancestor chain as background layers, innermost first. */
function* chainFrom(element: Element): Generator<BackgroundLayer> {
  let node: Element | null = element;
  while (node) {
    yield layerOf(getComputedStyle(node));
    node = node.parentElement;
  }
}

/**
 * Whether this element has text of its own, rather than only in children.
 *
 * Direct text nodes only. Asking `textContent` would call a wrapper around a
 * paragraph a text element and measure the wrapper's inherited colour against
 * the wrapper's background, which is a different question from the one anybody
 * hovering it is asking.
 */
function hasOwnText(element: Element): boolean {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '') return true;
  }
  return false;
}

/**
 * The gap between two edges, or null when there is nothing to measure.
 *
 * Negative gaps (overlapping or margin-collapsed neighbours) and absurd ones
 * are dropped rather than shown. A pill reading `-3px` invites a guess about
 * what it means, and one reading `1840px` is the distance to something on the
 * other side of the page, which is not spacing.
 */
const MAX_GAP = 400;
function gap(from: number, to: number): number | null {
  const value = Math.round((to - from) * 10) / 10;
  if (value < 1 || value > MAX_GAP) return null;
  return value;
}

/**
 * The immediate siblings, if they take up space.
 *
 * Immediate only. Skipping past a collapsed sibling to find a visible one would
 * report the distance to something with other things in between, which is not
 * the gap anybody is looking at.
 */
const laidOut = (node: Element | null): DOMRect | null => {
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
};

export function measureElement(element: Element, selector: string): Measurement {
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  const rect = toRect(box);

  const fontSizePx = Number.parseFloat(style.fontSize) || 0;
  const weightValue = Number.parseInt(style.fontWeight, 10) || 400;
  const lineHeight = Number.parseFloat(style.lineHeight);
  const letterSpacing = Number.parseFloat(style.letterSpacing);

  const foreground = parseColor(style.color);
  let contrast: ContrastReading | null = null;
  if (hasOwnText(element) && foreground) {
    const background = resolveBackgroundLayers(chainFrom(element));
    if (background.kind === 'resolved') {
      // Composited first, so the ratio is of the colour on screen rather than
      // the one the stylesheet asked for: translucent text is lighter than its
      // own declaration.
      contrast = contrastVerdict(
        contrastRatio(composite(foreground, background.color), background.color),
        fontSizePx,
        weightValue,
      );
    } else {
      contrast = { kind: 'indeterminate', because: INDETERMINATE_EXPLANATION[background.reason] };
    }
  }

  const previous = laidOut(element.previousElementSibling);
  const next = laidOut(element.nextElementSibling);
  return {
    rect,
    selector,
    fontFamily: primaryFamily(style.fontFamily),
    fontSizePx,
    weight: { numeric: weightValue, label: weightLabel(weightValue) },
    lineHeightPx: Number.isFinite(lineHeight) ? Math.round(lineHeight * 10) / 10 : null,
    letterSpacingPx: Number.isFinite(letterSpacing) ? Math.round(letterSpacing * 10) / 10 : 0,
    color: foreground ? hexColor(foreground) : style.color,
    contrast,
    spacing: {
      above: previous ? gap(previous.bottom, box.top) : null,
      below: next ? gap(box.bottom, next.top) : null,
    },
  };
}
