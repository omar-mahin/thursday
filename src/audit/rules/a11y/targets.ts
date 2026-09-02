import type { Rule } from '../../types';
import { finding, label } from '../../types';

/** WCAG 2.5.8 (AA) requires 24x24. 44x44 is the usability recommendation. */
const WCAG_MINIMUM = 24;

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
  run({ candidates, settings }) {
    const results = [];
    for (const element of candidates) {
      if (!element.interactive) continue;
      if (element.disabled) continue;
      // Inline links inside a paragraph are sized by the text, not by design.
      if (element.tagName === 'a' && element.parent !== null && element.styles.display === 'inline') continue;

      const { width, height } = element.rect;
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
