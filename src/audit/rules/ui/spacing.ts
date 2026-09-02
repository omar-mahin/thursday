import type { ElementSnapshot, PageSnapshot } from '../../../shared/types';
import type { Rule } from '../../types';
import { describe, finding } from '../../types';
import { clusterNumbers, distanceToMultiple, fitScale, median } from '../../measure/cluster';

const GAP_TOLERANCE = 2;
const MIN_SAMPLE = 6;

/** Vertical gaps between consecutive siblings inside the same parent. */
function verticalGaps(snapshot: PageSnapshot, candidates: ElementSnapshot[]): Array<{ gap: number; element: ElementSnapshot }> {
  const byParent = new Map<number, ElementSnapshot[]>();
  for (const element of candidates) {
    if (element.parent === null) continue;
    if (element.styles.position === 'absolute' || element.styles.position === 'fixed') continue;
    const bucket = byParent.get(element.parent);
    if (bucket) bucket.push(element);
    else byParent.set(element.parent, [element]);
  }

  const gaps: Array<{ gap: number; element: ElementSnapshot }> = [];
  for (const siblings of byParent.values()) {
    if (siblings.length < 2) continue;
    const ordered = [...siblings].sort((a, b) => a.documentRect.y - b.documentRect.y);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      const gap = Math.round(current.documentRect.y - (previous.documentRect.y + previous.documentRect.height));
      // Negative means overlap; huge means unrelated sections.
      if (gap < 0 || gap > 160) continue;
      gaps.push({ gap, element: current });
    }
  }
  void snapshot;
  return gaps;
}

/**
 * UI-002 - spacing that does not fit the page's own scale.
 *
 * Phrased as "potential", and only when a scale actually exists: if the page's
 * gaps are already scattered there is no scale to violate. A 19px gap is not
 * wrong in the abstract -- it is only interesting next to a page built on 8s.
 */
export const spacingInconsistency: Rule = {
  id: 'UI-002',
  category: 'ui',
  kind: 'heuristic',
  scope: 'page',
  description: 'Spacing should follow a consistent scale',
  run({ snapshot, candidates }) {
    const gaps = verticalGaps(snapshot, candidates);
    if (gaps.length < MIN_SAMPLE) return [];

    const values = gaps.map((entry) => entry.gap);
    const fit = fitScale(values, GAP_TOLERANCE);
    // No scale means nothing to deviate from: a 19px gap is only interesting
    // next to a page built on 8s.
    if (!fit) return [];

    const oddOnes = gaps.filter((entry) => distanceToMultiple(entry.gap, fit.step) > GAP_TOLERANCE);
    if (oddOnes.length === 0 || oddOnes.length > gaps.length * 0.3) return [];

    const common = clusterNumbers(values, GAP_TOLERANCE)
      .filter((cluster) => cluster.length >= 2)
      .map((cluster) => Math.round(median(cluster)))
      .slice(0, 5);
    const worst = oddOnes[0]!;

    return [
      finding(spacingInconsistency, {
        title: 'Potential spacing inconsistency',
        summary: `A ${worst.gap}px gap does not fit the ${fit.step}px spacing rhythm the rest of the page follows.`,
        evidence: [
          `${Math.round(fit.coverage * 100)}% of ${gaps.length} measured gaps sit on a multiple of ${fit.step}px.`,
          ...(common.length > 0 ? [`Most common gaps: ${common.join(', ')}px.`] : []),
          ...oddOnes.slice(0, 4).map((entry) => `${entry.gap}px above ${describe(entry.element)}.`),
        ],
        impact: 'Off-scale spacing reads as accidental and makes grouping less obvious.',
        recommendation: `Snap these gaps to a multiple of ${fit.step}px, or confirm the exception is deliberate.`,
        elementIndex: worst.element.index,
        relatedIndexes: oddOnes.map((entry) => entry.element.index),
        severity: 'low',
        measurements: {
          outliers: oddOnes.length,
          sampled: gaps.length,
          gap: worst.gap,
          step: fit.step,
        },
      }),
    ];
  },
};

/**
 * UI-005 - elements in a section that almost line up.
 *
 * Only near-misses are reported. Two edges 40px apart are a layout decision;
 * two edges 3px apart are almost certainly a mistake, and that gap is exactly
 * what a designer wants flagged.
 */
export const alignmentInconsistency: Rule = {
  id: 'UI-005',
  category: 'ui',
  kind: 'heuristic',
  scope: 'page',
  description: 'Related elements should share an alignment edge',
  run({ candidates }) {
    const byParent = new Map<number, ElementSnapshot[]>();
    for (const element of candidates) {
      if (element.parent === null) continue;
      if (element.rect.width < 24) continue;
      if (element.styles.position === 'absolute' || element.styles.position === 'fixed') continue;
      const bucket = byParent.get(element.parent);
      if (bucket) bucket.push(element);
      else byParent.set(element.parent, [element]);
    }

    const results = [];
    for (const siblings of byParent.values()) {
      if (siblings.length < 3) continue;
      const edges = siblings.map((element) => ({ edge: element.documentRect.x, element }));
      const clusters = clusterNumbers(edges.map((entry) => entry.edge), 1);
      const dominant = clusters.reduce((best, cluster) => (cluster.length > best.length ? cluster : best), clusters[0]!);
      if (dominant.length < siblings.length - 1) continue;

      const dominantEdge = median(dominant);
      for (const entry of edges) {
        const distance = Math.abs(entry.edge - dominantEdge);
        if (distance <= 1 || distance > 8) continue; // aligned, or deliberately indented
        results.push(
          finding(alignmentInconsistency, {
            title: `Element is ${Math.round(distance)}px out of alignment`,
            summary: `${describe(entry.element)} starts ${Math.round(distance)}px away from the edge its ${dominant.length} siblings share.`,
            evidence: [
              `This element's left edge: ${Math.round(entry.edge)}px.`,
              `${dominant.length} siblings align at ${Math.round(dominantEdge)}px.`,
            ],
            impact: 'Near-misses on alignment read as sloppiness rather than intent.',
            recommendation: 'Align this element with its siblings, or offset it enough to look deliberate.',
            elementIndex: entry.element.index,
            severity: 'low',
            measurements: { offset: Math.round(distance), siblingEdge: Math.round(dominantEdge) },
          }),
        );
      }
    }
    return results;
  },
};
