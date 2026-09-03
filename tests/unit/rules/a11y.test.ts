import { beforeEach, describe, expect, it } from 'vitest';
import { imageMissingAlt } from '../../../src/audit/rules/a11y/images';
import { emptyInteractive, missingFormLabel } from '../../../src/audit/rules/a11y/labels';
import { lowContrast } from '../../../src/audit/rules/a11y/contrast';
import { smallTouchTarget } from '../../../src/audit/rules/a11y/targets';
import {
  documentBasics,
  duplicateIds,
  focusIndicator,
  headingHierarchy,
  positiveTabIndex,
} from '../../../src/audit/rules/a11y/structure';
import { element, named, resetIndexes, run, snapshot } from '../helpers/snapshot';

beforeEach(resetIndexes);

describe('A11Y-001 image alt text', () => {
  it('flags an img with no alt attribute', () => {
    const findings = run(imageMissingAlt, snapshot([element({ tagName: 'img', rect: { x: 0, y: 0, width: 400, height: 300 } })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'A11Y-001', severity: 'high', type: 'rule' });
  });

  it('treats a small unlabelled image as less severe than a large one', () => {
    const small = run(imageMissingAlt, snapshot([element({ tagName: 'img', rect: { x: 0, y: 0, width: 16, height: 16 } })]));
    expect(small[0]?.severity).toBe('medium');
  });

  it('accepts alt="" as a valid decorative declaration', () => {
    const findings = run(imageMissingAlt, snapshot([element({ tagName: 'img', alt: '', rect: { x: 0, y: 0, width: 20, height: 20 } })]));
    expect(findings).toEqual([]);
  });

  it('mentions, but does not fail, a large image marked decorative', () => {
    const findings = run(imageMissingAlt, snapshot([element({ tagName: 'img', alt: '', rect: { x: 0, y: 0, width: 600, height: 400 } })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'info', type: 'heuristic' });
  });

  it('says nothing about an image with real alt text', () => {
    expect(run(imageMissingAlt, snapshot([element({ tagName: 'img', alt: 'A cat asleep' })]))).toEqual([]);
  });
});

describe('A11Y-002 form labels', () => {
  const field = (labelledBy: 'none' | 'placeholder' | 'label-for', extra = {}) =>
    element({
      tagName: 'input',
      form: { type: 'email', required: false, labelledBy },
      ...extra,
    });

  it('flags a field with no label at all as high', () => {
    const findings = run(missingFormLabel, snapshot([field('none')]));
    expect(findings[0]).toMatchObject({ ruleId: 'A11Y-002', severity: 'high' });
  });

  it('treats a placeholder as a partial answer, not a full violation', () => {
    // Placeholders are announced but vanish on input, so this is medium.
    const findings = run(missingFormLabel, snapshot([field('placeholder', { placeholder: 'Email' })]));
    expect(findings[0]).toMatchObject({ severity: 'medium' });
    expect(findings[0]?.title).toMatch(/placeholder/i);
  });

  it('accepts a properly associated label', () => {
    expect(run(missingFormLabel, snapshot([field('label-for')]))).toEqual([]);
  });

  it('ignores buttons and hidden fields, which need no label', () => {
    const buttons = snapshot([
      element({ tagName: 'input', form: { type: 'submit', required: false, labelledBy: 'none' } }),
      element({ tagName: 'input', form: { type: 'hidden', required: false, labelledBy: 'none' } }),
    ]);
    expect(run(missingFormLabel, buttons)).toEqual([]);
  });

  it('records whether the field is required', () => {
    const findings = run(
      missingFormLabel,
      snapshot([element({ tagName: 'input', form: { type: 'text', required: true, labelledBy: 'none' } })]),
    );
    expect(findings[0]?.evidence.join(' ')).toContain('required');
  });
});

describe('A11Y-007 empty interactive elements', () => {
  it('flags a button that announces nothing', () => {
    const findings = run(emptyInteractive, snapshot([element({ tagName: 'button', interactive: true })]));
    expect(findings[0]).toMatchObject({ ruleId: 'A11Y-007', severity: 'high' });
  });

  it('says link when it is a link', () => {
    const findings = run(
      emptyInteractive,
      snapshot([element({ tagName: 'a', interactive: true, href: 'https://x.test/a' })]),
    );
    expect(findings[0]?.title).toMatch(/Link/);
  });

  it('accepts any accessible name, however it was derived', () => {
    expect(run(emptyInteractive, snapshot([named('Close', { tagName: 'button', interactive: true })]))).toEqual([]);
  });

  it('leaves form fields to A11Y-002', () => {
    const field = element({
      tagName: 'input',
      interactive: true,
      form: { type: 'text', required: false, labelledBy: 'none' },
    });
    expect(run(emptyInteractive, snapshot([field]))).toEqual([]);
  });

  it('ignores non-interactive elements', () => {
    expect(run(emptyInteractive, snapshot([element({ tagName: 'div' })]))).toEqual([]);
  });
});

describe('A11Y-003 contrast', () => {
  const text = (color: string, background: string, extra: Record<string, unknown> = {}) =>
    element({ tagName: 'p', text: 'Readable copy', styles: { color, backgroundColor: background, ...extra } });

  it('flags grey on white below 4.5:1', () => {
    const findings = run(lowContrast, snapshot([text('rgb(150, 150, 150)', 'rgb(255, 255, 255)')]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.measurements?.['ratio']).toBeLessThan(4.5);
    expect(findings[0]?.type).toBe('rule');
  });

  it('passes text that meets the threshold', () => {
    expect(run(lowContrast, snapshot([text('rgb(17, 17, 17)', 'rgb(255, 255, 255)')]))).toEqual([]);
  });

  it('applies the large-text threshold to large text', () => {
    // 3.5:1 fails for body copy but passes for 24px text.
    const grey = 'rgb(140, 140, 140)';
    const body = run(lowContrast, snapshot([text(grey, 'rgb(255, 255, 255)')]));
    const large = run(lowContrast, snapshot([text(grey, 'rgb(255, 255, 255)', { fontSize: 28 })]));
    expect(body).toHaveLength(1);
    expect(large).toEqual([]);
  });

  it('walks up to an opaque ancestor for a transparent background', () => {
    const page = snapshot([
      element({ tagName: 'section', styles: { backgroundColor: 'rgb(0, 0, 0)' } }),
      element({
        tagName: 'p',
        parent: 0,
        text: 'On black',
        styles: { color: 'rgb(30, 30, 30)', backgroundColor: 'rgba(0, 0, 0, 0)' },
      }),
    ]);
    const findings = run(lowContrast, page);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.join(' ')).toContain('rgb(0, 0, 0)');
  });

  it('reports indeterminate rather than guessing behind a background image', () => {
    const findings = run(
      lowContrast,
      snapshot([text('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)', { hasBackgroundImage: true })]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'info', type: 'heuristic' });
    expect(findings[0]?.title).toMatch(/could not be verified/i);
    expect(findings[0]?.measurements?.['ratio']).toBeUndefined();
  });

  it('reports indeterminate under a blend mode', () => {
    const findings = run(
      lowContrast,
      snapshot([text('rgb(120, 120, 120)', 'rgb(255, 255, 255)', { mixBlendMode: 'multiply' })]),
    );
    expect(findings[0]?.measurements?.['reason']).toBe('blend-mode');
  });

  it('escalates severity as the shortfall grows', () => {
    const bad = run(lowContrast, snapshot([text('rgb(230, 230, 230)', 'rgb(255, 255, 255)')]));
    const mild = run(lowContrast, snapshot([text('rgb(130, 130, 130)', 'rgb(255, 255, 255)')]));
    expect(bad[0]?.severity).toBe('critical');
    expect(mild[0]?.severity).toBe('medium');
  });

  it('ignores elements with no text', () => {
    expect(run(lowContrast, snapshot([element({ tagName: 'div' })]))).toEqual([]);
  });
});

describe('A11Y-004 touch targets', () => {
  const target = (width: number, height: number) =>
    named('Buy', { tagName: 'button', interactive: true, rect: { x: 0, y: 0, width, height } });

  it('calls a sub-24px target a rule violation, citing WCAG 2.5.8', () => {
    const findings = run(smallTouchTarget, snapshot([target(20, 20)]));
    expect(findings[0]).toMatchObject({ type: 'rule', severity: 'high' });
    expect(findings[0]?.evidence.join(' ')).toContain('2.5.8');
  });

  it('calls a 30px target a heuristic, not a violation', () => {
    // 44px is a platform recommendation; claiming it as WCAG would be inventing
    // a standard.
    const findings = run(smallTouchTarget, snapshot([target(30, 30)]));
    expect(findings[0]).toMatchObject({ type: 'heuristic', severity: 'low' });
    expect(findings[0]?.evidence.join(' ')).toContain('not a WCAG requirement');
  });

  it('accepts a target at the threshold', () => {
    expect(run(smallTouchTarget, snapshot([target(44, 44)]))).toEqual([]);
  });

  it('respects a configured threshold', () => {
    const page = snapshot([target(30, 30)]);
    expect(run(smallTouchTarget, page, { minTouchTarget: 24, vaguePhrases: [] })).toEqual([]);
  });

  it('ignores inline links inside text, which are sized by the copy', () => {
    const link = element({
      tagName: 'a',
      interactive: true,
      parent: 0,
      rect: { x: 0, y: 0, width: 60, height: 18 },
      styles: { display: 'inline' },
      accessibleName: { name: 'terms', source: 'text', weak: false },
    });
    expect(run(smallTouchTarget, snapshot([element({ tagName: 'p' }), link]))).toEqual([]);
  });

  it('ignores disabled controls', () => {
    const disabled = named('Buy', { tagName: 'button', interactive: true, disabled: true, rect: { x: 0, y: 0, width: 10, height: 10 } });
    expect(run(smallTouchTarget, snapshot([disabled]))).toEqual([]);
  });

  it('measures a wrapped checkbox by its label, which is the real target', () => {
    // Clicking anywhere in the label toggles the control, so the label is the
    // target WCAG 2.5.8 measures. Saying otherwise would fire on very nearly
    // every checkbox on the web. Found by auditing Thursday's own settings.
    resetIndexes();
    const wrapper = element({
      tagName: 'label',
      rect: { x: 0, y: 0, width: 180, height: 28 },
      documentRect: { x: 0, y: 0, width: 180, height: 28 },
    });
    const box = element({
      tagName: 'input',
      parent: wrapper.index,
      interactive: true,
      rect: { x: 0, y: 6, width: 16, height: 16 },
      documentRect: { x: 0, y: 6, width: 16, height: 16 },
      form: { type: 'checkbox', required: false, labelledBy: 'label-wrapped' },
    });
    expect(run(smallTouchTarget, snapshot([wrapper, box]))).toEqual([]);
  });

  it('still flags a checkbox whose label is no bigger than the control', () => {
    // A label sized to its control adds nothing, and taking it anyway would
    // hide a real defect.
    resetIndexes();
    const wrapper = element({
      tagName: 'label',
      rect: { x: 0, y: 0, width: 16, height: 16 },
      documentRect: { x: 0, y: 0, width: 16, height: 16 },
    });
    const box = element({
      tagName: 'input',
      parent: wrapper.index,
      interactive: true,
      rect: { x: 0, y: 0, width: 16, height: 16 },
      documentRect: { x: 0, y: 0, width: 16, height: 16 },
      form: { type: 'checkbox', required: false, labelledBy: 'label-wrapped' },
    });
    expect(run(smallTouchTarget, snapshot([wrapper, box]))).toHaveLength(1);
  });

  it('does not borrow a label the control is not inside', () => {
    resetIndexes();
    const box = element({
      tagName: 'input',
      interactive: true,
      rect: { x: 0, y: 0, width: 16, height: 16 },
      documentRect: { x: 0, y: 0, width: 16, height: 16 },
      form: { type: 'checkbox', required: false, labelledBy: 'label-for' },
    });
    expect(run(smallTouchTarget, snapshot([box]))).toHaveLength(1);
  });

  it('says nothing about a visually-hidden control', () => {
    // The sr-only pattern is on most real sites -- skip links, live regions,
    // the file input behind a styled button. With border-box a 1px input with
    // a 1px border measures 2 x 2. Found by auditing Thursday's own panel.
    expect(run(smallTouchTarget, snapshot([target(2, 2)]))).toEqual([]);
  });

  it('still flags a control that is small but visible', () => {
    expect(run(smallTouchTarget, snapshot([target(10, 10)]))).toHaveLength(1);
  });
});

describe('A11Y-005 heading hierarchy', () => {
  const heading = (level: number, text: string) =>
    element({ tagName: `h${level}`, headingLevel: level, text });

  it('flags a skipped level', () => {
    const findings = run(headingHierarchy, snapshot([heading(1, 'Title'), heading(4, 'Detail')]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'medium' });
    expect(findings[0]?.measurements).toEqual({ from: 1, to: 4 });
  });

  it('accepts a well-formed outline, including going back up', () => {
    const page = snapshot([heading(1, 'A'), heading(2, 'B'), heading(3, 'C'), heading(2, 'D')]);
    expect(run(headingHierarchy, page)).toEqual([]);
  });

  it('flags a page with no h1', () => {
    const findings = run(headingHierarchy, snapshot([heading(2, 'B'), heading(3, 'C')]));
    expect(findings[0]?.title).toMatch(/no h1/i);
  });

  it('mentions multiple h1s at low severity', () => {
    const findings = run(headingHierarchy, snapshot([heading(1, 'A'), heading(1, 'B')]));
    expect(findings[0]).toMatchObject({ severity: 'low' });
  });

  it('says nothing about a page with no headings at all', () => {
    expect(run(headingHierarchy, snapshot([element({ tagName: 'p', text: 'copy' })]))).toEqual([]);
  });
});

describe('A11Y-008 duplicate ids', () => {
  it('flags a repeated id and counts the occurrences', () => {
    const page = snapshot([element({ tagName: 'div', id: 'main' }), element({ tagName: 'section', id: 'main' })]);
    const findings = run(duplicateIds, page);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.measurements).toEqual({ id: 'main', count: 2 });
  });

  it('says nothing when ids are unique or absent', () => {
    const page = snapshot([element({ id: 'a' }), element({ id: 'b' }), element({})]);
    expect(run(duplicateIds, page)).toEqual([]);
  });
});

describe('A11Y-009 document basics', () => {
  it('flags a missing lang attribute', () => {
    const findings = run(documentBasics, snapshot([], { lang: null }));
    expect(findings[0]?.title).toMatch(/lang/);
  });

  it('flags an empty title', () => {
    const findings = run(documentBasics, snapshot([], { title: '   ' }));
    expect(findings[0]?.title).toMatch(/no title/i);
  });

  it('says nothing when both are present', () => {
    expect(run(documentBasics, snapshot([]))).toEqual([]);
  });
});

describe('A11Y-010 positive tabindex', () => {
  it('reports one finding covering every offender', () => {
    const page = snapshot([
      element({ tagName: 'div', tabIndex: 3 }),
      element({ tagName: 'div', tabIndex: 1 }),
      element({ tagName: 'div', tabIndex: 0 }),
    ]);
    const findings = run(positiveTabIndex, page);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.measurements).toEqual({ count: 2, highest: 3 });
  });

  it('accepts tabindex 0 and -1', () => {
    const page = snapshot([element({ tabIndex: 0 }), element({ tabIndex: -1 })]);
    expect(run(positiveTabIndex, page)).toEqual([]);
  });
});

describe('A11Y-006 focus indicator', () => {
  it('flags outlines removed with nothing put back', () => {
    const page = snapshot([], {
      styleSheets: { readableSheets: 2, unreadableSheets: 0, focusOutlineResets: 3, focusIndicatorRules: 0 },
    });
    const findings = run(focusIndicator, page);
    expect(findings[0]).toMatchObject({ severity: 'medium', type: 'heuristic' });
  });

  it('stays quiet when replacements exist', () => {
    const page = snapshot([], {
      styleSheets: { readableSheets: 2, unreadableSheets: 0, focusOutlineResets: 2, focusIndicatorRules: 2 },
    });
    expect(run(focusIndicator, page)).toEqual([]);
  });

  it('lowers severity and says so when stylesheets could not be read', () => {
    const page = snapshot([], {
      styleSheets: { readableSheets: 1, unreadableSheets: 2, focusOutlineResets: 1, focusIndicatorRules: 0 },
    });
    const findings = run(focusIndicator, page);
    expect(findings[0]?.severity).toBe('low');
    expect(findings[0]?.evidence.join(' ')).toMatch(/cross-origin/);
  });

  it('stays quiet when nothing removes an outline', () => {
    expect(run(focusIndicator, snapshot([]))).toEqual([]);
  });
});
