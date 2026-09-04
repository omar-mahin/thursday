/**
 * Text measurement and encoding for the PDF export.
 *
 * The PDF uses three of the fourteen fonts every reader is required to have --
 * Helvetica, Helvetica-Bold and Courier -- so nothing has to be embedded. That
 * is what keeps the export at a few kilobytes of new code instead of a few
 * hundred kilobytes of font binary inside a 700KB bundle budget.
 *
 * The cost is honest and worth stating plainly: those fonts are addressed
 * through WinAnsiEncoding, which is Latin-1 plus the CP1252 punctuation. Text
 * outside that -- Greek, Cyrillic, Arabic, CJK -- has no glyph to point at.
 * Rather than emit mojibake, `encodeWinAnsi` substitutes and *counts* what it
 * could not carry, and the report prints that count so a reader is never left
 * to guess whether a page of question marks was the website's fault or ours.
 * The HTML report stays the lossless artifact.
 */

export type PdfFont = 'regular' | 'bold' | 'mono';

/** Base-14 names, so no font program is embedded. */
export const BASE_FONTS: Record<PdfFont, string> = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  mono: 'Courier',
};

/** Stands in for a character WinAnsiEncoding has no glyph for. */
export const SUBSTITUTE = 0x3f; // '?'

/**
 * The CP1252 upper block, by Unicode code point.
 *
 * Worth having in full rather than folding to ASCII: real web copy is full of
 * curly quotes, en dashes and ellipses, and every one of them has a proper
 * glyph here. Flattening them would make Thursday's own report look worse than
 * the page it is describing.
 */
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/**
 * Characters with no WinAnsi slot but an obvious plain-text stand-in.
 *
 * These are substitutions, not losses, so they are not counted against the
 * reader: a non-breaking hyphen rendered as a hyphen is the same hyphen. The
 * various fixed-width spaces collapse to a space, and the zero-width
 * formatting characters vanish -- which is what they already look like.
 */
const PLAIN: Record<number, string> = {
  0x00ad: '', 0x200b: '', 0x200c: '', 0x200d: '', 0xfeff: '',
  0x2011: '-', 0x2012: '-', 0x2015: '-', 0x2212: '-',
  0x2044: '/', 0x2032: "'", 0x2033: '"',
  0x2028: ' ', 0x2029: ' ', 0x3000: ' ', 0x202f: ' ', 0x205f: ' ',
  0x2000: ' ', 0x2001: ' ', 0x2002: ' ', 0x2003: ' ', 0x2004: ' ',
  0x2005: ' ', 0x2006: ' ', 0x2007: ' ', 0x2008: ' ', 0x2009: ' ', 0x200a: ' ',
};

export type Encoded = {
  /** WinAnsi bytes, ready for a PDF string. */
  bytes: number[];
  /** Characters that had no glyph and became `?`. Reported, never hidden. */
  lost: number;
};

/**
 * Turns text into WinAnsi bytes.
 *
 * Control characters are dropped rather than substituted: a stray tab or
 * carriage-order character in scraped page copy is not something the reader
 * needs told about, and printing `?` for it would be noise. Line breaks are
 * the layout's business and are expected to have been split off already.
 */
export function encodeWinAnsi(text: string): Encoded {
  const bytes: number[] = [];
  let lost = 0;

  const push = (source: string): void => {
    for (const character of source) {
      const point = character.codePointAt(0) ?? 0;
      if (point === 0x09) {
        bytes.push(0x20);
        continue;
      }
      if (point < 0x20 || point === 0x7f) continue;
      if (point < 0x7f) {
        bytes.push(point);
        continue;
      }
      const plain = PLAIN[point];
      if (plain !== undefined) {
        // Always ASCII, so this cannot recurse further than one level.
        for (const replacement of plain) bytes.push(replacement.charCodeAt(0));
        continue;
      }
      const mapped = CP1252[point];
      if (mapped !== undefined) {
        bytes.push(mapped);
        continue;
      }
      if (point >= 0xa0 && point <= 0xff) {
        bytes.push(point);
        continue;
      }
      bytes.push(SUBSTITUTE);
      lost += 1;
    }
  };

  push(text);
  return { bytes, lost };
}

/**
 * Glyph widths in 1/1000 em, from the Adobe Font Metrics for the base-14
 * fonts. Transcribed rather than approximated: a wrapped line that is 3%
 * wider than measured overflows the margin, and there is no reflow in a PDF
 * to rescue it.
 */
const ASCII_HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const ASCII_HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** WinAnsi 0x80-0x9F, in order, with the unassigned slots as zero. */
const UPPER_HELVETICA = [
  556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

const UPPER_HELVETICA_BOLD = [
  556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

/** Widths by byte, so measuring is one array read per character. */
function table(ascii: readonly number[], upper: readonly number[]): number[] {
  const widths = new Array<number>(256).fill(0);
  for (let index = 0; index < ascii.length; index += 1) widths[0x20 + index] = ascii[index] ?? 0;
  for (let index = 0; index < upper.length; index += 1) widths[0x80 + index] = upper[index] ?? 0;
  // The unassigned CP1252 slots never reach here (encodeWinAnsi cannot emit
  // them), but a zero width would silently break wrapping if one ever did.
  for (let byte = 0x80; byte < 0x100; byte += 1) {
    if (widths[byte] === 0) widths[byte] = widths[0x20] ?? 278;
  }
  return widths;
}

const WIDTHS: Record<PdfFont, number[]> = {
  regular: table(ASCII_HELVETICA, UPPER_HELVETICA),
  bold: table(ASCII_HELVETICA_BOLD, UPPER_HELVETICA_BOLD),
  // Courier is monospaced at 600 for every glyph it has.
  mono: new Array<number>(256).fill(600),
};

export function widthOfBytes(bytes: readonly number[], font: PdfFont, size: number): number {
  const widths = WIDTHS[font];
  let total = 0;
  for (const byte of bytes) total += widths[byte] ?? 0;
  return (total * size) / 1000;
}

/** Width of `text` if it were drawn in one line. */
export function measure(text: string, font: PdfFont, size: number): number {
  return widthOfBytes(encodeWinAnsi(text).bytes, font, size);
}

/**
 * Breaks text into lines that fit `maxWidth`.
 *
 * Explicit newlines are honoured, because a note the user typed across three
 * lines meant three lines. A single word longer than the measure -- a long URL,
 * a CSS selector -- is split mid-word rather than allowed to run off the page:
 * an ugly break is recoverable, text past the paper edge is not.
 */
export function wrap(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/[ \t]+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, font, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word, font, size) <= maxWidth) {
        line = word;
        continue;
      }
      const pieces = breakWord(word, font, size, maxWidth);
      lines.push(...pieces.slice(0, -1));
      line = pieces[pieces.length - 1] ?? '';
    }
    if (line) lines.push(line);
  }
  return lines;
}

function breakWord(word: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const character of word) {
    const candidate = piece + character;
    if (piece && measure(candidate, font, size) > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  pieces.push(piece);
  return pieces;
}
