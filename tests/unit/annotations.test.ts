import { describe, expect, it } from 'vitest';
import { commentLabel } from '../../src/shared/utils/labels';
import { commentPins } from '../../src/sidepanel/state/findings';
import {
  buildAuditFile,
  FILE_VERSION,
  parseAuditFile,
  serializeAuditFile,
} from '../../src/storage/file';
import { annotationFromSubmission } from '../../src/storage/annotations';
import { fitWithin } from '../../src/shared/media/image';
import type { Annotation, Audit, ElementReference, PageSnapshotDigest } from '../../src/shared/types';

const reference = (overrides: Partial<ElementReference> = {}): ElementReference => ({
  tagName: 'section',
  structuralPath: 'main>section:nth-of-type(2)',
  ancestry: ['main'],
  rect: { x: 10, y: 20, width: 400, height: 300 },
  centroid: { x: 210, y: 170 },
  ...overrides,
});

const digest: PageSnapshotDigest = {
  snapshotId: 'snap-1',
  capturedAt: 1,
  url: 'https://example.test/',
  origin: 'https://example.test',
  title: 'Example',
  viewport: {
    width: 1280,
    height: 720,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 240,
    documentWidth: 1280,
    documentHeight: 3000,
  },
  elementCount: 100,
  truncated: false,
  locations: [],
};

const audit: Audit = {
  id: 'audit-1',
  url: 'https://example.test/',
  origin: 'https://example.test',
  title: 'Example',
  createdAt: 1,
  updatedAt: 1,
  viewportWidth: 1280,
  viewportHeight: 720,
  categories: ['ux'],
  status: 'completed',
  findingIds: [],
  truncated: false,
  elementsScanned: 100,
  framesNotInspected: { crossOrigin: 0, sameOrigin: 0 },
};

const annotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'c1',
  auditId: 'audit-1',
  body: 'The middle plan is the one to buy and nothing says so.',
  attachments: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const attachment = (id = 'att-1', overrides: Record<string, unknown> = {}) => ({
  id,
  annotationId: 'c1',
  auditId: 'audit-1',
  mime: 'image/png',
  bytes: 68,
  width: 1,
  height: 1,
  source: 'file' as const,
  createdAt: 1,
  ...overrides,
});

describe('comment markers', () => {
  it('letters comments so they cannot be read as finding numbers', () => {
    expect([1, 2, 26].map(commentLabel)).toEqual(['A', 'B', 'Z']);
  });

  it('keeps going past the alphabet', () => {
    expect([27, 28, 52, 53].map(commentLabel)).toEqual(['AA', 'AB', 'AZ', 'BA']);
  });

  it('never produces an empty marker, whatever it is handed', () => {
    expect(commentLabel(0)).toBe('A');
    expect(commentLabel(-3)).toBe('A');
  });
});

describe('comment pins', () => {
  it('pins a comment where its anchor was', () => {
    const pins = commentPins(
      [annotation({ elementRef: reference(), documentRect: { x: 10, y: 260, width: 400, height: 300 } })],
      digest,
    );
    expect(pins).toHaveLength(1);
    expect(pins[0]?.kind).toBe('comment');
    expect(pins[0]?.targetId).toBe('c1');
    expect(pins[0]?.documentRect).toEqual({ x: 10, y: 260, width: 400, height: 300 });
    // No severity: a comment is not on that ladder.
    expect(pins[0]?.severity).toBeUndefined();
  });

  it('falls back to the anchor rect plus the scroll it was taken at', () => {
    const pins = commentPins([annotation({ elementRef: reference() })], digest);
    // 20 measured in the viewport at scrollY 240 is 260 down the document.
    expect(pins[0]?.documentRect).toEqual({ x: 10, y: 260, width: 400, height: 300 });
  });

  it('gives an unanchored comment no pin at all', () => {
    // Putting it somewhere arbitrary would claim a location the user never
    // chose, which is worse than showing nothing.
    expect(commentPins([annotation()], digest)).toEqual([]);
  });

  it('letters by position in the whole list, not among the pinned ones', () => {
    // Otherwise comment C in the panel would be pin B on the page.
    const pins = commentPins(
      [
        annotation({ id: 'a' }),
        annotation({ id: 'b', elementRef: reference() }),
        annotation({ id: 'c', elementRef: reference() }),
      ],
      digest,
    );
    expect(pins.map((pin) => pin.ordinal)).toEqual([2, 3]);
    expect(pins.map((pin) => commentLabel(pin.ordinal))).toEqual(['B', 'C']);
  });

  it('offers the measured index only for the snapshot the comment came from', () => {
    const same = commentPins(
      [annotation({ elementRef: reference(), elementIndex: 42, snapshotId: 'snap-1' })],
      digest,
    );
    expect(same[0]?.elementIndex).toBe(42);
  });

  it('refuses an index from a different snapshot', () => {
    // Index 42 of one capture is an unrelated element in another, so trusting
    // it would draw a confident pin on the wrong thing -- which is worse than
    // drawing none. -1 is not a valid index, so the page falls to the ladder.
    const other = commentPins(
      [annotation({ elementRef: reference(), elementIndex: 42, snapshotId: 'snap-from-last-week' })],
      digest,
    );
    expect(other[0]?.elementIndex).toBe(-1);
  });

  it('refuses an index with no snapshot recorded against it', () => {
    // A number that happens to be in range is not a shortcut.
    const orphan = commentPins([annotation({ elementRef: reference(), elementIndex: 42 })], digest);
    expect(orphan[0]?.elementIndex).toBe(-1);
  });

  it('draws nothing without a digest to place pins against', () => {
    expect(commentPins([annotation({ elementRef: reference() })], null)).toEqual([]);
  });
});

describe('comments in an audit file', () => {
  const roundTrip = (annotations: Annotation[], attachments: Record<string, string> = {}) => {
    const file = buildAuditFile({
      audit,
      findings: [],
      digest,
      productVersion: '0.2.0',
      annotations,
      attachments,
    });
    const outcome = parseAuditFile(serializeAuditFile(file));
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.value;
  };

  it('is written at the version that understands comments', () => {
    expect(FILE_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('carries a triaged comment status through a file', () => {
    const { file } = roundTrip([annotation({ status: 'resolved' })]);
    expect(file.annotations?.[0]?.status).toBe('resolved');
  });

  it('leaves an untriaged comment with no status rather than inventing open', () => {
    /*
     * `open` written here would read as "somebody looked at this and left it
     * open" when nobody did, and it would mean a file from before this field
     * existed came back claiming a triage decision it never held.
     */
    const { file } = roundTrip([annotation()]);
    expect(file.annotations?.[0]).not.toHaveProperty('status');
  });

  it('drops a status the file made up', () => {
    const source = buildAuditFile({
      audit,
      findings: [],
      digest,
      productVersion: '0.2.0',
      annotations: [annotation()],
      attachments: {},
    });
    const tampered = JSON.parse(serializeAuditFile(source)) as {
      annotations: Array<Record<string, unknown>>;
    };
    tampered.annotations[0]!['status'] = 'urgent';
    const outcome = parseAuditFile(JSON.stringify(tampered));
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.value.file.annotations?.[0]?.status).toBeUndefined();
  });

  it('survives a round trip with its anchor and its image', () => {
    const { file, warnings } = roundTrip(
      [annotation({ elementRef: reference(), attachments: [attachment()] })],
      { 'att-1': PIXEL },
    );
    expect(warnings).toEqual([]);
    expect(file.annotations?.[0]?.body).toBe('The middle plan is the one to buy and nothing says so.');
    expect(file.annotations?.[0]?.elementRef?.structuralPath).toBe('main>section:nth-of-type(2)');
    expect(file.annotations?.[0]?.attachments).toHaveLength(1);
    expect(file.attachments?.['att-1']).toBe(PIXEL);
  });

  it('leaves comments out entirely when there are none', () => {
    const file = buildAuditFile({ audit, findings: [], digest, productVersion: '0.2.0' });
    expect(file.annotations).toBeUndefined();
    expect(file.attachments).toBeUndefined();
  });

  it('still opens a file written before comments existed', () => {
    // The whole point of the version bump being additive.
    const v1 = {
      format: 'thursday.audit',
      version: 1,
      exportedAt: 1,
      product: { name: 'Thursday', version: '0.1.0' },
      page: { url: 'https://example.test/', title: 'Example', viewport: digest.viewport },
      audit,
      findings: [],
      digest,
    };
    const outcome = parseAuditFile(JSON.stringify(v1));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.file.annotations).toBeUndefined();
  });
});

describe('a hostile audit file', () => {
  const read = (raw: unknown) => {
    const outcome = parseAuditFile(
      JSON.stringify({
        format: 'thursday.audit',
        version: 2,
        audit,
        findings: [],
        digest,
        ...(raw as object),
      }),
    );
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.value;
  };

  it('drops a comment with no body rather than showing an empty card', () => {
    const { file } = read({ annotations: [{ id: 'c1', body: '   ' }, { id: 'c2', body: 'real' }] });
    expect(file.annotations?.map((item) => item.id)).toEqual(['c2']);
  });

  it('drops a comment with no id, which could never be pinned or deleted', () => {
    const { file } = read({ annotations: [{ body: 'orphan' }] });
    expect(file.annotations).toBeUndefined();
  });

  it('refuses a second comment claiming an id already used', () => {
    const { file, warnings } = read({
      annotations: [{ id: 'c1', body: 'first' }, { id: 'c1', body: 'second' }],
    });
    expect(file.annotations).toHaveLength(1);
    expect(file.annotations?.[0]?.body).toBe('first');
    expect(warnings.join(' ')).toContain('could not be read');
  });

  it('refuses an attachment type it cannot decode', () => {
    // An SVG would render as a broken image at best, and is a script vector at
    // worst -- these strings go straight into an src attribute in the report.
    const { file } = read({
      annotations: [
        { id: 'c1', body: 'x', attachments: [attachment('a', { mime: 'image/svg+xml' })] },
      ],
      attachments: { a: 'data:image/svg+xml;base64,PHN2Zy8+' },
    });
    expect(file.annotations?.[0]?.attachments).toEqual([]);
  });

  it('refuses an image source that is not an inline image', () => {
    const { file, warnings } = read({
      annotations: [{ id: 'c1', body: 'x', attachments: [attachment('a')] }],
      attachments: { a: 'https://tracker.example/pixel.png' },
    });
    expect(file.annotations?.[0]?.attachments).toEqual([]);
    expect(warnings.join(' ')).toContain('only inline PNG, JPEG or WebP');
  });

  it('drops an attachment the file promised but did not include', () => {
    const { file, warnings } = read({
      annotations: [{ id: 'c1', body: 'x', attachments: [attachment('missing')] }],
    });
    expect(file.annotations?.[0]?.attachments).toEqual([]);
    expect(warnings.join(' ')).toContain('listed but not included');
    // The words the user wrote survive regardless: they are the part that took
    // thought, and losing them over a missing picture would be the wrong trade.
    expect(file.annotations?.[0]?.body).toBe('x');
  });

  it('caps how many comments one file can carry', () => {
    const many = Array.from({ length: 400 }, (_, index) => ({ id: `c${index}`, body: 'x' }));
    const { file, warnings } = read({ annotations: many });
    expect(file.annotations).toHaveLength(200);
    expect(warnings.join(' ')).toContain('the first 200 were kept');
  });

  it('truncates a comment body rather than carrying an essay into the report', () => {
    const { file } = read({ annotations: [{ id: 'c1', body: 'x'.repeat(50_000) }] });
    expect(file.annotations?.[0]?.body.length).toBe(8000);
  });

  it('drops an element index whose snapshot the file did not say', () => {
    // Written as a pair, read as a pair. A file that names an index but no
    // snapshot has given the panel nothing it can safely use.
    const { file } = read({ annotations: [{ id: 'c1', body: 'x', elementIndex: 7 }] });
    expect(file.annotations?.[0]?.elementIndex).toBeUndefined();
    expect(file.annotations?.[0]?.snapshotId).toBeUndefined();
  });

  it('keeps an element index that came with its snapshot', () => {
    const { file } = read({
      annotations: [{ id: 'c1', body: 'x', elementIndex: 7, snapshotId: 'snap-1' }],
    });
    expect(file.annotations?.[0]?.elementIndex).toBe(7);
    expect(file.annotations?.[0]?.snapshotId).toBe('snap-1');
  });

  it('reassigns every comment to the audit in the file', () => {
    // A comment claiming another audit's id would attach itself to a stored
    // audit on this machine that the sender knows nothing about.
    const { file } = read({ annotations: [{ id: 'c1', body: 'x', auditId: 'somebody-elses-audit' }] });
    expect(file.annotations?.[0]?.auditId).toBe('audit-1');
  });

  it('ignores a comments field that is not a list', () => {
    expect(read({ annotations: 'lots' }).file.annotations).toBeUndefined();
    expect(read({ annotations: { c1: 'x' } }).file.annotations).toBeUndefined();
  });
});

describe('scaling an attached image', () => {
  it('leaves an image that is already small enough alone', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('scales the long edge down and keeps the aspect ratio', () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 });
  });

  it('never rounds a dimension away to nothing', () => {
    // A 1px-tall banner scaled by a factor of 100 must still be an image.
    expect(fitWithin(10_000, 1, 1600).height).toBe(1);
  });

  it('does not divide by zero on a degenerate image', () => {
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 0, height: 0 });
  });
});

/**
 * At-least-once delivery, without duplicate comments.
 *
 * The page resends a comment until somebody acknowledges it, and either the
 * panel or the service worker may be the one that stores it -- so the same
 * submission really does get stored twice, in different buckets, on either side
 * of a reconnect. `submissionId` is what is meant to stop that becoming two
 * comments, and for a while it did not: the only check was an in-memory set in
 * the panel, which the worker does not share and a panel reload forgets.
 */
describe('storing the same submission twice', () => {
  const submission = {
    submissionId: 'sub-1',
    target: null,
    body: 'Said once, sent twice.',
    priority: 'normal' as const,
    author: 'Omar',
    images: [],
  };

  it('produces the same row rather than two', () => {
    const first = annotationFromSubmission(submission, 'audit-1');
    const second = annotationFromSubmission(submission, 'notes:https://example.test');

    // Same key, so the second store overwrites the first instead of adding to
    // it. The bucket differs -- that is what carryComments is for -- but the
    // identity does not.
    expect(first.annotation.id).toBe('sub-1');
    expect(second.annotation.id).toBe(first.annotation.id);
  });

  it('does not add a second copy of an attached image', () => {
    const withImage = {
      ...submission,
      images: [{ mime: 'image/png', dataUrl: PIXEL, name: 'shot.png' }],
    };
    const first = annotationFromSubmission(withImage, 'audit-1');
    const second = annotationFromSubmission(withImage, 'audit-1');
    expect(first.annotation.attachments[0]?.id).toBe('sub-1-0');
    expect(second.annotation.attachments[0]?.id).toBe(first.annotation.attachments[0]?.id);
  });

  it('keeps two different submissions apart', () => {
    const other = annotationFromSubmission({ ...submission, submissionId: 'sub-2' }, 'audit-1');
    expect(other.annotation.id).not.toBe('sub-1');
  });
});
