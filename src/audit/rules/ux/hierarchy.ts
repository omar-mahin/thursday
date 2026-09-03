import type { ElementSnapshot, PageSnapshot } from '../../../shared/types';
import type { Rule } from '../../types';
import { finding, label } from '../../types';
import { resolveBackground } from '../../measure/background';
import { isOpaque, parseColor } from '../../measure/color';

/** Rough visual weight: area, boosted by strong colour and heavy type. */
export function visualWeight(element: ElementSnapshot): number {
  const area = element.rect.width * element.rect.height;
  const weightFactor = element.styles.fontWeight >= 600 ? 1.15 : 1;
  const filled = element.styles.backgroundColor !== 'rgba(0, 0, 0, 0)' ? 1.2 : 1;
  const sizeFactor = 1 + element.styles.fontSize / 100;
  return area * weightFactor * filled * sizeFactor;
}

const isButton = (element: ElementSnapshot): boolean =>
  (element.tagName === 'button' || element.role === 'button' || element.form?.type === 'submit') &&
  !element.disabled &&
  element.accessibleName.name.length > 0;

/**
 * Whether a control has been styled to attract, rather than merely being a
 * control.
 *
 * The distinction matters because it is the whole rule. Treating every named
 * button as a call to action makes UX-001 fire on any application with two
 * similar toolbar buttons or a list of clickable rows -- which Thursday's own
 * panel is, and which is how this was found. A call to action has been given a
 * treatment that separates it from its surroundings: a fill that differs from
 * the background behind it, or a shadow lifting it off the page. A button that
 * is the same colour as the card it sits on has not been promoted, whatever
 * else is true of it.
 */
export function isPromoted(snapshot: PageSnapshot, element: ElementSnapshot): boolean {
  if (element.styles.hasBoxShadow) return true;
  const own = parseColor(element.styles.backgroundColor);
  if (!own || own.a === 0) return false;

  const parent = element.parent === null ? undefined : snapshot.elements[element.parent];
  if (!parent) return isOpaque(own);
  const behind = resolveBackground(snapshot, parent);
  // An unknowable background cannot be shown to match, so a filled control on
  // one is taken at face value rather than dismissed.
  if (behind.kind === 'indeterminate') return true;
  return (
    Math.abs(own.r - behind.color.r) +
      Math.abs(own.g - behind.color.g) +
      Math.abs(own.b - behind.color.b) >
    FILL_DIFFERENCE
  );
}

/**
 * How different a fill has to be from its surroundings to read as promoted.
 * Summed across channels, so a nudge of two or three levels -- the kind used
 * for a subtle hover or a raised panel -- does not count as a call to action.
 */
const FILL_DIFFERENCE = 24;

/**
 * UX-001 - two calls to action of near-identical prominence in one section.
 *
 * This is measurable, which is why it is here and not left to the AI phase:
 * same section, near-identical visual weight, both primary-looking. What it
 * cannot know is which one the business wants people to press -- so it reports
 * the competition, not the answer.
 */
export const competingCtas: Rule = {
  id: 'UX-001',
  category: 'ux',
  kind: 'heuristic',
  scope: 'page',
  description: 'One action per section should be visually dominant',
  run({ candidates, snapshot }) {
    const bySection = new Map<number | null, ElementSnapshot[]>();
    for (const element of candidates) {
      if (!isButton(element) || !isPromoted(snapshot, element)) continue;
      const key = element.landmark;
      const bucket = bySection.get(key);
      if (bucket) bucket.push(element);
      else bySection.set(key, [element]);
    }

    const results = [];
    for (const buttons of bySection.values()) {
      if (buttons.length < 2) continue;
      const ranked = [...buttons].sort((a, b) => visualWeight(b) - visualWeight(a));
      const first = ranked[0]!;
      const second = ranked[1]!;
      const ratio = visualWeight(second) / visualWeight(first);
      if (ratio < 0.85) continue; // one is clearly dominant

      const sameTreatment = first.styles.backgroundColor === second.styles.backgroundColor;
      results.push(
        finding(competingCtas, {
          title: 'Two actions compete for the same attention',
          summary: `"${label(first)}" and "${label(second)}" sit in the same section with near-identical visual weight, so neither reads as the primary action.`,
          evidence: [
            `"${label(first)}": ${Math.round(first.rect.width)} × ${Math.round(first.rect.height)}px, ${first.styles.backgroundColor}, ${first.styles.fontSize}px/${first.styles.fontWeight}.`,
            `"${label(second)}": ${Math.round(second.rect.width)} × ${Math.round(second.rect.height)}px, ${second.styles.backgroundColor}, ${second.styles.fontSize}px/${second.styles.fontWeight}.`,
            `Visual weight differs by ${Math.round((1 - ratio) * 100)}%.`,
            sameTreatment ? 'Both use the same background colour.' : 'Backgrounds differ, but overall weight does not.',
          ],
          impact: 'Users have to stop and choose between two equally-loud options, which adds a decision they did not ask for.',
          recommendation: 'Keep one action prominent and demote the other to a secondary or text style.',
          elementIndex: second.index,
          relatedIndexes: [first.index, second.index],
          severity: 'medium',
          measurements: { weightRatio: Math.round(ratio * 100) / 100, sameBackground: sameTreatment },
        }),
      );
    }
    return results;
  },
};

const NAV_ITEM_LIMIT = 7;

/** UX-002 - a top-level navigation with more items than people can scan. */
export const navigationSize: Rule = {
  id: 'UX-002',
  category: 'ux',
  kind: 'heuristic',
  scope: 'page',
  description: 'Top-level navigation should stay scannable',
  run({ candidates }) {
    const navs = candidates.filter((element) => element.tagName === 'nav' || element.role === 'navigation');
    const results = [];
    for (const nav of navs) {
      const links = candidates.filter(
        (element) =>
          element.landmark === nav.index &&
          (element.tagName === 'a' || element.role === 'link') &&
          element.accessibleName.name.length > 0,
      );
      if (links.length <= NAV_ITEM_LIMIT) continue;
      results.push(
        finding(navigationSize, {
          title: `Navigation has ${links.length} top-level items`,
          summary: `${links.length} links sit at the top level of this navigation, past the point where people scan rather than read.`,
          evidence: [
            `${links.length} links found in this nav.`,
            `Labels: ${links.slice(0, 8).map((link) => `"${link.accessibleName.name}"`).join(', ')}${links.length > 8 ? '…' : ''}.`,
          ],
          impact: 'Long navigations get scanned less carefully, so important destinations get missed.',
          recommendation: 'Group related destinations, or move secondary ones into the footer or a submenu.',
          elementIndex: nav.index,
          severity: 'info',
          measurements: { items: links.length, limit: NAV_ITEM_LIMIT },
        }),
      );
    }
    return results;
  },
};
