import type { Rule } from '../../types';
import { describe, finding } from '../../types';

/**
 * A11Y-001 - image missing alt text.
 *
 * The three cases are genuinely different and must not be collapsed:
 *  - no alt attribute at all: the browser has nothing to announce (violation)
 *  - alt="": an explicit, valid claim that the image is decorative
 *  - alt="" on something that looks informative: worth mentioning, not failing
 *
 * "Looks informative" is a size and position heuristic, so it is reported as
 * `info` -- only the missing attribute is stated as a rule.
 */
export const imageMissingAlt: Rule = {
  id: 'A11Y-001',
  category: 'a11y',
  kind: 'rule',
  scope: 'element',
  description: 'Images need alt text, or an explicit empty alt if decorative',
  run({ candidates }) {
    const results = [];
    for (const element of candidates) {
      if (element.tagName !== 'img') continue;

      const hasAttribute = element.alt !== undefined;
      const isEmpty = element.alt === '';
      const area = element.rect.width * element.rect.height;
      const looksInformative = area >= 3600; // 60x60 and up

      if (!hasAttribute) {
        results.push(
          finding(imageMissingAlt, {
            title: 'Image has no alt attribute',
            summary: `${describe(element)} has no alt attribute, so screen readers fall back to announcing its file name or nothing at all.`,
            evidence: [
              'The img element has no alt attribute.',
              `Rendered at ${Math.round(element.rect.width)} × ${Math.round(element.rect.height)}px.`,
            ],
            impact: 'People using a screen reader do not learn what this image conveys.',
            recommendation: looksInformative
              ? 'Add alt text describing what the image communicates. If it is purely decorative, use alt="".'
              : 'Add alt="" if the image is decorative, or descriptive alt text if it carries meaning.',
            elementIndex: element.index,
            severity: looksInformative ? 'high' : 'medium',
            measurements: { width: element.rect.width, height: element.rect.height },
          }),
        );
        continue;
      }

      if (isEmpty && looksInformative) {
        results.push(
          finding(imageMissingAlt, {
            type: 'heuristic',
            title: 'Large image marked decorative',
            summary: `${describe(element)} uses alt="" but is ${Math.round(element.rect.width)} × ${Math.round(element.rect.height)}px, which is large for a decorative image.`,
            evidence: [
              'alt="" declares the image decorative.',
              `Rendered at ${Math.round(element.rect.width)} × ${Math.round(element.rect.height)}px.`,
            ],
            impact: 'If the image carries meaning, that meaning is not available to screen readers.',
            recommendation: 'Confirm the image is genuinely decorative; if it is not, describe it in alt text.',
            elementIndex: element.index,
            severity: 'info',
            measurements: { width: element.rect.width, height: element.rect.height },
          }),
        );
      }
    }
    return results;
  },
};
