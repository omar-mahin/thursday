import { beforeEach, describe, expect, it } from 'vitest';
import { inconsistentButtons } from '../../../src/audit/rules/ui/buttons';
import { alignmentInconsistency, spacingInconsistency } from '../../../src/audit/rules/ui/spacing';
import { colorSprawl, typographySprawl } from '../../../src/audit/rules/ui/typography';
import { element, named, resetIndexes, run, snapshot } from '../helpers/snapshot';

beforeEach(resetIndexes);

const button = (name: string, styleOverrides = {}) =>
  named(name, {
    tagName: 'button',
    interactive: true,
    rect: { x: 0, y: 0, width: 120, height: 44 },
    styles: { backgroundColor: 'rgb(37, 99, 235)', color: 'rgb(255, 255, 255)', borderRadius: '8px', ...styleOverrides },
  });

describe('UI-001 inconsistent buttons', () => {
  it('flags a group that breaks the dominant style', () => {
    const page = snapshot([
      button('One'),
      button('Two'),
      button('Three'),
      button('Odd A', { borderRadius: '0px', backgroundColor: 'rgb(220, 38, 38)' }),
      button('Odd B', { borderRadius: '0px', backgroundColor: 'rgb(220, 38, 38)' }),
    ]);
    const findings = run(inconsistentButtons, page);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'UI-001', severity: 'low', type: 'heuristic' });
    expect(findings[0]?.measurements?.['inThisVariant']).toBe(2);
  });

  it('leaves a single deliberate primary button alone', () => {
    // A primary among secondaries is design, not drift -- the most important
    // false positive to avoid for this rule.
    const page = snapshot([
      button('Cancel', { backgroundColor: 'rgba(0, 0, 0, 0)' }),
      button('Back', { backgroundColor: 'rgba(0, 0, 0, 0)' }),
      button('Skip', { backgroundColor: 'rgba(0, 0, 0, 0)' }),
      button('Continue'),
    ]);
    expect(run(inconsistentButtons, page)).toEqual([]);
  });

  it('stays quiet with too few buttons to establish a norm', () => {
    const page = snapshot([button('One'), button('Two', { borderRadius: '0px' })]);
    expect(run(inconsistentButtons, page)).toEqual([]);
  });

  it('stays quiet when every button already matches', () => {
    const page = snapshot([button('A'), button('B'), button('C'), button('D')]);
    expect(run(inconsistentButtons, page)).toEqual([]);
  });

  it('stays quiet when styles are so scattered there is no norm', () => {
    const page = snapshot([
      button('A', { borderRadius: '0px' }),
      button('B', { borderRadius: '2px' }),
      button('C', { borderRadius: '4px' }),
      button('D', { borderRadius: '9px' }),
      button('E', { borderRadius: '12px' }),
    ]);
    expect(run(inconsistentButtons, page)).toEqual([]);
  });
});

describe('UI-002 spacing', () => {
  const stack = (gaps: number[]) => {
    const elements = [element({ tagName: 'section' })];
    let y = 0;
    for (const gap of gaps) {
      y += gap;
      elements.push(
        element({ tagName: 'p', parent: 0, text: 'copy', rect: { x: 0, y, width: 400, height: 20 }, documentRect: { x: 0, y, width: 400, height: 20 } }),
      );
      y += 20;
    }
    return snapshot(elements);
  };

  it('flags a value off the page scale', () => {
    const findings = run(spacingInconsistency, stack([16, 16, 16, 16, 8, 8, 19]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.measurements?.['gap']).toBe(19);
    expect(findings[0]?.title).toMatch(/potential/i);
  });

  it('accepts a page that sticks to its scale', () => {
    expect(run(spacingInconsistency, stack([8, 16, 16, 24, 24, 8, 16]))).toEqual([]);
  });

  it('stays quiet when there is no scale to violate', () => {
    // Scattered spacing means no norm; calling 19px wrong here would be
    // asserting a system the page does not have.
    expect(run(spacingInconsistency, stack([7, 13, 19, 23, 31, 37, 41]))).toEqual([]);
  });

  it('stays quiet on too small a sample', () => {
    expect(run(spacingInconsistency, stack([16, 19]))).toEqual([]);
  });
});

describe('UI-005 alignment', () => {
  const row = (xs: number[]) => {
    const elements = [element({ tagName: 'section' })];
    xs.forEach((x, position) => {
      const rect = { x, y: position * 40, width: 300, height: 30 };
      elements.push(element({ tagName: 'div', parent: 0, rect, documentRect: rect }));
    });
    return snapshot(elements);
  };

  it('flags a near-miss of a few pixels', () => {
    const findings = run(alignmentInconsistency, row([24, 24, 24, 27]));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.measurements?.['offset']).toBe(3);
  });

  it('accepts exact alignment', () => {
    expect(run(alignmentInconsistency, row([24, 24, 24, 24]))).toEqual([]);
  });

  it('accepts a deliberate indent', () => {
    // 40px away reads as intentional; 3px away reads as a mistake.
    expect(run(alignmentInconsistency, row([24, 24, 24, 64]))).toEqual([]);
  });
});

describe('UI-003 typography sprawl', () => {
  const textAt = (fontSize: number, fontWeight = 400, fontFamily = 'Inter, sans-serif') =>
    element({ tagName: 'p', text: 'some copy here', styles: { fontSize, fontWeight, fontFamily } });

  it('flags a page with more type styles than a system would have', () => {
    const elements = [];
    for (let size = 10; size < 24; size += 1) elements.push(textAt(size));
    const findings = run(typographySprawl, snapshot(elements));
    expect(findings).toHaveLength(1);
    expect(Number(findings[0]?.measurements?.['styles'])).toBeGreaterThan(12);
  });

  it('accepts a disciplined type scale', () => {
    const elements = [];
    for (const size of [14, 16, 16, 20, 24, 32, 16, 14, 16, 20]) elements.push(textAt(size));
    expect(run(typographySprawl, snapshot(elements))).toEqual([]);
  });

  it('stays quiet on a page with barely any text', () => {
    expect(run(typographySprawl, snapshot([textAt(12), textAt(14)]))).toEqual([]);
  });
});

describe('UI-006 colour sprawl', () => {
  const textIn = (color: string) => element({ tagName: 'p', text: 'copy', styles: { color } });

  it('flags near-identical colours, which no one picks on purpose', () => {
    const elements = [
      textIn('rgb(51, 51, 51)'),
      textIn('rgb(52, 52, 52)'),
      textIn('rgb(17, 17, 17)'),
      textIn('rgb(17, 17, 17)'),
      textIn('rgb(255, 255, 255)'),
      textIn('rgb(37, 99, 235)'),
      textIn('rgb(17, 17, 17)'),
      textIn('rgb(17, 17, 17)'),
    ];
    const findings = run(colorSprawl, snapshot(elements));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.measurements?.['nearDuplicatePairs']).toBe(1);
    expect(findings[0]?.evidence.join(' ')).toMatch(/visually identical/);
  });

  it('accepts a small distinct palette', () => {
    const elements = [];
    for (const color of ['rgb(17, 17, 17)', 'rgb(90, 90, 90)', 'rgb(37, 99, 235)']) {
      for (let i = 0; i < 3; i += 1) elements.push(textIn(color));
    }
    expect(run(colorSprawl, snapshot(elements))).toEqual([]);
  });
});
