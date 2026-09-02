import type { ElementSnapshot } from '../../../shared/types';
import type { Rule } from '../../types';
import { finding, label } from '../../types';
import { findOutliers, groupBy } from '../../measure/cluster';

const signature = (element: ElementSnapshot): string => {
  const styles = element.styles;
  return [
    styles.backgroundColor,
    styles.color,
    styles.borderRadius,
    styles.borderWidths.join('/'),
    `${styles.fontSize}/${styles.fontWeight}`,
    styles.padding.join('/'),
  ].join(' | ');
};

const isButtonLike = (element: ElementSnapshot): boolean =>
  element.tagName === 'button' ||
  element.role === 'button' ||
  element.form?.type === 'submit';

/**
 * UI-001 - buttons that break the page's own button style.
 *
 * Requires a dominant style before anything counts as a deviation: three
 * buttons agreeing is a system, two buttons disagreeing is just two buttons.
 * Without that floor this rule fires on every page that has a primary and a
 * secondary button, which is most of them.
 */
export const inconsistentButtons: Rule = {
  id: 'UI-001',
  category: 'ui',
  kind: 'heuristic',
  scope: 'page',
  description: 'Buttons on a page should share a consistent visual treatment',
  run({ candidates }) {
    const buttons = candidates.filter((element) => isButtonLike(element) && !element.disabled);
    if (buttons.length < 4) return [];

    const clusters = groupBy(buttons, signature);
    const split = findOutliers(clusters, { minimumMajority: 3, maximumOutlierShare: 0.4 });
    if (!split) return [];

    const results = [];
    for (const outlier of split.outliers) {
      // A single deliberate primary button is normal design, not an error.
      if (outlier.items.length === 1 && split.outliers.length === 1) continue;
      const first = outlier.items[0]!;
      const majority = split.majority.items[0]!;
      results.push(
        finding(inconsistentButtons, {
          title: 'Button style differs from the rest of the page',
          summary: `${outlier.items.length} button${outlier.items.length === 1 ? '' : 's'} use a treatment that ${split.majority.items.length} other buttons do not share.`,
          evidence: [
            `"${label(first)}": ${first.styles.backgroundColor}, radius ${first.styles.borderRadius}, ${first.styles.fontSize}px/${first.styles.fontWeight}.`,
            `Dominant style (${split.majority.items.length} buttons): ${majority.styles.backgroundColor}, radius ${majority.styles.borderRadius}, ${majority.styles.fontSize}px/${majority.styles.fontWeight}.`,
            `${clusters.length} distinct button styles on the page.`,
          ],
          impact: 'Inconsistent controls make it harder to learn what is clickable and which action matters.',
          recommendation: 'Reuse the shared button styles, or make the difference intentional and systematic.',
          elementIndex: first.index,
          relatedIndexes: outlier.items.map((item) => item.index),
          severity: 'low',
          measurements: { variants: clusters.length, inThisVariant: outlier.items.length },
        }),
      );
    }
    return results;
  },
};
