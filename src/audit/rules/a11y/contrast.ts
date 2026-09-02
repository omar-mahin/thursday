import type { Rule } from '../../types';
import { describe, finding } from '../../types';
import { INDETERMINATE_EXPLANATION, resolveBackground } from '../../measure/background';
import { contrastRatio, contrastTarget, formatColor, parseColor } from '../../measure/color';

const MIN_TEXT_LENGTH = 2;

/**
 * A11Y-003 - text contrast below the WCAG threshold.
 *
 * Deliberately reports three outcomes rather than two: pass, fail, and
 * "could not be determined". The third is the honest answer whenever the
 * background is an image, a gradient, or affected by a blend mode -- and it is
 * emitted as `info` with the reason, never as a violation (PLAN.md section 2.3).
 */
export const lowContrast: Rule = {
  id: 'A11Y-003',
  category: 'a11y',
  kind: 'rule',
  scope: 'element',
  description: 'Text must meet the WCAG 1.4.3 contrast ratio against its background',
  run({ snapshot, candidates }) {
    const results = [];
    for (const element of candidates) {
      const text = element.text?.trim();
      if (!text || text.length < MIN_TEXT_LENGTH) continue;

      const foreground = parseColor(element.styles.color);
      if (!foreground) continue;
      if (foreground.a < 0.1) continue; // effectively invisible; not a contrast problem

      const background = resolveBackground(snapshot, element);
      const target = contrastTarget(element.styles.fontSize, element.styles.fontWeight);

      if (background.kind === 'indeterminate') {
        results.push(
          finding(lowContrast, {
            type: 'heuristic',
            title: 'Contrast could not be verified',
            summary: `Contrast for ${describe(element)} could not be measured because ${INDETERMINATE_EXPLANATION[background.reason]}.`,
            evidence: [
              `Text colour: ${formatColor(foreground)}.`,
              `Reason: ${INDETERMINATE_EXPLANATION[background.reason]}${background.detail ? ` (${background.detail})` : ''}.`,
              `Needs ${target.ratio}:1 at ${element.styles.fontSize}px / ${element.styles.fontWeight}.`,
            ],
            impact: 'The text may be hard to read, but this needs a visual check rather than a calculation.',
            recommendation: 'Check this text by eye against its darkest and lightest background areas.',
            elementIndex: element.index,
            severity: 'info',
            measurements: { reason: background.reason, target: target.ratio },
          }),
        );
        continue;
      }

      const composited = foreground.a < 0.999
        ? { ...foreground, a: 1, r: foreground.r, g: foreground.g, b: foreground.b }
        : foreground;
      const ratio = contrastRatio(composited, background.color);
      if (ratio >= target.ratio) continue;

      const shortfall = Math.round((target.ratio - ratio) * 100) / 100;
      results.push(
        finding(lowContrast, {
          title: `Text contrast ${ratio}:1 is below the ${target.ratio}:1 minimum`,
          summary: `${describe(element)} has a contrast ratio of ${ratio}:1 against its background, short of the WCAG minimum by ${shortfall}.`,
          evidence: [
            `Text colour ${formatColor(foreground)} on ${formatColor(background.color)}.`,
            `Measured ratio ${ratio}:1; WCAG 1.4.3 requires ${target.ratio}:1 for ${target.large ? 'large' : 'normal'} text.`,
            `Font: ${element.styles.fontSize}px, weight ${element.styles.fontWeight}.`,
            `Text: "${text.slice(0, 60)}".`,
          ],
          impact: 'People with low vision, and anyone in bright light, will struggle to read this.',
          recommendation: `Darken the text or lighten the background until the ratio reaches ${target.ratio}:1.`,
          elementIndex: element.index,
          severity: ratio < target.ratio / 2 ? 'critical' : ratio < 3 ? 'high' : 'medium',
          measurements: {
            ratio,
            target: target.ratio,
            fontSize: element.styles.fontSize,
            fontWeight: element.styles.fontWeight,
            largeText: target.large,
          },
        }),
      );
    }
    return results;
  },
};
