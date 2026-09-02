/**
 * Clustering helpers for the UI rules.
 *
 * These rules are all variations on one question: is this value part of the
 * page's system, or an outlier? A single odd value proves nothing -- a scale
 * needs a majority before a deviation means anything -- so every helper here
 * requires a dominant group before it will call anything an outlier.
 */

export type Cluster<T> = {
  key: string;
  items: T[];
};

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Cluster<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return [...map.entries()]
    .map(([k, values]) => ({ key: k, items: values }))
    .sort((a, b) => b.items.length - a.items.length);
}

export type OutlierOptions = {
  /** A cluster must hold at least this many items to count as the norm. */
  minimumMajority: number;
  /** At most this share of items may be outliers, or there is no norm at all. */
  maximumOutlierShare: number;
};

export type OutlierResult<T> = {
  majority: Cluster<T>;
  outliers: Cluster<T>[];
};

/**
 * Splits clusters into a dominant group and outliers, or returns null when the
 * values are too scattered to have a norm -- in which case there is nothing to
 * deviate from and the rule must stay quiet.
 */
export function findOutliers<T>(
  clusters: readonly Cluster<T>[],
  options: OutlierOptions,
): OutlierResult<T> | null {
  const [majority, ...rest] = clusters;
  if (!majority || majority.items.length < options.minimumMajority) return null;
  if (rest.length === 0) return null;

  const total = clusters.reduce((sum, cluster) => sum + cluster.items.length, 0);
  const outlierCount = total - majority.items.length;
  if (outlierCount / total > options.maximumOutlierShare) return null;

  return { majority, outliers: rest };
}

/** Nearest value in a set, and how far away it is. */
export function nearest(value: number, candidates: readonly number[]): { value: number; distance: number } | null {
  let best: { value: number; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (!best || distance < best.distance) best = { value: candidate, distance };
  }
  return best;
}

/** Groups numbers that sit within `tolerance` of each other. */
export function clusterNumbers(values: readonly number[], tolerance: number): number[][] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const value of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(value - last[last.length - 1]!) <= tolerance) last.push(value);
    else groups.push([value]);
  }
  return groups;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Infers the step of a spacing scale from the values that repeat.
 *
 * Clustering alone is not enough: a page built on 8s might use 8px exactly once,
 * and that single use is part of the system, not a deviation from it. The step
 * is what makes 8 legitimate and 19 suspicious.
 */
export function inferStep(values: readonly number[]): number | null {
  const positive = values.filter((value) => value > 0).map((value) => Math.round(value));
  if (positive.length === 0) return null;
  const step = positive.reduce((current, value) => gcd(current, value), positive[0]!);
  return step >= 2 ? step : null;
}

/**
 * Candidate spacing steps, in the units design systems actually use.
 *
 * Nothing below 8 is a candidate: with a 2px tolerance, every integer sits
 * within 2 of a multiple of 4, so "the page steps in 4s" is a claim that can
 * never be false -- and a rule that cannot be wrong is worthless.
 */
export const STEP_CANDIDATES = [8, 10, 12, 16] as const;

export type ScaleFit = { step: number; coverage: number };

/**
 * Finds the step that best explains a set of measured gaps.
 *
 * A plain GCD is useless here because one bad value poisons it: gcd(16, 19) is
 * 1, so the single gap we want to report would erase the scale it deviates
 * from. This instead scores each candidate by how much of the page it explains
 * and requires a strong majority before claiming a scale exists at all.
 */
export function fitScale(
  values: readonly number[],
  tolerance: number,
  minimumCoverage = 0.8,
): ScaleFit | null {
  if (values.length === 0) return null;
  let best: ScaleFit | null = null;
  for (const step of STEP_CANDIDATES) {
    const onStep = values.filter((value) => distanceToMultiple(value, step) <= tolerance).length;
    const coverage = onStep / values.length;
    // Ties go to the larger step: it is the stronger, more falsifiable claim.
    if (!best || coverage > best.coverage || (coverage === best.coverage && step > best.step)) {
      best = { step, coverage };
    }
  }
  return best && best.coverage >= minimumCoverage ? best : null;
}

/** Distance from a value to the nearest multiple of `step`. */
export function distanceToMultiple(value: number, step: number): number {
  if (step <= 0) return Number.POSITIVE_INFINITY;
  const remainder = Math.abs(value) % step;
  return Math.min(remainder, step - remainder);
}

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
};
