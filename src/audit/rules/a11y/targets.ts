import type { ElementSnapshot, PageSnapshot, Rect } from '../../../shared/types';
import type { Rule } from '../../types';
import { finding, label } from '../../types';

/** WCAG 2.5.8 (AA) requires 24x24. 44x44 is the usability recommendation. */
const WCAG_MINIMUM = 24;

/**
 * Below this, an element is not a target that got too small -- it is one that
 * was never meant to be seen.
 *
 * The visually-hidden pattern (`clip-path: inset(50%)` on a 1px box, or a
 * `sr-only` class) is everywhere: skip links, live regions, and the file input
 * behind a styled "Choose file" button. With `box-sizing: border-box` a 1px
 * input with a 1px border measures 2 x 2. Telling someone to give that 24px is
 * advice they cannot act on, and it would fire on most real websites -- which
 * is how it was found: on Thursday's own panel, whose file input is exactly
 * this pattern.
 *
 * A genuinely broken control collapsed to a few pixels is a real defect, but it
 * is not a target-size defect, and A11Y-004 is not the rule that should claim
 * to have found it.
 */
const VISUALLY_HIDDEN_CEILING = 4;

/** How far up to look for a wrapping label. Deeper than that is not a label. */
const LABEL_SEARCH_HOPS = 4;

/**
 * The box a pointer actually has to hit.
 *
 * A form control inside a `<label>` is activated by clicking anywhere in that
 * label, so the label is the target -- which is what WCAG 2.5.8 measures. A
 * 16px checkbox with a 200px label beside it is not a 16px target, and saying
 * so would fire on very nearly every checkbox on the web. Found by auditing
 * Thursday's own settings page, whose two toggles are exactly this pattern.
 *
 * The test is structural -- is there a label around it -- and deliberately not
 * "did the accessible name come from a wrapping label". Those differ: a control
 * with an `aria-label` takes its name from the attribute while still being
 * activated by the label around it, and the first version of this check missed
 * exactly that case on Thursday's own settings page.
 */
export function targetBox(snapshot: PageSnapshot, element: ElementSnapshot): Rect {
  if (!element.form) return element.rect;
  let parent = element.parent === null ? undefined : snapshot.elements[element.parent];
  let hops = 0;
  while (parent && hops < LABEL_SEARCH_HOPS) {
    if (parent.tagName === 'label') {
      // Only when the label really is bigger: a label sized to its control
      // adds nothing, and taking it anyway would hide a genuine defect.
      const bigger =
        parent.rect.width >= element.rect.width && parent.rect.height >= element.rect.height;
      return bigger ? parent.rect : element.rect;
    }
    parent = parent.parent === null ? undefined : snapshot.elements[parent.parent];
    hops += 1;
  }
  return element.rect;
}

/**
 * A11Y-004 - interactive target smaller than the configured minimum.
 *
 * Labelled a usability heuristic, not a WCAG violation, unless the target is
 * below the 24px normative floor. The default 44px comes from platform
 * guidance; calling everything under it a "violation" would be inventing a
 * standard, which the AI layer is explicitly forbidden from doing and the
 * deterministic rules should not do either.
 */
export const smallTouchTarget: Rule = {
  id: 'A11Y-004',
  category: 'a11y',
  kind: 'heuristic',
  scope: 'element',
  description: 'Interactive targets should be large enough to hit reliably',
  run({ candidates, settings, snapshot }) {
    const results = [];
    for (const element of candidates) {
      if (!element.interactive) continue;
      if (element.disabled) continue;
      // Inline links inside a paragraph are sized by the text, not by design.
      if (element.tagName === 'a' && element.parent !== null && element.styles.display === 'inline') continue;

      const { width, height } = targetBox(snapshot, element);
      // Deliberately hidden rather than badly sized. See above.
      if (width <= VISUALLY_HIDDEN_CEILING && height <= VISUALLY_HIDDEN_CEILING) continue;
      const smallest = Math.min(width, height);
      // WCAG 2.5.8 asks whether a 24px square fits inside the target, so one
      // short dimension is enough to fail it.
      const belowNormative = smallest < WCAG_MINIMUM;
      // The 44px recommendation is about compact controls. A 640 x 24 label is
      // trivial to hit, and flagging it would bury the icon buttons that matter.
      const compactAndSmall = width < settings.minTouchTarget && height < settings.minTouchTarget;
      if (!belowNormative && !compactAndSmall) continue;
      results.push(
        finding(smallTouchTarget, {
          type: belowNormative ? 'rule' : 'heuristic',
          title: belowNormative
            ? `Target ${Math.round(width)} × ${Math.round(height)}px is below the 24px minimum`
            : `Target ${Math.round(width)} × ${Math.round(height)}px is smaller than ${settings.minTouchTarget}px`,
          summary: belowNormative
            ? `"${label(element)}" is ${Math.round(width)} × ${Math.round(height)}px, under the 24 × 24px floor in WCAG 2.5.8.`
            : `"${label(element)}" is ${Math.round(width)} × ${Math.round(height)}px, below the ${settings.minTouchTarget}px recommendation for touch.`,
          evidence: [
            `Measured ${Math.round(width)} × ${Math.round(height)}px.`,
            belowNormative
              ? 'WCAG 2.5.8 (AA) requires at least 24 × 24 CSS pixels.'
              : `${settings.minTouchTarget}px is the platform recommendation for comfortable touch targets, not a WCAG requirement.`,
          ],
          impact: 'Small targets are hard to hit accurately, especially on touch screens or with reduced motor control.',
          recommendation: 'Increase the padding or the hit area, keeping the visual size if the design needs it.',
          elementIndex: element.index,
          severity: belowNormative ? 'high' : 'low',
          measurements: { width, height, threshold: settings.minTouchTarget },
        }),
      );
    }
    return results;
  },
};
