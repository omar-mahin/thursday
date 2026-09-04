import type { Audit, PageSnapshotDigest } from '../shared/types';

/**
 * What a report cannot claim to cover.
 *
 * Shared by the HTML report and the PDF, and shared deliberately. Both had
 * their own copy of these three sentences, differing only in how they were
 * wrapped for output -- which is two chances to fix a wording in one place and
 * not the other, and end up telling two readers of the same audit different
 * things about how much of the page was looked at.
 *
 * Returns plain sentences. Escaping and drawing belong to whichever writer is
 * asking.
 */
export type CoverageInput = {
  audit: Pick<Audit, 'truncated' | 'framesNotInspected'>;
  digest: Pick<PageSnapshotDigest, 'elementCount'>;
  /** Findings the audit produced but the user left out. Stated, not hidden. */
  omitted?: number;
};

export function coverageNotices(input: CoverageInput): string[] {
  const lines: string[] = [];

  if (input.audit.truncated) {
    lines.push(
      `This page had more elements than one pass examines, so ${input.digest.elementCount} were measured and the rest were not. Findings below are complete for what was examined, not for the whole page.`,
    );
  }

  const { crossOrigin, sameOrigin } = input.audit.framesNotInspected;
  const frames = crossOrigin + sameOrigin;
  if (frames > 0) {
    lines.push(
      `${frames} embedded frame${frames === 1 ? '' : 's'}${
        crossOrigin > 0 && sameOrigin > 0 ? ` (${crossOrigin} from another origin)` : ''
      } ${frames === 1 ? 'was' : 'were'} enumerated but not looked inside. Nothing within ${
        frames === 1 ? 'it' : 'them'
      } is covered by this report.`,
    );
  }

  if (input.omitted && input.omitted > 0) {
    lines.push(
      `${input.omitted} further finding${
        input.omitted === 1 ? ' was' : 's were'
      } produced by this audit but not selected for this report.`,
    );
  }

  return lines;
}
