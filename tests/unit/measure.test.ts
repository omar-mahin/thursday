import { describe, expect, it } from 'vitest';
import {
  colorDistance,
  composite,
  contrastRatio,
  contrastTarget,
  parseColor,
  relativeLuminance,
} from '../../src/audit/measure/color';
import {
  clusterNumbers,
  distanceToMultiple,
  findOutliers,
  fitScale,
  groupBy,
  inferStep,
  median,
  nearest,
  STEP_CANDIDATES,
} from '../../src/audit/measure/cluster';
import { countSyllables, normalizeLabel, readability, upperCaseRatio, words } from '../../src/audit/measure/text';

describe('parseColor', () => {
  it('reads the forms getComputedStyle actually returns', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it('reads hex in all four lengths', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor('#ff000080')?.a).toBeCloseTo(0.502, 2);
  });

  it('returns null rather than guessing at colours it cannot resolve', () => {
    // Reporting "unparseable" makes contrast indeterminate, which is the honest
    // outcome; a guess here would produce a fabricated ratio.
    expect(parseColor('oklch(0.7 0.1 200)')).toBeNull();
    expect(parseColor('rebeccapurple')).toBeNull();
    expect(parseColor('var(--brand)')).toBeNull();
  });
});

describe('contrast maths', () => {
  it('matches the known WCAG reference values', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(contrastRatio(black, white)).toBe(21);
    expect(contrastRatio(white, white)).toBe(1);
    // #767676 on white is the canonical 4.54:1 boundary case.
    expect(contrastRatio({ r: 118, g: 118, b: 118, a: 1 }, white)).toBeCloseTo(4.54, 1);
  });

  it('is symmetric', () => {
    const a = { r: 30, g: 60, b: 90, a: 1 };
    const b = { r: 200, g: 210, b: 220, a: 1 };
    expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
  });

  it('uses the large-text threshold only where WCAG does', () => {
    expect(contrastTarget(16, 400)).toEqual({ ratio: 4.5, large: false });
    expect(contrastTarget(24, 400)).toEqual({ ratio: 3, large: true });
    expect(contrastTarget(19, 700)).toEqual({ ratio: 3, large: true });
    expect(contrastTarget(19, 400)).toEqual({ ratio: 4.5, large: false });
  });

  it('computes luminance in the expected order', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(0, 5);
    // Green contributes most to perceived luminance.
    expect(relativeLuminance({ r: 0, g: 255, b: 0, a: 1 })).toBeGreaterThan(
      relativeLuminance({ r: 255, g: 0, b: 0, a: 1 }),
    );
  });
});

describe('composite', () => {
  it('returns the top layer when it is opaque', () => {
    const top = { r: 10, g: 20, b: 30, a: 1 };
    expect(composite(top, { r: 255, g: 255, b: 255, a: 1 })).toEqual(top);
  });

  it('blends a translucent layer onto its backdrop', () => {
    const result = composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(result.r).toBeCloseTo(127.5, 1);
    expect(result.a).toBe(1);
  });

  it('stays transparent when both layers are', () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 0 }).a).toBe(0);
  });
});

describe('colorDistance', () => {
  it('is near zero for indistinguishable colours and large for distinct ones', () => {
    const a = parseColor('#333333')!;
    const b = parseColor('#343434')!;
    expect(colorDistance(a, b)).toBeLessThan(24);
    expect(colorDistance(a, parseColor('#ff0000')!)).toBeGreaterThan(100);
  });
});

describe('clustering', () => {
  it('groups and orders by size', () => {
    const clusters = groupBy(['a', 'b', 'a', 'a', 'c'], (value) => value);
    expect(clusters.map((cluster) => [cluster.key, cluster.items.length])).toEqual([
      ['a', 3],
      ['b', 1],
      ['c', 1],
    ]);
  });

  it('finds outliers only when a majority exists', () => {
    const clusters = groupBy(['x', 'x', 'x', 'y'], (value) => value);
    const result = findOutliers(clusters, { minimumMajority: 3, maximumOutlierShare: 0.4 });
    expect(result?.majority.key).toBe('x');
    expect(result?.outliers).toHaveLength(1);
  });

  it('refuses to name outliers when values are scattered', () => {
    // No norm means nothing to deviate from, so the rule must stay quiet.
    const scattered = groupBy(['a', 'b', 'c', 'd'], (value) => value);
    expect(findOutliers(scattered, { minimumMajority: 3, maximumOutlierShare: 0.4 })).toBeNull();
  });

  it('refuses when the majority is too small', () => {
    const clusters = groupBy(['x', 'x', 'y'], (value) => value);
    expect(findOutliers(clusters, { minimumMajority: 3, maximumOutlierShare: 0.4 })).toBeNull();
  });

  it('clusters numbers within a tolerance', () => {
    expect(clusterNumbers([8, 9, 16, 17, 40], 2)).toEqual([[8, 9], [16, 17], [40]]);
  });

  it('finds the nearest value and its distance', () => {
    expect(nearest(19, [8, 16, 24, 32])).toEqual({ value: 16, distance: 3 });
    expect(nearest(19, [])).toBeNull();
  });

  it('computes a median for both parities', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('text measurements', () => {
  it('counts words without punctuation', () => {
    expect(words('Ship faster — with fewer bugs.')).toEqual(['Ship', 'faster', 'with', 'fewer', 'bugs']);
  });

  it('estimates syllables well enough for a grade band', () => {
    expect(countSyllables('cat')).toBe(1);
    expect(countSyllables('running')).toBe(2);
    expect(countSyllables('beautiful')).toBe(3);
    expect(countSyllables('')).toBe(0);
  });

  it('refuses to score a sample too small to mean anything', () => {
    expect(readability('Short copy here.')).toBeNull();
  });

  it('scores simple copy lower than dense copy', () => {
    const simple = readability(
      'We help you ship. The tool is fast. It runs in your browser. You can try it now. No card is needed. It is free to start. We do not track you. Your data stays here. Nothing is sent away. It just works.',
    );
    const dense = readability(
      'Our comprehensive infrastructure orchestration platform facilitates the systematic implementation of organizational transformation initiatives through the utilization of sophisticated methodological frameworks, enabling unprecedented operational efficiencies across heterogeneous distributed environments notwithstanding considerable architectural complexity.',
    );
    expect(simple).not.toBeNull();
    expect(dense).not.toBeNull();
    expect(dense!.grade).toBeGreaterThan(simple!.grade);
  });

  it('measures the share of capital letters, ignoring punctuation', () => {
    expect(upperCaseRatio('SIGN UP NOW!')).toBe(1);
    expect(upperCaseRatio('Sign up now')).toBeCloseTo(1 / 9, 2);
    expect(upperCaseRatio('123 !!!')).toBe(0);
  });

  it('normalizes labels for comparison', () => {
    expect(normalizeLabel('  Learn More! ')).toBe('learn more');
    expect(normalizeLabel('Read more →')).toBe('read more');
  });
});

describe('inferStep', () => {
  it('finds the step behind a spacing scale', () => {
    expect(inferStep([16, 24])).toBe(8);
    expect(inferStep([10, 15, 20])).toBe(5);
    expect(inferStep([16, 20])).toBe(4);
  });

  it('returns null when values share no meaningful step', () => {
    expect(inferStep([13, 19])).toBeNull();
    expect(inferStep([])).toBeNull();
  });

  it('treats a lone value as its own step', () => {
    expect(inferStep([16])).toBe(16);
  });

  it('measures distance to the nearest multiple in both directions', () => {
    expect(distanceToMultiple(8, 8)).toBe(0);
    expect(distanceToMultiple(19, 8)).toBe(3);
    expect(distanceToMultiple(17, 8)).toBe(1);
  });
});

describe('fitScale', () => {
  it('finds the step a page follows, despite an outlier', () => {
    // A plain GCD would return 1 here, erasing the scale the outlier deviates
    // from. That is the whole reason this function exists.
    const fit = fitScale([16, 16, 16, 16, 16, 19], 2);
    // 8 and 16 both explain five of six gaps, so the larger step wins: it is
    // the stronger claim about the page.
    expect(fit?.step).toBe(16);
    expect(fit?.coverage).toBeCloseTo(5 / 6, 2);
  });

  it('accepts a half-step as part of the scale', () => {
    const fit = fitScale([32, 16, 16, 16, 8, 16], 2);
    expect(fit?.step).toBe(8);
    expect(fit?.coverage).toBe(1);
  });

  it('refuses to claim a scale for scattered values', () => {
    expect(fitScale([13, 19, 23, 31, 37, 41], 2)).toBeNull();
  });

  it('never proposes a step small enough to be unfalsifiable', () => {
    // With a 2px tolerance every integer is within 2 of a multiple of 4.
    expect(STEP_CANDIDATES.every((step) => step >= 8)).toBe(true);
  });

  it('returns null for no data', () => {
    expect(fitScale([], 2)).toBeNull();
  });
});
