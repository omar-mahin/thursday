import type { Finding, PageSnapshot, Rect } from '../../shared/types';

/**
 * Which findings share a screenful.
 *
 * Tab capture allows two calls a second. Photographing thirty findings one at
 * a time is therefore fifteen seconds of somebody's page scrolling under them,
 * and most of those captures are of the same screenful anyway -- findings
 * cluster, because bad markup clusters. So the page is walked in bands one
 * viewport tall, and each band costs one capture however many findings are in
 * it.
 *
 * Pure on purpose: the arithmetic here is where an off-by-one produces a
 * screenshot of the wrong part of the page, which is a far worse failure than
 * no screenshot at all, and it is all testable without a browser.
 */

export type CaptureBand = {
  /** Where to scroll to. */
  scrollY: number;
  /** Snapshot indices of the findings this band covers. */
  indices: number[];
};

export type CapturePlan = {
  bands: CaptureBand[];
  /** Where the user had the page before any of this. Restored at the end. */
  restoreY: number;
  /**
   * Findings deliberately left out, with the reason. Reported rather than
   * dropped: "no screenshot" and "no screenshot because it is a card field"
   * are different things to tell somebody.
   */
  skipped: { findingId: string; reason: SkipReason }[];
};

export type SkipReason = 'no-element' | 'redacted' | 'no-size';

/**
 * Breathing room above a band's first finding.
 *
 * A finding flush against the top of the screenful has no context above it,
 * and context above is most of what tells you where you are on a page.
 */
export const BAND_MARGIN = 64;

/** Below this a rect is a layout artefact rather than something to photograph. */
const MIN_SIDE = 2;

const bottom = (rect: Rect): number => rect.y + rect.height;

export function planCapture(
  findings: readonly Finding[],
  snapshot: PageSnapshot,
): CapturePlan {
  const viewportHeight = Math.max(1, snapshot.viewport.height);
  const documentHeight = Math.max(viewportHeight, snapshot.viewport.documentHeight);
  const maxScroll = Math.max(0, documentHeight - viewportHeight);

  const skipped: CapturePlan['skipped'] = [];
  const targets: { index: number; rect: Rect }[] = [];

  for (const finding of findings) {
    const index = finding.elementIndex;
    if (index === undefined) {
      // Not every finding is about an element. A page with no h1 has nothing
      // to photograph, and that is not a failure.
      if (finding.elementRef) skipped.push({ findingId: finding.id, reason: 'no-element' });
      continue;
    }
    const element = snapshot.elements[index];
    if (!element) {
      skipped.push({ findingId: finding.id, reason: 'no-element' });
      continue;
    }
    if (element.redacted) {
      skipped.push({ findingId: finding.id, reason: 'redacted' });
      continue;
    }
    const rect = element.documentRect;
    if (rect.width < MIN_SIDE || rect.height < MIN_SIDE) {
      skipped.push({ findingId: finding.id, reason: 'no-size' });
      continue;
    }
    targets.push({ index, rect });
  }

  // One band can serve several findings on the same element, and several
  // findings on one element are common -- a button can fail contrast, target
  // size and accessible name at once.
  const byIndex = new Map<number, Rect>();
  for (const target of targets) byIndex.set(target.index, target.rect);

  const ordered = [...byIndex.entries()]
    .map(([index, rect]) => ({ index, rect }))
    .sort((a, b) => a.rect.y - b.rect.y || a.index - b.index);

  const bands: CaptureBand[] = [];
  let cursor = 0;
  while (cursor < ordered.length) {
    const first = ordered[cursor]!;
    /*
     * Anchored on the first finding's top, not on a fixed grid of screenfuls.
     * A grid wastes captures: a finding sitting 20px below a boundary gets a
     * band of its own with almost nothing in it, and the band above it is
     * mostly empty space.
     */
    const scrollY = Math.max(0, Math.min(first.rect.y - BAND_MARGIN, maxScroll));
    const limit = scrollY + viewportHeight;
    const indices: number[] = [];
    while (cursor < ordered.length) {
      const next = ordered[cursor]!;
      // Fully inside, or too tall to ever fit -- an element taller than the
      // screen is photographed from its top rather than skipped, because the
      // crop is going to be clipped either way and clipped is not useless.
      const fits = bottom(next.rect) <= limit || next.rect.height >= viewportHeight;
      if (indices.length > 0 && !fits) break;
      if (next.rect.y >= limit) break;
      indices.push(next.index);
      cursor += 1;
    }
    bands.push({ scrollY, indices });
  }

  return {
    bands,
    restoreY: Math.max(0, Math.min(snapshot.viewport.scrollY, maxScroll)),
    skipped,
  };
}
