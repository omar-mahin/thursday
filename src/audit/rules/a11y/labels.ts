import type { Rule } from '../../types';
import { describe, finding } from '../../types';

const NEEDS_NO_LABEL = new Set(['hidden', 'submit', 'reset', 'button', 'image']);

/**
 * A11Y-002 - form control with no accessible label.
 *
 * A placeholder is deliberately treated as a partial answer rather than none:
 * it is announced by most screen readers but disappears the moment the field
 * has content, so it earns `medium`, not `high`. Overstating that as a full
 * violation is the kind of thing that makes people stop trusting a11y tools.
 */
export const missingFormLabel: Rule = {
  id: 'A11Y-002',
  category: 'a11y',
  kind: 'rule',
  scope: 'element',
  description: 'Form controls need a programmatically associated label',
  run({ candidates }) {
    const results = [];
    for (const element of candidates) {
      if (!element.form) continue;
      if (NEEDS_NO_LABEL.has(element.form.type)) continue;

      const source = element.form.labelledBy;
      if (source === 'label-for' || source === 'label-wrapped' || source === 'aria') continue;

      const placeholderOnly = source === 'placeholder';
      results.push(
        finding(missingFormLabel, {
          title: placeholderOnly ? 'Form field labelled only by its placeholder' : 'Form field has no label',
          summary: placeholderOnly
            ? `${describe(element)} relies on its placeholder for a name. Placeholders vanish once the field has content.`
            : `${describe(element)} has no associated label, so it is announced only by its type.`,
          evidence: [
            `Field type: ${element.form.type}.`,
            placeholderOnly
              ? `Accessible name comes from the placeholder "${element.placeholder ?? ''}".`
              : 'No label element, aria-label or aria-labelledby was found.',
            element.form.required ? 'The field is required.' : 'The field is optional.',
          ],
          impact: placeholderOnly
            ? 'Once someone types, the only description of the field disappears; screen reader support for placeholders is inconsistent.'
            : 'People using assistive tech cannot tell what this field expects.',
          recommendation: placeholderOnly
            ? 'Add a visible <label for> alongside the placeholder rather than instead of it.'
            : 'Add a <label for> pointing at this field, or an aria-label if a visible label is impossible.',
          elementIndex: element.index,
          severity: placeholderOnly ? 'medium' : 'high',
          measurements: { fieldType: element.form.type, labelledBy: source },
        }),
      );
    }
    return results;
  },
};

/**
 * A11Y-007 - interactive element with no accessible name.
 *
 * The unambiguous one: a button or link that announces nothing at all.
 */
export const emptyInteractive: Rule = {
  id: 'A11Y-007',
  category: 'a11y',
  kind: 'rule',
  scope: 'element',
  description: 'Buttons and links need an accessible name',
  run({ candidates }) {
    const results = [];
    for (const element of candidates) {
      if (!element.interactive) continue;
      if (element.form) continue; // covered by A11Y-002
      if (element.accessibleName.name) continue;
      if (element.tagName === 'label') continue;

      const isLink = element.tagName === 'a' || element.role === 'link';
      results.push(
        finding(emptyInteractive, {
          title: isLink ? 'Link has no accessible name' : 'Interactive element has no accessible name',
          summary: `${describe(element)} can be activated but announces nothing.`,
          evidence: [
            'No text content, aria-label, aria-labelledby, title or image alt text was found.',
            `Role: ${element.role ?? element.tagName}.`,
            `Rendered at ${Math.round(element.rect.width)} × ${Math.round(element.rect.height)}px.`,
          ],
          impact: 'Screen reader users hear only the role, with no indication of what it does.',
          recommendation: isLink
            ? 'Give the link text, or an aria-label describing its destination.'
            : 'Add visible text, or an aria-label describing the action.',
          elementIndex: element.index,
          severity: 'high',
        }),
      );
    }
    return results;
  },
};
