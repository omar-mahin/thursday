import { beforeEach, describe, expect, it } from 'vitest';
import { competingCtas, isPromoted, navigationSize, visualWeight } from '../../../src/audit/rules/ux/hierarchy';
import { formLength, isInside, nonObviousClickable } from '../../../src/audit/rules/ux/forms';
import {
  duplicateLinkText,
  longParagraphs,
  readingDifficulty,
  sectionWithoutHeading,
  shoutingText,
  vagueLabels,
} from '../../../src/audit/rules/content/copy';
import { ctaAboveFold, heroCtaCount } from '../../../src/audit/rules/cro/cta';
import { fixedWidthBlocker, horizontalOverflow, tinyMobileText } from '../../../src/audit/rules/responsive/layout';
import { element, named, resetIndexes, run, snapshot } from '../helpers/snapshot';

beforeEach(resetIndexes);

const cta = (name: string, overrides = {}, styleOverrides = {}) =>
  named(name, {
    tagName: 'button',
    interactive: true,
    rect: { x: 0, y: 0, width: 160, height: 48 },
    documentRect: { x: 0, y: 0, width: 160, height: 48 },
    styles: { backgroundColor: 'rgb(37, 99, 235)', fontWeight: 700, ...styleOverrides },
    ...overrides,
  });

describe('UX-001 competing calls to action', () => {
  it('flags two near-identical actions in the same section', () => {
    const page = snapshot([
      element({ tagName: 'section' }),
      cta('Start free trial', { landmark: 0 }),
      cta('Book a demo', { landmark: 0 }),
    ]);
    const findings = run(competingCtas, page);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'UX-001', severity: 'medium' });
    expect(Number(findings[0]?.measurements?.['weightRatio'])).toBeGreaterThan(0.85);
  });

  it('accepts a clear primary and a smaller secondary', () => {
    const page = snapshot([
      element({ tagName: 'section' }),
      cta('Start free trial', { landmark: 0 }),
      cta('Learn how', {
        landmark: 0,
        rect: { x: 0, y: 0, width: 90, height: 30 },
        documentRect: { x: 0, y: 0, width: 90, height: 30 },
      }, { backgroundColor: 'rgba(0, 0, 0, 0)', fontWeight: 400 }),
    ]);
    expect(run(competingCtas, page)).toEqual([]);
  });

  it('ignores two identical buttons that were never promoted', () => {
    // Found by auditing Thursday's own panel. Treating every named button as a
    // call to action makes this rule fire on any application with a toolbar or
    // a list of clickable rows -- a control that is the same colour as the card
    // it sits on has not been promoted, whatever else is true of it.
    const page = snapshot([
      element({ tagName: 'section', styles: { backgroundColor: 'rgb(247, 248, 250)' } }),
      cta('Show on page', { landmark: 0, parent: 0 }, { backgroundColor: 'rgb(247, 248, 250)', fontWeight: 400 }),
      cta('Add to report', { landmark: 0, parent: 0 }, { backgroundColor: 'rgb(247, 248, 250)', fontWeight: 400 }),
    ]);
    expect(run(competingCtas, page)).toEqual([]);
  });

  it('ignores clickable list rows, which are rows and not actions', () => {
    const page = snapshot([
      element({ tagName: 'ul', styles: { backgroundColor: 'rgb(255, 255, 255)' } }),
      cta('2 x Form controls need a label', { landmark: 0, parent: 0 }, { backgroundColor: 'rgba(0, 0, 0, 0)' }),
      cta('3 x Targets are too small', { landmark: 0, parent: 0 }, { backgroundColor: 'rgba(0, 0, 0, 0)' }),
    ]);
    expect(run(competingCtas, page)).toEqual([]);
  });

  it('still flags two filled actions on a plain background', () => {
    // The case the rule exists for must survive the fix.
    const page = snapshot([
      element({ tagName: 'section', styles: { backgroundColor: 'rgb(255, 255, 255)' } }),
      cta('Start free trial', { landmark: 0, parent: 0 }, { backgroundColor: 'rgb(31, 79, 216)' }),
      cta('Book a demo', { landmark: 0, parent: 0 }, { backgroundColor: 'rgb(31, 79, 216)' }),
    ]);
    expect(run(competingCtas, page)).toHaveLength(1);
  });

  it('counts a shadow as promotion, since it lifts a control off the page', () => {
    resetIndexes();
    const parent = element({ tagName: 'section', styles: { backgroundColor: 'rgb(255, 255, 255)' } });
    const flat = cta('Flat', { parent: parent.index }, { backgroundColor: 'rgb(255, 255, 255)' });
    const raised = cta('Raised', { parent: parent.index }, {
      backgroundColor: 'rgb(255, 255, 255)',
      hasBoxShadow: true,
    });
    const page = snapshot([parent, flat, raised]);
    expect(isPromoted(page, flat)).toBe(false);
    expect(isPromoted(page, raised)).toBe(true);
  });

  it('does not compare actions in different sections', () => {
    const page = snapshot([
      element({ tagName: 'section' }),
      element({ tagName: 'footer' }),
      cta('Start', { landmark: 0 }),
      cta('Contact', { landmark: 1 }),
    ]);
    expect(run(competingCtas, page)).toEqual([]);
  });

  it('weighs size, colour and weight together', () => {
    const big = cta('Big');
    const small = cta('Small', { rect: { x: 0, y: 0, width: 40, height: 20 } }, { backgroundColor: 'rgba(0, 0, 0, 0)', fontWeight: 400 });
    expect(visualWeight(big)).toBeGreaterThan(visualWeight(small));
  });
});

describe('UX-002 navigation size', () => {
  const navWith = (count: number) => {
    const elements = [element({ tagName: 'nav' })];
    for (let i = 0; i < count; i += 1) {
      elements.push(named(`Link ${i}`, { tagName: 'a', landmark: 0, href: `https://x.test/${i}` }));
    }
    return snapshot(elements);
  };

  it('mentions an oversized navigation as info only', () => {
    const findings = run(navigationSize, navWith(10));
    expect(findings[0]).toMatchObject({ severity: 'info', type: 'heuristic' });
  });

  it('accepts a navigation within the scanning limit', () => {
    expect(run(navigationSize, navWith(6))).toEqual([]);
  });
});

describe('UX-003 form length', () => {
  const formWith = (fields: number, fieldsets = 0) => {
    const elements = [element({ tagName: 'form' })];
    for (let i = 0; i < fieldsets; i += 1) elements.push(element({ tagName: 'fieldset', parent: 0 }));
    for (let i = 0; i < fields; i += 1) {
      elements.push(
        element({ tagName: 'input', parent: 0, form: { type: 'text', required: i < 2, labelledBy: 'label-for' } }),
      );
    }
    return snapshot(elements);
  };

  it('flags a long ungrouped form', () => {
    const findings = run(formLength, formWith(10));
    expect(findings[0]).toMatchObject({ ruleId: 'UX-003', severity: 'medium' });
    expect(findings[0]?.measurements?.['fields']).toBe(10);
  });

  it('accepts a long form that is grouped into sections', () => {
    // Length is not the problem; length without structure is.
    expect(run(formLength, formWith(10, 3))).toEqual([]);
  });

  it('accepts a short form', () => {
    expect(run(formLength, formWith(4))).toEqual([]);
  });

  it('walks the parent chain to find nested fields', () => {
    const elements = [
      { index: 0, parent: null },
      { index: 1, parent: 0 },
      { index: 2, parent: 1 },
    ];
    expect(isInside(elements, elements[2]!, 0)).toBe(true);
    expect(isInside(elements, elements[0]!, 2)).toBe(false);
  });
});

describe('UX-004 non-obvious clickables', () => {
  it('flags a div that clicks but gives no signal', () => {
    const page = snapshot([element({ tagName: 'div', interactive: true, styles: { cursor: 'auto' } })]);
    const findings = run(nonObviousClickable, page);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.join(' ')).toMatch(/cursor/i);
  });

  it('accepts a div with a role and a pointer cursor', () => {
    const page = snapshot([
      element({ tagName: 'div', interactive: true, role: 'button', styles: { cursor: 'pointer' } }),
    ]);
    expect(run(nonObviousClickable, page)).toEqual([]);
  });

  it('leaves real buttons and links alone', () => {
    const page = snapshot([
      element({ tagName: 'button', interactive: true, styles: { cursor: 'auto' } }),
      element({ tagName: 'a', interactive: true, href: 'https://x.test' }),
    ]);
    expect(run(nonObviousClickable, page)).toEqual([]);
  });

  it('is more severe when the element is not focusable either', () => {
    const focusable = run(
      nonObviousClickable,
      snapshot([element({ tagName: 'div', interactive: true, focusable: true, styles: { cursor: 'auto' } })]),
    );
    const not = run(
      nonObviousClickable,
      snapshot([element({ tagName: 'div', interactive: true, focusable: false, styles: { cursor: 'auto' } })]),
    );
    expect(focusable[0]?.severity).toBe('low');
    expect(not[0]?.severity).toBe('medium');
  });
});

describe('CNT-001 vague labels', () => {
  it('flags labels that mean nothing out of context', () => {
    const page = snapshot([named('Learn more', { tagName: 'a', href: 'https://x.test/pricing' })]);
    const findings = run(vagueLabels, page);
    expect(findings[0]).toMatchObject({ ruleId: 'CNT-001', severity: 'medium', type: 'rule' });
  });

  it('accepts a label that describes its destination', () => {
    expect(run(vagueLabels, snapshot([named('See pricing plans', { tagName: 'a', href: '/p' })]))).toEqual([]);
  });

  it('leaves the empty case to A11Y-007', () => {
    expect(run(vagueLabels, snapshot([element({ tagName: 'a', href: '/p', interactive: true })]))).toEqual([]);
  });

  it('uses the configured phrase list', () => {
    const page = snapshot([named('Vamos', { tagName: 'a', href: '/p' })]);
    expect(run(vagueLabels, page)).toEqual([]);
    expect(run(vagueLabels, page, { minTouchTarget: 44, vaguePhrases: ['vamos'] })).toHaveLength(1);
  });
});

describe('CNT-002 duplicate link text', () => {
  it('flags one label pointing at several destinations', () => {
    const page = snapshot([
      named('Read the docs', { tagName: 'a', href: 'https://x.test/a' }),
      named('Read the docs', { tagName: 'a', href: 'https://x.test/b' }),
    ]);
    const findings = run(duplicateLinkText, page);
    expect(findings[0]?.measurements).toMatchObject({ occurrences: 2, destinations: 2 });
  });

  it('accepts repeated links to the same place', () => {
    const page = snapshot([
      named('Pricing', { tagName: 'a', href: 'https://x.test/p' }),
      named('Pricing', { tagName: 'a', href: 'https://x.test/p' }),
    ]);
    expect(run(duplicateLinkText, page)).toEqual([]);
  });
});

describe('CNT-003 long paragraphs', () => {
  it('flags a paragraph past the scanning threshold', () => {
    const text = 'word '.repeat(100).trim();
    const findings = run(longParagraphs, snapshot([element({ tagName: 'p', text })]));
    expect(findings[0]?.measurements?.['words']).toBeGreaterThanOrEqual(90);
  });

  it('uses the count measured before truncation, not the clipped sample', () => {
    // The snapshot caps text at 200 characters. Extrapolating from that sample
    // under-counted dense copy badly, so the count is measured at collection.
    const findings = run(
      longParagraphs,
      snapshot([element({ tagName: 'p', text: 'word '.repeat(40).trim(), textLength: 2000, wordCount: 300 })]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.measurements?.['words']).toBe(300);
  });

  it('accepts a normal paragraph', () => {
    expect(run(longParagraphs, snapshot([element({ tagName: 'p', text: 'A short, readable paragraph.' })]))).toEqual([]);
  });
});

describe('CNT-004 reading difficulty', () => {
  it('reports a high grade as information, never as a failure', () => {
    const dense =
      'Notwithstanding the aforementioned considerations regarding infrastructural orchestration, organizations implementing comprehensive transformation initiatives must necessarily accommodate substantial architectural heterogeneity throughout their distributed computational environments, particularly where legacy interoperability requirements constrain modernization trajectories.';
    const findings = run(readingDifficulty, snapshot([element({ tagName: 'p', text: dense })]));
    expect(findings[0]).toMatchObject({ severity: 'info' });
    expect(Number(findings[0]?.measurements?.['grade'])).toBeGreaterThan(12);
  });

  it('stays quiet on plain copy', () => {
    const plain =
      'We help you ship faster. The tool runs in your browser. You can try it now. No card is needed. It is free to start. We do not track you. Your data stays on your machine. Nothing is sent to a server. It just works.';
    expect(run(readingDifficulty, snapshot([element({ tagName: 'p', text: plain })]))).toEqual([]);
  });
});

describe('CNT-005 shouting text', () => {
  it('flags long passages of capitals in the content', () => {
    const findings = run(
      shoutingText,
      snapshot([element({ tagName: 'p', text: 'LIMITED TIME OFFER ENDS SOON ACT NOW' })]),
    );
    expect(findings).toHaveLength(1);
  });

  it('ignores capitals applied by CSS, where the source text is fine', () => {
    const page = snapshot([
      element({ tagName: 'p', text: 'LIMITED TIME OFFER ENDS SOON ACT NOW', styles: { textTransform: 'uppercase' } }),
    ]);
    expect(run(shoutingText, page)).toEqual([]);
  });

  it('ignores short acronyms and labels', () => {
    expect(run(shoutingText, snapshot([element({ tagName: 'span', text: 'API' })]))).toEqual([]);
  });
});

describe('CNT-006 unheaded content', () => {
  it('flags a long stretch of copy above the first heading', () => {
    const elements = [];
    for (let i = 0; i < 4; i += 1) {
      elements.push(element({ tagName: 'p', text: 'word '.repeat(40).trim(), precedingHeading: null }));
    }
    const findings = run(sectionWithoutHeading, snapshot(elements));
    expect(findings).toHaveLength(1);
  });

  it('accepts copy that sits under a heading', () => {
    const page = snapshot([
      element({ tagName: 'h2', headingLevel: 2, text: 'Section' }),
      element({ tagName: 'p', text: 'word '.repeat(200).trim(), precedingHeading: 0 }),
    ]);
    expect(run(sectionWithoutHeading, page)).toEqual([]);
  });
});

describe('CRO-001 action before the fold', () => {
  it('flags a page whose only actions are below the fold', () => {
    const page = snapshot([
      cta('Start free trial', { documentRect: { x: 0, y: 1600, width: 160, height: 48 } }),
    ]);
    const findings = run(ctaAboveFold, page);
    expect(findings[0]).toMatchObject({ ruleId: 'CRO-001', severity: 'medium' });
  });

  it('accepts a page with an action in the first screen', () => {
    expect(run(ctaAboveFold, snapshot([cta('Start free trial')]))).toEqual([]);
  });

  it('stays quiet on a page that asks for no action at all', () => {
    // Otherwise every documentation page and settings screen gets a finding.
    expect(run(ctaAboveFold, snapshot([element({ tagName: 'p', text: 'Reference material.' })]))).toEqual([]);
  });
});

describe('CRO-002 hero action count', () => {
  it('flags too many actions above the fold', () => {
    const elements = [];
    for (let i = 0; i < 5; i += 1) {
      elements.push(cta(`Action ${i}`, { documentRect: { x: 0, y: 100 + i * 60, width: 160, height: 48 } }));
    }
    const findings = run(heroCtaCount, snapshot(elements));
    expect(findings[0]?.measurements).toMatchObject({ count: 5 });
  });

  it('accepts a focused hero', () => {
    const page = snapshot([cta('Start free trial'), cta('See pricing')]);
    expect(run(heroCtaCount, page)).toEqual([]);
  });
});

describe('RESP-001 horizontal overflow', () => {
  it('flags sideways scrolling and names the widest offender', () => {
    const wide = element({
      tagName: 'div',
      rect: { x: 0, y: 0, width: 1600, height: 200 },
      documentRect: { x: 0, y: 0, width: 1600, height: 200 },
      classNames: ['too-wide'],
    });
    const page = snapshot([wide], {
      viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0, documentWidth: 1600, documentHeight: 900 },
    });
    const findings = run(horizontalOverflow, page);
    expect(findings[0]).toMatchObject({ severity: 'high', type: 'rule' });
    expect(findings[0]?.summary).toContain('div.too-wide');
    expect(findings[0]?.measurements?.['overflow']).toBe(320);
  });

  it('accepts a page that fits', () => {
    expect(run(horizontalOverflow, snapshot([element({})]))).toEqual([]);
  });

  it('tolerates a sub-pixel difference', () => {
    const page = snapshot([element({})], {
      viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0, documentWidth: 1281, documentHeight: 900 },
    });
    expect(run(horizontalOverflow, page)).toEqual([]);
  });
});

describe('RESP-002 fixed-width blockers', () => {
  it('flags a rigid element wider than a phone', () => {
    const page = snapshot([
      element({
        tagName: 'div',
        rect: { x: 0, y: 0, width: 1200, height: 100 },
        styles: { display: 'inline-block' },
      }),
    ]);
    const findings = run(fixedWidthBlocker, page);
    expect(findings[0]?.measurements?.['width']).toBe(1200);
  });

  it('accepts a block element that simply fills its container', () => {
    // A wide block reflows; a wide inline-block does not.
    const page = snapshot([element({ tagName: 'div', rect: { x: 0, y: 0, width: 1200, height: 100 } })]);
    expect(run(fixedWidthBlocker, page)).toEqual([]);
  });

  it('leaves media alone', () => {
    const page = snapshot([
      element({ tagName: 'img', rect: { x: 0, y: 0, width: 1200, height: 100 }, styles: { display: 'inline-block' } }),
    ]);
    expect(run(fixedWidthBlocker, page)).toEqual([]);
  });
});

describe('RESP-003 tiny text on small screens', () => {
  const mobile = (fontSize: number) =>
    snapshot([element({ tagName: 'p', text: 'Some copy', styles: { fontSize } })], {
      viewport: { width: 390, height: 844, devicePixelRatio: 3, scrollX: 0, scrollY: 0, documentWidth: 390, documentHeight: 1200 },
    });

  it('flags text under 12px on a phone viewport', () => {
    expect(run(tinyMobileText, mobile(10))[0]).toMatchObject({ severity: 'medium' });
  });

  it('accepts 12px and above', () => {
    expect(run(tinyMobileText, mobile(12))).toEqual([]);
  });

  it('does not run at all on a desktop viewport', () => {
    const desktop = snapshot([element({ tagName: 'p', text: 'Some copy', styles: { fontSize: 9 } })]);
    expect(run(tinyMobileText, desktop)).toEqual([]);
  });
});
