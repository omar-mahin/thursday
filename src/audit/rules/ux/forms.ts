import type { Rule } from '../../types';
import { describe, finding } from '../../types';

const FIELD_WARN_THRESHOLD = 8;

/**
 * UX-003 - a form with a lot of fields and no visible grouping.
 *
 * Field count alone is not a problem: a tax form has to be long. The signal is
 * length *without* grouping, so a form split into fieldsets is left alone.
 */
export const formLength: Rule = {
  id: 'UX-003',
  category: 'ux',
  kind: 'heuristic',
  scope: 'page',
  description: 'Long forms should be grouped into sections',
  run({ candidates }) {
    const forms = candidates.filter((element) => element.tagName === 'form');
    const results = [];

    for (const form of forms) {
      const inputs = candidates.filter(
        (element) =>
          element.form &&
          !['submit', 'reset', 'button', 'hidden'].includes(element.form.type) &&
          isInside(candidates, element, form.index),
      );
      if (inputs.length < FIELD_WARN_THRESHOLD) continue;

      const groups = candidates.filter(
        (element) => element.tagName === 'fieldset' && isInside(candidates, element, form.index),
      );
      if (groups.length >= 2) continue;

      const required = inputs.filter((element) => element.form?.required).length;
      results.push(
        finding(formLength, {
          title: `Form asks for ${inputs.length} fields with no grouping`,
          summary: `${describe(form)} has ${inputs.length} fields in a single ungrouped block, ${required} of them required.`,
          evidence: [
            `${inputs.length} input fields, ${required} required.`,
            groups.length === 0 ? 'No fieldsets group the fields.' : 'Only one fieldset was found.',
            `Field types: ${[...new Set(inputs.map((element) => element.form?.type))].join(', ')}.`,
          ],
          impact: 'A long undifferentiated form reads as more work than it is, and people abandon it.',
          recommendation: 'Group related fields into fieldsets with legends, or split the form into steps. Drop any field you do not need yet.',
          elementIndex: form.index,
          severity: 'medium',
          measurements: { fields: inputs.length, required, fieldsets: groups.length },
        }),
      );
    }
    return results;
  },
};

/** Walks the snapshot's parent chain, which is indices rather than references. */
function isInside(
  all: readonly { index: number; parent: number | null }[],
  element: { parent: number | null },
  ancestorIndex: number,
): boolean {
  let parent = element.parent;
  let hops = 0;
  while (parent !== null && hops < 30) {
    if (parent === ancestorIndex) return true;
    parent = all[parent]?.parent ?? null;
    hops += 1;
  }
  return false;
}

export { isInside };

/**
 * UX-004 - things that behave like buttons but do not look like them.
 *
 * A click handler on a div with a default cursor and no role: the page knows it
 * is interactive and nothing else does.
 */
export const nonObviousClickable: Rule = {
  id: 'UX-004',
  category: 'ux',
  kind: 'heuristic',
  scope: 'element',
  description: 'Interactive elements should look interactive',
  run({ candidates }) {
    const results = [];
    for (const element of candidates) {
      if (!element.interactive) continue;
      // Anchors, buttons and fields carry their own affordances. A label is
      // clickable by design but is not meant to look like a control.
      if (element.tagName === 'a' || element.tagName === 'button' || element.form) continue;
      if (element.tagName === 'label' || element.tagName === 'summary') continue;
      if (element.disabled) continue;

      const cursorSuggestsClick = element.styles.cursor === 'pointer';
      const hasRole = element.role === 'button' || element.role === 'link';
      const looksLikeControl =
        element.styles.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
        element.styles.borderWidths.some((width) => width > 0) ||
        element.styles.textDecorationLine.includes('underline');

      if (cursorSuggestsClick && (hasRole || looksLikeControl)) continue;

      const problems: string[] = [];
      if (!cursorSuggestsClick) problems.push(`cursor is "${element.styles.cursor}", not "pointer"`);
      if (!hasRole) problems.push('no button or link role');
      if (!looksLikeControl) problems.push('no background, border or underline to suggest a control');
      if (problems.length < 2) continue;

      results.push(
        finding(nonObviousClickable, {
          title: 'Clickable element does not look clickable',
          summary: `${describe(element)} responds to clicks but gives no visual signal that it does.`,
          evidence: [
            ...problems.map((problem) => `${problem[0]!.toUpperCase()}${problem.slice(1)}.`),
            element.focusable ? 'It is keyboard focusable.' : 'It is not keyboard focusable either.',
          ],
          impact: 'People do not discover functionality that gives them no affordance.',
          recommendation: 'Give it a pointer cursor and a visible affordance, and an explicit role so assistive tech agrees.',
          elementIndex: element.index,
          severity: element.focusable ? 'low' : 'medium',
          measurements: { cursor: element.styles.cursor, focusable: element.focusable },
        }),
      );
    }
    return results;
  },
};
