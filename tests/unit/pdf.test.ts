import { describe, expect, it } from 'vitest';
import { encodeWinAnsi, measure, SUBSTITUTE, wrap } from '../../src/pdf/metrics';
import { latin1, PdfDocument, pdfDate, pdfString, pdfTextString } from '../../src/pdf/writer';
import { MARGIN, PAGE_HEIGHT, PdfLayout } from '../../src/pdf/layout';
import { buildAuditPdf, pdfFileName } from '../../src/pdf/report';
import type { Annotation, Audit, Finding, PageSnapshotDigest } from '../../src/shared/types';

// -- a structural checker --------------------------------------------------
//
// A PDF with a wrong byte offset in its cross-reference table opens as
// "damaged file" in some readers and not at all in others, and nothing in the
// bytes looks obviously wrong. So the tests below do not just grep the output:
// they parse the trailer, walk the xref and confirm every offset lands on the
// object header it claims to. That is precisely the failure a hand-written
// container can have, and it is not one that can be caught by eye.

const text = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
};

/**
 * Everything the reader will actually see, as one string.
 *
 * Grepping the raw file for a phrase does not work: wrapped text is one `Tj`
 * per line, so any sentence long enough to matter is split across several.
 * Pulling the drawn strings out and rejoining them tests what a person
 * reading the page gets, which is the thing worth asserting.
 */
function visible(file: Uint8Array): string {
  const drawn: string[] = [];
  for (const match of text(file).matchAll(/\((?:\\.|[^()\\])*\) Tj/g)) {
    drawn.push(match[0].slice(1, -4).replace(/\\([()\\])/g, '$1'));
  }
  return drawn.join(' ');
}

type Structure = {
  size: number;
  root: number;
  info: number;
  offsets: number[];
  /** Object numbers referenced anywhere as `N 0 R`. */
  referenced: Set<number>;
};

function parse(file: Uint8Array): Structure {
  const source = text(file);
  expect(source.startsWith('%PDF-1.7\n')).toBe(true);
  expect(source.endsWith('%%EOF\n')).toBe(true);

  const startxrefAt = source.lastIndexOf('startxref');
  expect(startxrefAt).toBeGreaterThan(0);
  const startxref = Number(/startxref\s+(\d+)/.exec(source.slice(startxrefAt))?.[1]);
  expect(Number.isInteger(startxref)).toBe(true);
  expect(source.slice(startxref, startxref + 4)).toBe('xref');

  const header = /xref\n0 (\d+)\n/.exec(source.slice(startxref));
  const size = Number(header?.[1]);
  const tableStart = startxref + (header?.[0].length ?? 0);

  // Twenty bytes per entry, exactly -- readers index into this arithmetically
  // -- starting with the mandatory free entry for object zero.
  expect(source.slice(tableStart, tableStart + 20)).toBe('0000000000 65535 f \n');
  const offsets: number[] = [0];
  for (let id = 1; id < size; id += 1) {
    const entry = source.slice(tableStart + id * 20, tableStart + (id + 1) * 20);
    expect(entry).toMatch(/^\d{10} 00000 n \n$/);
    offsets.push(Number(entry.slice(0, 10)));
  }

  const trailer = /\/Size (\d+) \/Root (\d+) 0 R \/Info (\d+) 0 R/.exec(source.slice(startxref));
  expect(trailer).not.toBeNull();

  const referenced = new Set<number>();
  for (const match of source.matchAll(/(\d+) 0 R/g)) referenced.add(Number(match[1]));

  return { size, root: Number(trailer?.[2]), info: Number(trailer?.[3]), offsets, referenced };
}

/** Every xref offset points at the object it says, and every reference resolves. */
function assertConsistent(file: Uint8Array): Structure {
  const structure = parse(file);
  const source = text(file);
  for (let id = 1; id < structure.size; id += 1) {
    expect(source.slice(structure.offsets[id] ?? 0)).toMatch(new RegExp(`^${id} 0 obj\\n`));
  }
  for (const id of structure.referenced) {
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThan(structure.size);
  }
  expect(structure.size).toBe(structure.offsets.length);
  return structure;
}

describe('WinAnsi encoding', () => {
  it('passes ASCII through unchanged', () => {
    expect(encodeWinAnsi('Hello, world!')).toEqual({
      bytes: [...'Hello, world!'].map((character) => character.charCodeAt(0)),
      lost: 0,
    });
  });

  it('keeps the punctuation real web copy is full of', () => {
    // Curly quotes, an en dash and an ellipsis all have proper glyphs. Folding
    // them to ASCII would make the report look worse than the page it audits.
    const { bytes, lost } = encodeWinAnsi('“It’s fine” – mostly…');
    expect(lost).toBe(0);
    expect(bytes).toContain(0x93);
    expect(bytes).toContain(0x94);
    expect(bytes).toContain(0x92);
    expect(bytes).toContain(0x96);
    expect(bytes).toContain(0x85);
  });

  it('carries Latin-1 accents as single bytes', () => {
    expect(encodeWinAnsi('café').bytes).toEqual([0x63, 0x61, 0x66, 0xe9]);
  });

  it('substitutes what no base-14 font can draw, and counts it', () => {
    const { bytes, lost } = encodeWinAnsi('価格 ok');
    expect(lost).toBe(2);
    expect(bytes.filter((byte) => byte === SUBSTITUTE)).toHaveLength(2);
    // The rest of the string still survives: a Japanese heading must not take
    // the English body copy down with it.
    expect(text(new Uint8Array(bytes))).toBe('?? ok');
  });

  it('replaces characters that have a plain equivalent without counting a loss', () => {
    // A non-breaking hyphen rendered as a hyphen is the same hyphen, so
    // telling the reader something was lost would be false.
    expect(encodeWinAnsi('a‑b')).toEqual({ bytes: [0x61, 0x2d, 0x62], lost: 0 });
  });

  it('drops zero-width formatting characters silently', () => {
    expect(encodeWinAnsi('a\u200bb\ufeff')).toEqual({ bytes: [0x61, 0x62], lost: 0 });
  });

  it('drops control characters rather than printing question marks for them', () => {
    expect(encodeWinAnsi('a\u0001b')).toEqual({ bytes: [0x61, 0x62], lost: 0 });
  });
});

describe('measurement and wrapping', () => {
  it('measures from the real font metrics, not an average', () => {
    // In Helvetica an 'i' is 222/1000 em and an 'm' is 833. A measurement that
    // treated them alike would overflow the margin on dense text.
    expect(measure('i', 'regular', 1000)).toBe(222);
    expect(measure('m', 'regular', 1000)).toBe(833);
    expect(measure('i', 'mono', 1000)).toBe(600);
  });

  it('never returns a line wider than the measure', () => {
    const body =
      'The primary call to action and the secondary action are styled identically, so nothing tells a visitor which one the page wants them to press.';
    for (const line of wrap(body, 'regular', 10, 200)) {
      expect(measure(line, 'regular', 10)).toBeLessThanOrEqual(200);
    }
  });

  it('keeps the line breaks the user typed', () => {
    expect(wrap('one\ntwo', 'regular', 10, 500)).toEqual(['one', 'two']);
  });

  it('breaks a word that cannot fit rather than letting it run off the page', () => {
    const selector = 'div>section>ul>li>article>header>h2>span>a'.repeat(4);
    const lines = wrap(selector, 'mono', 9, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, 'mono', 9)).toBeLessThanOrEqual(120);
    // Nothing is lost in the break.
    expect(lines.join('')).toBe(selector);
  });
});

describe('the PDF container', () => {
  it('writes high bytes as single Latin-1 bytes, not UTF-8 pairs', () => {
    // TextEncoder would emit 0xC3 0xA9 here, and the reader would draw two
    // glyphs of rubbish where the accented letter should be.
    expect([...latin1('é')]).toEqual([0xe9]);
  });

  it('escapes the three bytes that could end a string early', () => {
    expect(pdfString('a(b)c\\d').literal).toBe('(a\\(b\\)c\\\\d)');
  });

  it('reports characters it could not carry into a string', () => {
    expect(pdfString('価').lost).toBe(1);
  });

  it('writes document metadata as UTF-16, not as font-encoded bytes', () => {
    // The information dictionary is decoded as PDFDocEncoding, where the byte
    // WinAnsi uses for an em dash means a capital S-caron -- which is exactly
    // how "Thursday audit — Pricing" first appeared in Chrome's title bar.
    expect(pdfTextString('A\u2014B')).toBe('<FEFF004120140042>');
    expect(pdfTextString('価')).toBe('<FEFF4FA1>');
    // Outside the BMP, as a surrogate pair.
    expect(pdfTextString('\u{1F600}')).toBe('<FEFFD83DDE00>');
  });

  it('writes a date in the form every reader accepts', () => {
    expect(pdfDate(Date.UTC(2026, 8, 3, 9, 5, 7))).toBe('D:20260903090507Z');
  });

  it('produces a file whose xref offsets all land on their objects', () => {
    const doc = new PdfDocument();
    const stream = doc.addStream('/Type /Test', latin1('some stream contents'));
    const root = doc.add(`<< /Type /Catalog /Stream ${stream.id} 0 R >>`);
    const info = doc.add('<< /Title (t) >>');
    assertConsistent(doc.build(root, info));
  });

  it('refuses to build with an object that was reserved and never defined', () => {
    // Silently writing a zero offset would produce a file that opens as
    // damaged, with nothing in it pointing at the mistake.
    const doc = new PdfDocument();
    doc.reserve();
    const root = doc.add('<< /Type /Catalog >>');
    const info = doc.add('<< >>');
    expect(() => doc.build(root, info)).toThrow(/reserved but never defined/);
  });

  it('states a stream length that matches the bytes written', () => {
    const doc = new PdfDocument();
    const stream = doc.addStream('', latin1('0123456789'));
    const root = doc.add('<< /Type /Catalog >>');
    const file = text(doc.build(root, doc.add('<< >>')));
    expect(file).toContain('/Length 10 >>\nstream\n0123456789\nendstream');
    expect(stream.id).toBe(1);
  });
});

describe('the layout', () => {
  const sheet = (): PdfLayout => new PdfLayout(new PdfDocument());
  const meta = { title: 't', author: 'Thursday', subject: 's', createdAt: 0 };

  it('numbers every page once the total is known', () => {
    const layout = sheet();
    // Enough lines to guarantee more than two pages.
    for (let index = 0; index < 200; index += 1) layout.text(`line ${index}`, { size: 11 });
    const file = text(layout.finish(meta));
    const total = Number(/\/Count (\d+)/.exec(file)?.[1]);
    expect(total).toBeGreaterThan(2);
    expect(file).toContain(`(Page 1 of ${total})`);
    expect(file).toContain(`(Page ${total} of ${total})`);
  });

  it('declares the three built-in fonts and embeds no font program', () => {
    const layout = sheet();
    layout.text('a', { font: 'bold' });
    const file = text(layout.finish(meta));
    expect(file).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(file).toContain('/BaseFont /Helvetica-Bold');
    expect(file).toContain('/BaseFont /Courier');
    expect(file).not.toContain('/FontFile');
  });

  it('starts a new page rather than running a block past the footer', () => {
    const layout = sheet();
    layout.text('first', { size: 10 });
    expect(layout.top).toBeGreaterThan(MARGIN);
    layout.ensure(PAGE_HEIGHT);
    expect(layout.top).toBe(MARGIN);
  });

  it('does not break a page for a block placed at the very top', () => {
    // Otherwise a block taller than a page would loop looking for room that
    // does not exist anywhere.
    const layout = sheet();
    layout.ensure(PAGE_HEIGHT * 4);
    expect(text(layout.finish(meta))).toContain('/Count 1');
  });

  it('embeds an image once even when it is placed twice', () => {
    const layout = sheet();
    const image = { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 10, height: 10 };
    layout.place(image);
    layout.place(image);
    const file = text(layout.finish(meta));
    expect([...file.matchAll(/\/Subtype \/Image/g)]).toHaveLength(1);
    expect(file).toContain('/Filter /DCTDecode');
  });

  it('counts the characters it could not draw', () => {
    const layout = sheet();
    layout.text('価格表');
    expect(layout.lost).toBe(3);
  });
});

// -- a whole report --------------------------------------------------------

const digest: PageSnapshotDigest = {
  snapshotId: 'snap-1',
  capturedAt: 1,
  url: 'https://example.test/pricing',
  origin: 'https://example.test',
  title: 'Pricing',
  viewport: {
    width: 1280,
    height: 720,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    documentWidth: 1280,
    documentHeight: 2400,
  },
  elementCount: 240,
  truncated: false,
  locations: [{ index: 4, documentRect: { x: 10, y: 20, width: 100, height: 40 } }],
};

const audit: Audit = {
  id: 'audit-1',
  url: 'https://example.test/pricing',
  origin: 'https://example.test',
  title: 'Pricing',
  createdAt: Date.UTC(2026, 8, 3, 9, 0, 0),
  updatedAt: Date.UTC(2026, 8, 3, 9, 0, 0),
  viewportWidth: 1280,
  viewportHeight: 720,
  categories: ['a11y', 'ux'],
  status: 'completed',
  findingIds: ['f1'],
  truncated: false,
  elementsScanned: 240,
  framesNotInspected: { crossOrigin: 0, sameOrigin: 0 },
};

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  auditId: 'audit-1',
  ruleId: 'A11Y-001',
  category: 'a11y',
  type: 'rule',
  title: 'Text contrast is 2.8:1',
  severity: 'high',
  confidence: 1,
  summary: 'The body copy does not meet the 4.5:1 minimum.',
  evidence: ['Measured 2.8:1 against #f4f4f4.'],
  impact: 'Low-contrast text is hard to read.',
  recommendation: 'Darken the text or lighten the background.',
  status: 'open',
  createdAt: 1,
  updatedAt: 1,
  elementIndex: 4,
  elementRef: {
    tagName: 'p',
    structuralPath: 'main>p:nth-of-type(2)',
    ancestry: ['main'],
    rect: { x: 10, y: 20, width: 100, height: 40 },
    centroid: { x: 60, y: 40 },
  },
  ...overrides,
});

const annotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'c1',
  auditId: 'audit-1',
  body: 'The plan comparison reads as three equal options, but the middle one is the one to buy.',
  attachments: [],
  createdAt: Date.UTC(2026, 8, 3, 9, 30, 0),
  updatedAt: Date.UTC(2026, 8, 3, 9, 30, 0),
  ...overrides,
});

const attachment = (overrides: Partial<Annotation['attachments'][number]> = {}) => ({
  id: 'att-1',
  annotationId: 'c1',
  auditId: 'audit-1',
  mime: 'image/png',
  bytes: 4,
  width: 20,
  height: 10,
  source: 'file' as const,
  createdAt: 1,
  ...overrides,
});

const base = {
  audit,
  digest,
  productVersion: '0.2.0',
  generatedAt: Date.UTC(2026, 8, 3, 10, 0, 0),
};

describe('the audit report as a PDF', () => {
  it('is a structurally valid file', () => {
    assertConsistent(buildAuditPdf({ ...base, findings: [finding()] }));
  });

  it('carries the page, the audit time and every finding', () => {
    const pdf = buildAuditPdf({ ...base, findings: [finding()] });
    const page = visible(pdf);
    expect(page).toContain('https://example.test/pricing');
    expect(page).toContain('Text contrast is 2.8:1');
    expect(page).toContain('A11Y-001');
    expect(page).toContain('Measured 2.8:1 against #f4f4f4.');
    expect(page).toContain('Darken the text or lighten the background.');
    // The URL is a live link, not just printed text.
    expect(text(pdf)).toContain('/Subtype /Link');
    expect(text(pdf)).toContain('/URI (https://example.test/pricing)');
  });

  it('says so when the audit could not see the whole page', () => {
    const page = visible(
      buildAuditPdf({
        ...base,
        audit: { ...audit, truncated: true, framesNotInspected: { crossOrigin: 2, sameOrigin: 1 } },
        findings: [finding()],
      }),
    );
    expect(page).toContain('more elements than one pass examines');
    expect(page).toContain('3 embedded frames');
    expect(page).toContain('2 from another origin');
  });

  it('states how many findings were left out of the report', () => {
    expect(visible(buildAuditPdf({ ...base, findings: [finding()], omitted: 7 }))).toContain(
      '7 further findings were produced by this audit but not selected for this report.',
    );
  });

  it('keeps comments in their own section, marked as opinions', () => {
    const page = visible(
      buildAuditPdf({
        ...base,
        findings: [finding()],
        annotations: [annotation(), annotation({ id: 'c2' })],
      }),
    );
    expect(page).toContain('COMMENTS');
    expect(page).toContain('observations and opinions, not measurements');
    // Lettered, so a comment marker can never be read as a finding number.
    expect(page).toMatch(/(^| )A( |$)/);
    expect(page).toMatch(/(^| )B( |$)/);
  });

  it('says a comment has no anchor rather than inventing one', () => {
    expect(visible(buildAuditPdf({ ...base, findings: [], annotations: [annotation()] }))).toContain(
      'On the page as a whole (no element anchor).',
    );
  });

  it('embeds an attached image and uses the user caption as its label', () => {
    const pdf = buildAuditPdf({
      ...base,
      findings: [],
      annotations: [
        annotation({ attachments: [attachment({ caption: 'The middle plan, unhighlighted' })] }),
      ],
      attachments: { 'att-1': { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 20, height: 10 } },
    });
    expect(text(pdf)).toContain('/Subtype /Image');
    expect(text(pdf)).toContain('/Width 20 /Height 10');
    expect(visible(pdf)).toContain('The middle plan, unhighlighted');
  });

  it('skips an attachment whose image is missing instead of drawing a gap', () => {
    const input = {
      ...base,
      findings: [],
      annotations: [annotation({ attachments: [attachment({ id: 'gone' })] })],
    };
    expect(text(buildAuditPdf(input))).not.toContain('/Subtype /Image');
    assertConsistent(buildAuditPdf(input));
  });

  it('admits in the file itself when characters could not be drawn', () => {
    const page = visible(buildAuditPdf({ ...base, findings: [finding({ title: '価格' })] }));
    expect(page).toContain('2 characters in this audit could not be drawn');
    expect(page).toContain('The HTML report keeps them exactly as they appear on the page.');
  });

  it('says nothing about missing characters when none were missing', () => {
    expect(visible(buildAuditPdf({ ...base, findings: [finding()] }))).not.toContain(
      'could not be drawn',
    );
  });

  it('produces a report even with nothing selected', () => {
    const pdf = buildAuditPdf({ ...base, findings: [] });
    expect(visible(pdf)).toContain('No findings were included in this report.');
    assertConsistent(pdf);
  });

  it('stays valid across page breaks with a hundred findings', () => {
    const many = Array.from({ length: 100 }, (_, index) =>
      finding({ id: `f${index}`, title: `Finding number ${index}` }),
    );
    const structure = assertConsistent(buildAuditPdf({ ...base, findings: many }));
    expect(structure.size).toBeGreaterThan(10);
  });

  it('names the file after the host and the time of the audit', () => {
    expect(pdfFileName(audit)).toBe('thursday-report-example.test-2026-09-03-09-00.pdf');
  });

  it('still names a file for a page with no parseable URL', () => {
    expect(pdfFileName({ ...audit, url: 'not a url' })).toMatch(/^thursday-report-page-/);
  });
});
