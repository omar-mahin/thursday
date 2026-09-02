import type { ElementSnapshot } from '../../../shared/types';
import type { Rule } from '../../types';
import { finding } from '../../types';
import { colorDistance, parseColor } from '../../measure/color';
import { groupBy } from '../../measure/cluster';

const TYPE_SPRAWL_LIMIT = 12;
const COLOR_SPRAWL_LIMIT = 12;
/** Below this distance two colours are indistinguishable in practice. */
const NEAR_DUPLICATE_DISTANCE = 24;

const hasText = (element: ElementSnapshot): boolean => (element.text?.trim().length ?? 0) > 1;

/**
 * UI-003 - more type styles than a system would have.
 *
 * Counts distinct family/size/weight triples on text-bearing elements. A number
 * alone is not a defect, so this is an observation with the count and the list,
 * leaving the judgement to the person reading it.
 */
export const typographySprawl: Rule = {
  id: 'UI-003',
  category: 'ui',
  kind: 'heuristic',
  scope: 'page',
  description: 'A page should draw on a small set of type styles',
  run({ candidates }) {
    const textElements = candidates.filter(hasText);
    if (textElements.length < 8) return [];

    const clusters = groupBy(
      textElements,
      (element) =>
        `${element.styles.fontFamily.split(',')[0]?.trim() ?? ''} ${element.styles.fontSize} ${element.styles.fontWeight}`,
    );
    if (clusters.length <= TYPE_SPRAWL_LIMIT) return [];

    const families = new Set(
      textElements.map((element) => element.styles.fontFamily.split(',')[0]?.trim().replace(/"/g, '') ?? ''),
    );
    const sizes = [...new Set(textElements.map((element) => element.styles.fontSize))].sort((a, b) => a - b);

    return [
      finding(typographySprawl, {
        title: `${clusters.length} distinct type styles on one page`,
        summary: `The page renders text in ${clusters.length} different family/size/weight combinations across ${families.size} font ${families.size === 1 ? 'family' : 'families'}.`,
        evidence: [
          `${clusters.length} distinct family/size/weight combinations.`,
          `${sizes.length} distinct font sizes: ${sizes.slice(0, 12).join(', ')}px${sizes.length > 12 ? '…' : ''}.`,
          `Families in use: ${[...families].slice(0, 4).join(', ')}.`,
          ...clusters.slice(0, 4).map((cluster) => `${cluster.items.length}× ${cluster.key}`),
        ],
        impact: 'A wide type inventory makes hierarchy harder to read and the design harder to maintain.',
        recommendation: 'Consolidate onto a defined type scale and reuse its steps.',
        severity: 'low',
        measurements: { styles: clusters.length, sizes: sizes.length, families: families.size },
      }),
    ];
  },
};

/**
 * UI-006 - colour sprawl, with near-duplicates called out.
 *
 * The interesting signal is not the count but the pairs: #333 next to #343434
 * is a value that escaped the system, and no human would choose both on purpose.
 */
export const colorSprawl: Rule = {
  id: 'UI-006',
  category: 'ui',
  kind: 'heuristic',
  scope: 'page',
  description: 'Text colours should come from a defined palette',
  run({ candidates }) {
    const textElements = candidates.filter(hasText);
    if (textElements.length < 8) return [];

    const counts = new Map<string, number>();
    for (const element of textElements) {
      counts.set(element.styles.color, (counts.get(element.styles.color) ?? 0) + 1);
    }
    const colors = [...counts.keys()];

    const nearDuplicates: Array<[string, string, number]> = [];
    for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        const a = parseColor(colors[i]!);
        const b = parseColor(colors[j]!);
        if (!a || !b) continue;
        const distance = colorDistance(a, b);
        if (distance > 0 && distance < NEAR_DUPLICATE_DISTANCE) {
          nearDuplicates.push([colors[i]!, colors[j]!, Math.round(distance)]);
        }
      }
    }

    if (nearDuplicates.length === 0 && colors.length <= COLOR_SPRAWL_LIMIT) return [];

    const evidence = [`${colors.length} distinct text colours across ${textElements.length} text elements.`];
    for (const [a, b, distance] of nearDuplicates.slice(0, 4)) {
      evidence.push(`${a} and ${b} are visually identical (distance ${distance}).`);
    }

    return [
      finding(colorSprawl, {
        title: nearDuplicates.length > 0
          ? 'Near-duplicate text colours in use'
          : `${colors.length} distinct text colours on one page`,
        summary: nearDuplicates.length > 0
          ? `${nearDuplicates.length} pair${nearDuplicates.length === 1 ? '' : 's'} of text colours differ by an amount no one can see, which usually means a value escaped the palette.`
          : `The page uses ${colors.length} different text colours.`,
        evidence,
        impact: 'Colours outside the palette are invisible to the eye but make the design drift over time.',
        recommendation: 'Collapse near-identical colours onto one palette token.',
        severity: 'low',
        measurements: { colors: colors.length, nearDuplicatePairs: nearDuplicates.length },
      }),
    ];
  },
};
