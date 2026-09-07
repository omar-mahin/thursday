import { describe, expect, it } from 'vitest';
import {
  contrastVerdict,
  formatPx,
  formatRatio,
  hexColor,
  isLargeText,
  primaryFamily,
  weightLabel,
} from '../../src/content/overlay/measure';

/**
 * What the ruler puts in its chips.
 *
 * All of it is formatting and thresholds, which is exactly the sort of code
 * that looks obviously right and rounds a 4.4999 into a pass.
 */

describe('the weight label', () => {
  it('names the weights people name', () => {
    expect(weightLabel(400)).toBe('Regular');
    expect(weightLabel(700)).toBe('Bold');
    expect(weightLabel(600)).toBe('Semibold');
  });

  it('shows the number for a weight with no common name', () => {
    // 450 is legal in a variable font. Inventing a name for it would be worse
    // than showing what the page actually said.
    expect(weightLabel(450)).toBe('450');
  });
});

describe('the font family', () => {
  it('takes the first family in the stack', () => {
    expect(primaryFamily('Georgia, "Times New Roman", serif')).toBe('Georgia');
  });

  it('unquotes a quoted family', () => {
    expect(primaryFamily('"Helvetica Neue", Arial, sans-serif')).toBe('Helvetica Neue');
    expect(primaryFamily("'Fira Code', monospace")).toBe('Fira Code');
  });

  it('says so rather than showing nothing', () => {
    expect(primaryFamily('')).toBe('unknown');
  });
});

describe('lengths in a chip', () => {
  it('keeps whole numbers whole', () => {
    expect(formatPx(24)).toBe('24px');
    expect(formatPx(0)).toBe('0px');
  });

  it('gives a fraction one decimal', () => {
    // Letter spacing is routinely fractional, and 0.9px is the difference
    // between a deliberate choice and a rounding artefact.
    expect(formatPx(0.9)).toBe('0.9px');
    expect(formatPx(21.44)).toBe('21.4px');
  });

  it('rounds rather than truncating', () => {
    expect(formatPx(1.96)).toBe('2px');
  });
});

describe('large text, for contrast purposes', () => {
  /*
   * WCAG 1.4.3 says 18pt, or 14pt bold. In CSS pixels those are 24 and 18.66,
   * and the fractional one is the whole reason this is tested: 18px bold is
   * *not* large, and treating it as large drops the requirement from 4.5 to 3
   * and turns a failure into a pass.
   */
  it('is 24px and up at any weight', () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(23.9, 400)).toBe(false);
  });

  it('is 18.66px and up when bold', () => {
    expect(isLargeText(18.67, 700)).toBe(true);
    expect(isLargeText(18, 700)).toBe(false);
  });

  it('is not large merely for being bold', () => {
    expect(isLargeText(16, 900)).toBe(false);
  });

  it('does not treat semibold as bold', () => {
    // 600 is not bold in WCAG's terms, however heavy it looks.
    expect(isLargeText(20, 600)).toBe(false);
  });
});

describe('the contrast verdict', () => {
  const verdict = (ratio: number, size = 16, weight = 400) => {
    const reading = contrastVerdict(ratio, size, weight);
    if (reading.kind !== 'measured') throw new Error('expected a measurement');
    return reading;
  };

  it('holds body text to 4.5 and 7', () => {
    expect(verdict(4.5)).toMatchObject({ aa: true, aaa: false });
    expect(verdict(4.49)).toMatchObject({ aa: false, aaa: false });
    expect(verdict(7)).toMatchObject({ aa: true, aaa: true });
  });

  it('holds large text to 3 and 4.5', () => {
    expect(verdict(3, 24)).toMatchObject({ aa: true, aaa: false, large: true });
    expect(verdict(2.99, 24)).toMatchObject({ aa: false, large: true });
    expect(verdict(4.5, 24)).toMatchObject({ aa: true, aaa: true });
  });

  it('is exactly at the threshold, not near it', () => {
    // WCAG is "at least", so the boundary passes. A > instead of a >= here
    // would fail every colour pair chosen to sit exactly on the line, which is
    // what a careful designer does.
    expect(verdict(4.5).aa).toBe(true);
    expect(verdict(7).aaa).toBe(true);
  });
});

describe('the ratio, as written', () => {
  it('shows two decimals', () => {
    expect(formatRatio(4.5)).toBe('4.50:1');
  });

  it('floors rather than rounding up', () => {
    // 4.499 rounded to two decimals is 4.50, which reads as a pass next to a
    // badge saying it failed. Flooring keeps the number and the verdict
    // telling the same story.
    expect(formatRatio(4.499)).toBe('4.49:1');
  });
});

describe('the colour chip', () => {
  it('writes an opaque colour as six hex digits', () => {
    expect(hexColor({ r: 51, g: 51, b: 51, a: 1 })).toBe('#333333');
    expect(hexColor({ r: 0, g: 0, b: 0, a: 1 })).toBe('#000000');
  });

  it('pads single digits', () => {
    expect(hexColor({ r: 1, g: 2, b: 3, a: 1 })).toBe('#010203');
  });

  it('keeps the alpha rather than dropping it', () => {
    // #a0a0a0 for something half transparent is a wrong answer, not a shorter
    // one -- and the alpha is often the reason the contrast is failing.
    expect(hexColor({ r: 160, g: 160, b: 160, a: 0.5 })).toBe('#a0a0a080');
  });

  it('clamps a colour outside the byte range', () => {
    expect(hexColor({ r: 300, g: -20, b: 128, a: 1 })).toBe('#ff0080');
  });

  it('rounds fractional channels, which compositing produces', () => {
    expect(hexColor({ r: 127.6, g: 127.4, b: 0, a: 1 })).toBe('#807f00');
  });
});
