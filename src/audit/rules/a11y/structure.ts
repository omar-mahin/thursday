import type { Rule } from '../../types';
import { describe, finding } from '../../types';

/**
 * A11Y-005 - heading levels skipped.
 *
 * Reported as a structural issue with a medium ceiling. A skipped level makes a
 * document outline harder to navigate, but it is not the same class of problem
 * as an unlabelled control, and inflating it would drown out the things that
 * actually block people.
 */
export const headingHierarchy: Rule = {
  id: 'A11Y-005',
  category: 'a11y',
  kind: 'rule',
  scope: 'page',
  description: 'Heading levels should not skip, and a page needs exactly one h1',
  run({ candidates }) {
    const headings = candidates
      .filter((element) => element.headingLevel !== undefined)
      .sort((a, b) => a.index - b.index);
    if (headings.length === 0) return [];

    const results = [];
    const h1s = headings.filter((heading) => heading.headingLevel === 1);

    if (h1s.length === 0) {
      results.push(
        finding(headingHierarchy, {
          title: 'Page has no h1',
          summary: 'No level-1 heading was found, so the page has no top-level title in its outline.',
          evidence: [
            `${headings.length} heading${headings.length === 1 ? '' : 's'} found, starting at h${headings[0]?.headingLevel}.`,
          ],
          impact: 'Screen reader users navigating by heading have no anchor for what the page is about.',
          recommendation: 'Promote the main page title to an h1.',
          severity: 'medium',
          measurements: { headings: headings.length },
        }),
      );
    } else if (h1s.length > 1) {
      results.push(
        finding(headingHierarchy, {
          type: 'heuristic',
          title: `Page has ${h1s.length} h1 headings`,
          summary: `${h1s.length} level-1 headings compete to describe the page.`,
          evidence: h1s.slice(0, 4).map((heading) => `h1: "${heading.text ?? heading.accessibleName.name}"`),
          impact: 'The document outline no longer says which heading describes the page as a whole.',
          recommendation: 'Keep one h1 and demote the others to h2.',
          elementIndex: h1s[1]?.index,
          severity: 'low',
          measurements: { count: h1s.length },
        }),
      );
    }

    let previous = headings[0]!.headingLevel!;
    for (const heading of headings.slice(1)) {
      const level = heading.headingLevel!;
      if (level > previous + 1) {
        results.push(
          finding(headingHierarchy, {
            title: `Heading level jumps from h${previous} to h${level}`,
            summary: `"${heading.text ?? heading.accessibleName.name}" is an h${level} directly under an h${previous}, skipping ${level - previous - 1} level${level - previous - 1 === 1 ? '' : 's'}.`,
            evidence: [
              `Previous heading was h${previous}.`,
              `This heading is h${level}: "${(heading.text ?? heading.accessibleName.name).slice(0, 60)}".`,
            ],
            impact: 'People navigating by heading structure lose the sense of what is nested inside what.',
            recommendation: `Use h${previous + 1} here, or add the intermediate heading the outline implies.`,
            elementIndex: heading.index,
            severity: 'medium',
            measurements: { from: previous, to: level },
          }),
        );
      }
      previous = level;
    }
    return results;
  },
};

/**
 * A11Y-008 - duplicate ids.
 *
 * Trivial to detect and genuinely breaks things: aria-labelledby, label[for]
 * and every fragment link resolve to the first match only.
 */
export const duplicateIds: Rule = {
  id: 'A11Y-008',
  category: 'a11y',
  kind: 'rule',
  scope: 'page',
  description: 'Element ids must be unique',
  run({ candidates }) {
    const byId = new Map<string, number[]>();
    for (const element of candidates) {
      if (!element.id) continue;
      const bucket = byId.get(element.id);
      if (bucket) bucket.push(element.index);
      else byId.set(element.id, [element.index]);
    }

    const results = [];
    for (const [id, indexes] of byId) {
      if (indexes.length < 2) continue;
      results.push(
        finding(duplicateIds, {
          title: `Duplicate id "${id}"`,
          summary: `${indexes.length} elements share the id "${id}". Label and fragment references resolve to the first one only.`,
          evidence: [
            `id="${id}" appears ${indexes.length} times.`,
            'aria-labelledby, label[for] and #fragment links all resolve to the first match.',
          ],
          impact: 'Labels can attach to the wrong control, and in-page links can jump to the wrong place.',
          recommendation: 'Make each id unique, or use classes if the value is only used for styling.',
          elementIndex: indexes[1],
          relatedIndexes: indexes,
          severity: 'medium',
          measurements: { id, count: indexes.length },
        }),
      );
    }
    return results;
  },
};

/** A11Y-009 - the document-level basics: a language and a title. */
export const documentBasics: Rule = {
  id: 'A11Y-009',
  category: 'a11y',
  kind: 'rule',
  scope: 'page',
  description: 'The document needs a lang attribute and a non-empty title',
  run({ snapshot }) {
    const results = [];
    if (!snapshot.lang || snapshot.lang.trim() === '') {
      results.push(
        finding(documentBasics, {
          title: 'Page has no lang attribute',
          summary: 'The html element has no lang attribute, so assistive tech has to guess the language.',
          evidence: ['<html> has no lang attribute.'],
          impact: 'Screen readers may read the page with the wrong pronunciation rules.',
          recommendation: 'Add lang to the html element, e.g. <html lang="en">.',
          severity: 'medium',
        }),
      );
    }
    if (!snapshot.title || snapshot.title.trim() === '') {
      results.push(
        finding(documentBasics, {
          title: 'Page has no title',
          summary: 'The document title is empty, so tabs, history and screen readers have nothing to announce.',
          evidence: ['<title> is missing or empty.'],
          impact: 'People cannot tell this page apart from another in tabs, history or bookmarks.',
          recommendation: 'Give the page a title describing its content.',
          severity: 'medium',
        }),
      );
    }
    return results;
  },
};

/**
 * A11Y-010 - positive tabindex.
 *
 * Any value above 0 pulls an element to the front of the tab order, ahead of
 * everything in document order, and the two orders then diverge silently.
 */
export const positiveTabIndex: Rule = {
  id: 'A11Y-010',
  category: 'a11y',
  kind: 'rule',
  scope: 'element',
  description: 'tabindex above 0 breaks the natural focus order',
  run({ candidates }) {
    const offenders = candidates.filter((element) => element.tabIndex > 0);
    if (offenders.length === 0) return [];

    const first = offenders[0]!;
    return [
      finding(positiveTabIndex, {
        title: `${offenders.length} element${offenders.length === 1 ? ' uses' : 's use'} a positive tabindex`,
        summary: `tabindex="${first.tabIndex}" on ${describe(first)} moves it ahead of every other focusable element, regardless of where it sits on the page.`,
        evidence: offenders
          .slice(0, 5)
          .map((element) => `${describe(element)} has tabindex="${element.tabIndex}".`),
        impact: 'Keyboard focus jumps around in an order that does not match the visual layout.',
        recommendation: 'Use tabindex="0" and put the element where it belongs in the DOM.',
        elementIndex: first.index,
        relatedIndexes: offenders.map((element) => element.index),
        severity: 'medium',
        measurements: { count: offenders.length, highest: Math.max(...offenders.map((e) => e.tabIndex)) },
      }),
    ];
  },
};

/**
 * A11Y-006 - focus indicator removed.
 *
 * A CSSOM heuristic, not a measurement: we can see that rules remove the focus
 * outline and whether anything puts an indicator back, but we cannot render the
 * result. If the page's stylesheets could not be read at all, this stays quiet
 * rather than guessing.
 */
export const focusIndicator: Rule = {
  id: 'A11Y-006',
  category: 'a11y',
  kind: 'heuristic',
  scope: 'page',
  description: 'Focus styles should not be removed without a visible replacement',
  run({ snapshot }) {
    const facts = snapshot.styleSheets;
    if (facts.focusOutlineResets === 0) return [];
    if (facts.focusIndicatorRules >= facts.focusOutlineResets) return [];

    const unreadable = facts.unreadableSheets > 0;
    return [
      finding(focusIndicator, {
        title: 'Focus outline removed without a clear replacement',
        summary: `${facts.focusOutlineResets} stylesheet rule${facts.focusOutlineResets === 1 ? '' : 's'} remove the focus outline, and only ${facts.focusIndicatorRules} appear to add an indicator back.`,
        evidence: [
          `${facts.focusOutlineResets} rule(s) set outline to none or 0 on :focus.`,
          `${facts.focusIndicatorRules} rule(s) define an alternative focus indicator.`,
          unreadable
            ? `${facts.unreadableSheets} stylesheet(s) could not be read (cross-origin), so this may be incomplete.`
            : `All ${facts.readableSheets} stylesheet(s) were readable.`,
        ],
        impact: 'Keyboard users cannot see where they are on the page.',
        recommendation: 'Pair every outline reset with a visible :focus-visible style.',
        severity: unreadable ? 'low' : 'medium',
        measurements: {
          resets: facts.focusOutlineResets,
          indicators: facts.focusIndicatorRules,
          unreadableSheets: facts.unreadableSheets,
        },
      }),
    ];
  },
};
