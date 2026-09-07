import type { ElementSnapshot, PageSnapshot } from '../../shared/types';
import { composite, isOpaque, parseColor, type Rgb } from './color';

/**
 * Resolves the colour actually behind an element's text by walking its ancestor
 * chain in the snapshot and compositing what it finds.
 *
 * Returns a reason instead of a colour whenever the answer is not knowable from
 * computed styles: that reason is what rule A11Y-003 reports so the user gets
 * "check this by eye" rather than a fabricated ratio.
 */
export type BackgroundResult =
  | { kind: 'resolved'; color: Rgb; layers: number }
  | { kind: 'indeterminate'; reason: IndeterminateReason; detail?: string };

export type IndeterminateReason =
  | 'background-image'
  | 'blend-mode'
  | 'backdrop-filter'
  | 'unparseable-color'
  | 'no-opaque-ancestor';

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };

/**
 * The four style facts this resolver needs, whatever they were read from.
 *
 * Named separately so the live-DOM ruler and the snapshot-based rules run the
 * *same* resolver. Two implementations would be two chances to disagree, and
 * the disagreement would be user-visible: hovering an element and reading
 * "AA passes" while the audit reports a contrast failure on that same element
 * is a straight contradiction, and there would be no way to tell which half was
 * lying.
 */
export type BackgroundLayer = {
  backgroundColor: string;
  hasBackgroundImage: boolean;
  mixBlendMode: string;
  hasBackdropFilter: boolean;
};

/** The ancestor chain, innermost first. */
export function resolveBackgroundLayers(chain: Iterable<BackgroundLayer>): BackgroundResult {
  const stack: Rgb[] = [];
  let layers = 0;

  for (const styles of chain) {
    if (styles.hasBackgroundImage) {
      return { kind: 'indeterminate', reason: 'background-image' };
    }
    if (styles.mixBlendMode !== 'normal') {
      return { kind: 'indeterminate', reason: 'blend-mode', detail: styles.mixBlendMode };
    }
    if (styles.hasBackdropFilter) {
      return { kind: 'indeterminate', reason: 'backdrop-filter' };
    }

    const parsed = parseColor(styles.backgroundColor);
    if (!parsed) {
      return { kind: 'indeterminate', reason: 'unparseable-color', detail: styles.backgroundColor };
    }
    if (parsed.a > 0) {
      stack.push(parsed);
      layers += 1;
      if (isOpaque(parsed)) {
        // Composite from the opaque layer upward.
        let result = parsed;
        for (let index = stack.length - 2; index >= 0; index -= 1) {
          result = composite(stack[index]!, result);
        }
        return { kind: 'resolved', color: result, layers };
      }
    }
  }

  // Nothing opaque was found in the collected chain. The page canvas is white by
  // default, but only claim that when no translucent layers were stacked on it.
  if (stack.length === 0) return { kind: 'resolved', color: WHITE, layers: 0 };
  let result = WHITE;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    result = composite(stack[index]!, result);
  }
  return { kind: 'resolved', color: result, layers };
}

/** The snapshot's ancestor chain, as layers. */
export function resolveBackground(snapshot: PageSnapshot, element: ElementSnapshot): BackgroundResult {
  return resolveBackgroundLayers(
    (function* chain() {
      let current: ElementSnapshot | undefined = element;
      while (current) {
        yield current.styles;
        current = current.parent === null ? undefined : snapshot.elements[current.parent];
      }
    })(),
  );
}

export const INDETERMINATE_EXPLANATION: Record<IndeterminateReason, string> = {
  'background-image': 'the text sits on a background image or gradient',
  'blend-mode': 'a blend mode changes the rendered colours',
  'backdrop-filter': 'a backdrop filter changes the rendered colours',
  'unparseable-color': 'the background colour could not be read',
  'no-opaque-ancestor': 'no opaque background was found behind the text',
};
