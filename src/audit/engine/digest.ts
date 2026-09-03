import type {
  ElementLocation,
  Finding,
  PageSnapshot,
  PageSnapshotDigest,
} from '../../shared/types';

/**
 * Trims a snapshot down to what a stored audit needs.
 *
 * Only elements a finding actually points at are kept. A 1500-element page with
 * twelve findings yields twelve locations, not fifteen hundred -- and every
 * measured style, class list and text sample stays out of storage, which is
 * both smaller and less to be careless with.
 */
export function digestFor(snapshot: PageSnapshot, findings: readonly Finding[]): PageSnapshotDigest {
  const wanted = new Set<number>();
  for (const finding of findings) {
    if (finding.elementIndex !== undefined) wanted.add(finding.elementIndex);
  }

  const locations: ElementLocation[] = [];
  for (const index of [...wanted].sort((a, b) => a - b)) {
    const element = snapshot.elements[index];
    if (element) locations.push({ index, documentRect: element.documentRect });
  }

  return {
    snapshotId: snapshot.id,
    capturedAt: snapshot.capturedAt,
    url: snapshot.url,
    origin: snapshot.origin,
    title: snapshot.title,
    viewport: snapshot.viewport,
    elementCount: snapshot.elements.length,
    truncated: snapshot.truncated,
    locations,
  };
}

/** Document rects by element index, for building pins without a live snapshot. */
export function locationIndex(digest: PageSnapshotDigest | null): Map<number, ElementLocation> {
  return new Map((digest?.locations ?? []).map((location) => [location.index, location]));
}
