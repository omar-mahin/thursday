import type { ElementSnapshot } from '../../../shared/types';
import type { Rule } from '../../types';
import { finding, label } from '../../types';
import { visualWeight } from '../ux/hierarchy';

const isCta = (element: ElementSnapshot): boolean =>
  (element.tagName === 'button' || element.role === 'button' || element.form?.type === 'submit') &&
  !element.disabled &&
  element.accessibleName.name.length > 0;

/**
 * CRO-001 - the page has calls to action, but none above the fold.
 *
 * Framed as a conditional on purpose. "No CTA in the first viewport" fires on
 * every documentation page, blog post and settings screen, which is noise. The
 * defensible version is: this page clearly wants people to act, and gives them
 * nothing to act on until they scroll.
 */
export const ctaAboveFold: Rule = {
  id: 'CRO-001',
  category: 'cro',
  kind: 'heuristic',
  scope: 'page',
  description: 'A page with calls to action should offer one before scrolling',
  run({ snapshot, candidates }) {
    const ctas = candidates.filter(isCta);
    if (ctas.length === 0) return []; // not a page that asks for an action

    const fold = snapshot.viewport.height;
    const aboveFold = ctas.filter((element) => element.documentRect.y < fold);
    if (aboveFold.length > 0) return [];

    const first = [...ctas].sort((a, b) => a.documentRect.y - b.documentRect.y)[0]!;
    const scrolls = Math.round((first.documentRect.y / fold) * 10) / 10;

    return [
      finding(ctaAboveFold, {
        title: 'No call to action before the fold',
        summary: `The page has ${ctas.length} action${ctas.length === 1 ? '' : 's'}, and the first appears ${Math.round(first.documentRect.y)}px down -- about ${scrolls} screens.`,
        evidence: [
          `Viewport height: ${fold}px.`,
          `First action "${label(first)}" starts at ${Math.round(first.documentRect.y)}px.`,
          `${ctas.length} action(s) found on the page in total.`,
        ],
        impact: 'People who do not scroll never see that there is anything to do here.',
        recommendation: 'Move a primary action into the first screen, or repeat it there.',
        elementIndex: first.index,
        severity: 'medium',
        measurements: { firstCtaY: first.documentRect.y, viewportHeight: fold, screens: scrolls },
      }),
    ];
  },
};

const HERO_CTA_LIMIT = 3;

/** CRO-002 - too many actions competing in the first screen. */
export const heroCtaCount: Rule = {
  id: 'CRO-002',
  category: 'cro',
  kind: 'heuristic',
  scope: 'page',
  description: 'The first screen should not offer too many competing actions',
  run({ snapshot, candidates }) {
    const fold = snapshot.viewport.height;
    const hero = candidates.filter(
      (element) => isCta(element) && element.documentRect.y < fold && element.landmark === null,
    );
    if (hero.length <= HERO_CTA_LIMIT) return [];

    const ranked = [...hero].sort((a, b) => visualWeight(b) - visualWeight(a));
    return [
      finding(heroCtaCount, {
        title: `${hero.length} actions compete in the first screen`,
        summary: `The area above the fold offers ${hero.length} actions outside any landmark, so there is no obvious next step.`,
        evidence: [
          `${hero.length} actions above the ${fold}px fold.`,
          `Labels: ${ranked.slice(0, 6).map((element) => `"${label(element)}"`).join(', ')}.`,
        ],
        impact: 'More choices at the top of the page means more deliberation before anyone does anything.',
        recommendation: 'Lead with one action and move the rest further down or into secondary styling.',
        elementIndex: ranked[0]?.index,
        relatedIndexes: hero.map((element) => element.index),
        severity: 'low',
        measurements: { count: hero.length, limit: HERO_CTA_LIMIT },
      }),
    ];
  },
};
