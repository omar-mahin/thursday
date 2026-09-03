import type { PageSnapshot, RawFinding } from '../../shared/types';
import { normalizeLabel } from '../measure/text';

/**
 * Duplicate suppression (spec section 34).
 *
 * Three passes, cheapest first:
 *  1. ancestor/descendant collapse for the same rule -- keep the innermost,
 *     because "this button has low contrast" beats "something in this section
 *     has low contrast"
 *  2. exact merge on rule, category and element
 *  3. per-element and per-audit caps, so one pathological page cannot bury the
 *     things that matter
 *
 * No embeddings and no semantic similarity: every finding here comes from a
 * known rule, so identity is knowable rather than guessable. The slot for
 * AI-versus-deterministic overlap arrives with that layer.
 */

export const MAX_PER_ELEMENT = 8;
export const MAX_PER_AUDIT = 60;
/**
 * One noisy rule must not bury the rest of the page. An unstyled form can put
 * a dozen inputs under the touch-target minimum, and a list of twelve
 * near-identical findings hides the unlabelled control underneath them.
 * The UI also groups repeats by rule, and the suppressed count is reported
 * rather than hidden.
 */
export const MAX_PER_RULE = 5;


/** Similarity floor for treating two titles as the same statement. */
export const TITLE_SIMILARITY = 0.6;

/** Deep enough for real markup; a bound, so a cyclic parent index cannot hang. */
const MAX_ANCESTOR_HOPS = 40;

/** Token-set Jaccard: enough to spot two phrasings of one statement. */
export function titleSimilarity(a: string, b: string): number {
  const left = new Set(normalizeLabel(a).split(' ').filter(Boolean));
  const right = new Set(normalizeLabel(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function dedupe(findings: readonly RawFinding[], snapshot: PageSnapshot): RawFinding[] {
  // 1. collapse a rule firing on both an element and its ancestor
  const byRule = new Map<string, RawFinding[]>();
  for (const finding of findings) {
    const bucket = byRule.get(finding.ruleId);
    if (bucket) bucket.push(finding);
    else byRule.set(finding.ruleId, [finding]);
  }

  /**
   * A rule that fired on an element and on its ancestor keeps the inner one.
   *
   * Walking every pair looks natural and is quadratic: an unstyled page can
   * put a thousand controls under the touch-target minimum, and comparing each
   * against each -- rebuilding an ancestor chain every time -- was a million
   * chain walks and most of the audit's running time. Walking each element's
   * chain once and asking whether any ancestor also fired is the same answer
   * in linear time, because the chain depends only on the element.
   */
  const dropped = new Set<RawFinding>();
  for (const group of byRule.values()) {
    if (group.length < 2) continue;

    const byIndex = new Map<number, RawFinding[]>();
    for (const finding of group) {
      if (finding.elementIndex === undefined) continue;
      const bucket = byIndex.get(finding.elementIndex);
      if (bucket) bucket.push(finding);
      else byIndex.set(finding.elementIndex, [finding]);
    }
    if (byIndex.size < 2) continue;

    for (const index of byIndex.keys()) {
      let parent = snapshot.elements[index]?.parent ?? null;
      let hops = 0;
      while (parent !== null && hops < MAX_ANCESTOR_HOPS) {
        const outer = byIndex.get(parent);
        if (outer) for (const finding of outer) dropped.add(finding);
        parent = snapshot.elements[parent]?.parent ?? null;
        hops += 1;
      }
    }
  }

  // 2. exact merge on the same statement about the same element
  const seen = new Map<string, RawFinding>();
  const merged: RawFinding[] = [];
  for (const finding of findings) {
    if (dropped.has(finding)) continue;
    const key = `${finding.ruleId}|${finding.category}|${finding.elementIndex ?? 'page'}`;
    const existing = seen.get(key);
    if (existing && titleSimilarity(existing.title, finding.title) >= TITLE_SIMILARITY) {
      // Keep the first, absorb any evidence the second adds.
      for (const line of finding.evidence) {
        if (!existing.evidence.includes(line)) existing.evidence.push(line);
      }
      continue;
    }
    seen.set(key, finding);
    merged.push(finding);
  }

  return merged;
}

/** Caps, applied after ranking so what survives is what matters most. */
export function applyCaps(findings: readonly RawFinding[]): { findings: RawFinding[]; suppressed: number } {
  const perElement = new Map<number | 'page', number>();
  const perRule = new Map<string, number>();
  const kept: RawFinding[] = [];

  for (const finding of findings) {
    if (kept.length >= MAX_PER_AUDIT) break;
    const elementKey = finding.elementIndex ?? 'page';
    const elementCount = perElement.get(elementKey) ?? 0;
    if (elementKey !== 'page' && elementCount >= MAX_PER_ELEMENT) continue;
    const ruleCount = perRule.get(finding.ruleId) ?? 0;
    if (ruleCount >= MAX_PER_RULE) continue;
    perElement.set(elementKey, elementCount + 1);
    perRule.set(finding.ruleId, ruleCount + 1);
    kept.push(finding);
  }

  return { findings: kept, suppressed: findings.length - kept.length };
}
